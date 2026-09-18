const readline = require('readline');

// Asks a yes/no question on the terminal. With no interactive terminal — CI, a
// piped command — it answers no instead of hanging forever waiting for someone
// who is not there.
const askYesNo = async (question) => {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise(resolve => rl.question(`${question} [y/N] `, resolve));
    return /^(y|yes|s|si|sí)$/i.test(String(answer).trim());
  } finally {
    rl.close();
  }
};

module.exports = { askYesNo };
