// Every button: work tasks, slots, shop, review, plus the router's handling. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const jobs = require('../src/jobs');
const work = require('../src/commands/work');
work.TUNING.tipMax = 0; // exact pay in these tests
const slots = require('../src/commands/slots');
const shopCmd = require('../src/commands/shop');
const review = require('../src/commands/review');
const co = require('../src/companies');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false };
market.set(m);

const G = '123456789012345678';
const mk = (id, username) => ({ id, username, send: async () => {} });
const ANA = mk('300000000000000001', 'ana');
const BEN = mk('300000000000000002', 'ben');
const ctxFor = (user, extra = {}) => ({ ...router.makeCtx({ guildId: G, channelId: 'chan', user, ...extra }, { db, market }), random: () => 0.5 });
const ids = (out) => out.components.flatMap((r) => r.components.map((b) => b.custom_id));
const labels = (out) => out.components.flatMap((r) => r.components.map((b) => b.label));
const press = (cmd, id, user, extra) => cmd.onButton(ctxFor(user, extra), id.split(':').slice(1));

(async () => {
  for (const u of [ANA, BEN]) db.player(G, u);
  db.updatePlayer(G, ANA.id, { cash: 5000_00 });

  // ---- task choices always include the right answer, and fit Discord's limits ----
  for (const [job, kind] of [['RRM', 'queue'], ['RRM', 'links'], ['RRM', 'rule'], ['BSTG', 'tile'], ['BSTG', 'grid'], ['BLU', 'steps'], ['BLU', 'tool'], ['BNW', 'sheet']]) {
    for (let i = 0; i < 40; i++) {
      const t = jobs.task(job, { rush: i % 2 === 1, tier: i % 4, kind });
      assert.ok(t.choices && t.choices.some((c) => c.value === t.ans), `${job} ${kind} choices include the answer`);
      assert.ok(t.choices.length <= 25 && t.choices.every((c) => c.label.length <= 80));
      assert.strictEqual(new Set(t.choices.map((c) => c.value)).size, t.choices.length, `${job} ${kind}: no duplicate choices`);
    }
  }
  assert.strictEqual(jobs.task('BLU', { kind: 'steps' }).choices.length, 3);
  assert.ok(!jobs.task('NACH', { kind: 'order' }).choices && !jobs.task('BNW', { kind: 'math' }).choices, 'typing tasks stay typed');

  // ---- work: answering with a button ----
  db.updatePlayer(G, ANA.id, { job: 'RRM', hired_at: 0, last_work: 0 });
  work.TUNING.kind = 'queue';
  const task = await work.run(ctxFor(ANA));
  assert.deepStrictEqual(labels(task), ['Ban', 'OK']);
  const st = work.active.get(`${G}:${ANA.id}`);
  const right = ids(task)[st.choices.findIndex((c) => c.value === st.ans)];
  assert.ok((await press(work, right, BEN)).reply.includes("isn't your shift"));
  assert.ok(router.pending.has(`chan:${ANA.id}`), 'still waiting for a typed answer too');
  const done = await press(work, right, ANA);
  assert.deepStrictEqual(done.update, { components: [] }, 'buttons removed from the task');
  const result = typeof done.followUp === 'string' ? done.followUp : done.followUp.content;
  assert.ok(result.includes('Nice work'), result);
  assert.ok(!router.pending.has(`chan:${ANA.id}`), 'typed wait cancelled');
  assert.deepStrictEqual(await press(work, right, ANA), { update: { components: [] } }, 'old buttons just clear');

  // BSTG gets 8 tile buttons in two rows
  db.updatePlayer(G, ANA.id, { job: 'BSTG', last_work: 0 });
  work.TUNING.kind = 'tile';
  const tiles = await work.run(ctxFor(ANA));
  assert.deepStrictEqual(labels(tiles), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.strictEqual(tiles.components.length, 2);
  const wrongId = ids(tiles).find((id, i) => String(i + 1) !== work.active.get(`${G}:${ANA.id}`).ans);
  const miss = await press(work, wrongId, ANA);
  assert.ok((typeof miss.followUp === 'string' ? miss.followUp : miss.followUp.content).includes('Not quite'));

  // NACH stays typed: no buttons
  db.updatePlayer(G, ANA.id, { job: 'NACH', last_work: 0 });
  work.TUNING.kind = 'order';
  assert.strictEqual((await work.run(ctxFor(ANA))).components.length, 0);
  work.active.clear(); router.pending.clear();

  // ---- slots: Spin again ----
  const spin = await slots.run(ctxFor(ANA), { amount: '20' });
  const again = ids(spin)[0];
  assert.ok(labels(spin)[0].includes('⬡ 20.00'));
  assert.ok((await press(slots, again, BEN)).reply.includes('Get your own machine'));
  assert.ok((await press(slots, again, ANA)).reply.includes('cool down'), 'cooldown still applies');
  slots.lastSpin.clear();
  const respin = await press(slots, again, ANA);
  assert.ok(respin.update.embeds[0].title.includes('Rend-Sino') && respin.update.components.length === 1);

  // ---- shop: Buy buttons ----
  const shown = await shopCmd.run(ctxFor(ANA));
  assert.strictEqual(ids(shown).length, 5 + 6, 'five shelf tabs and the Work shelf\'s six Buy buttons');
  const flip = await press(shopCmd, 'shop:shelf:rare', BEN);
  assert.ok(flip.update.embeds[0].title.includes('Collectible'), 'shelf tabs flip the page');
  const bought = await press(shopCmd, 'shop:buy:coffee', BEN);
  assert.ok(bought.reply.includes('Bought a **Coffee**'), bought.reply);
  assert.strictEqual(db.itemCount(G, BEN.id, 'coffee'), 1, 'buys for whoever pressed');

  // ---- review: Approve/Reject buttons ----
  config.ownerId = ANA.id;
  db.updatePlayer(G, BEN.id, { cash: 20000_00 });
  for (const [t, n, who] of [['AAA', 'Alpha Co', BEN], ['BBB', 'Beta Co', ANA]]) {
    co.found(db, { ticker: t, name: n, owner: who, guildId: G });
  }
  const list = await review.run(ctxFor(ANA));
  assert.deepStrictEqual(labels(list), ['Approve AAA', 'Reject AAA', 'Approve BBB', 'Reject BBB']);
  assert.ok((await press(review, 'review:approve:AAA', BEN)).reply.includes('Only Render Room mods'));
  const after = await press(review, 'review:approve:AAA', ANA);
  assert.strictEqual(co.get(db, 'AAA').status, 'private');
  assert.ok(after.update.content.includes('Approved **Alpha Co**') && labels(after.update).length === 2, 'list refreshes');
  const last = await press(review, 'review:reject:BBB', BEN, { guildId: G, isMod: true });
  assert.ok(last.reply, 'mods outside the home server (none set) cannot');
  config.homeGuildId = G;
  const fin = await press(review, 'review:reject:BBB', BEN, { isMod: true });
  assert.ok(fin.update.content.includes('No companies waiting') && fin.update.components.length === 0);

  // ---- the router with a fake Discord button press ----
  const calls = [];
  const fake = (customId, user) => ({
    customId, user, guildId: G, channelId: 'chan', memberPermissions: { has: () => false },
    update: async (p) => calls.push(['update', p]), followUp: async (p) => calls.push(['followUp', p]),
    reply: async (p) => calls.push(['reply', p]), deferUpdate: async () => calls.push(['defer'])
  });
  slots.lastSpin.clear();
  await router.handleButton(fake(again, ANA), { db, market });
  assert.strictEqual(calls[0][0], 'update');
  await router.handleButton(fake(again, BEN), { db, market });
  assert.ok(calls[1][0] === 'reply' && calls[1][1].ephemeral === true, 'private answer to the wrong person');
  db.updatePlayer(G, ANA.id, { job: 'RRM', last_work: 0 });
  work.TUNING.kind = 'queue';
  const t2 = await work.run(ctxFor(ANA));
  await router.handleButton(fake(ids(t2)[0], ANA), { db, market });
  assert.deepStrictEqual(calls.slice(2).map((c) => c[0]), ['update', 'followUp'], 'task buttons cleared, result posted');
  assert.strictEqual(calls[3][1].ephemeral, false, 'the result is public');

  console.log('All button tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
