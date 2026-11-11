require('../src/config').achievementPay = false; // these tests count exact balances
// Loans between players: request, buttons, interest, payback, garnishing. Offline:  npm test
const assert = require('assert');
const path = require('path');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const loans = require('../src/loans');
const loanCmd = require('../src/commands/loan');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false };
market.set(m);

const G = '123456789012345678';
const mk = (id, username, bot = false) => ({ id, username, bot, send: async () => {} });
const KORB = mk('200000000000000001', 'KorbedOut');
const NACHO = mk('200000000000000002', 'nacho');
const OTHER = mk('200000000000000003', 'other');
const DAY = loans.RULES.dayMs;

const ctxFor = (user) => router.makeCtx({ guildId: G, channelId: 'chan', user }, { db, market });
const text = (out) => (out == null ? '' : (out.content || '') + JSON.stringify(out.embeds || ''));
const run = (args, user = NACHO) => router.runCommand(loanCmd, ctxFor(user), args);
async function say(line, user = NACHO, extra = {}) {
  const p = router.parsePrefix(line);
  assert.ok(p, 'not a command: ' + line);
  return text(await router.runCommand(p.cmd, { ...ctxFor(user), ...extra }, { ...p.args, ...extra.args }));
}
const button = (id, user) => loanCmd.onButton(ctxFor(user), id.split(':').slice(1));
const cash = (u) => db.player(G, u).cash;

