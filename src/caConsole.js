const util = require('util');

// In --json mode stdout must hold the result object and nothing else, but a
// client action is free to call console.log. This console keeps what it says
// so it can travel inside the result instead of breaking the JSON.
const createCollectingConsole = () => {
  const logs = [];
  // Inherits the real console so a call we did not think of (console.table)
  // still works instead of blowing up inside the client action.
  const bmconsole = Object.create(console);
  for (const level of ['log', 'info', 'debug', 'warn', 'error']) {
    bmconsole[level] = (...args) => {
      logs.push({ level, message: args.map((a) => (typeof a === 'string' ? a : util.inspect(a))).join(' ') });
    };
  }
  return { bmconsole, logs };
};

module.exports = { createCollectingConsole };
