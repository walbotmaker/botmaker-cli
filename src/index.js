const { version } = require('../package.json');
const { __, locale } = require('./i18n');
const getDiff = require('./getDiff');
const newCa = require('./newCa');
const pull = require('./pull');
const push = require('./push');
const yargs = require('yargs/yargs');
const run = require('./run');
const importWorkspace = require('./importWorkspace');
const setCustomer = require('./setCustomer');
const getStatus = require('./getStatus');
const publish = require('./publish');
const rename = require('./rename');
const listCas = require('./listCas');
const CaType = require('./caTypes');
const setSchedule = require('./setSchedule');

const main = async (args) => {
  const pwd = process.cwd();
  const arrgs = yargs(args)
    .scriptName('bmc')
    .usage(__('Usage: $0 <command> [options]'))
    .command(
      ['run <source>', 'r'],
      __('Run a Botmaker Client Action Script'),
      async (yargs) => yargs
        .option('v', {
          alias: 'var',
          describe: __('<varName> <varValue> Set a context variable'),
          nargs: 2
        })
        .option('p', {
          alias: 'param',
          describe: __('<paramName> <paramValue> Set a param'),
          nargs: 2
        })
        .option('volatile', { describe: __('Will not presist the state') })
        .option('endpoint', { describe: __('Force to run as endpoint') })
        .option('port <portNumber>', { describe: __('Change endpoint port number') })
      ,
    )
    .command(
      ['import <apiToken>', 'i'],
      __('Import a new business from a token'),
    )
    .command(
      ['set-customer <customerId>', 'c'],
      __('Load context for a customer'),
    )
    .command(
      ['status [caName]', 's'],
      __('Show change status'),
    )
    .command(
      ['diff <caName> <code>', 'd'],
      __('Diff client actions states'),
      (yargs) => yargs
        .option('v', {
          alias: 'vs-code',
          describe: __('Open in vs-code'),
        })
    )
    .command(
      ['pull [caName]'],
      __('Pull incoming changes'),
    ).command(
      ['new <caName>', 'n'],
      __('Create a new client action'),
      (yargs) => yargs
        .option('v', {
          alias: 'vs-code',
          describe: __('Open in vs-code'),
        }).option('e', {
          alias: 'endpoint',
          describe: __('Create as endpoint type'),
        }).option('a', {
          alias: 'ai-function',
          describe: __('Create as AI function type'),
        }).option('w', {
          alias: 'whatsapp-flow',
          describe: __('Create as WhatsApp flow type'),
        }).option('f', {
          alias: 'webchat-form',
          describe: __('Create as Webchat form type'),
        }).option('S', {
          alias: 'schedule-ca',
          describe: __('<cronExpression> Create as Schedule type with cron expression'),
          nargs: 1,
        })
    ).command(
      ['push [caName]'],
      __('Push changes in client action'),
      (yargs) => yargs
        .option('b', {
          alias: 'publish',
          describe: __('Push and publish with a single command'),
        })
    ).command(
      ['publish <caName>'],
      __('Publish changes in client action')
    ).command(
      ['rename <caName> <newName>'],
      __('Renames the given client action')
    )
    .command(
      ['set-schedule <caName> <cronString>'],
      __('Set the cron schedule on a SCHEDULE type client action')
    )
    .locale(locale)
    .demandCommand()
    .help('h')
    .alias('h', 'help')
    .version(version)
    .epilog(__('copyright Botmaker %s', '2026'))
    .argv;

  switch (arrgs._[0]) {
    case "set-customer":
    case "c":
      const { customerId } = arrgs;
      await setCustomer(pwd, customerId);
      break;
    case "diff":
    case "d":
      const { caName: caName1, code, v: vsCode } = arrgs;
      await getDiff(pwd, caName1, code, vsCode);
      break;
    case "import":
    case "i":
      const { apiToken } = arrgs;
      await importWorkspace(pwd, apiToken)
      break;
    case "list":
    case "ls":
      await listCas(pwd)
      break;
    case "new":
    case "n":
      const { caName: caName3, v: vsCode1, e, a, w, f, S } = arrgs;
      const typeFlagCount = [e, a, w, f, S].filter(Boolean).length;
      if (typeFlagCount > 1) {
        throw new Error(__('Only one type flag may be specified at a time (-e, -a, -w, -f, -S).'));
      }
      const newType = e ? CaType.ENDPOINT
        : a ? CaType.AI_FUNCTION
        : w ? CaType.WHATSAPP_FLOW
        : f ? CaType.WEBCHAT_FORM
        : S ? CaType.SCHEDULE
        : CaType.USER;
      await newCa(pwd, caName3, newType, vsCode1, S || null);
      break;
    case "publish":
      const { caName: caName5 } = arrgs;
      await publish(pwd, caName5);
      break;
    case "pull":
      const { caName: caName2 } = arrgs;
      await pull(pwd, caName2);
      break;
    case "push":
      const { caName: caName4, b} = arrgs;
      await push(pwd, caName4, b ? "TRUE" : "FALSE");
      break;
    case "rename":
      const { caName: caName6, newName} = arrgs;
      await rename(pwd, caName6, newName);
      break;
    case "set-schedule":
      const { caName: caName7, cronString } = arrgs;
      await setSchedule(pwd, caName7, cronString);
      break;
    case "run":
    case "r":
      const { source, v = [], p = [], volatile = false, endpoint, port } = arrgs;
      await run(pwd, source, { vars: v, params: p, volatile, endpoint, port})
      break;
    case "status":
    case "s":
      const { caName } = arrgs;
      await getStatus(pwd, caName);
      break;
    default:
      console.error(`bmc: '${arrgs._[0]}' is not a bmc command. See 'bmc -h'`)
      process.exit(-1);
  }
}

module.exports = (args) => {
  main(args)
    .catch((e) => console.error(`bmc: ${e.message || e}`))
}
