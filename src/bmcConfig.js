const path = require('path');
const util = require('util');
const fs = require('fs');
const { __ } = require('./i18n');

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

exports.getBmc = async (wpPath) => {
  let raw;
  try {
    raw = await readFile(path.join(wpPath, '.bmc'), 'UTF-8');
  } catch (e) {
    throw new Error(__("Could not read '.bmc' file. Make sure you are in a botmaker workspace."));
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(__("'.bmc' file is corrupted. Please run 'bmc import <token>' in another workspace to fix it."));
  }
  const cas = Array.isArray(parsed.cas) ? parsed.cas : [];
  // Workspaces created before client actions moved into src/<type>/ folders cannot be
  // used here: their file paths point nowhere. Re-importing is the only way back.
  const incompatible = cas.find(ca => ca.filename && !ca.filename.startsWith('src/'));
  if (incompatible) {
    throw new Error(__(
      'This workspace is incompatible with this version of botmaker-cli.\nPlease re-import your workspace with `bmc import <apiToken>`.'
    ));
  }
  return { ...parsed, cas };
};

exports.saveBmc = async (wpPath, token, cas) => {
  await writeFile(path.join(wpPath, '.bmc'), JSON.stringify({ token, cas }), 'UTF-8');
};

exports.getContext = async (wpPath) => {
  let raw;
  try {
    raw = await readFile(path.join(wpPath, 'context.json'), 'UTF-8');
  } catch (e) {
    throw new Error(__("Could not read 'context.json' file. Make sure you are in a botmaker workspace."));
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(__("'context.json' file is corrupted. Please run 'bmc set-customer rnd' to fix it."));
  }
};

exports.saveContext = async (wpPath, context) => {
  await writeFile(path.join(wpPath, 'context.json'), JSON.stringify(context, null, 4), 'UTF-8');
};
