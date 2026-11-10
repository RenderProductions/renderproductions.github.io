// DM receipts: who gets them, what's on them, turning them off, and closed DMs. Offline:  npm test
const assert = require('assert');
const path = require('path');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const m = JSON.parse(JSON.stringify(base));
m.market = { ...m.market, status: 'open', open: true, halted: false };
for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 10; }
market.set(m);

const G = '123456789012345678';
const inbox = {};
const mk = (id, username) => ({ id, username, send: async (msg) => { (inbox[id] = inbox[id] || []).push(msg); } });
const ANA = mk('400000000000000001', 'ana');
const BEN = mk('400000000000000002', 'ben');
const CLOSED = { id: '400000000000000003', username: 'closed', send: async () => { throw new Error('Cannot send messages to this user'); } };
const users = { [ANA.id]: ANA, [BEN.id]: BEN, [CLOSED.id]: CLOSED };
const client = { user: { id: '1' }, users: { fetch: async (id) => users[id] } };

const ctxFor = (user) => ({ ...router.makeCtx({ guildId: G, channelId: 'chan', user, guildName: 'The Render Room' }, { db, market, client }), random: () => 0.5 });
const settle = () => new Promise((r) => setTimeout(r, 10)); // receipts are sent in the background
async function say(line, user, args = {}) {
  const p = router.parsePrefix(line);
  return router.runCommand(p.cmd, ctxFor(user), { ...p.args, ...args });
}
const last = (u) => inbox[u.id][inbox[u.id].length - 1].embeds[0];
const field = (e, name) => (e.fields.find((f) => f.name === name) || {}).value;

(async () => {
  for (const u of [ANA, BEN, CLOSED]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 10000_00 }); }

  // ---- trades ----
  await say('r!buy RRM 5', ANA); await settle();
  let r = last(ANA);
  assert.strictEqual(r.title, '🧾 Bought 5 RRM');
  assert.strictEqual(field(r, 'Total cost'), '⬡ 50.00');
  assert.strictEqual(field(r, 'Polygons left'), '⬢ 9,950.00');
  assert.ok(r.footer.text.startsWith('The Render Room · ') && r.footer.text.includes('receipts off'));
  assert.ok(r.timestamp, 'dated');
  await say('r!sell RRM 2', ANA); await settle();
  r = last(ANA);
  assert.ok(r.title === '🧾 Sold 2 RRM' && field(r, 'You still own') === '3 RRM');

  // ---- shop ----
  await say('r!purchase coffee', ANA); await settle();
  assert.ok(last(ANA).title.includes('Bought a Coffee') && field(last(ANA), 'Price') === '⬡ 100.00');

  // ---- loans: both sides get one ----
  const loanCmd = require('../src/commands/loan');
  const req = await router.runCommand(loanCmd, ctxFor(ANA), { lender: BEN, amount: '300', interest: '2' });
  await loanCmd.onButton(ctxFor(BEN), req.components[0].components[0].custom_id.split(':').slice(1)); await settle();
  assert.ok(last(ANA).title.includes('Loan received from ben'));
  assert.ok(last(BEN).title.includes('Loan given to ana') && field(last(BEN), 'Interest') === '2% a day');
  await say('r!payback', ANA, { lender: BEN, amount: '100' }); await settle();
  assert.ok(last(ANA).title.includes('Loan payment to ben') && field(last(ANA), 'Still owed') === '⬡ 200.00');
  assert.ok(last(BEN).title.includes('Loan payment from ana'));
  await say('r!forgive', BEN, { borrower: ANA }); await settle();
  assert.ok(last(ANA).title.includes('ben forgave your loan'));

  // ---- turning them off ----
  assert.ok((await say('r!receipts', ANA)).content.includes('Receipts are **on**'));
  await say('r!receipts off', ANA);
  const before = inbox[ANA.id].length;
  await say('r!buy RRM 1', ANA); await settle();
  assert.strictEqual(inbox[ANA.id].length, before, 'no DM when off');
  await say('r!receipts on', ANA);
  await say('r!buy RRM 1', ANA); await settle();
  assert.strictEqual(inbox[ANA.id].length, before + 1);

  // ---- closed DMs never break the command ----
  const out = await say('r!buy RRM 1', CLOSED); await settle();
  assert.ok(JSON.stringify(out.embeds).includes('bought 1 RRM'), 'trade still goes through');

  // ---- no receipt spam from work or slots ----
  const count = inbox[ANA.id].length;
  await say('r!slots 20', ANA); await settle();
  assert.strictEqual(inbox[ANA.id].length, count);

  console.log('All receipt tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
