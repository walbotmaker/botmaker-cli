const test = require('node:test');
const assert = require('node:assert');
const { collectMoveUpdates } = require('../src/push');
const { CrossTypeMoveError } = require('../src/caPaths');

test('a whole folder moving turns into one rename per client action', () => {
  const cas = [
    { id: '1', name: 'user/ventas/a', type: 'USER', filename: 'src/user/ventas/a.js' },
    { id: '2', name: 'user/ventas/b', type: 'USER', filename: 'src/user/ventas/b.js' },
    { id: '3', name: 'user/otro/c', type: 'USER', filename: 'src/user/otro/c.js' },
  ];
  const statuses = [
    { id: '1', fn: 'src/user/stock/a.js' },
    { id: '2', fn: 'src/user/stock/b.js' },
    { id: '3', fn: 'src/user/otro/c.js' },
  ];

  assert.deepStrictEqual(collectMoveUpdates(cas, statuses), [
    { id: '1', name: 'user/stock/a' },
    { id: '2', name: 'user/stock/b' },
  ]);
});

test('a file moved into another type folder aborts the whole push', () => {
  const cas = [{ id: '1', name: 'user/a', type: 'USER', filename: 'src/user/a.js' }];
  const statuses = [{ id: '1', fn: 'src/mcp/a.js' }];

  assert.throws(() => collectMoveUpdates(cas, statuses), CrossTypeMoveError);
});

test('nothing moved means nothing is sent', () => {
  const cas = [{ id: '1', name: 'user/a', type: 'USER', filename: 'src/user/a.js' }];
  const statuses = [{ id: '1', fn: 'src/user/a.js' }];

  assert.deepStrictEqual(collectMoveUpdates(cas, statuses), []);
});

const { mergePushEntries } = require('../src/push');

test('a client action that only moved still travels, with no code change', () => {
  const moves = [{ id: '1', name: 'user/stock/a' }];
  const statuses = [{ id: '1', fn: 'src/user/stock/a.js' }];

  assert.deepStrictEqual(mergePushEntries([], moves, statuses), [
    { payload: { id: '1', name: 'user/stock/a' }, fn: 'src/user/stock/a.js' },
  ]);
});

test('a code change and a move on the same client action share one payload', () => {
  const entries = [{ payload: { id: '1', unPublishedCode: 'nuevo' }, fn: 'src/user/stock/a.js' }];
  const moves = [{ id: '1', name: 'user/stock/a' }];
  const statuses = [{ id: '1', fn: 'src/user/stock/a.js' }];

  assert.deepStrictEqual(mergePushEntries(entries, moves, statuses), [
    { payload: { id: '1', unPublishedCode: 'nuevo', name: 'user/stock/a' }, fn: 'src/user/stock/a.js' },
  ]);
});
