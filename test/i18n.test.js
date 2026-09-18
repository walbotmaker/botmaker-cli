// Messages are asserted verbatim, so they must not follow the machine's locale.
process.env.BMC_LANG = 'en';
const test = require('node:test');
const assert = require('node:assert');
const { detectLocale, languageOf, __ } = require('../src/i18n');

test('a locale keeps only its language part', () => {
  assert.strictEqual(languageOf('es_ES.UTF-8'), 'es');
  assert.strictEqual(languageOf('pt-BR'), 'pt');
  assert.strictEqual(languageOf('fr'), 'fr');
});

test('BMC_LANG wins over the system locale', () => {
  assert.strictEqual(detectLocale({ BMC_LANG: 'pt', LANG: 'es_ES.UTF-8' }), 'pt');
});

test('the usual environment variables are read most specific first', () => {
  assert.strictEqual(detectLocale({ LC_ALL: 'fr_FR.UTF-8', LANG: 'es_ES.UTF-8' }), 'fr');
  assert.strictEqual(detectLocale({ LC_MESSAGES: 'pt_BR', LANG: 'es_ES' }), 'pt');
  assert.strictEqual(detectLocale({ LANG: 'es_AR.UTF-8' }), 'es');
});

test('a language we do not ship falls back to English', () => {
  assert.strictEqual(detectLocale({ LANG: 'de_DE.UTF-8' }), 'en');
  assert.strictEqual(detectLocale({}), 'en');
});

test('a message with no catalog entry comes out as written, never blank', () => {
  assert.strictEqual(__('A message no catalog has ever seen'),
    'A message no catalog has ever seen');
});

test('placeholders are filled in', () => {
  assert.match(__('%s was added', 'src/user/a.js'), /src\/user\/a\.js/);
});

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { SUPPORTED } = require('../src/i18n');

const localesDir = path.join(__dirname, '..', 'locales');
const load = (lang) => JSON.parse(fs.readFileSync(path.join(localesDir, `${lang}.json`), 'utf8'));

test('every language ships a catalog with the same keys', () => {
  const en = Object.keys(load('en')).sort();
  for (const lang of SUPPORTED) {
    assert.deepStrictEqual(Object.keys(load(lang)).sort(), en, `${lang} is out of step with en`);
  }
});

test('no message is left untranslated', () => {
  for (const lang of SUPPORTED) {
    const empty = Object.entries(load(lang)).filter(([, v]) => !v).map(([k]) => k);
    assert.deepStrictEqual(empty, [], `${lang} has untranslated messages`);
  }
});

test('translations keep the same placeholders as the English', () => {
  const en = load('en');
  for (const lang of SUPPORTED) {
    for (const [key, value] of Object.entries(load(lang))) {
      const count = (text) => (String(text).match(/%s/g) || []).length;
      assert.strictEqual(count(value), count(en[key]),
        `${lang}: "${key}" has ${count(value)} placeholders, English has ${count(en[key])}`);
    }
  }
});

test('the catalog matches what the source actually asks for', () => {
  // Re-running the extractor must not change anything: a message added to the
  // code without running it leaves the other languages silently in English.
  const before = SUPPORTED.map(l => fs.readFileSync(path.join(localesDir, `${l}.json`), 'utf8'));
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'extract-locales.js')], { stdio: 'pipe' });
  const after = SUPPORTED.map(l => fs.readFileSync(path.join(localesDir, `${l}.json`), 'utf8'));
  assert.deepStrictEqual(after, before,
    'locales are stale — run node scripts/extract-locales.js and translate the new keys');
});
