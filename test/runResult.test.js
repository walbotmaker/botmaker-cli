const test = require('node:test');
const assert = require('node:assert');
const {
  buildEnvelope,
  exitCodeFor,
  renderJson,
  compileError,
  runtimeError,
  usageError,
  ErrorKind,
} = require('../src/runResult');

test('a run with no error is reported as ok', () => {
  const envelope = buildEnvelope({ type: 'AI_FUNCTION', name: 'ventas/miFn', durationMs: 34, result: { total: 42 } });
  assert.strictEqual(envelope.ok, true);
  assert.strictEqual(envelope.type, 'AI_FUNCTION');
  assert.strictEqual(envelope.name, 'ventas/miFn');
  assert.strictEqual(envelope.durationMs, 34);
  assert.deepStrictEqual(envelope.result, { total: 42 });
});

test('a run with an error is reported as not ok', () => {
  const envelope = buildEnvelope({ type: 'AI_FUNCTION', error: runtimeError('boom') });
  assert.strictEqual(envelope.ok, false);
  assert.strictEqual(envelope.error.kind, ErrorKind.RUNTIME);
});

test('logs are always an array, so nobody has to check for null', () => {
  const envelope = buildEnvelope({ type: 'USER' });
  assert.deepStrictEqual(envelope.logs, []);
});

test('a client action that returns nothing still reports a result, as null', () => {
  const envelope = buildEnvelope({ type: 'USER', result: undefined });
  assert.strictEqual(envelope.result, null);
});

test('the input schema travels only when there is one', () => {
  const withSchema = buildEnvelope({ type: 'AI_FUNCTION', inputSchema: { properties: { a: {} } } });
  assert.deepStrictEqual(withSchema.inputSchema, { properties: { a: {} } });
  const without = buildEnvelope({ type: 'AI_FUNCTION' });
  assert.ok(!('inputSchema' in without), 'no empty inputSchema key');
});

test('the flow fields sit at the top level, next to ok', () => {
  const envelope = buildEnvelope({
    type: 'WHATSAPP_FLOW',
    flow: { action: 'INIT', screen: '', nextScreen: 'DATOS', data: { a: 1 }, flowState: { action: 'data_exchange', screen: 'DATOS', data: {} } },
  });
  assert.strictEqual(envelope.action, 'INIT');
  assert.strictEqual(envelope.screen, '');
  assert.strictEqual(envelope.nextScreen, 'DATOS');
  assert.deepStrictEqual(envelope.data, { a: 1 });
  assert.deepStrictEqual(envelope.flowState, { action: 'data_exchange', screen: 'DATOS', data: {} });
});

test('a flow that finished has no nextScreen key at all', () => {
  const envelope = buildEnvelope({ type: 'WHATSAPP_FLOW', flow: { action: 'INIT', screen: '' } });
  assert.ok(!('nextScreen' in envelope), 'a finished flow must not carry an empty nextScreen');
});

test('a compile error carries its diagnostics and a stable code', () => {
  const error = compileError('no compila', [{ code: 2345, message: 'bad arg', start: 120 }]);
  assert.strictEqual(error.kind, ErrorKind.COMPILE);
  assert.strictEqual(error.code, 'TS_COMPILE_FAILED');
  assert.strictEqual(error.diagnostics.length, 1);
});

test('a runtime error keeps the stack when there is one', () => {
  const error = runtimeError('boom', 'Error: boom\n    at x');
  assert.strictEqual(error.code, 'CA_THREW');
  assert.ok(error.stack.includes('at x'));
  assert.ok(!('diagnostics' in error), 'a runtime error has no diagnostics');
});

test('a usage error names what the caller got wrong', () => {
  const error = usageError('JSON_NOT_SUPPORTED_FOR_ENDPOINT', 'endpoint runs a server');
  assert.strictEqual(error.kind, ErrorKind.USAGE);
  assert.strictEqual(error.code, 'JSON_NOT_SUPPORTED_FOR_ENDPOINT');
});

test('every error code is spelled the same way, whatever the locale', () => {
  const error = compileError('no compila');
  assert.match(error.code, /^[A-Z0-9_]+$/);
});

test('ok exits 0 and a failure exits 1', () => {
  assert.strictEqual(exitCodeFor(buildEnvelope({ type: 'USER' })), 0);
  assert.strictEqual(exitCodeFor(buildEnvelope({ type: 'USER', error: runtimeError('boom') })), 1);
});

test('the rendered json is the only thing on the line, and it parses', () => {
  const envelope = buildEnvelope({ type: 'AI_FUNCTION', result: { a: 1 }, logs: [{ level: 'log', message: 'hola' }] });
  const parsed = JSON.parse(renderJson(envelope));
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(parsed.logs, [{ level: 'log', message: 'hola' }]);
});

test('a result that cannot be serialized still comes out as valid json', () => {
  const circular = { name: 'loop' };
  circular.self = circular;
  const parsed = JSON.parse(renderJson(buildEnvelope({ type: 'AI_FUNCTION', result: circular })));
  assert.strictEqual(parsed.ok, false, 'a result we cannot show is a failure, not a silent success');
  assert.strictEqual(parsed.error.code, 'RESULT_NOT_SERIALIZABLE');
});

test('a runtime error can carry its own code, for failures that are not a throw', () => {
  const error = runtimeError('no exporta nada', null, 'CA_NOT_A_FUNCTION');
  assert.strictEqual(error.kind, ErrorKind.RUNTIME);
  assert.strictEqual(error.code, 'CA_NOT_A_FUNCTION');
});
