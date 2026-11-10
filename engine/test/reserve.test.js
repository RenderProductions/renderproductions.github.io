// The Polygon Reserve: money in, money out, shrinking payouts, warnings, refills and the crash. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = ''; // never call GitHub from tests
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const reserve = require('../src/reserve');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false };
m.crash = null;
for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 10; }
market.set(m);

const G = '123456789012345678';
const ANA = { id: '500000000000000001', username: 'ana', send: async () => {} };
const client = { user: { id: '1' }, users: { fetch: async () => ANA } };
const ctx = () => ({ ...router.makeCtx({ guildId: G, channelId: 'c', user: ANA, guildName: 'Test' }, { db, market, client }), random: () => 0.99 });
async function say(line, args = {}) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctx(), { ...p.args, ...args }); }
const S = reserve.RULES.start;

(async () => {
  // A new player's starting Polygons come out of it
  db.player(G, ANA);
  assert.strictEqual(reserve.get(db), S - config.startingCash);
  db.updatePlayer(G, ANA.id, { cash: 100000_00 });

  // Buying stock fills it, selling drains it
  let before = reserve.get(db);
  await say('r!buy RRM 10');
  assert.strictEqual(reserve.get(db), before + 10 * 10_00);
  await say('r!sell RRM 4');
  assert.strictEqual(reserve.get(db), before + 6 * 10_00);

  // Daily is paid out of it, full size while it's healthy
  before = reserve.get(db);
  let out = await say('r!daily');
  assert.ok(JSON.stringify(out).includes('250.00'));
  assert.strictEqual(reserve.get(db), before - config.dailyAmount);

  // Warnings as it falls, and shrinking payouts under 25%
  const warned = [];
  reserve.events.on('low', (e) => warned.push(e.line));
  reserve.move(db, Math.round(S * 0.12) - reserve.get(db)); // down to 12%
  assert.deepStrictEqual(warned, [0.25], 'one warning for the worst line crossed');
  assert.ok(Math.abs(reserve.factor(db) - 0.48) < 0.01, 'payouts at about 48%');
  db.updatePlayer(G, ANA.id, { daily_day: '' });
  out = await say('r!daily');
  assert.ok(JSON.stringify(out).includes('120.00') && JSON.stringify(out).includes('payouts are at 48%'));
  out = await say('r!reserve');
  assert.ok(out.embeds[0].description.includes('12%') && out.embeds[0].description.includes('shrunk'));

  // Never below the emergency floor
  reserve.move(db, -reserve.get(db) - 5000_00);
  assert.strictEqual(reserve.factor(db), reserve.RULES.minPayout);
  assert.deepStrictEqual(warned, [0.25, 0]);

  // At zero, a crash starts once (GitHub is faked here)
  const calls = [];
  global.fetch = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true }; };
  config.githubToken = 'test';
  assert.strictEqual((await reserve.maybeCrash(db, m)).started, true);
  assert.ok(calls[0].url.endsWith('/actions/workflows/crash.yml/dispatches') && calls[0].body.inputs.action === 'start a crash');
  assert.strictEqual((await reserve.maybeCrash(db, m)).started, false, 'only once');
  config.githubToken = '';

  // The crash's recovery refills it toward 50%
  const rec = { ...m, crash: { phase: 'recovery', crashUntil: new Date().toISOString(), recoveryUntil: new Date(Date.now() + 48 * 3600000).toISOString() } };
  before = reserve.get(db);
  assert.ok(reserve.recover(db, rec) > 0 && reserve.get(db) > before);
  reserve.move(db, Math.round(S * 0.49) - reserve.get(db));
  for (let i = 0; i < 10; i++) reserve.recover(db, rec);
  assert.ok(reserve.get(db) <= S * 0.5 + 1, 'stops at half');

  // Only the owner can fund it
  config.ownerId = ANA.id;
  before = reserve.get(db);
  await say('r!reserve fund 1000');
  assert.strictEqual(reserve.get(db), before + 1000_00);
  config.ownerId = 'someone-else';
  assert.ok(JSON.stringify(await say('r!reserve fund 1000')).includes('Only the bot owner'));

  // Reset puts it back to exactly full
  config.ownerId = ANA.id;
  await say('r!reserve reset');
  assert.strictEqual(reserve.get(db), S);
  config.ownerId = 'someone-else';

  // The house's balance is the reserve now
  const bal = await say('r!balance', { user: { id: '1', username: "Render's Vision", bot: true } });
  assert.ok(bal.embeds[0].description.includes('Polygon Reserve'));

  console.log('All reserve tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
