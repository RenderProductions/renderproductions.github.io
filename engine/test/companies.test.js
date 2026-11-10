// Player companies, start to finish: found, approve/reject, levels, IPO, trading, work, salary,
// upkeep, death. Offline, throwaway database:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const co = require('../src/companies');
const publish = require('../src/publish');
const work = require('../src/commands/work');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false };
market.set(m);

const G = '123456789012345678';
const G2 = '876543210987654321';
const mk = (id, username) => ({ id, username, send: async () => {} });
const OWNER = mk('100000000000000001', 'founder');
const BOB = mk('100000000000000002', 'bob');
const MOD = mk('100000000000000003', 'mod');

function ctxFor(user, { guildId = G, isMod = false } = {}) {
  const ctx = router.makeCtx({ guildId, channelId: 'chan', user, isMod }, { db, market });
  ctx.random = () => 0.5;
  return ctx;
}
const text = (out) => (out == null ? '' : out.content || JSON.stringify(out.embeds));
async function say(line, user = OWNER, opts) {
  const p = router.parsePrefix(line);
  assert.ok(p, 'not a command: ' + line);
  return text(await router.runCommand(p.cmd, ctxFor(user, opts), p.args));
}
const has = async (line, needle, user, opts) => {
  const out = await say(line, user, opts);
  assert.ok(out.includes(needle), `"${line}" should include "${needle}", got: ${out}`);
};
const cash = (u, g = G) => db.player(g, u).cash;

