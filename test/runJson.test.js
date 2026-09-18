const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'bmc.js');

// A workspace is just a .bmc, a context.json and the client action files, so
// these tests drive the real CLI instead of poking at its internals.
const makeWorkspace = (cas) => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-json-'));
  const entries = cas.map(({ name, filename, type, code }) => {
    const full = path.join(wp, filename);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, code, 'utf8');
    return { name, filename, type, publishedCode: code, code };
  });
  fs.writeFileSync(path.join(wp, '.bmc'), JSON.stringify({ token: 'test-token', cas: entries }), 'utf8');
  fs.writeFileSync(
    path.join(wp, 'context.json'),
    JSON.stringify({ userData: { variables: {}, _id_: 'local-test' }, params: {} }),
    'utf8'
  );
  return wp;
};

const bmc = (wp, args) => {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd: wp,
    encoding: 'utf8',
    env: { ...process.env, BMC_LANG: 'en' },
    // A command that hangs is a failure, not a test that runs forever.
    timeout: 20000,
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
};

const mcp = (code) => ({ name: 'mcp/fn', filename: 'src/mcp/fn.ts', type: 'AI_FUNCTION', code });

const DOUBLE = `/**
 * doubles a number
 * @param myNumber the number to double
 * @return the double
 */
export default function double(myNumber: number): number {
  return myNumber * 2;
}
`;

