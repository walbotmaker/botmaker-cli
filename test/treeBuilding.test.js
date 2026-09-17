const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nameToRelPath } = require('../src/caPaths');

// Mirrors what importWorkspace does per client action, without the API call.
const placeCa = (wpPath, ca) => {
  const rel = nameToRelPath(ca.type, ca.name);
  fs.mkdirSync(path.join(wpPath, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(wpPath, rel), ca.code, 'utf8');
  return rel;
};

test('the tree is built under the folder of each type', () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  const cas = [
    { name: 'user/ventas/promos/miFn', type: 'USER', code: 'a' },
    { name: 'ventas/otro', type: 'AI_FUNCTION', code: 'b' },
    { name: 'suelto', type: 'ENDPOINT', code: 'c' },
  ];
  const rels = cas.map(ca => placeCa(wp, ca));

  assert.deepStrictEqual(rels, [
    'src/user/ventas/promos/mifn.js',
    'src/mcp/ventas/otro.ts',
    'src/endpoint/suelto.js',
  ]);
  for (const rel of rels) {
    assert.ok(fs.existsSync(path.join(wp, rel)), `${rel} should exist`);
  }
  fs.rmSync(wp, { recursive: true, force: true });
});

test('the same file name lives in two different folders without colliding', () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  const a = placeCa(wp, { name: 'ventas/x', type: 'USER', code: 'a' });
  const b = placeCa(wp, { name: 'stock/x', type: 'USER', code: 'b' });

  assert.notStrictEqual(a, b);
  assert.strictEqual(fs.readFileSync(path.join(wp, a), 'utf8'), 'a');
  assert.strictEqual(fs.readFileSync(path.join(wp, b), 'utf8'), 'b');
  fs.rmSync(wp, { recursive: true, force: true });
});
