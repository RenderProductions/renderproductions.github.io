// Every command lives in its own file in this folder.
// To add one: copy a simple command (daily.js is a good template), then add it to this list.
// Each command works as both r!name and /name automatically.
const list = [
  require('./market'),
  require('./buy'),
  require('./sell'),
  require('./portfolio'),
  require('./daily'),
  require('./help')
];

const byName = new Map();
for (const c of list) {
  byName.set(c.name, c);
  for (const a of c.aliases || []) byName.set(a, c);
}

module.exports = { list, find: (name) => byName.get(String(name).toLowerCase()) };
