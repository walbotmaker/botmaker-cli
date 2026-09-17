const path = require('path');
const fse = require('fs-extra');

// Deletes folders that a move emptied, stopping at the type folder so the
// workspace never loses src/user, src/mcp and friends. A relative path like
// "src/user" is two segments, so the loop stops before reaching it.
const pruneEmptyFolders = async (wpPath, relDir) => {
  let current = String(relDir || '').split('\\').join('/');
  while (current && current !== '.' && current.split('/').length > 2) {
    const abs = path.join(wpPath, current);
    const entries = await fse.readdir(abs).catch(() => null);
    if (!entries || entries.length > 0) return;
    await fse.remove(abs);
    current = path.dirname(current);
  }
};

const moveLocalFile = async (wpPath, fromRel, toRel) => {
  await fse.ensureDir(path.join(wpPath, path.dirname(toRel)));
  await fse.move(path.join(wpPath, fromRel), path.join(wpPath, toRel), { overwrite: true });
  await pruneEmptyFolders(wpPath, path.dirname(fromRel));
};

module.exports = { moveLocalFile, pruneEmptyFolders };