test('a client action that works prints one json object and exits 0', () => {
  const wp = makeWorkspace([mcp(DOUBLE)]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/fn.ts', '-p', 'myNumber', '21']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.type, 'AI_FUNCTION');
  assert.strictEqual(out.result, 42);
  assert.deepStrictEqual(out.logs, []);
});

test('code that does not compile exits 1 and says so as a COMPILE error', () => {
  const wp = makeWorkspace([mcp('export default function f(): number { return "no"; }\n')]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/fn.ts']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 1);
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error.kind, 'COMPILE');
  assert.strictEqual(out.error.code, 'TS_COMPILE_FAILED');
});

test('a client action that throws exits 1 and says so as a RUNTIME error', () => {
  const wp = makeWorkspace([mcp('export default function f() { throw new Error("boom"); }\n')]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/fn.ts']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 1);
  assert.strictEqual(out.error.kind, 'RUNTIME');
  assert.match(out.error.message, /boom/);
});

test('what the client action logs travels inside the json instead of breaking it', () => {
  const wp = makeWorkspace([mcp('export default function f() { console.log("hola"); return 1; }\n')]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/fn.ts']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.deepStrictEqual(out.logs, [{ level: 'log', message: 'hola' }]);
});

test('--schema gives back the tool contract without running the code', () => {
  const wp = makeWorkspace([mcp(`/**
 * doubles a number
 * @param myNumber the number to double
 */
export default function double(myNumber: number): number {
  throw new Error("this must not run");
}
`)]);
  const { status, stdout } = bmc(wp, ['run', '--json', '--schema', 'src/mcp/fn.ts']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.ok(out.inputSchema.properties.myNumber, 'the parameter shows up in the schema');
  assert.ok(!('result' in out), 'nothing ran, so there is no result');
});

test('--schema on something that is not an MCP is a usage error', () => {
  const wp = makeWorkspace([{ name: 'user/a', filename: 'src/user/a.js', type: 'USER', code: 'result.done();\n' }]);
  const { status, stdout } = bmc(wp, ['run', '--json', '--schema', 'src/user/a.js']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 1);
  assert.strictEqual(out.error.code, 'SCHEMA_ONLY_FOR_AI_FUNCTION');
});

test('--json on an endpoint is refused, because an endpoint is a server', () => {
  const wp = makeWorkspace([{ name: 'endpoint/a', filename: 'src/endpoint/a.js', type: 'ENDPOINT', code: '\n' }]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/endpoint/a.js']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 1);
  assert.strictEqual(out.error.kind, 'USAGE');
  assert.strictEqual(out.error.code, 'JSON_NOT_SUPPORTED_FOR_ENDPOINT');
});

test('asking for a client action that is not there is a usage error, not a crash', () => {
  const wp = makeWorkspace([mcp(DOUBLE)]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/nope.ts']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 1);
  assert.strictEqual(out.error.code, 'CA_NOT_FOUND');
});

test('a flow answers with the next screen and the state it left behind', () => {
  const wp = makeWorkspace([{
    name: 'whatsappflow/alta',
    filename: 'src/whatsappflow/alta.js',
    type: 'WHATSAPP_FLOW',
    code: 'flow.nextScreen = "DATOS";\nflow.data = { saludo: "hola" };\nflow.send();\n',
  }]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/whatsappflow/alta.js']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.strictEqual(out.action, 'INIT');
  assert.strictEqual(out.nextScreen, 'DATOS');
  assert.deepStrictEqual(out.data, { saludo: 'hola' });
  assert.strictEqual(out.flowState.screen, 'DATOS', 'the next run starts where this one left off');
  assert.deepStrictEqual(
    JSON.parse(fs.readFileSync(path.join(wp, 'flowstate.json'), 'utf8')),
    out.flowState,
    'what it reports is what it wrote'
  );
});

test('the exit code does not depend on the flag: a failure is 1 in human mode too', () => {
  const wp = makeWorkspace([mcp('export default function f() { throw new Error("boom"); }\n')]);
  const { status, stdout } = bmc(wp, ['run', 'src/mcp/fn.ts']);
  assert.strictEqual(status, 1);
  assert.strictEqual(stdout.trim(), '', 'a failure says nothing on stdout, it goes to stderr');
});

test('without the flag the human output is still the human output', () => {
  const wp = makeWorkspace([mcp(DOUBLE)]);
  const { status, stdout } = bmc(wp, ['run', 'src/mcp/fn.ts', '-p', 'myNumber', '21']);
  assert.strictEqual(status, 0);
  assert.match(stdout, /Success in/);
  assert.match(stdout, /42/);
});

test('a normal client action reports what it said and what it logged', () => {
  const wp = makeWorkspace([{
    name: 'user/a',
    filename: 'src/user/a.js',
    type: 'USER',
    code: "bmconsole.log('paso por aca');\nresult.text('listo');\nresult.done();\n",
  }]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/user/a.js']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.strictEqual(out.type, 'USER');
  assert.deepStrictEqual(out.result.say, [{ literals: ['listo'] }]);
  assert.deepStrictEqual(out.logs, [{ level: 'log', message: 'paso por aca' }]);
});

test('a big result survives a pipe instead of being cut off at 64KB', () => {
  const wp = makeWorkspace([mcp(`/**
 * returns a big list
 */
export default function big() {
  const rows = [];
  for (let i = 0; i < 5000; i++) rows.push({ i, nombre: 'fila numero ' + i });
  return rows;
}
`)]);
  const { status, stdout } = bmc(wp, ['run', '--json', 'src/mcp/fn.ts']);
  assert.ok(stdout.length > 65536, 'the case only bites above one pipe buffer');
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.strictEqual(out.result.length, 5000);
});

test('a flag written before the file does not swallow the file', () => {
  const wp = makeWorkspace([mcp(DOUBLE)]);
  const { status, stdout } = bmc(wp, ['run', '--json', '--volatile', 'src/mcp/fn.ts', '-p', 'myNumber', '21']);
  const out = JSON.parse(stdout);
  assert.strictEqual(status, 0);
  assert.strictEqual(out.result, 42);
});

test('--volatile=false means persist, not the opposite', () => {
  const wp = makeWorkspace([mcp(`/**
 * remembers a greeting
 */
export default function saludar(): string {
  User.set('saludo', 'hola');
  return 'ok';
}
`)]);
  const { status } = bmc(wp, ['run', '--json', '--volatile=false', 'src/mcp/fn.ts']);
  assert.strictEqual(status, 0);
  const context = JSON.parse(fs.readFileSync(path.join(wp, 'context.json'), 'utf8'));
  assert.strictEqual(context.userData.variables.saludo, 'hola', 'asking not to be volatile must save the variables');
});

test('a port that is not a number is refused instead of listening somewhere random', () => {
  const wp = makeWorkspace([{ name: 'endpoint/a', filename: 'src/endpoint/a.js', type: 'ENDPOINT', code: '\n' }]);
  const { status, stderr } = bmc(wp, ['run', '--endpoint', '--port', 'abc', 'src/endpoint/a.js']);
  assert.strictEqual(status, 1, 'it must fail, not start a server');
  assert.match(stderr, /port/i);
});
