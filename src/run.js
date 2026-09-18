const readline = require('readline');
const fs = require('fs');
const rp = require('request-promise');
const util = require('util');
const caRunner = require('./caRunner');
const path = require('path');
const resolveRenderer = require('./resultRenderer');
const chalk = require('chalk');
const { __ } = require('./i18n');
const getWorkspacePath = require('./getWorkspacePath');
const { getBmc, getContext, saveContext } = require('./bmcConfig');
const express = require('express');
const { getCaByNameOrPath } = require('./getStatus');
const caEndpointRunner = require('./caEndpointRunner');
const caFlowFormRunner = require('./caFlowFormRunner');
const CaType = require('./caTypes');
const { buildEnvelope, exitCodeFor, renderJson, compileError, runtimeError, usageError } = require('./runResult');
const { createCollectingConsole } = require('./caConsole');
const { Project, ts } = require('ts-morph');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const exists = util.promisify(fs.exists);

let _compileFn = null;
const getCompile = async () => {
  if (_compileFn) return _compileFn;
  const tsFilePath = path.join(__dirname, 'tsCompiler.ts');
  const project = new Project({
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ESNext,
      esModuleInterop: true,
      skipLibCheck: true,
    }
  });
  project.addSourceFileAtPath(tsFilePath);
  const sourceFile = project.getSourceFileOrThrow(tsFilePath);
  sourceFile.replaceWithText(sourceFile.getText().replace(/import\.meta\.dirname/g, '__dirname'));
  const emitResult = project.emitToMemory();
  const jsFile = emitResult.getFiles().find(f => f.filePath.includes('tsCompiler'));
  if (!jsFile) throw new Error(__('Failed to emit tsCompiler.ts'));
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', '__filename', jsFile.text)(
    mod, mod.exports, require, __dirname, tsFilePath
  );
  _compileFn = mod.exports.compile;
  if (typeof _compileFn !== 'function') throw new Error(__('tsCompiler bridge failed to export compile()'));
  return _compileFn;
};

const doubleArrayToObject = array => {
  const obj = {};
  for (let index = 0; index < array.length / 2; index++) {
    obj[array[index]] = array[index + 1];
  }
  return obj
}

// The single exit point of run: prints the machine-readable result when it
// was asked for, and turns a failure into a non-zero status so a script can
// tell success from failure without reading the text.
//
// It waits for stdout before leaving: process.exit() throws away whatever is
// still buffered, and when the output goes through a pipe that cuts a big
// result at 64KB.
const finish = (envelope, json) => {
  const code = exitCodeFor(envelope);
  process.exitCode = code;
  const bye = () => process.exit(code);
  if (json) process.stdout.write(renderJson(envelope) + '\n', bye);
  else if (process.stdout.writableLength > 0) process.stdout.once('drain', bye);
  else bye();
};

