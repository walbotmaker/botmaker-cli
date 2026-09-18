// Reads every __() call out of src/ and writes the keys into locales/en.json.
// Static on purpose: harvesting at runtime only ever sees the messages whose
// code path actually ran, which for a CLI is a small slice of them.
//
//   node scripts/extract-locales.js
//
// Keys already in a catalog keep their translation; only new ones are added.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const localesDir = path.join(root, 'locales');
const LANGS = ['en', 'es', 'pt', 'fr'];

// __('...') or __("...") — the first argument is the message, the rest are
// values filled into %s at run time.
const CALL = /\b__n?\(\s*(['"])((?:\\.|(?!\1)[^\\])*)\1/g;

const keys = new Set();
for (const file of fs.readdirSync(path.join(root, 'src'))) {
  if (!file.endsWith('.js') || file === 'i18n.js') continue;
  const source = fs.readFileSync(path.join(root, 'src', file), 'utf8');
  for (const match of source.matchAll(CALL)) {
    keys.add(match[2].replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"'));
  }
}

fs.mkdirSync(localesDir, { recursive: true });
for (const lang of LANGS) {
  const file = path.join(localesDir, `${lang}.json`);
  const existing = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const next = {};
  for (const key of [...keys].sort()) {
    next[key] = existing[key] !== undefined ? existing[key] : (lang === 'en' ? key : '');
  }
  const dropped = Object.keys(existing).filter(k => !keys.has(k));
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
  const done = Object.values(next).filter(Boolean).length;
  console.log(`${lang}: ${done}/${keys.size} translated${dropped.length ? `, ${dropped.length} stale key(s) dropped` : ''}`);
}
