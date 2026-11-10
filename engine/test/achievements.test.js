// Achievements, share lots and profiles. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const A = require('../src/achievements');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const snap = (edit) => { const m = JSON.parse(JSON.stringify(base)); m.market = { ...m.market, status: 'open', open: true, halted: false }; m.crash = null; m.boost = null;
  for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 10; } if (edit) edit(m); return m; };
market.set(snap());

const G = '123456789012345678';
const mk = (id, username) => ({ id, username, send: async () => {} });
const ANA = mk('900000000000000001', 'ana'), BEN = mk('900000000000000002', 'ben');
const ctxFor = (u) => router.makeCtx({ guildId: G, channelId: 'c', user: u }, { db, market, client: { user: { id: '9' } } });
async function say(line, u = ANA, extra = {}) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), { ...p.args, ...extra }); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const has = (u, id) => A.has(db, u.id, id);

(async () => {
  for (const u of [ANA, BEN]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 100000_00 }); }

  // Unlocks show up on the reply, once
  let out = await say('r!buy RRM 10');
  assert.ok(text(out).includes('Achievement unlocked') && text(out).includes('Shareholder'));
  assert.ok(!text(await say('r!buy RRM 1')).includes('Shareholder'), 'only once');
  assert.ok(has(ANA, 'shareholder'));

  // Lots: what you paid and when
  assert.strictEqual(db.lots(G, ANA.id, 'RRM').reduce((s, l) => s + l.shares, 0), 11);
  // Time Well Spent: a week-old lot, sold at a profit
  db.raw.prepare('UPDATE lots SET bought_at = ? WHERE user_id = ?').run(Date.now() - 8 * 86400000, ANA.id);
  market.set(snap((m) => { m.prices.RRM = 12; }));
  assert.ok(text(await say('r!sell RRM 5')).includes('Time Well Spent'));
  assert.strictEqual(db.lots(G, ANA.id, 'RRM').reduce((s, l) => s + l.shares, 0), 6, 'oldest lots used first');
  // Paper Hands: sold at half or less
  market.set(snap((m) => { m.prices.RRM = 4; }));
  assert.ok(text(await say('r!sell RRM 1')).includes('Paper Hands'));
  // Buy the Dip, Diversified
  market.set(snap((m) => { m.crash = { phase: 'crash' }; }));
  assert.ok(text(await say('r!buy BLU 1')).includes('Buy the Dip'));
  for (const t of ['NACH', 'BNW']) await say(`r!buy ${t} 1`);
  assert.ok(text(await say('r!buy BSTG 1')).includes('Diversified'));
  market.set(snap());
  // Diamond Hands: shares from before the last crash, sold after its recovery
  db.setMeta('mk_crash', JSON.stringify({ start: new Date(Date.now() - 10 * 86400000).toISOString(), tremorHours: 2, crashHours: 48, recoveryHours: 72 }));
  db.raw.prepare('UPDATE lots SET bought_at = ? WHERE user_id = ? AND ticker = ?').run(Date.now() - 11 * 86400000, ANA.id, 'RRM');
  assert.ok(text(await say('r!sell RRM 1')).includes('Diamond Hands'));
  // Wiped Out
  market.set(snap((m) => { m.wipes.BNW = 1; }));
  await say('r!balance');
  assert.ok(has(ANA, 'wiped_out') && !db.lots(G, ANA.id, 'BNW').length);
  market.set(snap());

  // Daily, gifts, the secret tip
  assert.ok(text(await say('r!daily')).includes('Day One'));
  await say('r!gift', ANA, { player: { id: '9', username: 'bot', bot: true }, amount: '5' });
  assert.ok(has(ANA, 'tip_the_house'));
  await say('r!gift', ANA, { player: BEN, amount: '1000' });
  assert.ok(has(ANA, 'generous'));

  // Legendary: a free Title in that server
  const before = db.itemCount(G, BEN.id, 'title');
  const line = A.award({ db, guildId: G, user: BEN, notes: [] }, 'millionaire');
  assert.ok(line.includes('free **Title**') && db.itemCount(G, BEN.id, 'title') === before + 1);

  // Casino: first win, high roller, losing streak
  const casino = require('../src/casino');
  let r = () => 0.1;
  const cctx = (u) => ({ ...ctxFor(u), random: () => r() });
  const flip = require('../src/commands/coinflip');
  casino.last.clear();
  out = await router.runCommand(flip, cctx(BEN), { amount: '2500', side: 'heads' });
  assert.ok(text(out).includes('High Roller') && text(out).includes("Beginner's Luck"));
  r = () => 0.9;
  for (let i = 0; i < 10; i++) { casino.last.clear(); out = await router.runCommand(flip, cctx(BEN), { amount: '10', side: 'heads' }); }
  assert.ok(text(out).includes('Down Bad'));

  // Work: first paycheck, perfect review + promotion, and a strike
  const work = require('../src/commands/work');
  work.TUNING.tipMax = 0; work.TUNING.kind = 'order';
  db.updatePlayer(G, BEN.id, { job: 'NACH', hired_at: 0, last_work: 0 });
  db.updateCareer(G, BEN.id, 'NACH', { rev_total: 9, rev_right: 9 });
  await say('r!work', BEN);
  const w = router.pending.get(`c:${BEN.id}`); router.pending.delete(`c:${BEN.id}`);
  out = await w.handler({ content: work.active.get(`${G}:${BEN.id}`).ans });
  out = A.attach(w.ctx, out);
  assert.ok(text(out).includes('First Paycheck') && text(out).includes('Perfect Review') && text(out).includes('Promoted'), text(out));

  // r!achievements and r!profile
  const ach = await say('r!achievements');
  assert.ok(ach.embeds[0].description.includes(`/ ${A.LIST.length}`) && ach.components.length);
  const cat = require('../src/commands/achievements');
  const page = await cat.onButton(ctxFor(ANA), [ANA.id, ANA.id, 'secret']);
  assert.ok(page.update.embeds[0].description.includes('Tip the House') && page.update.embeds[0].description.includes('???'), 'found secrets show, unfound stay hidden');
  const prof = await say('r!profile');
  assert.ok(prof.embeds[0].fields.find((f) => f.name.includes('Achievements')).value.startsWith(String(A.unlocked(db, ANA.id).length)));
  assert.ok(text(await say('r!profile', ANA, { visibility: 'private' })).includes('private'));
  assert.ok(require('../src/commands/profile').isPrivate(db, ANA.id));

  // Every achievement is well formed
  for (const a of A.LIST) assert.ok(a.name && a.desc && A.CATEGORIES[a.cat] && A.RARITY[a.rarity], a.id);
  assert.strictEqual(new Set(A.LIST.map((a) => a.id)).size, A.LIST.length);

  console.log(`All achievement tests passed (${A.LIST.length} achievements).`);
})().catch((e) => { console.error(e); process.exit(1); });
