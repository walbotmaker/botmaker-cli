const getStatus = require("./getStatus");
const path = require('path');
const util = require('util');
const fs = require('fs');

const { getBmc, saveBmc } = require('./bmcConfig');
const getWorkspacePath = require('./getWorkspacePath');
const { updateCas } = require("./bmService");
const chalk = require("chalk");
const publish = require('./publish');
const { movedName } = require('./caPaths');
const { askYesNo } = require('./confirm');

const readFile = util.promisify(fs.readFile);

const {ChangeType} = getStatus;
const maxLength = 100000;

const checkClientActionLength = (text, caName) => {
  if (text.length > maxLength) {
    console.log(chalk.red(`The code action ${caName} is too big. The maximum size is 100000 characters.`));
    throw new Error(`Error trying to push changes in ${caName}`);
  }
}

const getPushChanges = (status, changes) => {
  const hasLocalCode = changes.includes(ChangeType.LOCAL_CHANGES);
  if (!hasLocalCode) {
    return;
  }

  // No local file means f is null, and null differs from the published code,
  // so LOCAL_CHANGES fires even though there is nothing to send. Pushing it
  // would overwrite the client action with empty code, so stop instead.
  if (status.f == null) {
    throw new Error(
      `'${status.n}' has no local file at '${status.fn}'. Run 'bmc pull' to bring ` +
      `it back, or move the file to that path. Pushing now would send empty code.`
    );
  }

  const payload = { id: status.id };
  payload.unPublishedCode = status.f;
  return { payload, fn: status.fn };
}

// Points the status at the file the reconciliation found, once a person said
// it is the same client action. m keeps the cached path so the move still shows.
const adoptProbableMove = (status, content) => {
  status.f = content;
  status.fn = status.probableMove.relPath;
  status.M = status.probableMove.relPath;
  delete status.probableMove;
};

// A file that was moved, renamed and edited at once matches nothing exactly, so
// the CLI will not adopt it on its own — pushing it would rename a client action
// on the platform off a guess. Ask instead.
const resolveProbableMove = async (wpPath, status) => {
  if (!status.probableMove) return false;
  const { relPath, score } = status.probableMove;
  const percent = Math.round(score * 100);
  console.log(chalk.yellow(
    `'${status.n}' is missing from ${status.m}, and ${relPath} looks ${percent}% like it.`
  ));
  const yes = await askYesNo(chalk.yellow(`Treat ${relPath} as '${status.n}' and rename it on the platform?`));
  if (!yes) return false;
  adoptProbableMove(status, await readFile(path.join(wpPath, relPath), 'UTF-8'));
  return true;
};

// One entry per client action whose file no longer sits where .bmc says it is.
// Moving a folder is just every client action under it moving at once, so there
// is no special case for folders. Throws on the first file found under the wrong
// type folder, which aborts the push before anything is sent.
const collectMoveUpdates = (cas, statuses) => {
  const updates = [];
  for (const status of statuses) {
    if (!status || !status.fn) continue;
    const ca = cas.find(c => c.id === status.id);
    if (!ca) continue;
    const name = movedName(ca, status.fn);
    if (name && name !== ca.name) {
      updates.push({ id: ca.id, name });
    }
  }
  return updates;
};

// A client action can have a code change, a move, or both. Both travel in the
// same payload so the server sees a single update.
const mergePushEntries = (entries, moves, statuses) => {
  const merged = entries.map(e => ({ payload: { ...e.payload }, fn: e.fn }));
  for (const move of moves) {
    const found = merged.find(e => e.payload.id === move.id);
    if (found) {
      found.payload.name = move.name;
      continue;
    }
    const status = statuses.find(s => s && s.id === move.id);
    merged.push({ payload: { id: move.id, name: move.name }, fn: status ? status.fn : undefined });
  }
  return merged;
};

const applyPush = async (token, payloads) => {
  await updateCas(token, payloads);
}

const hasIncomingChanges = (changes) => {
  return changes.some(c =>
    c === ChangeType.INCOMING_CHANGES
    || c === ChangeType.REMOVE_REMOTE
    || c === ChangeType.NEW_CA
    || c === ChangeType.RENAMED
    || c === ChangeType.TYPE_CHANGED
  );
}

