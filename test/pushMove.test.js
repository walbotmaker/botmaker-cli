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

const { adoptProbableMove } = require('../src/push');

test('accepting a probable move makes the status point at the found file', () => {
  const status = {
    id: '1', n: 'a', f: null, fn: 'src/user/viejo.js', m: 'src/user/viejo.js',
    M: 'src/user/viejo.js', p: 'CODE', u: null,
    probableMove: { relPath: 'src/user/nuevo.js', score: 0.8 },
  };

  adoptProbableMove(status, 'CODE EDITADO');

  assert.strictEqual(status.f, 'CODE EDITADO', 'the file content becomes the local code');
  assert.strictEqual(status.fn, 'src/user/nuevo.js');
  assert.strictEqual(status.M, 'src/user/nuevo.js', 'M is where the file really is');
  assert.strictEqual(status.m, 'src/user/viejo.js', 'm stays as the cached path, so the move is still visible');
  assert.strictEqual(status.probableMove, undefined, 'it is no longer pending');
});

test('a file dragged into another type folder gets the type error, not the missing-file one', () => {
  const status = {
    id: '1', n: 'user/test_ab', t: 'USER', f: null,
    fn: 'src/user/test_ab.js', m: 'src/user/test_ab.js', M: 'src/user/test_ab.js',
    p: 'CODE', u: null,
    misplacedAt: 'src/webchatforms/test_ab.js',
  };

  assert.throws(
    () => getPushChanges(status, [ChangeType.REMOVE_LOCAL, ChangeType.LOCAL_CHANGES]),
    (err) => {
      assert.strictEqual(err.name, 'CrossTypeMoveError');
      assert.match(err.message, /src\/webchatforms\/test_ab\.js/, 'it must say where the file went');
      assert.match(err.message, /src\/user\//, 'and where it belongs');
      return true;
    }
  );
});

const { combineBlockers } = require('../src/push');

test('every blocking problem is reported at once, not one per run', () => {
  const errors = [
    new Error("'SelectedProduct' is a USER client action but its file now sits at 'src/whatsappflow/selectedproduct.js'."),
    new Error("'test-csv' is a USER client action but its file now sits at 'src/webchatforms/test_csv.js'."),
  ];

  const combined = combineBlockers(errors);
  assert.match(combined.message, /2 client actions/);
  assert.match(combined.message, /SelectedProduct/);
  assert.match(combined.message, /test-csv/, 'the second one must be in there too');
  assert.match(combined.message, /Nothing was sent/);
});

test('a single blocker keeps its own message, with no list wrapper', () => {
  const only = new Error("'a' is a USER client action but its file now sits at 'src/mcp/a.js'.");
  assert.strictEqual(combineBlockers([only]), only);
});

test('no blockers means nothing to throw', () => {
  assert.strictEqual(combineBlockers([]), null);
});

const { adoptRestoredFile } = require('../src/push');

test('putting a misplaced file back leaves the status ready to push', () => {
  const status = {
    id: '1', n: 'SelectedProduct', t: 'USER', f: null,
    fn: 'src/user/selectedproduct.js', m: 'src/user/selectedproduct.js',
    M: 'src/user/selectedproduct.js', p: 'CODE', u: null,
    misplacedAt: 'src/whatsappflow/selectedproduct.js',
  };

  adoptRestoredFile(status, 'CODE');

  assert.strictEqual(status.misplacedAt, undefined, 'it no longer blocks the push');
  assert.strictEqual(status.f, 'CODE', 'the code is readable again');
  assert.strictEqual(status.fn, 'src/user/selectedproduct.js');
  assert.strictEqual(status.M, 'src/user/selectedproduct.js', 'it is back where .bmc says, so this is not a move');
  assert.strictEqual(status.m, 'src/user/selectedproduct.js');
});
