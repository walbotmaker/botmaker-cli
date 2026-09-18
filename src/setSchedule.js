const chalk = require('chalk');
const { __ } = require('./i18n');
const { isValidCron } = require('cron-validator');
const { getBmc, saveBmc } = require('./bmcConfig');
const getWorkspacePath = require('./getWorkspacePath');
const { updateCas } = require('./bmService');
const { getCaByNameOrPath } = require('./getStatus');
const CaType = require('./caTypes');

const setSchedule = async (pwd, caName, cronString) => {
  if (!isValidCron(cronString, { seconds: false })) {
    throw new Error(__('Invalid cron expression: "%s". Expected a valid 5-field cron string (e.g. "0 * * * *").', cronString));
  }

  const wpPath = await getWorkspacePath(pwd);
  const { token, cas } = await getBmc(wpPath);
  const codeAction = await getCaByNameOrPath(wpPath, cas, caName);

  if (!codeAction || !codeAction.id) {
    throw new Error(__('The client action was not uploaded.'));
  }

  if (codeAction.type !== CaType.SCHEDULE) {
    throw new Error(__("'%s' is not a SCHEDULE type client action.", caName));
  }

  await updateCas(token, [{ id: codeAction.id, schedule: cronString }]);

  const newCas = cas.map(ca =>
    ca.id === codeAction.id ? { ...ca, schedule: cronString } : ca
  );
  await saveBmc(wpPath, token, newCas);

  console.log(chalk.green(__("Changed schedule for '%s' to: %s", caName, cronString)));
};

module.exports = setSchedule;
