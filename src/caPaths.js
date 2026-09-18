const CaType = require('./caTypes');
const { getTypeFolder, TYPE_FOLDERS } = require('./caTypes');

// One path segment, cleaned up so it is safe as a file or folder name.
const formatSegment = (segment) =>
  String(segment)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\W+/g, '_') // replace spaces and punctuation with underscore
    .replace(/[\u{0080}-\u{FFFF}]/gu, '') // remove all non ascii chars
    .toLowerCase();

// Remote names carry the folder tree, so the cleanup runs per segment.
// Running it over the whole string would turn the slashes into underscores.
const formatName = (name) =>
  String(name || '')
    .split('/')
    .filter(Boolean)
    .map(formatSegment)
    .join('/');

const extensionFor = (type) => (type === CaType.AI_FUNCTION ? 'ts' : 'js');

const leafOf = (nameOrPath) => {
  const segments = String(nameOrPath || '').split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
};

// Older client actions have no type prefix; those live at the root of their
// type folder. The length check keeps a client action actually named "user"
// from vanishing.
const stripTypePrefix = (type, segments) => {
  const typeFolder = getTypeFolder(type);
  return typeFolder && segments.length > 1 && segments[0] === typeFolder
    ? segments.slice(1)
    : segments;
};

const nameToRelPath = (type, name) => {
  const raw = String(name || '').split('/').filter(Boolean);
  const segments = stripTypePrefix(type, raw).map(formatSegment).filter(Boolean);
  if (segments.length === 0) {
    throw new Error(`Client action name '${name}' has no usable segments.`);
  }
  const file = `${segments.join('/')}.${extensionFor(type)}`;
  const typeFolder = getTypeFolder(type);
  return typeFolder ? `src/${typeFolder}/${file}` : file;
};

const TYPE_FOLDER_SET = new Set(TYPE_FOLDERS);

const stripExtension = (value) => String(value || '').replace(/\.(ts|js)$/, '');

const relPathToName = (type, relPath) => {
  const rel = String(relPath || '').split('\\').join('/');
  const typeFolder = getTypeFolder(type);
  const prefix = typeFolder ? `src/${typeFolder}/` : '';
  const inside = prefix && rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
  const withoutExt = stripExtension(inside);
  return typeFolder ? `${typeFolder}/${withoutExt}` : withoutExt;
};

class CrossTypeMoveError extends Error {
  constructor(ca, cachedRel, actualRel) {
    super(
      `'${ca.name}' is a ${ca.type} client action but its file now sits at ` +
      `'${actualRel}'. Move it back under 'src/${getTypeFolder(ca.type)}/'. ` +
      `Moving a file cannot change a client action's type.`
    );
    this.name = 'CrossTypeMoveError';
    this.ca = ca;
    this.cachedRel = cachedRel;
    this.actualRel = actualRel;
  }
}

// Returns the new remote name when the file moved, or null when it did not.
// The cached filename is the anchor on purpose: recomputing the name from
// scratch every time would rename client actions nobody touched, because
// formatSegment lowercases and strips accents.
const movedName = (ca, actualRel) => {
  const cachedRel = ca.filename;
  if (!cachedRel || !actualRel || cachedRel === actualRel) return null;

  const typeFolder = getTypeFolder(ca.type);
  if (typeFolder) {
    const segments = String(actualRel).split('/');
    if (segments[0] !== 'src' || segments[1] !== typeFolder) {
      throw new CrossTypeMoveError(ca, cachedRel, actualRel);
    }
  }

  const oldBase = stripExtension(leafOf(cachedRel));
  const newBase = stripExtension(leafOf(actualRel));
  // Only the folder part changes on a plain move; the leaf keeps the spelling
  // the platform already has, unless the file itself was renamed too.
  const leaf = newBase === oldBase ? leafOf(ca.name) : newBase;
  const folders = relPathToName(ca.type, actualRel).split('/').slice(0, -1);
  return [...folders, leaf].join('/');
};

// Same file, same folders, under the right type. Used to put back a file that
// was dragged into another type's folder: only the type segment is wrong, so
// any folders the user built inside it are kept rather than flattened away.
const withTypeFolder = (type, relPath) => {
  const segments = String(relPath || '').split('\\').join('/').split('/');
  const typeFolder = getTypeFolder(type);
  if (!typeFolder || segments.length < 3 || segments[0] !== 'src') return null;
  if (!TYPE_FOLDER_SET.has(segments[1])) return null;
  return ['src', typeFolder, ...segments.slice(2)].join('/');
};

const assertNoForeignTypePrefix = (type, name) => {
  const first = String(name || '').split('/').filter(Boolean)[0];
  const typeFolder = getTypeFolder(type);
  if (first && first !== typeFolder && TYPE_FOLDER_SET.has(first)) {
    throw new Error(
      `'${name}' starts with '${first}', which is the folder of another client ` +
      `action type. A ${type} client action cannot live there.`
    );
  }
};

module.exports = {
  formatSegment,
  formatName,
  extensionFor,
  leafOf,
  nameToRelPath,
  relPathToName,
  movedName,
  withTypeFolder,
  assertNoForeignTypePrefix,
  CrossTypeMoveError,
};
