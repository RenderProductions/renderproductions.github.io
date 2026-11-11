// Every command lives in its own file in this folder.
// To add one: copy a simple command (apply.js is a good template), then add it to this list.
// Each command works as both r!name and /name automatically (unless it's marked hidden).
const list = [
  require('./help'),
  require('./balance'),
  require('./daily'),
  require('./leaderboard'),
  require('./gift'),
  require('./order'),
  require('./broker'),
  require('./profile'),
  require('./achievements'),
  require('./backpay'),
  require('./savings'),
  require('./dropin'),
  require('./reserve'),
  require('./crash'),
  require('./boost'),
  require('./market'),
  require('./buy'),
  require('./sell'),
  require('./chart'),
  require('./compare'),
  require('./dividends'),
  require('./apply'),
  require('./quit'),
  require('./work'),
  require('./job'),
  require('./gig'),
  require('./shop'),
  require('./purchase'),
  require('./inventory'),
  require('./use'),
  require('./settitle'),
  require('./cleartitle'),
  require('./found'),
  require('./company'),
  require('./exchange'),
  require('./invest'),
  require('./upgrade'),
  require('./ipo'),
  require('./salary'),
  require('./review'),
  require('./approve'),
  require('./reject'),
  require('./slots'),
  require('./coinflip'),
  require('./dice'),
  require('./blackjack'),
  require('./bus'),
  require('./hilo'),
  require('./mines'),
  require('./rocket'),
  require('./derby'),
  require('./lottery'),
  require('./gambling'),
  require('./loan'),
  require('./payback'),
  require('./loans'),
  require('./forgive'),
  require('./bailout'),
  require('./receipts'),
  require('./repay'),
  require('./404')
];

const byName = new Map();
for (const c of list) {
  byName.set(c.name, c);
  for (const a of c.aliases || []) byName.set(a, c);
}

module.exports = { list, find: (name) => byName.get(String(name).toLowerCase()) };
