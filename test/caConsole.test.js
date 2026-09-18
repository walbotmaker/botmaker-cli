const test = require('node:test');
const assert = require('node:assert');
const { createCollectingConsole } = require('../src/caConsole');

test('what the client action logs is collected, not printed', () => {
  const { bmconsole, logs } = createCollectingConsole();
  bmconsole.log('hola');
  bmconsole.warn('cuidado');
  bmconsole.error('feo');
  assert.deepStrictEqual(logs, [
    { level: 'log', message: 'hola' },
    { level: 'warn', message: 'cuidado' },
    { level: 'error', message: 'feo' },
  ]);
});

test('several arguments are joined the way console.log shows them', () => {
  const { bmconsole, logs } = createCollectingConsole();
  bmconsole.log('total:', 42);
  assert.strictEqual(logs[0].message, 'total: 42');
});

test('an object is written out, not left as [object Object]', () => {
  const { bmconsole, logs } = createCollectingConsole();
  bmconsole.log({ a: 1 });
  assert.match(logs[0].message, /a: 1/);
});

test('nothing logged means an empty list, never undefined', () => {
  const { logs } = createCollectingConsole();
  assert.deepStrictEqual(logs, []);
});
