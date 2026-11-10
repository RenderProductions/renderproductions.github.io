// Leaderboards and gifts. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const reserve = require('../src/reserve');

const m = JSON.parse(JSON.stringify(require(path.join(__dirname, '..', '..', 'prices.json'))));
m.market = { ...m.market, status: 'open', open: true, halted: false };
for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 10; }
market.set(m);

const G = '123456789012345678';
const dms = {};
const mk = (id, username) => ({ id, username, send: async (x) => { (dms[id] = dms[id] || []).push(x); } });
const ANA = mk('800000000000000001', 'ana'), BEN = mk('800000000000000002', 'ben'), CY = mk('800000000000000003', 'cy');
const users = { [ANA.id]: ANA, [BEN.id]: BEN, [CY.id]: CY };
const client = { user: { id: '9' }, users: { fetch: async (id) => users[id] } };
const ctxFor = (u) => router.makeCtx({ guildId: G, channelId: 'c', user: u, guildName: 'The Render Room' }, { db, market, client });
async function say(line, u = ANA, extra = {}) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), { ...p.args, ...extra }); }
const text = (o) => (typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const cash = (u) => db.player(G, u).cash;

(async () => {
  for (const u of [ANA, BEN, CY]) db.player(G, u);
  db.updatePlayer(G, ANA.id, { cash: 3000_00 });
  db.updatePlayer(G, BEN.id, { cash: 1000_00 });
  db.updatePlayer(G, CY.id, { cash: 200_00 });
  db.updateHolding(G, CY.id, 'RRM', { shares: 500 }); // 500 x 10 = 5,000 in stock

  // ---- leaderboard ----
  let lb = await say('r!leaderboard');
  let d = lb.embeds[0].description;
  assert.ok(lb.embeds[0].title.includes('Net worth'));
  assert.ok(d.indexOf('cy') < d.indexOf('ana') && d.indexOf('ana') < d.indexOf('ben'), 'shares count toward net worth: ' + d);
  assert.ok(d.startsWith('🥇') && d.includes('**➤ ana** (you)'));
  lb = await say('r!lb polygons');
  d = lb.embeds[0].description;
  assert.ok(d.indexOf('ana') < d.indexOf('ben') && d.indexOf('ben') < d.indexOf('cy'));
  db.updateCareer(G, BEN.id, 'NACH', { total: 40 });
  db.updateCareer(G, BEN.id, 'RRM', { total: 5 });
  assert.ok((await say('r!top shifts')).embeds[0].description.startsWith('🥇 **ben** · 45 shifts'));
  assert.ok(text(await say('r!lb casino')).includes("haven't placed a bet"));
  // Buttons switch boards
  const btn = lb.components[0].components.find((b) => b.custom_id.endsWith(':shifts'));
  const lbCmd = require('../src/commands/leaderboard');
  assert.ok((await lbCmd.onButton(ctxFor(ANA), btn.custom_id.split(':').slice(1))).update.embeds[0].title.includes('Shifts'));
  // Your spot shows when you're outside the top 10
  for (let i = 0; i < 12; i++) { const u = mk(`81000000000000000${String(i).padStart(2, '0')}`, `p${i}`); db.player(G, u); db.updatePlayer(G, u.id, { cash: 9000_00 + i }); }
  d = (await say('r!lb polygons', CY)).embeds[0].description;
  assert.ok(d.includes('**Your spot:** #15 of 15'), d);

  // ---- gift ----
  let r0 = reserve.get(db);
  let out = await say('r!gift', ANA, { player: BEN, amount: '100', note: 'for the pizza' });
  assert.ok(out.content.includes('<@' + BEN.id + '>') && out.content.includes('sent you **⬡ 100.00**') && out.content.includes('> for the pizza'), out.content);
  assert.deepStrictEqual(out.allowedMentions, { users: [BEN.id] }, 'pings only the receiver');
  assert.strictEqual(cash(ANA), 3000_00 - 105_00, '5% fee on top');
  assert.strictEqual(cash(BEN), 1000_00 + 100_00);
  assert.strictEqual(reserve.get(db), r0 + 5_00, 'the fee goes to the reserve');
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(dms[BEN.id].some((x) => x.embeds[0].title.includes('Gift from ana')));
  assert.ok(text(await say('r!gift', ANA, { player: ANA, amount: '5' })).includes("can't gift yourself"));
  assert.ok(text(await say('r!gift', ANA, { player: { id: '9', username: 'bot', bot: true }, amount: '5' })).includes("doesn't take tips"));
  assert.ok(text(await say('r!gift', CY, { player: ANA, amount: '500' })).includes('costs ⬡ 525.00'));
  assert.ok(text(await say('r!gift', ANA, { player: BEN, amount: '0.5' })).includes('smallest gift'));
  // Daily limit
  db.updatePlayer(G, ANA.id, { cash: 100000_00 });
  assert.ok(text(await say('r!gift', ANA, { player: BEN, amount: '4900' })).includes('sent you'));
  assert.ok(text(await say('r!gift', ANA, { player: BEN, amount: '1' })).includes('up to ⬡ 5,000.00 a day'));
  // Can't dodge TODD or an overdue loan
  db.updatePlayer(G, BEN.id, { debt: 600_00 });
  assert.ok(text(await say('r!gift', BEN, { player: CY, amount: '10' })).includes('Pay me back first'));
  db.updatePlayer(G, BEN.id, { debt: 0 });
  const loans = require('../src/loans');
  loans.create(db, { guildId: G, lender: ANA, borrower: CY, amount: 100_00, rate: 1 });
  db.raw.prepare('UPDATE loans SET due_at = ? WHERE borrower_id = ?').run(Date.now() - 1000, CY.id);
  assert.ok(text(await say('r!gift', CY, { player: BEN, amount: '10' })).includes('overdue loan'));
  // Prefix form: r!gift @ben 25 a note with spaces
  const p = router.parsePrefix('r!gift <@' + BEN.id + '> 25 good game everyone');
  assert.strictEqual(p.args.amount, '25');
  assert.strictEqual(p.args.note, 'good game everyone');

  // ---- help looks the part ----
  const h = await say('r!help');
  assert.ok(h.embeds[0].thumbnail && h.embeds[0].fields.length >= 8 && h.components.length === 2);
  const casino = await say('r!help casino');
  assert.ok(casino.embeds[0].fields.some((f) => f.name === 'r!rocket <bet>') && casino.embeds[0].color === 0xeb459e);
  for (const k of Object.keys(require('../src/commands/help').PAGES)) {
    const pg = await say('r!help ' + k);
    assert.ok(pg.embeds[0].fields.length <= 25 && pg.embeds[0].fields.every((f) => f.name.length <= 256 && f.value.length <= 1024));
    assert.ok(JSON.stringify(pg.embeds[0]).length < 6000, k + ' fits in an embed');
  }

  // Buttons never carry a symbol Discord rejects as an emoji (⬢ broke r!leaderboard)
  const { button } = require('../src/buttons');
  assert.ok(!button('x', 'id', 'grey', false, '⬢').emoji && button('x', 'id', 'grey', false, '💰').emoji);
  for (const b of (await say('r!lb')).components.flatMap((r) => r.components)) assert.ok(!b.emoji || /\p{Extended_Pictographic}/u.test(b.emoji.name), b.label);
  // If Discord still rejects a reply, the router retries without emoji, then sends a short error
  const tries = [];
  const fakeMsg = { author: { id: ANA.id, bot: false, username: 'ana' }, guildId: G, channelId: 'c', content: 'r!help', member: null, guild: { name: 'T' },
    reply: async (p) => { tries.push(p); if (tries.length === 1) { const e = new Error('Invalid Form Body\ncomponents[0]: Invalid emoji'); e.code = 50035; throw e; } return { edit: async () => {} }; } };
  await router.handleMessage(fakeMsg, { db, market, client });
  assert.strictEqual(tries.length, 2);
  assert.ok(tries[1].components.every((r) => r.components.every((b) => !b.emoji)), 'second try has no emoji');

  console.log('All leaderboard and gift tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
