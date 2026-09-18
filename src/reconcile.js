const path = require('path');
const util = require('util');
const fs = require('fs');
const diff = require('diff');
const { getTypeFolder } = require('./caTypes');

const readFile = util.promisify(fs.readFile);
const exists = util.promisify(fs.exists);
const readdir = util.promisify(fs.readdir);

// Same default git uses for rename detection (-M): below this, git stops
// calling it a rename and reports a delete plus an add.
const SIMILARITY_THRESHOLD = 0.5;

const countLines = (text) => (text ? text.split('\n').length : 0);

// How much of two files is the same, from 0 to 1. Line based, like git's
// rename detection, and it reuses the diff package the CLI already has.
const similarity = (a, b) => {
  if (a === b) return a ? 1 : 0;
  if (!a || !b) return 0;
  let common = 0;
  for (const part of diff.diffLines(a, b)) {
    if (!part.added && !part.removed) common += part.count;
  }
  const total = Math.max(countLines(a), countLines(b));
  return total === 0 ? 0 : common / total;
};

// The versions of a client action's code the CLI already knows about. A file
// that was moved without being edited is identical to one of these.
const knownVersions = (ca) =>
  [ca.unPublishedCode, ca.publishedCode].filter(v => v != null);

// Links client actions whose file went missing to files nobody claims.
//
// Exact content is adopted outright; anything merely similar comes back as
// probable so a person can confirm it, because adopting it would rename a
// client action on the platform.
//
// Ambiguity is never resolved by guessing: if a client action matches more
// than one file, or a file matches more than one client action, both are left
// alone.
const matchMissingCas = (missingCas, candidates) => {
  const exact = new Map();
  const probable = new Map();

  const exactPairs = [];
  for (const ca of missingCas) {
    const versions = knownVersions(ca);
    for (const candidate of candidates) {
      if (versions.some(v => v === candidate.content)) {
        exactPairs.push({ caId: ca.id, relPath: candidate.relPath });
      }
    }
  }

  const casSeen = new Map();
  const filesSeen = new Map();
  for (const pair of exactPairs) {
    casSeen.set(pair.caId, (casSeen.get(pair.caId) || 0) + 1);
    filesSeen.set(pair.relPath, (filesSeen.get(pair.relPath) || 0) + 1);
  }
  // A client action or a file caught in an ambiguous exact match is out of the
  // running entirely. Letting it fall through to the similarity pass would pick
  // one of the identical candidates anyway, which is the guessing we refuse.
  const ambiguousCas = new Set();
  const ambiguousFiles = new Set();
  for (const pair of exactPairs) {
    if (casSeen.get(pair.caId) === 1 && filesSeen.get(pair.relPath) === 1) {
      exact.set(pair.caId, pair.relPath);
    } else {
      ambiguousCas.add(pair.caId);
      ambiguousFiles.add(pair.relPath);
    }
  }

  const takenFiles = new Set([...exact.values(), ...ambiguousFiles]);
  for (const ca of missingCas) {
    if (exact.has(ca.id) || ambiguousCas.has(ca.id)) continue;
    const versions = knownVersions(ca);
    let best = null;
    for (const candidate of candidates) {
      if (takenFiles.has(candidate.relPath)) continue;
      const score = Math.max(0, ...versions.map(v => similarity(v, candidate.content)));
      if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
        best = { relPath: candidate.relPath, score };
      }
    }
    if (best) probable.set(ca.id, best);
  }

  return { exact, probable };
};

const walkFiles = async (absDir, relPrefix) => {
  const out = [];
  const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const rel = `${relPrefix}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...await walkFiles(path.join(absDir, entry.name), rel));
    } else if (entry.isFile() && !entry.name.endsWith('.json')) {
      out.push(rel);
    }
  }
  return out;
};

// Looks for the files of client actions that are not where .bmc says they are.
// Only files under the client action's own type folder are considered, and only
// ones no other client action claims, so nothing is ever stolen from a healthy
// client action.
const reconcileWorkspace = async (wpPath, cas) => {
  const claimed = new Set(cas.map(ca => ca.filename).filter(Boolean));

  const missingCas = [];
  for (const ca of cas) {
    if (!ca.filename || !ca.id) continue;
    if (!(await exists(path.join(wpPath, ca.filename)))) missingCas.push(ca);
  }
  if (missingCas.length === 0) return { exact: new Map(), probable: new Map() };

  const byTypeFolder = new Map();
  const candidatesFor = async (type) => {
    const typeFolder = getTypeFolder(type);
    if (!typeFolder) return [];
    if (byTypeFolder.has(typeFolder)) return byTypeFolder.get(typeFolder);
    const root = path.join(wpPath, 'src', typeFolder);
    const rels = (await walkFiles(root, `src/${typeFolder}`)).filter(rel => !claimed.has(rel));
    const loaded = [];
    for (const rel of rels) {
      loaded.push({ relPath: rel, content: await readFile(path.join(wpPath, rel), 'UTF-8') });
    }
    byTypeFolder.set(typeFolder, loaded);
    return loaded;
  };

  const exact = new Map();
  const probable = new Map();
  const types = [...new Set(missingCas.map(ca => ca.type))];
  for (const type of types) {
    const group = missingCas.filter(ca => ca.type === type);
    const matched = matchMissingCas(group, await candidatesFor(type));
    for (const [id, rel] of matched.exact) exact.set(id, rel);
    for (const [id, hit] of matched.probable) probable.set(id, hit);
  }
  return { exact, probable };
};

module.exports = {
  SIMILARITY_THRESHOLD,
  similarity,
  matchMissingCas,
  reconcileWorkspace,
};