const applyToCas = (cas, updates) => cas.map(ca => {
  const u = updates.find(x => x.payload.id === ca.id);
  if (!u) return ca;
  const next = { ...ca };
  if (u.payload.unPublishedCode !== undefined) next.unPublishedCode = u.payload.unPublishedCode;
  if (u.payload.name !== undefined) next.name = u.payload.name;
  if (u.fn !== undefined) next.filename = u.fn;
  return next;
});

const singlePush = async (pwd, caName) => {
  const wpPath = await getWorkspacePath(pwd)
  let { changes, status } = await getStatus.getSingleStatusChanges(pwd, caName);
  if (hasIncomingChanges(changes)){
    throw new Error('There is incoming changes. You must make a pull first.');
  }
  if (await resolveProbableMove(wpPath, status)) {
    changes = getStatus.getChangesFromStatus(status);
  }
  const { token, cas } = await getBmc(wpPath);
  const pushChanges = getPushChanges(status, changes);
  const moves = collectMoveUpdates(cas, [status]);
  const toPush = mergePushEntries(pushChanges ? [pushChanges] : [], moves, [status]);
  if (toPush.length === 0) {
    console.log(chalk.green('Nothing to push!. No local changes found.'))
    return;
  }
  if (pushChanges && pushChanges.payload.unPublishedCode !== undefined) {
    checkClientActionLength(pushChanges.payload.unPublishedCode, caName);
  }
  await applyPush(token, toPush.map(t => t.payload));
  const newCas = applyToCas(cas, toPush);
  await saveBmc(wpPath, token, newCas);
}

const completePush = async (pwd) => {
  const wpPath = await getWorkspacePath(pwd)
  const { token, cas } = await getBmc(wpPath);
  const changesGenerator = getStatus.getStatusChanges(pwd);
  const entries = [];
  const statuses = [];
  for await (let statucChanges of changesGenerator) {
    const { status } = statucChanges;
    let { changes } = statucChanges;
    if (hasIncomingChanges(changes)){
      throw new Error('There is incoming changes you must make an pull first.');
    }
    if (await resolveProbableMove(wpPath, status)) {
      changes = getStatus.getChangesFromStatus(status);
    }
    statuses.push(status);
    const pushChanges = getPushChanges(status, changes);
    if (pushChanges) {
      if (pushChanges.payload.unPublishedCode !== undefined) {
        checkClientActionLength(pushChanges.payload.unPublishedCode, status.n);
      }
      entries.push(pushChanges);
    }
  }
  // Throws before anything is sent if some file sits under the wrong type.
  const moves = collectMoveUpdates(cas, statuses);
  const toPush = mergePushEntries(entries, moves, statuses);
  if(toPush.length === 0){
    console.log(chalk.green('Nothing to push!. No local changes found.'))
    return;
  }
  console.log(chalk.yellow('Uploading changes for:'));
  toPush.forEach(update => {
    const ca = cas.find(c => c.id === update.payload.id);
    const tags = [];
    if (update.payload.unPublishedCode !== undefined) tags.push('code');
    if (update.payload.name !== undefined) tags.push(`moved to ${update.payload.name}`);
    console.log(chalk.yellow(` * ${chalk.italic(update.fn)} `) + chalk.grey(`${ca.name} [${tags.join(', ')}]`))
  })
  await applyPush(token, toPush.map(t => t.payload));
  const newCas = applyToCas(cas, toPush);
  await saveBmc(wpPath, token, newCas);
}

const push = async (pwd, caName, forPublish) => {
  if (caName) {
    await singlePush(pwd, caName);
  } else {
    await completePush(pwd);
  }
  if(forPublish == "TRUE") {
    await publish(pwd, caName);
  }
};

push.collectMoveUpdates = collectMoveUpdates;
push.getPushChanges = getPushChanges;
push.adoptProbableMove = adoptProbableMove;
push.mergePushEntries = mergePushEntries;

module.exports = push;
