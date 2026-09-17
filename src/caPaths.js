const CaType = require('./caTypes');
const { getTypeFolder } = require('./caTypes');

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

module.exports = {
  formatSegment,
  formatName,
  extensionFor,
  leafOf,
  nameToRelPath,
};
