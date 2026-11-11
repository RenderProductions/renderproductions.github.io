// Sit Back and Relax: limit orders and brokers. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const trading = require('../src/trading');
const reserve = require('../src/reserve');
const A = require('../src/achievements');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const snap = (prices = {}, edit) => { const m = JSON.parse(JSON.stringify(base)); m.market = { ...m.market, status: 'open', open: true, halted: false }; m.crash = null; m.boost = null;
  for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = prices[c.id] ?? 10; } m.updated = new Date().toISOString(); if (edit) edit(m); return m; };
let m = snap();
market.set(m);

const G = '123456789012345678';
const inbox = {};
const mk = (id, username) => ({ id, username, send: async (x) => { (inbox[id] = inbox[id] || []).push(x); } });
const ANA = mk('920000000000000001', 'ana'), BEN = mk('920000000000000002', 'ben');
const users = { [ANA.id]: ANA, [BEN.id]: BEN };
const client = { user: { id: '9' }, users: { fetch: async (id) => users[id] } };
const deps = { db, market, client };
const ctxFor = (u) => router.makeCtx({ guildId: G, channelId: 'c', user: u }, { db, market, client });
async function say(line, u = ANA, extra = {}) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), { ...p.args, ...extra }); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const cash = (u = ANA) => db.player(G, u).cash;
const shares = (t, u = ANA) => db.holding(G, u.id, t).shares;
const tick = (prices, edit) => { m = snap(prices, edit); market.set(m); return trading.tick(deps, m); };
const settle = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  for (const u of [ANA, BEN]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 10000_00 }); }

  // ---- limit orders ----
  let out = text(await say('r!order buy RRM 10 at 8'));
  assert.ok(out.includes('Order **#1** placed') && out.includes('⬡ 80.00 is set aside'), out);
  assert.strictEqual(cash(), 10000_00 - 80_00, 'buy orders set the Polygons aside');
  assert.ok(text(await say('r!orders')).includes('Buy 10 RRM at ⬡ 8.00 or less'));
  tick({ RRM: 9 });
  assert.strictEqual(shares('RRM'), 0, 'not yet');
  const r0 = reserve.get(db);
  tick({ RRM: 7.5 });
  assert.strictEqual(shares('RRM'), 10, 'filled at 7.50');
  assert.strictEqual(cash(), 10000_00 - 75_00, 'paid the lower price, the rest came back');
  assert.strictEqual(reserve.get(db), r0 + 75_00);
  assert.ok(A.has(db, ANA.id, 'set_and_forget'));
  await settle();
  assert.ok(inbox[ANA.id].some((x) => x.embeds[0].title.includes('Limit order filled')));
  // Sell at or above, and a stop-loss
  await say('r!order sell RRM 4 at 12');
  await say('r!order sell RRM all below 5');
  tick({ RRM: 12.5 });
  assert.strictEqual(shares('RRM'), 6);
  tick({ RRM: 4 });
  assert.strictEqual(shares('RRM'), 0, 'stop sold the rest');
  assert.strictEqual(trading.list(db, G, ANA.id).length, 0);
  // Cancel gives back what was set aside
  await say('r!order buy NACH 5 at 2');
  const c1 = cash();
  assert.ok(text(await say('r!order cancel 4')).includes('⬡ 10.00 is back'));
  assert.strictEqual(cash(), c1 + 10_00);
  // Mistakes
  assert.ok(text(await say('r!order buy XYZ 5 at 2')).includes('five main companies'));
  assert.ok(text(await say('r!order buy RRM all at 2')).includes('needs a number'));
  assert.ok(text(await say('r!order buy RRM 99999 at 2')).includes('sets aside'));
  // Closed market: nothing fills
  await say('r!order buy BLU 1 at 50');
  m = snap({}, (x) => { x.market.status = 'closed'; x.market.open = false; }); market.set(m);
  assert.strictEqual(trading.tick(deps, m).orders.length, 0);
  assert.strictEqual(tick().orders.length, 1, 'fills once the market opens');

  // ---- brokers ----
  out = await say('r!broker');
  assert.ok(text(out).includes('Brokers looking for work') && text(out).includes('⬡ 1,000.00'));
  const brokerCmd = require('../src/commands/broker');
  const hireBtn = out.components[0].components[0].custom_id.split(':').slice(1);
  assert.ok((await brokerCmd.onButton(ctxFor(BEN), hireBtn)).reply.includes("isn't your brokerage"));
  const hired = await brokerCmd.onButton(ctxFor(ANA), hireBtn);
  assert.ok(hired.update.content.includes('You hired') && hired.update.content.includes('⬡ 1,000.00'));
  assert.ok(A.has(db, ANA.id, 'hired_help'));
  let b = trading.get(db, G, ANA.id);
  // Make it a steady broker for predictable tests
  db.raw.prepare("UPDATE brokers SET trait = 'steady' WHERE user_id = ?").run(ANA.id);
  assert.ok(text(await say('r!broker buy RRM until 6')).includes('keep buying **RRM**'));
  await say('r!broker sell RRM at 9');
  await say('r!broker stop RRM at 3');
  const c2 = cash();
  tick({ RRM: 5 });
  let h = trading.holding(db, G, ANA.id, 'RRM', m);
  assert.strictEqual(h.shares, 5, 'steady buys 5 a tick');
  assert.strictEqual(cash(), c2 - 25_00);
  for (let i = 0; i < 6; i++) tick({ RRM: 5 });
  assert.strictEqual(trading.holding(db, G, ANA.id, 'RRM', m).shares, 25, 'never more than 25 per company');
  assert.strictEqual(shares('RRM'), 0, "the broker's shares are theirs to manage, not in your own holdings");
  // Net worth counts them
  const bal = text(await say('r!balance'));
  // Sell at 9: 25 shares, paid 125, sold 225, profit 100, 10% cut 10
  const c3 = cash();
  tick({ RRM: 9 });
  assert.strictEqual(trading.holding(db, G, ANA.id, 'RRM', m).shares, 0);
  assert.strictEqual(cash(), c3 + 225_00 - 10_00, 'the broker takes 10% of the profit');
  b = trading.get(db, G, ANA.id);
  assert.strictEqual(b.profit, 100_00);
  assert.ok(text(await say('r!broker')).includes('Sold 25 RRM at ⬡ 9.00'));
  // Stop-loss
  tick({ RRM: 5 });
  tick({ RRM: 2.5 });
  assert.strictEqual(trading.holding(db, G, ANA.id, 'RRM', m).shares, 0, 'stop sold');
  assert.ok(trading.get(db, G, ANA.id).profit < 100_00);

  // A cautious broker waits a tick
  db.raw.prepare("UPDATE brokers SET trait = 'cautious' WHERE user_id = ?").run(ANA.id);
  tick({ RRM: 5 });
  assert.strictEqual(trading.holding(db, G, ANA.id, 'RRM', m).shares, 0, 'waited');
  tick({ RRM: 5 });
  assert.strictEqual(trading.holding(db, G, ANA.id, 'RRM', m).shares, 3, 'then bought (3 a tick)');
  // A gambler goes off script
  db.raw.prepare("UPDATE brokers SET trait = 'gambler' WHERE user_id = ?").run(ANA.id);
  trading.clearRules(db, G, ANA.id, 'RRM');
  trading.setRule(db, G, ANA.id, 'BLU', 'sell', 999_00);
  m = snap({ BLU: 10 }); market.set(m);
  trading.work(deps, trading.get(db, G, ANA.id), m, () => 0.01);
  assert.ok(trading.holding(db, G, ANA.id, 'BLU', m).shares > 0, 'bought something nobody asked for');
  assert.ok(JSON.parse(trading.get(db, G, ANA.id).log)[0][1].includes('Off script'));

  // Bankruptcy wipes the broker's shares too
  m = snap({}, (x) => { x.wipes.BLU = 1; }); market.set(m);
  assert.strictEqual(trading.holding(db, G, ANA.id, 'BLU', m).shares, 0);

  // ---- payday ----
  db.raw.prepare("UPDATE brokers SET trait = 'steady', paid_day = '2000-01-01' WHERE user_id = ?").run(ANA.id);
  const c4 = cash();
  tick();
  assert.strictEqual(cash(), c4 - 100_00, 'salary paid');
  await settle();
  assert.ok(inbox[ANA.id].some((x) => x.embeds[0].title.includes('daily report')));
  // Loyalty: a week on the job eases the bonus back a step
  db.raw.prepare("UPDATE brokers SET paid_day = '2000-01-01', loyal_at = ?, hires = 2 WHERE user_id = ?").run(Date.now() - 8 * 86400000, ANA.id);
  tick();
  assert.strictEqual(trading.get(db, G, ANA.id).hires, 1);
  // Can't pay: they quit, and hand back what they hold
  trading.setRule(db, G, ANA.id, 'NACH', 'buy', 20_00);
  tick({ NACH: 10 });
  const held = trading.holding(db, G, ANA.id, 'NACH', m).shares;
  assert.ok(held > 0);
  db.updatePlayer(G, ANA.id, { cash: 50_00 });
  db.raw.prepare("UPDATE brokers SET paid_day = '2000-01-01' WHERE user_id = ?").run(ANA.id);
  tick({ NACH: 10 });
  assert.strictEqual(trading.get(db, G, ANA.id), null, 'quit');
  assert.strictEqual(shares('NACH'), held, 'their shares came back to you');
  assert.ok(A.has(db, ANA.id, 'youre_fired'));
  // Rehiring costs 1.25x more each time
  assert.strictEqual(trading.nextBonus(db, G, ANA.id), Math.round(1000_00 * Math.pow(1.25, 1)));

  // ---- firing ----
  db.updatePlayer(G, BEN.id, { cash: 10000_00 });
  const c = trading.candidates(BEN.id)[0];
  trading.hire(ctxFor(BEN), c);
  assert.strictEqual(trading.nextBonus(db, G, BEN.id), 1250_00);
  trading.setRule(db, G, BEN.id, 'BNW', 'buy', 50_00);
  tick({ BNW: 10 });
  const fireAsk = await say('r!broker fire', BEN);
  const fired = await brokerCmd.onButton(ctxFor(BEN), fireAsk.components[0].components[0].custom_id.split(':').slice(1));
  assert.ok(fired.update.content.includes('packs up') && shares('BNW', BEN) > 0);
  assert.strictEqual(trading.rules(db, G, BEN.id).length, 0);

  // Retirement Plan (secret): a broker making 10,000 in profit
  trading.hire(ctxFor(BEN), trading.candidates(BEN.id)[1]);
  db.raw.prepare("UPDATE brokers SET trait = 'steady', profit = 9990_00 WHERE user_id = ?").run(BEN.id);
  trading.setRule(db, G, BEN.id, 'BSTG', 'buy', 2_00);
  trading.setRule(db, G, BEN.id, 'BSTG', 'sell', 100_00);
  tick({ BSTG: 1 });
  tick({ BSTG: 100 });
  assert.ok(A.has(db, BEN.id, 'retirement_plan'));

  console.log('All trading tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
