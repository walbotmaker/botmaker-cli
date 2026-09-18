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

const runUserCa = async (wpPath, token, cas, ca, vars, params, volatile) => {
  const { code, helpers, filePath} = await getCodeAnHelpers(wpPath, cas, ca)
  const context = await getContext(wpPath);
  const commandVars = doubleArrayToObject(vars);
  const commandParameters = doubleArrayToObject(params);
  context.userData.variables = { ...context.userData.variables, ...commandVars }
  context.params = { ...context.params, ...commandParameters }
  const startTime = new Date().getTime();
  const result = await new Promise((fulfill, reject) => {
    try {
      caRunner(code, context, helpers, fulfill, token, filePath);
    } catch (err) {
      reject(err);
    }
  });
  const endTime = new Date().getTime() - startTime;

  if (result) {
    if (result.error && result.stack) {
      const line = result.stack.split('\n')[1] || "";
      const found = line.matchAll(/\<anonymous\>(:\d+:\d+)/g).next();
      console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))))
      if (found.value) {
        console.error(chalk.red(`${result.stack.split('\n')[0]} at ${filePath}${found.value[1]}`));
      } else {
        console.error(chalk.red(result.stack));
      }
    } else if (result.error) {
      console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))))
      console.error(chalk.red(result.error));
    } else {
      const resultRendered = resolveRenderer(result.resultState, context);
      console.log(resultRendered)
      console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))))
      if (!volatile) {
        const newContext = { ...context, userData: { ...context.userData, variables: { ...context.userData.variables, ...result.resultState.user } } }
        await saveContext(wpPath, newContext);
      }
      //console.log(JSON.stringify(result));
    }
  }
  process.exit(0);
}

const runAiFunctionCa = async (wpPath, token, cas, ca, vars, params, volatile) => {
  const { code: tsCode, helpers, filePath } = await getCodeAnHelpers(wpPath, cas, ca);
  const compile = await getCompile();
  const mcpGlobalsPath = path.join(__dirname, '../workspaceTemplate/mcp.d.ts');
  const compileResult = await compile(tsCode, mcpGlobalsPath);
  if ('errors' in compileResult) {
    const msgs = compileResult.errors
      .map(e => (typeof e.message === 'string' ? e.message : e.message.messageText))
      .join('\n');
    throw new Error(__('TypeScript compilation failed:\n%s', msgs));
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

  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', '__dirname', '__filename', 'User', compileResult.code)(
    mod, mod.exports, require, path.dirname(filePath), filePath, User
  );

  const fn = mod.exports.default || mod.exports;
  if (typeof fn !== 'function') throw new Error(__('MCP CA must export a default function'));

  const paramOrder = Object.keys(compileResult.inputSchema?.properties || {});
  const paramValues = paramOrder.length > 0
    ? paramOrder.map(k => commandParameters[k])
    : [commandParameters];

  const startTime = new Date().getTime();
  try {
    const result = await fn(...paramValues);
    const endTime = new Date().getTime() - startTime;
    console.log(JSON.stringify(result, null, 2));
    console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))));
    if (!volatile) {
      const newContext = {
        ...context,
        userData: { ...context.userData, variables: { ...context.userData.variables } }
      };
      await saveContext(wpPath, newContext);
    }
  } catch (err) {
    const endTime = new Date().getTime() - startTime;
    console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))));
    console.error(chalk.red(err.stack || err.message));
  }
  process.exit(0);
};

const runFlowOrFormCa = async (wpPath, token, cas, ca) => {
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

  console.log(chalk.yellow(__('Running %s CA: %s', ca.type, ca.name)));
  console.log(chalk.yellow(`action=${action}${screen ? `, screen=${screen}` : ''}`));

  const startTime = new Date().getTime();
  const result = await caFlowFormRunner({ code, filePath, helpers, token, wpPath, context, action, screen, data, responseVar });
  const endTime = new Date().getTime() - startTime;

  if (result.error) {
    console.error(chalk.red(' ❌ ' + __('Fail in %sms', String(endTime))));
    console.error(chalk.red(result.stack || result.error));
  } else {
    console.log(chalk.green(' ✓ ' + __('Success in %sms', String(endTime))));
    if (result.nextScreen) {
      console.log(chalk.cyan(` → ${__('nextScreen: %s', result.nextScreen)}`));
    } else {
      console.log(chalk.cyan(' → ' + __('flow finished (SUCCESS)')));
    }
    if (result.data && Object.keys(result.data).length > 0) {
      console.log(chalk.cyan(' → ' + __('data:')), JSON.stringify(result.data, null, 2));
    }
    const newFlowState = result.nextScreen
      ? { action: 'data_exchange', screen: result.nextScreen, data: result.data || {} }
      : { action: 'INIT', screen: '', data: {} };
    await writeFile(flowStatePath, JSON.stringify(newFlowState, null, 2), 'utf-8');
  }
  process.exit(0);
};

const run = async (pwd, file, { vars, params, volatile, endpoint, port = 7070 }) => {
  const wpPath = await getWorkspacePath(pwd);
  const { token, cas } = await getBmc(wpPath);
  const ca = await getCaByNameOrPath(wpPath, cas, file);
  const type = endpoint ? CaType.ENDPOINT : (ca.type || CaType.USER);
  if (type === CaType.USER) {
    await runUserCa(wpPath, token, cas, ca, vars, params, volatile);
  } else if (type === CaType.AI_FUNCTION) {
    await runAiFunctionCa(wpPath, token, cas, ca, vars, params, volatile);
  } else if (type === CaType.ENDPOINT || type === 'SCHEDULE') {
    await runEndpointCa(wpPath, token, cas, ca, port);
  } else if (type === CaType.WHATSAPP_FLOW || type === CaType.WEBCHAT_FORM) {
    await runFlowOrFormCa(wpPath, token, cas, ca);
  } else {
    throw new Error(__("'%s' invalid client action type.", type));
  }
};

module.exports = run;