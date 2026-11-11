// Heists & Schemes: shorts, heists, takeovers, mergers, world events, 7-day history. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.achievementPay = false; // counts exact balances
config.githubToken = '';
config.ownerId = '950000000000000001';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const reserve = require('../src/reserve');
const A = require('../src/achievements');
const S = require('../src/shorts');
const H = require('../src/heists');
const T = require('../src/takeovers');
const W = require('../src/worldEvents');
const co = require('../src/companies');
const trading = require('../src/trading');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const snap = (prices = {}, edit) => { const m = JSON.parse(JSON.stringify(base)); m.market = { ...m.market, status: 'open', open: true, halted: false }; m.crash = null; m.boost = null;
  for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = prices[c.id] ?? 10; } m.changes = {}; m.updated = new Date().toISOString(); if (edit) edit(m); return m; };
let m = snap(); market.set(m);

const G = '123456789012345678';
const inbox = {};
const mk = (n, username) => { const id = `95000000000000000${n}`; return { id, username, send: async (x) => { (inbox[id] = inbox[id] || []).push(x); } }; };
const [OWN, ANA, BEN, CAL, DEE, EVE] = [mk(1, 'own'), mk(2, 'ana'), mk(3, 'ben'), mk(4, 'cal'), mk(5, 'dee'), mk(6, 'eve')];
const users = Object.fromEntries([OWN, ANA, BEN, CAL, DEE, EVE].map((u) => [u.id, u]));
const client = { user: { id: '9' }, users: { fetch: async (id) => users[id] } };
const deps = { db, market, client };
const ctxFor = (u, extra = {}) => ({ ...router.makeCtx({ guildId: G, channelId: 'den', user: u, ...extra }, deps), random: extra.random || Math.random });
async function say(line, u = ANA) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), p.args); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const cash = (u = ANA) => db.player(G, u).cash;
const tick = (prices, edit) => { m = snap(prices, edit); market.set(m); return trading.tick(deps, m); };
const settle = () => new Promise((r) => setTimeout(r, 10));

