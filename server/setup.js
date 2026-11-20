// One-time setup: pick your password and monthly credit. Run:  node setup.js
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');

const FILE = path.join(__dirname, 'config.json');
const old = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let muted = false;
rl._writeToOutput = s => { rl.output.write(muted && !/[\r\n]/.test(s) ? '*' : s); };
const ask = (q, hidden) => new Promise(res => {
  process.stdout.write(q);
  muted = !!hidden;
  rl.question('', a => { muted = false; res(a); });
});

(async () => {
  console.log('\n  Forge setup\n');
  let pw;
  for (;;) {
    pw = await ask('  Password (12+ characters): ', true);
    if (pw.length < 12) { console.log('  Too short — use at least 12 characters.'); continue; }
    const again = await ask('  Type it again: ', true);
    if (again !== pw) { console.log("  Didn't match, try again."); continue; }
    break;
  }
  console.log('\n  Monthly credit that comes with your plan (check claude.ai/settings/usage).');
  console.log('  Pro = 20, Max 5x = 100, Max 20x = 200.');
  const credit = Number(await ask(`  Monthly credit in $ [${old.monthlyCredit || 20}]: `)) || old.monthlyCredit || 20;
  const user = await ask(`  Your GitHub username [${(old.allowedOrigins || [])[0]?.replace(/^https:\/\/|\.github\.io$/g, '') || 'phelypsam-del'}]: `) || 'phelypsam-del';

  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  const config = {
    name: old.name || 'Forge',
    port: old.port || 8787,
    monthlyCredit: credit,
    hardStop: true,
    maxTurns: old.maxTurns || 8,
    allowedOrigins: [`https://${user.toLowerCase()}.github.io`],
    password: { salt: salt.toString('hex'), hash: hash.toString('hex') },
    systemPrompt: old.systemPrompt || 'You are chatting through a personal web app called Forge. Format answers in Markdown. You have no access to the local computer here; never try to read or write files.',
  };
  fs.writeFileSync(FILE, JSON.stringify(config, null, 2));
  // changing the password signs out every device
  try { fs.unlinkSync(path.join(__dirname, 'data', 'sessions.json')); } catch {}
  console.log('\n  Saved. Start the server with:  node server.js\n');
  rl.close();
})();