(async () => {
  // ---- founding ----
  await has('r!found', 'Usage');
  db.player(G, OWNER);
  await has('r!found MEOW Meow Industries', 'costs **⬡ 2,500.00');
  db.updatePlayer(G, OWNER.id, { cash: 100_000_00, debt: 5_00 });
  await has('r!found MEOW Meow Industries', 'Pay me back');
  db.updatePlayer(G, OWNER.id, { debt: 0 });
  await has('r!found M Meow', '2 to 5 letters');
  await has('r!found RRM Render Clone', 'already a listed company');
  await has('r!found MEOW Me', '3 to 32 characters');
  await has('r!found meow **Meow** @Industries', 'is filed');
  assert.strictEqual(cash(OWNER), 97_500_00);
  assert.strictEqual(co.get(db, 'MEOW').name, 'Meow Industries');
  await has('r!found WOOF Woof Co', 'already run **Meow Industries**');
  await has('r!company', 'Waiting for approval');
  await has('r!buy MEOW 1', 'Usage', BOB); // pending companies can't be traded

  // ---- approvals ----
  await has('r!review', "aren't set up", MOD);
  config.ownerId = OWNER.id;
  config.homeGuildId = G;
  await has('r!approve MEOW', 'Only Render Room mods', BOB);
  await has('r!approve MEOW', 'Only Render Room mods', MOD, { guildId: G2, isMod: true }); // mod elsewhere doesn't count
  await has('r!review', 'MEOW', MOD, { isMod: true });

  db.player(G, BOB);
  db.updatePlayer(G, BOB.id, { cash: 10_000_00 });
  await has('r!found BARK Bark Bark', 'is filed', BOB);
  await has('r!reject BARK too loud', 'got their ⬡ 2,500.00 back', MOD, { isMod: true });
  assert.strictEqual(cash(BOB), 10_000_00, 'rejected founder is refunded');
  assert.strictEqual(co.get(db, 'BARK').note, 'too loud');
  await has('r!found BARK Quiet Bark', 'is filed', BOB); // a rejected ticker can be used again
  await has('r!reject BARK', 'Rejected', OWNER); // the bot owner can review from anywhere

  await has('r!approve MEOW', 'Approved **Meow Industries**', MOD, { isMod: true });
  let c = co.get(db, 'MEOW');
  assert.strictEqual(c.status, 'private');
  assert.strictEqual(c.treasury, 2_500_00, 'founding cost becomes the treasury');

  // ---- growing ----
  await has('r!ipo', 'Only a **Firm**');
  await has('r!upgrade', 'costs **⬡ 5,000.00**');
  await has('r!invest abc', 'Usage');
  await has('r!invest 3000', 'Treasury: **⬢ 5,500.00**');
  await has('r!upgrade', 'now a **Small Business**');
  await has('r!invest 14000', 'Treasury: **⬢ 14,500.00**');
  await has('r!upgrade', 'You can go public now');
  await has('r!buy MEOW 1', 'is private', BOB);
  await has('r!salary 10', 'Only public companies');
  await has('r!ipo', 'no going back');
  const ipoCmd = require('../src/commands/ipo');
  assert.ok((await ipoCmd.onButton(ctxFor(OWNER), [OWNER.id, 'no'])).update.content.includes('Staying private'));
  assert.strictEqual(co.get(db, 'MEOW').status, 'private');
  assert.ok((await ipoCmd.onButton(ctxFor(BOB), [OWNER.id, 'yes'])).reply.includes('not your company'));
  assert.ok((await ipoCmd.onButton(ctxFor(OWNER), [OWNER.id, 'yes'])).update.content.includes('IS PUBLIC'));
  c = co.get(db, 'MEOW');
  assert.strictEqual(c.status, 'public');
  assert.strictEqual(c.treasury, 500_00, '14,500 - 12,000 upgrade - 2,000 listing fee');
  assert.strictEqual(c.price, 15.5, '(500 + 15,000 level value) / 1000 shares');
  await has('r!exchange', 'Meow Industries', BOB);

  // ---- trading ----
  await has('r!buy MEOW 5', "can't own shares of your own company");
  await has('r!buy MEOW 401', 'Only 400 shares', BOB);
  await has('r!buy MEOW 10', 'went into Meow Industries', BOB);
  c = co.get(db, 'MEOW');
  assert.strictEqual(c.treasury, 500_00 + 10 * 15_50, 'IPO shares fund the treasury');
  assert.strictEqual(c.offering_left, 390);
  assert.ok(c.price > 15.5, 'buying pushes the price up');
  await has('r!bal', '🏢 Meow Industries (MEOW)', BOB);
  await has('r!sell MEOW 20', 'only own 10', BOB);
  await has('r!sell MEOW 4', 'own **6**', BOB);
  assert.ok(co.get(db, 'MEOW').price < c.price, 'selling pushes it down');
  assert.strictEqual(co.holding(db, G2, BOB.id, 'MEOW'), 0, 'shares are per server');

  // ---- working there ----
  await has('r!apply MEOW', 'Welcome to **Meow Industries**', BOB);
  const t0 = co.get(db, 'MEOW').treasury;
  await say('r!work', BOB);
  const w = router.pending.get(`chan:${BOB.id}`);
  router.pending.delete(`chan:${BOB.id}`);
  const raw = await w.handler({ content: work.active.get(`${G}:${BOB.id}`).ans });
  const out = typeof raw === 'string' ? raw : raw.content;
  assert.ok(out.includes('+⬡ 42.00'), out); // 35 x 1.2 (Firm)
  assert.strictEqual(co.get(db, 'MEOW').treasury, t0 + 21_00, 'half the pay goes to the company');

  // ---- salary ----
  c = co.get(db, 'MEOW');
  const max = Math.floor(c.treasury * 0.1);
  await has('r!salary 999999', 'up to', OWNER);
  await has('r!salary max', 'from **Meow Industries**', OWNER, { guildId: G2 }).catch(() => {}); // wrong server is refused
  await has('r!salary max', 'paid in the server where you founded', OWNER, { guildId: G2 });
  const before = cash(OWNER);
  await has('r!salary max', 'You paid yourself');
  assert.strictEqual(cash(OWNER), before + max);
  await has('r!salary 1', 'Next salary');

  // ---- the market moves ----
  const p0 = co.get(db, 'MEOW').price;
  co.tick(db, Date.now(), () => 0.9);
  c = co.get(db, 'MEOW');
  assert.notStrictEqual(c.price, p0);
  assert.strictEqual(c.history.length, 2);
  await has('r!company MEOW', 'Price:', BOB);

  // ---- missed upkeep, then death ----
  co.update(db, 'MEOW', { treasury: 0, last_upkeep: Date.now() - co.RULES.dayMs - 1000 });
  let events = co.tick(db, Date.now(), () => 0.5);
  assert.deepStrictEqual(events[0], { ticker: 'MEOW', type: 'missed', strikes: 1 });
  await has('r!company', 'Missed upkeep 1 time');
  await has('r!upgrade', 'behind on upkeep');
  let now = Date.now();
  for (let day = 0; day < 10 && co.get(db, 'MEOW').status === 'public'; day++) {
    now += co.RULES.dayMs;
    for (let i = 0; i < 288 && co.get(db, 'MEOW').status === 'public'; i++) co.tick(db, now + i * co.RULES.tickMs, () => 0.5);
  }
  c = co.get(db, 'MEOW');
  assert.strictEqual(c.status, 'dead', 'an unfunded company dies');
  assert.strictEqual(c.price, 0);
  assert.strictEqual(co.holding(db, G, BOB.id, 'MEOW'), 0, "everyone's shares are gone");
  assert.strictEqual(db.player(G, BOB).job, null, 'employees lose their job');
  await has('r!sell MEOW 1', 'went under', BOB);
  await has('r!company MEOW', 'Closed', BOB);
  await has('r!found MEOW Meow Again', 'taken (by a company that went under)');
  await has('r!found PURR Purr Partners', 'is filed'); // the founder can start over

  // A private company closes after 3 missed upkeeps
  await has('r!approve PURR', 'Approved', OWNER);
  co.update(db, 'PURR', { treasury: 0, last_upkeep: Date.now() - 3 * co.RULES.dayMs - 1000 });
  events = co.tick(db);
  assert.ok(events.some((e) => e.type === 'dead' && e.ticker === 'PURR'));

  // ---- site snapshot ----
  await has('r!found ZOOM Zoom Zoom', 'is filed', BOB);
  await has('r!approve ZOOM', 'Approved', OWNER);
  const snap = publish.snapshot(db);
  assert.strictEqual(snap.companies.length, 1);
  assert.strictEqual(snap.companies[0].ticker, 'ZOOM');
  assert.strictEqual(snap.closed.length, 2);
  assert.strictEqual(snap.levels.length, 5);
  config.githubToken = '';
  assert.strictEqual(await publish.publish(db), false, 'no token = nothing published');

  console.log('All company tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