(async () => {
  for (const u of [KORB, NACHO, OTHER]) db.player(G, u);
  db.updatePlayer(G, KORB.id, { cash: 5000_00 });

  // ---- asking ----
  assert.ok(text(await run({})).includes('Usage'));
  assert.ok(text(await run({ lender: NACHO, amount: '10', interest: '1' })).includes("can't borrow from yourself"));
  assert.ok(text(await run({ lender: mk('9', 'Bot', true), amount: '10', interest: '1' })).includes("Bots don't lend"));
  assert.ok(text(await run({ lender: KORB, amount: 'lots', interest: '4' })).includes('Usage'));
  assert.ok(text(await run({ lender: KORB, amount: '1000', interest: '30' })).includes('at most **25%**'));
  db.updatePlayer(G, NACHO.id, { debt: 600_00 });
  assert.ok(text(await run({ lender: KORB, amount: '1000', interest: '4' })).includes('You owe ME'));
  db.updatePlayer(G, NACHO.id, { debt: 0 });

  const req = await run({ lender: KORB, amount: '1000', interest: '4%' });
  assert.ok(req.content.includes(`<@${KORB.id}>`), 'pings the lender');
  assert.deepStrictEqual(req.allowedMentions, { users: [KORB.id] }, 'and nobody else');
  assert.ok(text(req).includes('⬡ 1,000.00') && text(req).includes('4% a day'));
  assert.ok(text(req).includes('⬡ 1,315.93'), '1000 x 1.04^7 at the deadline: ' + text(req));
  const [acceptId, declineId] = req.components[0].components.map((b) => b.custom_id);

  // ---- answering ----
  assert.ok((await button(acceptId, OTHER)).reply.includes('Only KorbedOut'));
  db.updatePlayer(G, KORB.id, { cash: 500_00 });
  assert.ok((await button(acceptId, KORB)).reply.includes('You only have'), 'lender must have the money');
  db.updatePlayer(G, KORB.id, { cash: 5000_00 });
  const deal = await button(acceptId, KORB);
  assert.ok(text(deal.update).includes('Deal') && deal.update.components.length === 0, 'buttons go away');
  assert.strictEqual(cash(KORB), 4000_00);
  assert.strictEqual(cash(NACHO), 1500_00);
  assert.ok(text((await button(declineId, KORB)).update).includes('expired or was already answered'));

  // One loan between two people, either direction
  assert.ok(text(await run({ lender: KORB, amount: '5', interest: '1' })).includes('already a loan'));
  assert.ok(text(await run({ lender: NACHO, amount: '5', interest: '1' }, KORB)).includes('already a loan'));

  // ---- interest ----
  let loan = loans.active(db, G, { borrower: NACHO.id })[0];
  db.raw.prepare('UPDATE loans SET last_accrual = ?, due_at = ? WHERE id = ?').run(Date.now() - 2 * DAY - 1000, Date.now() + 5 * DAY, loan.id);
  loan = loans.active(db, G, { borrower: NACHO.id })[0];
  assert.strictEqual(loan.owed, Math.round(1000_00 * 1.04 * 1.04), 'two days of 4%');
  assert.ok((await say('r!loans')).includes('**KorbedOut**: ⬡ 1,081.60 at 4% a day'));
  assert.ok((await say('r!loans', KORB)).includes('Owed to you'));
  assert.ok((await say('r!bal')).includes('Owed to players: **⬡ 1,081.60'));
  assert.ok((await say('r!bal', KORB)).includes('Lent out: **⬢ 1,081.60'));

  // Interest stops at the deadline
  db.raw.prepare('UPDATE loans SET owed = 100000, last_accrual = ?, due_at = ? WHERE id = ?').run(Date.now() - 10 * DAY, Date.now() - 7 * DAY, loan.id);
  loan = loans.active(db, G, { borrower: NACHO.id })[0];
  assert.strictEqual(loan.owed, Math.round(1000_00 * Math.pow(1.04, 3)), 'only the 3 days before the deadline count');

  // ---- paying back ----
  assert.ok((await say('r!payback', NACHO)).includes('Usage'));
  const pb = router.parsePrefix('r!payback @x 100');
  assert.ok(text(await router.runCommand(pb.cmd, ctxFor(OTHER), { lender: KORB, amount: '100' })).includes("don't owe"));
  const before = cash(KORB);
  assert.ok(text(await router.runCommand(pb.cmd, ctxFor(NACHO), { lender: KORB, amount: '100' })).includes('Still owed'));
  assert.strictEqual(cash(KORB), before + 100_00);

  // ---- garnishing (the loan above is overdue) ----
  const owedNow = loans.active(db, G, { borrower: NACHO.id })[0].owed;
  const nachoBefore = cash(NACHO);
  const daily = await say('r!daily');
  assert.ok(daily.includes('went to **KorbedOut** for an overdue loan'), daily);
  assert.strictEqual(cash(NACHO), nachoBefore + 125_00, 'kept half of the 250 daily');
  assert.strictEqual(loans.active(db, G, { borrower: NACHO.id })[0].owed, owedNow - 125_00);

  const g = loans.garnish(db, G, NACHO.id, 99_999_00);
  assert.ok(g.paidTo[0].cleared, 'a big payday clears it');
  assert.strictEqual(g.taken, owedNow - 125_00, 'never takes more than is owed');
  assert.strictEqual(loans.active(db, G, { borrower: NACHO.id }).length, 0);
  assert.ok((await say('r!loans')).includes('No loans'));
  assert.strictEqual(loans.garnish(db, G, NACHO.id, 100_00).taken, 0, 'no overdue loans, nothing taken');

  // Paying off in full with r!payback
  const r2 = await run({ lender: OTHER, amount: '50', interest: '0' });
  db.updatePlayer(G, OTHER.id, { cash: 1000_00 });
  await button(r2.components[0].components[0].custom_id, OTHER);
  assert.ok(text(await router.runCommand(pb.cmd, ctxFor(NACHO), { lender: OTHER, amount: 'all' })).includes('paid off'));

  // Declining
  const r3 = await run({ lender: OTHER, amount: '50', interest: '2' });
  assert.ok(text((await button(r3.components[0].components[1].custom_id, OTHER)).update).includes('declined'));
  assert.strictEqual(loans.active(db, G, { borrower: NACHO.id }).length, 0);

  // Expired request
  const r4 = await run({ lender: OTHER, amount: '50', interest: '2' });
  const id4 = r4.components[0].components[0].custom_id;
  loans.requests.get(id4.split(':')[2]).expires = Date.now() - 1;
  assert.ok(text((await button(id4, OTHER)).update).includes('expired'));

  // Forgiving
  const r5 = await run({ lender: OTHER, amount: '80', interest: '3' });
  await button(r5.components[0].components[0].custom_id, OTHER);
  const fg = router.parsePrefix('r!forgive @x');
  assert.ok(text(await router.runCommand(fg.cmd, ctxFor(KORB), { borrower: NACHO })).includes("doesn't owe you"));
  const forgiven = await router.runCommand(fg.cmd, ctxFor(OTHER), { borrower: NACHO });
  assert.ok(forgiven.content.includes('forgave') && forgiven.content.includes('⬡ 80.00'), forgiven.content);
  assert.deepStrictEqual(forgiven.allowedMentions, { users: [NACHO.id] });
  assert.strictEqual(loans.active(db, G, { borrower: NACHO.id }).length, 0);
  assert.ok(text(await run({ lender: OTHER, amount: '5', interest: '1' })).includes('Loan request'), 'can borrow again after');

  // Help still fits in one Discord embed
  const help = await router.runCommand(require('../src/commands/help'), ctxFor(NACHO), {});
  assert.ok(help.embeds[0].description.length < 4096, 'help is ' + help.embeds[0].description.length + ' characters');

  console.log('All loan tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