const require_core_action_pattern = /require\((?:(?:'([a-zA-Z0-9_-]*))'|(?:"([a-zA-Z0-9_-]*)"))\)/g

const getCodeAnHelpers = async (wpPath, cas, ca) => {
  const filePath = path.join(wpPath, ca.filename);
  const helpers = {};

  let code = await readFile(filePath, "utf8");
  let match;

  while ((match = require_core_action_pattern.exec(code)) != null) {
    const req = match[1] || match[2];
    if (!req) continue
    const posibleReqFile = (cas.find(c => c.name === req) || {}).filename || `src/${req}.js`;
    const posibleUtils = path.join(wpPath, posibleReqFile);
    if (await exists(posibleUtils)) {
      let helper = await readFile(posibleUtils, "utf8");
      const parsedHelper = "({" + helper.replace(/function /, "").replace(/function /g, ",") + "})\n//# sourceURL=" + posibleUtils;
      helpers[req] = {code: parsedHelper, source: posibleUtils};
    }
  }
  return { code, helpers, filePath};
}

const runEndpointCa = async (wpPath, token, cas, ca, port) => {


  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  // app.use(express.raw());
  // app.use(express.text());
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  

  app.use((req, res, next) => {
    const start = (new Date()).getTime();
    console.log(chalk.yellow(` ${__('Req')} [${req.method}] ${req.path}`));
    res.on('finish', () => {
      const end = (new Date()).getTime();
      if(res.statusCode >= 200 && res.statusCode < 300) {
        console.log(chalk.green(` ${__('Res')} [${res.statusCode}] ${__('on %sms', String(end - start))}`));  
      } else {
        console.log(chalk.red(` ${__('Res')} [${res.statusCode}] ${__('on %sms', String(end - start))}`));
      }
    });
    next();
  });


  const runTest = () => new Promise( r => rl.question(__("Press ENTER to run test"), r ) )
    .then( async () => {
      console.log(__('Calling service...'))
      try{
        const ret = await rp({uri:`http://localhost:${port}`});
        console.log(chalk.green(ret));  
      } catch( err ) {
        console.error(chalk.red(err.message));
      }
      return runTest();
    });


  app.use(async (req, res) => {
    const { code, helpers, filePath} = await getCodeAnHelpers(wpPath, cas, ca)
    caEndpointRunner(req, res, token, code, helpers, filePath);
  });

  app.listen(port, () => {
    console.log(chalk.green(__('Listening in http://localhost:%s', String(port))));
    console.log(__('Press Ctrl + C to stop the server.'));
    runTest();
  });

  rl.on("close", function() {
    console.log('\n' + __('BYE BYE !!!'));
    process.exit(0);
  });
  
};

const runUserCa = async (wpPath, token, cas, ca, vars, params, volatile, opts = {}) => {
  const { json } = opts;
  const { code, helpers, filePath} = await getCodeAnHelpers(wpPath, cas, ca)
  const context = await getContext(wpPath);
  const commandVars = doubleArrayToObject(vars);
  const commandParameters = doubleArrayToObject(params);
  context.userData.variables = { ...context.userData.variables, ...commandVars }
  context.params = { ...context.params, ...commandParameters }
  const collected = json ? createCollectingConsole() : null;
  const startTime = new Date().getTime();
  const result = await new Promise((fulfill, reject) => {
    try {
      caRunner(code, context, helpers, fulfill, token, filePath, collected && collected.bmconsole);
    } catch (err) {
      reject(err);
    }
  });
  const endTime = new Date().getTime() - startTime;
  const logs = collected ? collected.logs : [];
  const base = { type: ca.type || CaType.USER, name: ca.name, durationMs: endTime, logs };

  if (result && result.error) {
    if (!json) {
      console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))))
      if (result.stack) {
        const line = result.stack.split('\n')[1] || "";
        const found = line.matchAll(/\<anonymous\>(:\d+:\d+)/g).next();
        if (found.value) {
          console.error(chalk.red(`${result.stack.split('\n')[0]} at ${filePath}${found.value[1]}`));
        } else {
          console.error(chalk.red(result.stack));
        }
      } else {
        console.error(chalk.red(result.error));
      }
    }
    return finish(buildEnvelope({ ...base, error: runtimeError(result.error.message || result.error, result.stack) }), json);
  }

  if (result) {
    if (!json) {
      console.log(resolveRenderer(result.resultState, context))
      console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))))
    }
    if (!volatile) {
      const newContext = { ...context, userData: { ...context.userData, variables: { ...context.userData.variables, ...result.resultState.user } } }
      await saveContext(wpPath, newContext);
    }
  }
  return finish(buildEnvelope({ ...base, result: result ? result.resultState : null }), json);
}

