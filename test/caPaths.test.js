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