(async () => {
  for (const u of Object.values(users)) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 100000_00 }); }

  // ---------------- shorts ----------------
  let out = text(await say('r!short RRM 10'));
  assert.ok(out.includes('Shorted 10 RRM at ⬡ 10.00') && out.includes('⬡ 50.00') && out.includes('Bear'), out);
  assert.strictEqual(cash(), 100000_00 - 50_00 - 1_00, 'half as margin, 1% fee');
  assert.ok(text(await say('r!short')).includes('margin call at ⬡ 14.50'));
  // Net worth: margin plus profit
  m = snap({ RRM: 6 }); market.set(m);
  assert.strictEqual(S.value(db, G, ANA.id, m, market.quote), 50_00 + 40_00);
  // Cover at 6: +40
  let c0 = cash();
  out = text(await say('r!cover RRM'));
  assert.ok(out.includes('profit **+⬡ 40.00**'), out);
  assert.strictEqual(cash(), c0 + 90_00);
  // Limits and mistakes
  assert.ok(text(await say('r!short RRM 101')).includes('up to 100'));
  assert.ok(text(await say('r!short XYZ 5')).includes('five main companies'));
  assert.ok(text(await say('r!cover RRM')).includes('no shorts open'));
  // Margin call: price climbs past entry + 90% of the margin per share
  await say('r!short BLU 10'); // at 6? no: BLU is 10
  tick({ BLU: 14 });
  assert.ok(S.get(db, G, ANA.id, 'BLU'), 'not yet');
  c0 = cash();
  tick({ BLU: 14.6 });
  assert.strictEqual(S.get(db, G, ANA.id, 'BLU'), null, 'margin called');
  assert.strictEqual(cash(), c0 + 50_00 - 46_00, 'the loss came out of the margin');
  assert.ok(A.has(db, ANA.id, 'margin_call'));
  // Bankruptcy pays the short out in full
  await say('r!short NACH 100', BEN);
  c0 = cash(BEN);
  tick({}, (x) => { x.wipes.NACH = 1; x.statuses.NACH = 'bankrupt'; });
  assert.strictEqual(cash(BEN), c0 + 500_00 + 1000_00, 'margin back plus the whole position');
  assert.ok(A.has(db, BEN.id, 'big_short'));
  await settle();
  assert.ok(inbox[BEN.id].some((x) => x.embeds[0].title.includes('short paid out')));
  // A losing cover can't take more than the margin
  tick();
  await say('r!short BNW 10', BEN);
  m = snap({ BNW: 14 }); market.set(m);
  c0 = cash(BEN);
  await say('r!cover all', BEN);
  assert.strictEqual(cash(BEN), c0 + 50_00 - 40_00);
  tick();

  // ---------------- world events ----------------
  db.setMeta('world_event', '');
  assert.strictEqual(W.tick(db, m, 1000), null, 'the first tick schedules one');
  const e = W.tick(db, m, 1000 + W.RULES.firstMs, () => 0.99);
  assert.ok(e && W.EVENTS[e.id], 'then it starts');
  assert.strictEqual(W.tick(db, m, 1000 + W.RULES.firstMs + 60_000), null, 'one at a time');
  // Market-aware: a big riser gets a Hiring Spree, a big faller a Fire Sale
  assert.deepStrictEqual(W.pick(snap({}, (x) => { x.changes = { BLU: 12 }; }), () => 0.1), { id: 'spotlight', ticker: 'BLU' });
  assert.deepStrictEqual(W.pick(snap({}, (x) => { x.changes = { BNW: -15 }; }), () => 0.4), { id: 'fire_sale', ticker: 'BNW' });
  // Effects
  W.start(db, 'bear_rumors');
  c0 = cash(CAL);
  await say('r!short RRM 10', CAL);
  assert.strictEqual(cash(CAL), c0 - 50_00, 'no fee during Bear Rumors');
  await say('r!cover RRM', CAL);
  W.start(db, 'labor_shortage');
  assert.strictEqual(W.workMult(db, 'RRM'), 1.5);
  W.start(db, 'spotlight', 'RRM');
  assert.strictEqual(W.workMult(db, 'RRM'), 2);
  assert.strictEqual(W.workMult(db, 'BLU'), 1);
  W.start(db, 'chatty');
  assert.strictEqual(W.chatMult(db), 2);
  assert.ok(text(await say('r!event')).includes('Gossip Hour'));
  assert.ok(text(await say('r!event start fish_frenzy')).includes('Only the bot owner'));
  assert.ok(text(await say('r!event start fish_frenzy', OWN)).includes('Fish Frenzy'));
  assert.ok(W.fishFrenzy(db));
  W.end(db);
  assert.strictEqual(W.active(db), null);

  // ---------------- heists ----------------
  const heist = require('../src/commands/heist');
  out = await say('r!heist');
  assert.ok(text(out).includes('Get a crew of 3 to 5'));
  assert.ok(text(await say('r!heist vault XYZ')).includes('Which vault'));
  const lobby = await say('r!heist vault RRM');
  assert.ok(text(lobby).includes('Heist: the RRM vault') && text(lobby).includes('Crew: **1**'), text(lobby));
  const btn = (o, i) => o.components.flatMap((r) => r.components)[i].custom_id.split(':').slice(1);
  const press = (u, parts, extra) => heist.onButton(ctxFor(u, extra), parts);
  // Roles: hacker, driver, lookout, muscle; then start, leave, cancel
  assert.ok((await press(BEN, btn(lobby, 4))).reply.includes('Only the leader'), 'only the leader starts');
  await press(BEN, btn(lobby, 0)); // hacker
  let up = await press(CAL, btn(lobby, 3)); // muscle
  assert.ok(text(up.update).includes('Crew: **3**'));
  // Start: clean getaway (roll 0)
  const r0 = reserve.get(db);
  const before = [ANA, BEN, CAL].map((u) => cash(u));
  up = await press(ANA, btn(lobby, 4), { random: () => 0 });
  const fin = up.update._final;
  assert.ok(text(fin).includes('CLEAN GETAWAY'), text(fin));
  const each = Math.floor(Math.round(3000_00 * 1.2) / 3);
  [ANA, BEN, CAL].forEach((u, i) => assert.strictEqual(cash(u), before[i] - 250_00 + each, `${u.username} got a share`));
  assert.ok(A.has(db, BEN.id, 'crew_up') && text(fin).includes('Crew Up'));
  assert.strictEqual(reserve.get(db), r0 + 3 * 250_00 - Math.round(3000_00 * 1.2));
  // Cooldowns: the crew and the server
  assert.ok(text(await say('r!heist stash')).includes('lying low'));
  assert.ok(text(await say('r!heist stash', DEE)).includes('just a heist'));
  // Caught: stake plus a fine
  db.setMeta(`heist_at:${G}`, '0');
  const l2 = await say('r!heist stash', DEE);
  await press(EVE, btn(l2, 2));
  await press(OWN, btn(l2, 2));
  const b2 = [DEE, EVE, OWN].map((u) => cash(u));
  up = await press(DEE, btn(l2, 4), { random: () => 0.99 });
  assert.ok(text(up.update._final).includes('CAUGHT'));
  [DEE, EVE, OWN].forEach((u, i) => assert.strictEqual(cash(u), b2[i] - 400_00 - 800_00));
  assert.ok(A.has(db, EVE.id, 'red_handed'));
  assert.ok(H.cooldown(db, G, EVE.id) > Date.now() + 11 * 3600000, 'caught: 12 hours');
  // A driver can get a failed crew away
  for (const u of Object.values(users)) db.setMeta(`heist_cd:${G}:${u.id}`, '0');
  db.setMeta(`heist_at:${G}`, '0');
  const r = H.run(db, G, { target: 'vault', ticker: 'BLU', crew: [{ id: ANA.id, name: 'ana', role: 'driver' }, { id: BEN.id, name: 'ben', role: 'driver' }, { id: CAL.id, name: 'cal', role: 'lookout' }] }, ((xs) => () => xs.shift())([0.99, 0.1]));
  assert.strictEqual(r.outcome, 'escaped');
  // The reserve needs a hacker
  assert.ok(H.odds('reserve', [{ role: 'muscle' }, { role: 'muscle' }, { role: 'lookout' }]) < H.odds('reserve', [{ role: 'hacker' }, { role: 'muscle' }, { role: 'lookout' }]) - 0.2);
  // Police Strike
  assert.ok(Math.abs(H.odds('vault', [{ role: 'lookout' }, { role: 'lookout' }, { role: 'lookout' }], 0.15) - H.odds('vault', [{ role: 'lookout' }, { role: 'lookout' }, { role: 'lookout' }]) - 0.15) < 1e-9);
  // Robbing the Reserve takes from it directly, not shrunk
  db.setMeta(`heist_at:${G}`, '0');
  for (const u of Object.values(users)) db.setMeta(`heist_cd:${G}:${u.id}`, '0');
  const rr = reserve.get(db);
  const rob = H.run(db, G, { target: 'reserve', crew: [{ id: ANA.id, name: 'ana', role: 'hacker' }, { id: BEN.id, name: 'ben', role: 'muscle' }, { id: CAL.id, name: 'cal', role: 'lookout' }] }, () => 0);
  assert.strictEqual(rob.outcome, 'clean');
  assert.strictEqual(reserve.get(db), rr + 3 * 750_00 - rob.haul);
  assert.ok(text(await say('r!heist')).includes('Recent heists here'));

  // ---------------- takeovers ----------------
  co.found(db, { ticker: 'MEOW', name: 'Meow Corp', owner: OWN, guildId: G });
  co.approve(db, 'MEOW');
  co.update(db, 'MEOW', { level: 3, treasury: 20000_00 });
  co.ipo(db, 'MEOW');
  assert.ok(text(await say('r!takeover MEOW')).includes('You need **200**'));
  co.update(db, 'MEOW', { price: 1 });
  co.buy(db, { guildId: G, user: ANA, ticker: 'MEOW', n: 200 });
  const c = co.get(db, 'MEOW');
  const premium = Math.round(T.worth(c) * 0.25);
  c0 = cash();
  out = text(await say('r!takeover MEOW'));
  assert.ok(out.includes('Hostile takeover launched') && cash() === c0 - premium, out);
  await settle();
  assert.ok(inbox[OWN.id].some((x) => String(x).includes('hostile takeover')));
  assert.ok(text(await say('r!takeover', OWN)).includes('is trying to take over'));
  // Defend: the poison pill
  const o0 = cash(OWN);
  out = text(await say('r!takeover defend', OWN));
  assert.ok(out.includes('Poison pill') && cash(OWN) === o0 - Math.round(T.worth(c) * 0.1), out);
  assert.strictEqual(cash(), c0, 'premium refunded');
  assert.ok(A.has(db, OWN.id, 'poison_pill'));
  // Try again, and this time the owner does nothing: it goes through after 24h
  await say('r!takeover MEOW');
  db.raw.prepare('UPDATE takeovers SET ends_at = ?').run(Date.now() - 1);
  const o1 = cash(OWN);
  tick();
  assert.strictEqual(co.get(db, 'MEOW').owner_id, ANA.id, 'ANA owns it now');
  assert.strictEqual(cash(OWN), o1 + premium, 'the old owner got the premium');
  assert.strictEqual(co.holding(db, G, ANA.id, 'MEOW'), 0, "the raider's shares folded into the company");
  assert.ok(A.has(db, ANA.id, 'hostile'));
  assert.ok(text(await say('r!takeover MEOW')).includes('your own company'));

  // ---------------- mergers ----------------
  co.found(db, { ticker: 'WOOF', name: 'Woof Inc', owner: BEN, guildId: G });
  co.approve(db, 'WOOF');
  co.update(db, 'WOOF', { treasury: 3000_00 });
  db.updatePlayer(G, CAL.id, { job: 'WOOF' });
  out = text(await say('r!merge WOOF'));
  assert.ok(out.includes('Merger proposed') && out.includes('(MEOW) absorbs'), out);
  const meowT = co.get(db, 'MEOW').treasury;
  out = text(await say('r!merge MEOW', BEN));
  assert.ok(out.includes('Merger done') && out.includes('Woof Inc (WOOF) is now part of **Meow Corp (MEOW)**'), out);
  assert.strictEqual(co.get(db, 'WOOF').status, 'dead');
  assert.strictEqual(co.get(db, 'MEOW').treasury, meowT + 3000_00);
  assert.strictEqual(db.player(G, CAL).job, 'MEOW', 'employees moved over');
  assert.ok(A.has(db, BEN.id, 'merger') && A.has(db, ANA.id, 'merger'));
  assert.strictEqual(co.ownedBy(db, BEN.id), null, 'BEN is free to found again');

  // ---------------- 7-day history ----------------
  const PH = require('../src/priceHistory');
  const hr = PH.HOUR;
  PH.record(db, snap({ RRM: 5 }), 10 * hr + 5);
  PH.record(db, snap({ RRM: 6 }), 10 * hr + 50); // same hour: the latest wins
  PH.record(db, snap({ RRM: 7 }), 11 * hr);
  assert.deepStrictEqual(PH.of(db, 'RRM').slice(0, 2), [[10 * hr, 6], [11 * hr, 7]]);
  PH.record(db, snap({ RRM: 8 }), 11 * hr + PH.KEEP + 1);
  assert.ok(!PH.of(db, 'RRM').some(([t]) => t === 10 * hr), 'older than a week is dropped');
  assert.ok(PH.snapshot(db).hourly.MEOW, 'player companies too');

  console.log('All Heists & Schemes tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
