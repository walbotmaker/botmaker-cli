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

const { nameToRelPath, relPathToName, assertNoForeignTypePrefix } = require('../src/caPaths');

test('renaming across folders is just a new path for the same client action', () => {
  const ca = { name: 'user/ventas/viejo', type: 'USER', filename: 'src/user/ventas/viejo.js' };
  const target = nameToRelPath(ca.type, 'stock/nuevo');

  assert.strictEqual(target, 'src/user/stock/nuevo.js');
  assert.strictEqual(relPathToName(ca.type, target), 'user/stock/nuevo');
  assert.throws(() => assertNoForeignTypePrefix('USER', 'mcp/nuevo'), /another client action type/);
});

const getPushChanges = require('../src/push').getPushChanges;
const { ChangeType } = require('../src/getStatus');

test('a client action whose local file is gone is refused, not pushed as empty code', () => {
  // The file was moved or deleted, so f is null. LOCAL_CHANGES still fires
  // because null differs from the published code — pushing that would send
  // empty code to the platform.
  const status = {
    id: '1', n: 'Test A/B', f: null, fn: 'src/user/test_a/b.js',
    p: 'const main = ...', u: null,
  };
  const changes = [ChangeType.REMOVE_LOCAL, ChangeType.LOCAL_CHANGES];

  assert.throws(() => getPushChanges(status, changes), /has no local file/);
});

test('a normal code change still pushes', () => {
  const status = {
    id: '1', n: 'a', f: 'nuevo', fn: 'src/user/a.js', p: 'viejo', u: null,
  };
  const result = getPushChanges(status, [ChangeType.LOCAL_CHANGES]);
  assert.deepStrictEqual(result, { payload: { id: '1', unPublishedCode: 'nuevo' }, fn: 'src/user/a.js' });
});
