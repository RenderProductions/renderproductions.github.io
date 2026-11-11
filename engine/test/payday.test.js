// Payday: achievement payouts and back pay, savings accounts, chat pay, TODD drop-ins. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const reserve = require('../src/reserve');
const A = require('../src/achievements');
const S = require('../src/savings');
const C = require('../src/chatter');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false }; m.crash = null; m.boost = null;
market.set(m);

const G = '123456789012345678';
const mk = (id, username) => ({ id, username });
const ANA = mk('930000000000000001', 'ana'), BEN = mk('930000000000000002', 'ben'), CAL = mk('930000000000000003', 'cal');
const deps = { db, market, client: { user: { id: '9' } } };
const ctxFor = (u, extra = {}) => router.makeCtx({ guildId: G, channelId: 'chan', user: u, ...extra }, deps);
async function say(line, u = ANA) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), p.args); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const cash = (u = ANA) => db.player(G, u).cash;

(async () => {
  for (const u of [ANA, BEN]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 10000_00 }); }

  // ---- achievement payouts ----
  const r0 = reserve.get(db);
  const c0 = cash();
  const ctx = ctxFor(ANA);
  const line = A.award(ctx, 'day_one');
  assert.ok(line.includes('+⬡ 250.00'), line);
  assert.strictEqual(cash(), c0 + 250_00, 'a common pays 250');
  assert.strictEqual(reserve.get(db), r0 - 250_00, 'out of the reserve');
  assert.strictEqual(A.award(ctx, 'day_one'), '', 'only once');
  assert.strictEqual(cash(), c0 + 250_00);

  // ---- back pay ----
  const since = Number(db.meta('ach_pay_since'));
  assert.ok(since > 0, 'the launch moment is recorded');
  const old = since - 86400000;
  for (const [id, who] of [['first_paycheck', BEN], ['diversified', BEN], ['millionaire', BEN]]) {
    db.raw.prepare('INSERT INTO achievements (user_id, id, guild_id, unlocked_at) VALUES (?, ?, ?, ?)').run(who.id, id, G, old);
  }
  assert.deepStrictEqual(A.backPay(db, BEN.id), { cents: 250_00 + 1000_00 + 7500_00, count: 3, claimed: false });
  assert.ok(text(await say('r!achievements', BEN)).includes('in back pay waiting'));
  const b0 = cash(BEN), rb = reserve.get(db);
  const out = text(await say('r!backpay', BEN));
  assert.ok(out.includes('**3** achievements') && out.includes('⬡ 8,750.00'), out);
  assert.strictEqual(cash(BEN), b0 + 8750_00);
  assert.strictEqual(reserve.get(db), rb, "back pay doesn't touch the reserve");
  assert.ok(text(await say('r!claim', BEN)).includes('already claimed'));
  assert.strictEqual(cash(BEN), b0 + 8750_00, 'once');
  assert.ok(text(await say('r!backpay')).includes('No back pay'), 'ANA unlocked hers after launch');
  assert.ok(!text(await say('r!achievements', BEN)).includes('back pay waiting'));

  // ---- savings ----
  db.updatePlayer(G, ANA.id, { cash: 10000_00 });
  let s = text(await say('r!savings deposit 1000 7'));
  assert.ok(s.includes('Locked away **⬡ 1,000.00** for 7 days') && s.includes('⬡ 1,060.00'), s);
  assert.strictEqual(cash(), 9000_00);
  assert.ok(text(await say('r!savings')).includes('#1'));
  assert.ok(text(await say('r!savings deposit 1000 5')).includes('3, 7, 14'));
  assert.ok(text(await say('r!savings deposit 50 3')).includes('smallest'));
  assert.ok(text(await say('r!savings deposit 99999 3')).includes('You only have'));
  await say('r!savings deposit 100 3');
  await say('r!savings deposit 100 14');
  assert.ok(text(await say('r!savings deposit 100 3')).includes('3 savings accounts'));
  // Net worth counts what's saved
  assert.ok(require('../src/economy').worth(ctxFor(ANA), m, db.player(G, ANA)) >= 10000_00);
  // Early withdrawal: no interest
  s = text(await say('r!savings withdraw 2'));
  assert.ok(s.includes('⬡ 100.00** is back') && s.includes('gone'), s);
  // Maturity pays interest, and the Nest Egg achievement
  db.raw.prepare('UPDATE savings SET ends_at = ? WHERE id = 1').run(Date.now() - 1);
  const c1 = cash();
  s = text(await say('r!savings'));
  assert.ok(s.includes('⬡ 60.00') && s.includes('Nest Egg'), s);
  assert.strictEqual(cash(), c1 + 1060_00 + 250_00, 'principal, 6%, and the achievement payout');
  // Can't save while owing TODD
  db.updatePlayer(G, BEN.id, { debt: 100_00 });
  assert.ok(text(await say('r!savings deposit 500 3', BEN)).includes('Pay me back'));
  db.updatePlayer(G, BEN.id, { debt: 0 });
  // The cap per server
  db.updatePlayer(G, BEN.id, { cash: 100000_00 });
  assert.ok(text(await say('r!savings deposit 60000 3', BEN)).includes('up to ⬡ 50,000.00'));

  // ---- chat pay ----
  const fixed = () => 0.5;
  let t = 1_000_000_000_000;
  const c2 = cash();
  assert.strictEqual(C.chatPay(db, G, ANA, 'hello everyone', t, fixed), 10_00, 'about 10 a message');
  assert.strictEqual(C.chatPay(db, G, ANA, 'still here', t + 1000, fixed), 0, 'once a minute');
  assert.strictEqual(C.chatPay(db, G, ANA, 'hello everyone', t + 61_000, fixed), 0, 'repeats do not count');
  assert.strictEqual(C.chatPay(db, G, ANA, 'ok', t + 122_000, fixed), 0, 'too short');
  assert.strictEqual(C.chatPay(db, G, ANA, '!!!!!!!', t + 122_000, fixed), 0, 'no letters');
  assert.strictEqual(C.chatPay(db, G, CAL, 'never used the bot', t, fixed), 0, 'only players');
  assert.strictEqual(cash(), c2 + 10_00);
  let paid = 10_00;
  for (let i = 1; i < 60; i++) paid += C.chatPay(db, G, ANA, `message number ${i}`, t + i * 61_000, fixed);
  assert.strictEqual(paid, C.RULES.chat.perDay, 'daily cap');
  assert.strictEqual(C.chatToday(db, G, ANA.id, t + 60 * 61_000), C.RULES.chat.perDay);
  assert.ok(text(await say('r!dropin')).includes('Chat pay'));
  const bal = text(await say('r!balance'));
  assert.ok(bal.includes('Chat pay today') && bal.includes('In savings'), bal);

  // ---- drop-ins ----
  const q = C.question(m, () => 0); // first kind: maths with the smallest numbers
  assert.ok(q.q.includes('3 × 3 + 1') && q.answers[0] === '10', q.q);
  for (let i = 0; i < 40; i++) { const x = C.question(m, Math.random); assert.ok(x.q && x.answers.length && x.answers.every(Boolean), JSON.stringify(x)); }
  const sent = [];
  const drop = await C.startDrop(deps, G, 'chan', async (p) => { sent.push(p); }, Date.now(), () => 0);
  assert.ok(sent[0].embeds[0].title.includes('DROP-IN') && drop.pot >= 300_00 && drop.pot <= 800_00);
  assert.strictEqual(C.answer(ctxFor(BEN), 'eleven'), null, 'wrong answer');
  const c3 = cash(BEN);
  const win = C.answer(ctxFor(BEN), ' 10 ');
  assert.ok(win.content.includes('ben** got it') && win.content.includes('Quick Draw'), win.content);
  assert.strictEqual(cash(BEN), c3 + drop.pot + 250_00, 'pot plus the Quick Draw payout');
  assert.strictEqual(C.answer(ctxFor(ANA), '10'), null, 'only the first');

  // Through the router: a normal message gets chat pay, a command doesn't
  C.lastDrop.set(G, Date.now()); // no surprise drop-ins in this part
  C.lastPaid.clear();
  db.updatePlayer(G, BEN.id, { chat_day: null, chat_earned: 0 });
  const msg = (content, u = BEN) => ({ content, author: { ...u, bot: false }, guildId: G, channelId: 'chan2', guild: { name: 'Test' },
    channel: { send: async () => {} }, reply: async (p) => p });
  const c4 = cash(BEN);
  await router.handleMessage(msg('what a nice day for trading'), deps);
  assert.ok(cash(BEN) > c4, 'chat pay through the router');
  // Mods can switch drop-ins off
  assert.ok(text(await say('r!dropin off')).includes('Only mods'));
  const mod = router.makeCtx({ guildId: G, channelId: 'chan', user: ANA, isMod: true }, deps);
  await router.runCommand(require('../src/commands/dropin'), mod, { action: 'off' });
  assert.ok(C.off(db, G));
  await router.runCommand(require('../src/commands/dropin'), mod, { action: 'on' });
  assert.ok(!C.off(db, G));

  // Never in announcements or read-only channels
  const { ChannelType, PermissionFlagsBits } = require('discord.js');
  const everyone = { id: 'everyone' };
  const chan = (type, allowed) => ({ type, isThread: () => false, permissionsFor: () => ({ has: (f) => allowed.includes(f) }) });
  const g = { roles: { everyone } };
  const all = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages];
  assert.ok(C.openToAll({ guild: g, channel: chan(ChannelType.GuildText, all) }));
  assert.ok(!C.openToAll({ guild: g, channel: chan(ChannelType.GuildAnnouncement, all) }), 'announcements');
  assert.ok(!C.openToAll({ guild: g, channel: chan(ChannelType.GuildText, [PermissionFlagsBits.ViewChannel]) }), 'read-only');
  assert.ok(!C.openToAll({ guild: g, channel: chan(ChannelType.GuildText, [PermissionFlagsBits.SendMessages]) }), 'hidden');

  // Mods can keep TODD to one channel
  await router.runCommand(require('../src/commands/dropin'), mod, { action: 'here' });
  assert.strictEqual(C.home(db, G), 'chan');
  C.lastDrop.set(G, 0);
  const posted = [];
  const m2 = (channelId) => ({ guildId: G, channelId, channel: { send: async (p) => { posted.push(channelId); } } });
  assert.strictEqual(await C.maybeDrop(m2('elsewhere'), deps, Date.now(), () => 0), null, 'not in other channels');
  assert.ok(await C.maybeDrop(m2('chan'), deps, Date.now(), () => 0), 'drops into the home channel');
  assert.deepStrictEqual(posted, ['chan']);
  C.active.clear();
  assert.ok(text(await router.runCommand(require('../src/commands/dropin'), router.makeCtx({ guildId: G, channelId: 'other', user: ANA, isMod: true }, deps), { action: 'now' })).includes('only drops in at'));
  await router.runCommand(require('../src/commands/dropin'), mod, { action: 'anywhere' });
  assert.strictEqual(C.home(db, G), '');

  console.log('All payday tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
