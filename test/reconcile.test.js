const test = require('node:test');
const assert = require('node:assert');
const { similarity, matchMissingCas, SIMILARITY_THRESHOLD } = require('../src/reconcile');

test('identical content scores 1', () => {
  assert.strictEqual(similarity('a\nb\nc\n', 'a\nb\nc\n'), 1);
});

test('completely different content scores low', () => {
  assert.ok(similarity('a\nb\nc\n', 'x\ny\nz\n') < 0.2);
});

test('a small edit still scores high, like git', () => {
  const a = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nnueve\ndiez\n';
  const b = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nCAMBIADA\nOTRA\n';
  const score = similarity(a, b);
  assert.ok(score >= 0.5 && score < 1, `expected a high but partial score, got ${score}`);
});

test('an empty side scores 0 instead of dividing by zero', () => {
  assert.strictEqual(similarity('', 'a\n'), 0);
  assert.strictEqual(similarity('a\n', ''), 0);
});

test('a file with the exact published code is adopted', () => {
  const missing = [{ id: '1', name: 'Test A/B', type: 'USER', publishedCode: 'CODE', unPublishedCode: null }];
  const candidates = [{ relPath: 'src/user/test_a_b.js', content: 'CODE' }];

  const { exact, probable } = matchMissingCas(missing, candidates);
  assert.strictEqual(exact.get('1'), 'src/user/test_a_b.js');
  assert.strictEqual(probable.size, 0);
});

test('the draft counts too, not just the published code', () => {
  const missing = [{ id: '1', name: 'a', type: 'USER', publishedCode: 'VIEJO', unPublishedCode: 'BORRADOR' }];
  const candidates = [{ relPath: 'src/user/otro.js', content: 'BORRADOR' }];

  assert.strictEqual(matchMissingCas(missing, candidates).exact.get('1'), 'src/user/otro.js');
});

test('two files with the same content are not guessed at', () => {
  const missing = [{ id: '1', name: 'a', type: 'USER', publishedCode: 'CODE', unPublishedCode: null }];
  const candidates = [
    { relPath: 'src/user/uno.js', content: 'CODE' },
    { relPath: 'src/user/dos.js', content: 'CODE' },
  ];

  const { exact, probable } = matchMissingCas(missing, candidates);
  assert.strictEqual(exact.size, 0, 'an ambiguous match must not be adopted');
  assert.strictEqual(probable.size, 0);
});

test('one file matching two client actions is not guessed at either', () => {
  const missing = [
    { id: '1', name: 'a', type: 'USER', publishedCode: 'CODE', unPublishedCode: null },
    { id: '2', name: 'b', type: 'USER', publishedCode: 'CODE', unPublishedCode: null },
  ];
  const candidates = [{ relPath: 'src/user/uno.js', content: 'CODE' }];

  assert.strictEqual(matchMissingCas(missing, candidates).exact.size, 0);
});

test('an edited file comes back as probable, not adopted', () => {
  const code = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nnueve\ndiez\n';
  const edited = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nCAMBIADA\nOTRA\n';
  const missing = [{ id: '1', name: 'a', type: 'USER', publishedCode: code, unPublishedCode: null }];
  const candidates = [{ relPath: 'src/user/editado.js', content: edited }];

  const { exact, probable } = matchMissingCas(missing, candidates);
  assert.strictEqual(exact.size, 0, 'an edited file is never adopted on its own');
  assert.ok(probable.get('1').score >= SIMILARITY_THRESHOLD);
  assert.strictEqual(probable.get('1').relPath, 'src/user/editado.js');
});

test('a file below the threshold is not even probable', () => {
  const missing = [{ id: '1', name: 'a', type: 'USER', publishedCode: 'uno\ndos\ntres\ncuatro\n', unPublishedCode: null }];
  const candidates = [{ relPath: 'src/user/nada.js', content: 'AAA\nBBB\nCCC\nDDD\n' }];

  const { exact, probable } = matchMissingCas(missing, candidates);
  assert.strictEqual(exact.size, 0);
  assert.strictEqual(probable.size, 0);
});

test('the best candidate wins when several are above the threshold', () => {
  const code = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nnueve\ndiez\n';
  const casi = 'uno\ndos\ntres\ncuatro\ncinco\nseis\nsiete\nocho\nnueve\nOTRA\n';
  const menos = 'uno\ndos\ntres\ncuatro\ncinco\nXXX\nYYY\nZZZ\nWWW\nVVV\n';
  const missing = [{ id: '1', name: 'a', type: 'USER', publishedCode: code, unPublishedCode: null }];
  const candidates = [
    { relPath: 'src/user/menos.js', content: menos },
    { relPath: 'src/user/casi.js', content: casi },
  ];

  assert.strictEqual(matchMissingCas(missing, candidates).probable.get('1').relPath, 'src/user/casi.js');
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const { reconcileWorkspace } = require('../src/reconcile');

test('it finds the real moved-and-renamed file in a workspace', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  fs.mkdirSync(path.join(wp, 'src/user'), { recursive: true });
  // The client action was moved out of src/user/test_a/ and flattened.
  fs.writeFileSync(path.join(wp, 'src/user/test_a_b.js'), 'CODE', 'utf8');
  fs.writeFileSync(path.join(wp, 'src/user/otro.js'), 'OTRO', 'utf8');

  const cas = [
    { id: '1', name: 'Test A/B', type: 'USER', filename: 'src/user/test_a/b.js', publishedCode: 'CODE', unPublishedCode: null },
    { id: '2', name: 'otro', type: 'USER', filename: 'src/user/otro.js', publishedCode: 'OTRO', unPublishedCode: null },
  ];

  const { exact, probable } = await reconcileWorkspace(wp, cas);
  assert.strictEqual(exact.get('1'), 'src/user/test_a_b.js');
  assert.strictEqual(probable.size, 0);
  assert.strictEqual(exact.has('2'), false, 'a client action whose file is where it should be is left alone');

  fs.rmSync(wp, { recursive: true, force: true });
});

test('a file already claimed by another client action is never stolen', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  fs.mkdirSync(path.join(wp, 'src/user'), { recursive: true });
  fs.writeFileSync(path.join(wp, 'src/user/vivo.js'), 'CODE', 'utf8');

  const cas = [
    { id: '1', name: 'perdido', type: 'USER', filename: 'src/user/perdido.js', publishedCode: 'CODE', unPublishedCode: null },
    { id: '2', name: 'vivo', type: 'USER', filename: 'src/user/vivo.js', publishedCode: 'CODE', unPublishedCode: null },
  ];

  const { exact, probable } = await reconcileWorkspace(wp, cas);
  assert.strictEqual(exact.size, 0, 'vivo.js belongs to client action 2');
  assert.strictEqual(probable.size, 0);

  fs.rmSync(wp, { recursive: true, force: true });
});

test('it only looks inside the client action own type folder', async () => {
  const wp = fs.mkdtempSync(path.join(os.tmpdir(), 'bmc-'));
  fs.mkdirSync(path.join(wp, 'src/mcp'), { recursive: true });
  fs.writeFileSync(path.join(wp, 'src/mcp/suelto.ts'), 'CODE', 'utf8');

  const cas = [
    { id: '1', name: 'perdido', type: 'USER', filename: 'src/user/perdido.js', publishedCode: 'CODE', unPublishedCode: null },
  ];

  const { exact } = await reconcileWorkspace(wp, cas);
  assert.strictEqual(exact.size, 0, 'a USER client action must not adopt a file under src/mcp');

  fs.rmSync(wp, { recursive: true, force: true });
});
