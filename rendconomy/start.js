// The startup file for bot hosts: point the host's "main file" here (rendconomy/start.js).
// It installs what's missing, builds the TypeScript, then runs the bot, and keeps it running:
//   - Auto-update: every few minutes it checks GitHub for new commits on this branch. If there are any, it pulls
//     them, installs packages if they changed, typechecks, builds, and restarts the bot on the new code. If the new
//     code doesn't typecheck, the bot keeps running the old code (and says so in the console).
//   - If the bot crashes, it's started again (and gives up, letting the host handle it, after 5 crashes in 10 minutes).
// Settings (in .env or the host's variables): AUTO_UPDATE=0 turns auto-update off; AUTO_UPDATE_MINUTES (default 2).
// Plain JavaScript on purpose, because it has to run before anything is built.
const { execSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' });
const git = (args) => execSync(`git ${args}`, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const log = (m) => console.log(`[start] ${m}`);

// .env may hold AUTO_UPDATE; read it without overwriting what the host set (the bot reads it again itself)
try {
  for (const line of fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }
const AUTO = process.env.AUTO_UPDATE !== '0';
const EVERY = Math.max(1, Number(process.env.AUTO_UPDATE_MINUTES) || 2) * 60_000;

const version = () => { try { return git('log -1 --format="%h %s (%cr)"'); } catch { return 'unknown (no git here)'; } };
log(`version: ${version()}`);

function install() {
  const lock = path.join(dir, 'package-lock.json');
  const stamp = path.join(dir, 'node_modules', '.installed-from');
  const want = fs.existsSync(lock) ? String(fs.statSync(lock).mtimeMs) : 'none';
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === want) return;
  log('installing packages...');
  // npm ci installs exactly what package-lock.json says and never edits it, so a git pull can't be blocked
  run(fs.existsSync(lock) ? 'npm ci --include=dev --no-audit --no-fund' : 'npm install --include=dev --no-audit --no-fund');
  fs.writeFileSync(stamp, want);
}
const tsc = (args) => run(`"${process.execPath}" node_modules/typescript/bin/tsc -p . ${args}`);

install();
log('building...');
tsc('');

// ---------------------------------------------------------------- running the bot

let child = null, swapping = false, stopping = false;
const crashes = [];
function startBot() {
  // node:sqlite prints an "experimental" warning on every start; it's expected, so hide it
  child = spawn(process.execPath, ['--no-warnings=ExperimentalWarning', 'dist/src/index.js'], { cwd: dir, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    child = null;
    if (swapping) return;                       // the updater is starting the new version
    if (stopping) process.exit(code ?? 0);
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && crashes[0] < now - 10 * 60_000) crashes.shift();
    if (crashes.length >= 5) { log('the bot crashed 5 times in 10 minutes; stopping so the host can restart it'); process.exit(1); }
    log(`the bot stopped (${signal ?? `code ${code}`}); starting it again in 5 seconds`);
    setTimeout(startBot, 5000);
  });
}
function stopBot() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const c = child;
    const kill = setTimeout(() => c.kill('SIGKILL'), 15_000);
    c.once('exit', () => { clearTimeout(kill); resolve(); });
    c.kill('SIGTERM');                           // the bot closes Discord and the database cleanly on SIGTERM
  });
}
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { stopping = true; if (child) child.kill(sig); else process.exit(0); });
startBot();

// ---------------------------------------------------------------- auto-update

let branch = null, badCommit = null, busy = false;
try { branch = git('rev-parse --abbrev-ref HEAD'); if (branch === 'HEAD') branch = null; } catch { branch = null; }
async function checkForUpdate() {
  if (busy || !branch) return;
  busy = true;
  try {
    git(`fetch --quiet origin ${branch}`);
    const here = git('rev-parse HEAD'), there = git(`rev-parse origin/${branch}`);
    if (here === there || there === badCommit) return;
    try { git(`merge-base --is-ancestor HEAD origin/${branch}`); } catch { log(`auto-update: this copy has commits GitHub doesn't; not pulling`); badCommit = there; return; }
    log(`auto-update: new code on ${branch}, pulling...`);
    git(`merge --ff-only origin/${branch}`);
    install();
    try { tsc('--noEmit'); } catch {
      log(`auto-update: the new code doesn't build; going back and keeping the bot running on ${here.slice(0, 7)}`);
      git(`reset --hard ${here}`);
      badCommit = there;
      return;
    }
    tsc('');
    log(`auto-update: restarting on ${version()}`);
    swapping = true;
    await stopBot();
    swapping = false;
    if (!stopping) startBot();
  } catch (e) {
    log(`auto-update: skipped (${String(e && e.message || e).split('\n')[0]})`);
  } finally { busy = false; }
}
if (AUTO && branch) {
  log(`auto-update: on, checking ${branch} every ${EVERY / 60_000} min`);
  setInterval(checkForUpdate, EVERY).unref();
} else log(`auto-update: off${AUTO ? ' (not a git checkout on a branch)' : ''}`);
