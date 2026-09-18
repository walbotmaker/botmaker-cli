// Messages are asserted verbatim, so they must not follow the machine's locale.
process.env.BMC_LANG = 'en';
const test = require('node:test');
const assert = require('node:assert');
const { formatSegment, formatName, nameToRelPath } = require('../src/caPaths');

test('formatSegment cleans up one segment', () => {
  assert.strictEqual(formatSegment('miFunción Ñ'), 'mifuncion_n');
});

test('formatName normalizes each segment and keeps the slashes', () => {
  assert.strictEqual(formatName('Ventas/Promos 2026/miFn'), 'ventas/promos_2026/mifn');
});

test('nameToRelPath hangs the tree off the type folder', () => {
  assert.strictEqual(
    nameToRelPath('USER', 'ventas/promos/miFn'),
    'src/user/ventas/promos/mifn.js'
  );
});

test('nameToRelPath drops the type prefix when the name already carries it', () => {
  assert.strictEqual(
    nameToRelPath('AI_FUNCTION', 'mcp/ventas/miFn'),
    'src/mcp/ventas/mifn.ts'
  );
});

test('a name with no folders lands at the root of its type folder', () => {
  assert.strictEqual(nameToRelPath('ENDPOINT', 'miFn'), 'src/endpoint/mifn.js');
});

test('a client action literally named like its own type folder is kept', () => {
  assert.strictEqual(nameToRelPath('USER', 'user'), 'src/user/user.js');
});

test('an empty name is refused', () => {
  assert.throws(() => nameToRelPath('USER', '///'), /no usable segments/);
});

const {
  relPathToName,
  movedName,
  assertNoForeignTypePrefix,
  CrossTypeMoveError,
} = require('../src/caPaths');

test('relPathToName strips src and the extension, and adds the type prefix', () => {
  assert.strictEqual(
    relPathToName('USER', 'src/user/ventas/promos/mifn.js'),
    'user/ventas/promos/mifn'
  );
});

test('a file that did not move produces no new name', () => {
  const ca = { name: 'miFn', type: 'USER', filename: 'src/user/mifn.js' };
  assert.strictEqual(movedName(ca, 'src/user/mifn.js'), null);
});

test('moving a file to another folder keeps the original leaf spelling', () => {
  const ca = { name: 'miFunciónÑ', type: 'USER', filename: 'src/user/mifuncion_n.js' };
  assert.strictEqual(
    movedName(ca, 'src/user/ventas/mifuncion_n.js'),
    'user/ventas/miFunciónÑ'
  );
});

test('renaming the file itself does change the leaf', () => {
  const ca = { name: 'miFn', type: 'USER', filename: 'src/user/mifn.js' };
  assert.strictEqual(movedName(ca, 'src/user/ventas/otro.js'), 'user/ventas/otro');
});

test('moving a file into another type folder is refused', () => {
  const ca = { name: 'miFn', type: 'USER', filename: 'src/user/mifn.js' };
  assert.throws(() => movedName(ca, 'src/mcp/mifn.js'), CrossTypeMoveError);
});

test('creating a client action under another type folder is refused', () => {
  assert.throws(
    () => assertNoForeignTypePrefix('ENDPOINT', 'mcp/x'),
    /folder of another client action type/
  );
});

test('the type prefix of its own type is fine', () => {
  assert.doesNotThrow(() => assertNoForeignTypePrefix('ENDPOINT', 'endpoint/x'));
});

const { withTypeFolder } = require('../src/caPaths');

test('swapping the type folder keeps the folders the user built', () => {
  assert.strictEqual(
    withTypeFolder('USER', 'src/schedule/test_2/carrousel.js'),
    'src/user/test_2/carrousel.js'
  );
});

test('a file at the root of the wrong type folder lands at the root of the right one', () => {
  assert.strictEqual(withTypeFolder('USER', 'src/mcp/algo.js'), 'src/user/algo.js');
});

test('nested folders survive whole', () => {
  assert.strictEqual(
    withTypeFolder('ENDPOINT', 'src/user/ventas/promos/x.js'),
    'src/endpoint/ventas/promos/x.js'
  );
});

test('a path that is not under a type folder gives nothing back to guess from', () => {
  assert.strictEqual(withTypeFolder('USER', 'suelto.js'), null);
});

test('the error points at the type folder and suggests keeping the folders', () => {
  const err = new CrossTypeMoveError(
    { name: 'Carrousel', type: 'USER' },
    'src/user/carrousel.js',
    'src/schedule/test_2/carrousel.js'
  );
  assert.match(err.message, /Move it anywhere under 'src\/user\/'/);
  assert.match(err.message, /src\/user\/test_2\/carrousel\.js/, 'it suggests the same folder under the right type');
});

test('with no folders to keep, the error suggests nothing extra', () => {
  const err = new CrossTypeMoveError(
    { name: 'test-csv', type: 'USER' },
    'src/user/test_csv.js',
    'src/webchatforms/test_csv.js'
  );
  assert.match(err.message, /Move it anywhere under 'src\/user\/', then push again/);
  assert.ok(!/would keep the folders/.test(err.message), 'no folder suggestion when there is no folder');
});