const runAiFunctionCa = async (wpPath, token, cas, ca, vars, params, volatile, opts = {}) => {
  const { json, schema } = opts;
  const { code: tsCode, helpers, filePath } = await getCodeAnHelpers(wpPath, cas, ca);
  const compile = await getCompile();
  const mcpGlobalsPath = path.join(__dirname, '../workspaceTemplate/mcp.d.ts');
  const compileResult = await compile(tsCode, mcpGlobalsPath);
  const base = { type: CaType.AI_FUNCTION, name: ca.name };
  if ('errors' in compileResult) {
    const diagnostics = compileResult.errors.map(e => ({
      code: e.code,
      message: typeof e.message === 'string' ? e.message : e.message.messageText,
      start: e.start,
    }));
    const msgs = diagnostics.map(d => d.message).join('\n');
    if (!json) console.error(chalk.red(__('TypeScript compilation failed:\n%s', msgs)));
    return finish(buildEnvelope({ ...base, error: compileError(msgs, diagnostics) }), json);
  }
  const inputSchema = compileResult.inputSchema || {};

  // --schema stops here on purpose: the schema is the contract the model sees
  // as a tool, and checking it should never run the function's side effects.
  if (schema) {
    if (!json) console.log(JSON.stringify(inputSchema, null, 2));
    return finish(buildEnvelope({ ...base, inputSchema }), json);
  }

  const context = await getContext(wpPath);
  const commandVars = doubleArrayToObject(vars);
  const commandParameters = doubleArrayToObject(params);
  context.userData.variables = { ...context.userData.variables, ...commandVars };
  context.params = { ...context.params, ...commandParameters };

  const User = {
    get: (key) => context.userData.variables[key],
    set: (key, value) => { context.userData.variables[key] = value; },
  };

  const collected = json ? createCollectingConsole() : null;
  const logs = collected ? collected.logs : [];
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', '__filename', 'User', 'console', compileResult.code)(
    mod, mod.exports, require, path.dirname(filePath), filePath, User, collected ? collected.bmconsole : console
  );

  const fn = mod.exports.default || mod.exports;
  if (typeof fn !== 'function') {
    const msg = __('MCP CA must export a default function');
    if (!json) console.error(chalk.red(msg));
    return finish(buildEnvelope({ ...base, logs, error: runtimeError(msg, null, 'CA_NOT_A_FUNCTION') }), json);
  }

  const paramOrder = Object.keys(inputSchema.properties || {});
  const paramValues = paramOrder.length > 0
    ? paramOrder.map(k => commandParameters[k])
    : [commandParameters];

  const startTime = new Date().getTime();
  try {
    const result = await fn(...paramValues);
    const endTime = new Date().getTime() - startTime;
    if (!json) {
      console.log(JSON.stringify(result, null, 2));
      console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))));
    }
    if (!volatile) {
      const newContext = {
        ...context,
        userData: { ...context.userData, variables: { ...context.userData.variables } }
      };
      await saveContext(wpPath, newContext);
    }
    return finish(buildEnvelope({ ...base, durationMs: endTime, result, inputSchema, logs }), json);
  } catch (err) {
    const endTime = new Date().getTime() - startTime;
    if (!json) {
      console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))));
      console.error(chalk.red(err.stack || err.message));
    }
    return finish(buildEnvelope({ ...base, durationMs: endTime, inputSchema, logs, error: runtimeError(err.message, err.stack) }), json);
  }
};

