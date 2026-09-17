const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { moveLocalFile } = require('../src/workspaceFiles');

test('a moved file lands in the new folder and leaves no empty folder behind', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  const from = 'src/user/ventas/promos/mifn.js';
  const to = 'src/user/stock/mifn.js';
  fs.mkdirSync(path.join(wp, path.dirname(from)), { recursive: true });
  fs.writeFileSync(path.join(wp, from), 'contenido', 'utf8');

  await moveLocalFile(wp, from, to);

  assert.ok(fs.existsSync(path.join(wp, to)), 'the file should be at its new path');
  assert.strictEqual(fs.readFileSync(path.join(wp, to), 'utf8'), 'contenido');
  assert.ok(!fs.existsSync(path.join(wp, from)), 'the old file should be gone');
  assert.ok(!fs.existsSync(path.join(wp, 'src/user/ventas')), 'the empty folder should be pruned');
  assert.ok(fs.existsSync(path.join(wp, 'src/user')), 'the type folder itself must survive');

  fs.rmSync(wp, { recursive: true, force: true });
});

test('a folder that still holds other files is not pruned', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  fs.mkdirSync(path.join(wp, 'src/user/ventas'), { recursive: true });
  fs.writeFileSync(path.join(wp, 'src/user/ventas/a.js'), 'a', 'utf8');
  fs.writeFileSync(path.join(wp, 'src/user/ventas/b.js'), 'b', 'utf8');

  await moveLocalFile(wp, 'src/user/ventas/a.js', 'src/user/stock/a.js');

  assert.ok(fs.existsSync(path.join(wp, 'src/user/ventas/b.js')), 'the sibling must stay');
  assert.ok(fs.existsSync(path.join(wp, 'src/user/ventas')), 'a non-empty folder must survive');

  fs.rmSync(wp, { recursive: true, force: true });
});
