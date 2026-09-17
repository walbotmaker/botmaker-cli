const path = require('path');
const chalk = require('chalk');
const getStatus = require("./getStatus");
const {ChangeType} = getStatus;
const { getBmc, saveBmc } = require('./bmcConfig');
const getWorkspacePath = require('./getWorkspacePath');
const { updateCas } = require("./bmService");
const { getCaByNameOrPath } = require('./getStatus');
const { nameToRelPath, relPathToName, assertNoForeignTypePrefix } = require('./caPaths');
const { moveLocalFile } = require('./workspaceFiles');


const hasIncomingChanges = (changes) => {
  return changes.some(c =>
    c === ChangeType.INCOMING_CHANGES
    || c === ChangeType.REMOVE_REMOTE
    || c === ChangeType.NEW_CA
    || c === ChangeType.RENAMED
    || c === ChangeType.TYPE_CHANGED
  );
}


const rename = async (pwd, caName, newName) => {
  const wpPath = await getWorkspacePath(pwd);
  const { changes, status } = await getStatus.getSingleStatusChanges(pwd, caName);
  if (hasIncomingChanges(changes)){
    throw new Error('There is incoming changes. You must make a pull first.');
  }
  if (!newName || caName == newName) {
    console.log(chalk.green('You need to provide a new name por the client action.'))
    return;
  }
  const { token, cas } = await getBmc(wpPath);
  const codeAction = await getCaByNameOrPath(wpPath, cas, caName);
  if (!codeAction || !codeAction.id) {
    throw new Error('The client action was not uploaded.');
  }
  // The new name can carry folders, so renaming is also how you move a client
  // action. What it cannot do is cross into another type's folder.
  assertNoForeignTypePrefix(codeAction.type, newName);
  const newFileName = nameToRelPath(codeAction.type, newName);
  const remoteName = relPathToName(codeAction.type, newFileName);
  const toUpdate = [{id:codeAction.id, name : remoteName}];
  await updateCas(token,toUpdate);
  await moveLocalFile(wpPath, codeAction.filename, newFileName);
  console.log(chalk.green(`Changed ${caName} name to ${remoteName}.`))
  const newCas = cas.map( ca =>
    codeAction.id === ca.id ? {...ca, name: remoteName, filename: newFileName} : ca
  );
  await saveBmc(wpPath,token,newCas);
};

module.exports = rename;
