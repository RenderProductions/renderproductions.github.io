// Runs the commands against a throwaway database and the repo's prices.json.
// No Discord connection needed:  npm test
const assert = require('assert');
const path = require('path');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const api = require('../src/api');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const open = JSON.parse(JSON.stringify(base));
open.market = { ...(open.market || {}), open: true };
for (const c of open.companies) { open.tradable[c.id] = true; c.status = 'ok'; }

const G = '123456789012345678';
const user = { id: '111111111111111111', username: 'tester' };
const ctx = { guildId: G, user, db, market };
const text = (out) => out.content || JSON.stringify(out.embeds);

async function say(line) {
  const p = router.parsePrefix(line);
  assert.ok(p, 'not parsed: ' + line);
  if (p.missing) return { content: 'missing ' + p.missing.name };
  return router.runCommand(p.cmd, ctx, p.args);
}

(async () => {
  market.set(open);
  const rrm = market.quote(open, 'RRM').priceCents;

  assert.ok(text(await say('r!market')).includes('Render Room'));
  assert.ok(text(await say('r!portfolio')).includes('500.00 Polygons'), 'starts with 500');

  await say('r!buy rrm 2');
  assert.strictEqual(db.shares(G, user.id, 'RRM'), 2);
  assert.strictEqual(db.player(G, user).cash, 500_00 - 2 * rrm);

  assert.ok(text(await say('r!buy RRM 999999')).includes('only have'));
  assert.ok(text(await say('r!buy RRM -3')).includes('whole number'));
  assert.ok(text(await say('r!buy NOPE 1')).includes('Unknown ticker'));
  assert.ok(text(await say('r!buy')).includes('missing'));

  await say('r!sell RRM all');
  assert.strictEqual(db.shares(G, user.id, 'RRM'), 0);
  assert.strictEqual(db.player(G, user).cash, 500_00, 'cents survive a round trip');

  await say('r!daily');
  assert.strictEqual(db.player(G, user).cash, 750_00);
  assert.ok(text(await say('r!daily')).includes('already claimed'));

  // Per-server balances: a different server starts fresh.
  assert.strictEqual(db.player('999999999999999999', user).cash, 500_00);

  // Closed market and bankrupt companies block trades.
  const closed = JSON.parse(JSON.stringify(open)); closed.market.open = false;
  market.set(closed);
  assert.ok(text(await say('r!buy RRM 1')).includes('closed'));
  const broke = JSON.parse(JSON.stringify(open)); broke.companies[0].status = 'bankrupt';
  market.set(broke);
  assert.ok(text(await say('r!buy RRM 1')).includes('bankrupt'));

  market.set(open);
  await say('r!buy BNW max');
  const lb = api.leaderboard(db, market, open, G);
  assert.strictEqual(lb[0].name, 'tester');
  assert.ok(Math.abs(lb[0].netWorth - 750) < 0.01, 'net worth ~750, got ' + lb[0].netWorth);

  assert.ok(text(await say('r!help')).includes('r!buy'));
  assert.ok(router.parsePrefix('hello r!buy') === null, 'only messages starting with the prefix');

  console.log('All command tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
