// The startup file for bot hosts: point the host's "main file" here (rendconomy/start.js).
// It installs what's missing, builds the TypeScript, then starts the bot. Plain JavaScript on purpose,
// because it has to run before anything is built.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const dir = __dirname;
const run = (cmd) => execSync(cmd, { cwd: dir, stdio: 'inherit' });

// node:sqlite still prints an "experimental" warning on every start; it's expected, so hide just that one
const emit = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const text = typeof warning === 'string' ? warning : warning && warning.message;
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0] && rest[0].type;
  if (type === 'ExperimentalWarning' && /SQLite/.test(text || '')) return;
  return emit.call(process, warning, ...rest);
};

const lock = path.join(dir, 'package-lock.json');
const stamp = path.join(dir, 'node_modules', '.installed-from');
const want = fs.existsSync(lock) ? String(fs.statSync(lock).mtimeMs) : 'none';
if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== want) {
  console.log('[start] installing packages...');
  run('npm install --include=dev --no-audit --no-fund');
  fs.writeFileSync(stamp, want);
}

console.log('[start] building...');
run(`"${process.execPath}" node_modules/typescript/bin/tsc -p .`);

require('./dist/src/index.js');