const runFlowOrFormCa = async (wpPath, token, cas, ca, opts = {}) => {
  const { json } = opts;
  const { code, helpers, filePath } = await getCodeAnHelpers(wpPath, cas, ca);
  const context = await getContext(wpPath);

  // flowstate.json is the local stand-in for what WhatsApp/Webchat would send:
  // where the user is in the flow. Each run advances it to the next screen.
  let testData = {};
  const flowStatePath = path.join(wpPath, 'flowstate.json');
  if (await exists(flowStatePath)) {
    testData = JSON.parse(await readFile(flowStatePath, 'utf8'));
  }

  const action = testData.action || 'INIT';
  const screen = testData.screen || '';
  const data = testData.data || {};
  const responseVar = ca.type === CaType.WHATSAPP_FLOW ? 'flow' : 'form';
  const collected = json ? createCollectingConsole() : null;
  const logs = collected ? collected.logs : [];
  const base = { type: ca.type, name: ca.name, logs };

  if (!json) {
    console.log(chalk.yellow(__('Running %s CA: %s', ca.type, ca.name)));
    console.log(chalk.yellow(`action=${action}${screen ? `, screen=${screen}` : ''}`));
  }

  const startTime = new Date().getTime();
  const result = await caFlowFormRunner({ code, filePath, helpers, token, wpPath, context, action, screen, data, responseVar, bmconsole: collected ? collected.bmconsole : null });
  const endTime = new Date().getTime() - startTime;

  if (result.error) {
    if (!json) {
      console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))));
      console.error(chalk.red(result.stack || result.error));
    }
    return finish(buildEnvelope({
      ...base,
      durationMs: endTime,
      flow: { action, screen },
      error: runtimeError(result.error.message || result.error, result.stack),
    }), json);
  }

  const flowState = result.nextScreen
    ? { action: 'data_exchange', screen: result.nextScreen, data: result.data || {} }
    : { action: 'INIT', screen: '', data: {} };
  await writeFile(flowStatePath, JSON.stringify(flowState, null, 2), 'utf-8');

  if (!json) {
    console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))));
    if (result.nextScreen) {
      console.log(chalk.cyan(` → ${__('nextScreen: %s', result.nextScreen)}`));
    } else {
      console.log(chalk.cyan(' → ' + __('flow finished (SUCCESS)')));
    }
    if (result.data && Object.keys(result.data).length > 0) {
      console.log(chalk.cyan(' → ' + __('data:')), JSON.stringify(result.data, null, 2));
    }
  }

  return finish(buildEnvelope({
    ...base,
    durationMs: endTime,
    flow: { action, screen, nextScreen: result.nextScreen, data: result.data || {}, flowState },
  }), json);
};

// A problem the caller caused, not the client action: no workspace, no such
// client action, a flag that does not apply to this type.
const usageFailure = (code, message) => Object.assign(new Error(message), { bmcError: usageError(code, message) });

const run = async (pwd, file, { vars, params, volatile, endpoint, port = 7070, json = false, schema = false }) => {
  try {
    const wpPath = await getWorkspacePath(pwd);
    const { token, cas } = await getBmc(wpPath);
    // getCaByNameOrPath throws plain text when it finds nothing; give that
    // failure a stable code so a caller does not have to read the message.
    const ca = await getCaByNameOrPath(wpPath, cas, file).catch(err => {
      throw usageFailure('CA_NOT_FOUND', err.message);
    });
    if (!ca) throw usageFailure('CA_NOT_FOUND', __("'%s' is not a client action of this workspace.", file));
    const type = endpoint ? CaType.ENDPOINT : (ca.type || CaType.USER);
    if (schema && type !== CaType.AI_FUNCTION) {
      throw usageFailure('SCHEMA_ONLY_FOR_AI_FUNCTION', __('--schema only works on AI function client actions.'));
    }
    if (json && (type === CaType.ENDPOINT || type === CaType.SCHEDULE)) {
      throw usageFailure('JSON_NOT_SUPPORTED_FOR_ENDPOINT', __('--json does not apply to %s: it starts a server instead of returning a result.', type));
    }
    // An unusable port would otherwise reach express, which quietly listens
    // on a random free one instead of the one you asked for.
    const servesHttp = type === CaType.ENDPOINT || type === CaType.SCHEDULE;
    if (servesHttp && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      throw usageFailure('INVALID_PORT', __('--port must be a whole number between 1 and 65535.'));
    }
    if (type === CaType.USER) {
      await runUserCa(wpPath, token, cas, ca, vars, params, volatile, { json });
    } else if (type === CaType.AI_FUNCTION) {
      await runAiFunctionCa(wpPath, token, cas, ca, vars, params, volatile, { json, schema });
    } else if (type === CaType.ENDPOINT || type === 'SCHEDULE') {
      await runEndpointCa(wpPath, token, cas, ca, port);
    } else if (type === CaType.WHATSAPP_FLOW || type === CaType.WEBCHAT_FORM) {
      await runFlowOrFormCa(wpPath, token, cas, ca, { json });
    } else {
      throw usageFailure('INVALID_CA_TYPE', __("'%s' invalid client action type.", type));
    }
  } catch (err) {
    const error = err.bmcError || usageError('RUN_SETUP_FAILED', err.message || String(err));
    if (!json) console.error(`bmc: ${error.message}`);
    finish(buildEnvelope({ error }), json);
  }
};

module.exports = run;