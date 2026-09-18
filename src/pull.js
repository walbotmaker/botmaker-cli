const getStatus = require("./getStatus");
const path = require('path');
const util = require('util');
const fs = require('fs');
const chalk = require('chalk');
const { __ } = require('./i18n');

const { getBmc, saveBmc } = require('./bmcConfig');
const getWorkspacePath = require('./getWorkspacePath');
const getDiff = require("./getDiff");
const importWorkspace = require("./importWorkspace");
const { nameToRelPath, extensionFor } = require('./caPaths');
const { moveLocalFile } = require('./workspaceFiles');
const fse = require('fs-extra');

const writeFile = util.promisify(fs.writeFile);
const rm = util.promisify(fs.unlink);

const createNewFile = async (wpPath, status, content) => {
  const relPath = nameToRelPath(status.T, status.N);
  const targetDir = path.join(wpPath, path.dirname(relPath));
  await fse.ensureDir(targetDir);
  const basename = await importWorkspace.getName(
    targetDir,
    path.basename(relPath, path.extname(relPath)),
    extensionFor(status.T),
  );
  const newFileName = `${path.dirname(relPath)}/${basename}`.split('\\').join('/');
  await writeFile(path.join(wpPath, newFileName), content, 'UTF-8');
  return newFileName;
};

const makeChanges = async (wpPath, cas, status, changes) => {
  const notAdded = changes.includes(getStatus.ChangeType.NOT_ADDED);
  const hasLocalChanges = changes.includes(getStatus.ChangeType.LOCAL_CHANGES);
  const hasIncomingChanges = changes.includes(getStatus.ChangeType.INCOMING_CHANGES);
  const wasAdded = changes.includes(getStatus.ChangeType.NEW_CA);
  const removeLocal = changes.includes(getStatus.ChangeType.REMOVE_LOCAL);
  const removeRemote = changes.includes(getStatus.ChangeType.REMOVE_REMOTE);

  if (notAdded) {
    return cas;
  }
  if (removeLocal && hasIncomingChanges) {
    console.log(chalk.bgRed(__('WARNING: %s has incoming changes but was deleted locally', status.name)))
    return cas;
  }
  if (hasLocalChanges && removeRemote) {
    console.log(chalk.bgRed(__('WARNING: %s has local changes but was deleted remotely.', path.join(wpPath, status.fn))));
    return cas;
  }

  if (removeRemote) {
    console.log(chalk.red(__('%s was deleted', path.join(wpPath, status.fn))));
    await rm(path.join(wpPath, status.fn))
    return cas.filter(ca => ca.id !== status.id);

  } else if (hasLocalChanges && hasIncomingChanges) {
    const remote = status.U || status.P;
    const original = status.u || status.p;
    const local = status.f;
    const { conflict, result } = getDiff.getMerge(local, original, remote);

    if (conflict) {
      console.log(chalk.bgRed(__('WARNING: %s has merge conflicts', path.join(wpPath, status.fn))));
    } else {
      console.log(chalk.yellow(__('WARNING: %s was merged automatically', path.join(wpPath, status.fn))));
    }
    await writeFile(path.join(wpPath, status.fn), result, 'UTF-8');
  } else if (hasIncomingChanges) {
    const newVersion = status.U || status.P;

    if (status.fn) {
      // The folder now travels inside the remote name, so an incoming rename
      // can mean the client action moved to another folder.
      const wantedRel = nameToRelPath(status.T, status.N);
      if (wantedRel !== status.fn) {
        await moveLocalFile(wpPath, status.fn, wantedRel);
        console.log(chalk.green(__('%s moved to %s', status.fn, wantedRel)));
        status.fn = wantedRel;
      }
      console.log(chalk.green(__('%s has changes', path.join(wpPath, status.fn))));
      await writeFile(path.join(wpPath, status.fn), newVersion, 'UTF-8');
    } else {
      // CA was tracked in .bmc but the local file was missing — re-create it.
      const newFileName = await createNewFile(wpPath, status, newVersion);
      status.fn = newFileName;
      console.log(chalk.green(__('%s was added', path.join(wpPath, status.fn))));
    }
  } else if (wasAdded) {
    const newVersion = status.U || status.P;
    const newFileName = await createNewFile(wpPath, status, newVersion);
    console.log(chalk.green(__('%s was added', path.join(wpPath, newFileName))));
    return cas.concat({
      publishedCode: status.P,
      unPublishedCode: status.U,
      name: status.N,
      type: status.T,
      id: status.id,
      filename: newFileName,
    })
  }

  return cas.map(ca => ca.id !== status.id ? ca : {
    publishedCode: status.P,
    unPublishedCode: status.U,
    name: status.N,
    type: status.T,
    id: status.id,
    filename: status.fn,
  });
}

const hasMerge = (changes) => {
  const hasLocalChanges = changes.includes(getStatus.ChangeType.LOCAL_CHANGES);
  const hasIncomingChanges = changes.includes(getStatus.ChangeType.INCOMING_CHANGES);
  return hasLocalChanges && hasIncomingChanges;
}

const singlePull = async (pwd, caName) => {
  const wpPath = await getWorkspacePath(pwd)
  const { token, cas } = await getBmc(wpPath);
  const { changes, status } = await getStatus.getSingleStatusChanges(pwd, caName);
  const newCas = await makeChanges(wpPath, cas, status, changes);
  if(newCas === cas) {
    console.log(chalk.green(__('Already up to date. :)')));
    return false;
  }
  await saveBmc(wpPath, token, newCas);
  return hasMerge(changes);
}

const completePull = async (pwd) => {
  const wpPath = await getWorkspacePath(pwd)
  const { token, cas } = await getBmc(wpPath);
  const changesGenerator = getStatus.getStatusChanges(pwd);
  let newCas = cas;
  let withMerges = false;
  for await (let statucChanges of changesGenerator) {
    const { status, changes } = statucChanges;
    newCas = await makeChanges(wpPath, newCas, status, changes);
    withMerges = withMerges || hasMerge(changes);
  }
  if(newCas === cas) {
    console.log(chalk.green(__('Already up to date. :)')));
    return false;
  }
  await saveBmc(wpPath, token, newCas);
  return withMerges;
}

const pull = async (pwd, caName) => {
  if (caName) {
    return await singlePull(pwd, caName);
  } else {
    return await completePull(pwd);
  }
};

module.exports = pull;
