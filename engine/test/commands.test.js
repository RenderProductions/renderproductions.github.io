// Runs every command against a throwaway database and the repo's prices.json.
// No Discord connection needed:  npm test
const assert = require('assert');
const path = require('path');
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const api = require('../src/api');
const fmt = require('../src/format');
const { slashCommands } = require('../src/slash');
const work = require('../src/commands/work');
const slots = require('../src/commands/slots');

// A market snapshot that's open, with every company solvent and no wipes.
const base = require(path.join(__dirname, '..', '..', 'prices.json'));
function snapshot(edit) {
  const m = JSON.parse(JSON.stringify(base));
  m.market = { ...(m.market || {}), status: 'open', open: true, halted: false, text: '🔔 Market open' };
  for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 10; }
  m.prices.NACH = 45.5; // a job's starting price, so pay is exactly 35 at Intern
  if (edit) edit(m);
  return m;
}
const OPEN = snapshot();

const G = '123456789012345678';
let dms = [];
const mkUser = (id, username) => ({ id, username, send: async (t) => { dms.push(t); } });
const ALICE = mkUser('111111111111111111', 'alice');
const BOB = mkUser('222222222222222222', 'bob');

let random = Math.random;
function ctxFor(user) {
  const ctx = router.makeCtx({ guildId: G, channelId: 'chan', user }, { db, market });
  ctx.random = () => random();
  return ctx;
}
const text = (out) => (out == null ? '' : (out.content || '') + (out.embeds ? JSON.stringify(out.embeds) : ''));
const cash = (u = ALICE) => db.player(G, u).cash;

// Runs "r!..." as a player, the same way the router does.
async function say(line, user = ALICE) {
  const p = router.parsePrefix(line);
  assert.ok(p, 'not a command: ' + line);
  return router.runCommand(p.cmd, ctxFor(user), p.args);
}
// Answers the task the bot is waiting on.
async function reply(content, user = ALICE) {
  const w = router.pending.get(`chan:${user.id}`);
  assert.ok(w, 'bot is not waiting for ' + user.username);
  router.pending.delete(`chan:${user.id}`);
  const out = await w.handler({ content });
  return typeof out === 'string' ? out : out && out.content; // a rush round comes back with buttons
}
const has = async (line, needle, user) => {
  const out = text(await say(line, user));
  assert.ok(out.includes(needle), `"${line}" should include "${needle}", got: ${out}`);
};

(async () => {
  market.set(OPEN);

  // ---- help, balance, daily ----
  await has('r!help', 'r!help casino');
  await has('r!help market', 'r!buy');
  await has('r!help gambling', 'r!rocket');
  // Every command is on a help page, and the buttons switch pages
  const help = require('../src/commands/help');
  const allHelp = Object.values(help.PAGES).map((pg) => pg.body('r!').join(' ')).join(' ');
  for (const c of require('../src/commands').list) if (!c.hidden && c.name !== 'help') assert.ok(allHelp.includes('r!' + c.name), `r!${c.name} is in r!help`);
  const hp = await say('r!help');
  const casinoBtn = hp.components.flatMap((r) => r.components).find((b) => b.custom_id.endsWith(':casino'));
  const flipped = await help.onButton(ctxFor(ALICE), casinoBtn.custom_id.split(':').slice(1));
  assert.ok(flipped.update.embeds[0].title.includes('Rend-Sino'));
  assert.ok((await help.onButton(ctxFor(BOB), casinoBtn.custom_id.split(':').slice(1))).reply, 'others get their own copy');
  assert.ok(!/\bAI\b|setai/.test(text(await say('r!help'))), 'help has no AI commands');
  await has('r!bal', 'Polygons: **⬢ 500.00**');
  await has('r!portfolio', "alice's portfolio");
  const viewBob = await router.runCommand(require('../src/commands/balance'), ctxFor(ALICE), { user: BOB });
  assert.ok(text(viewBob).includes("bob's portfolio"), 'can view someone else');
  // Easter egg: the bot's own portfolio is infinite, and other bots don't play
  const balanceCmd = require('../src/commands/balance');
  const house = await router.runCommand(balanceCmd, { ...ctxFor(ALICE), client: { user: { id: '999' } } }, { user: { id: '999', username: "Render's Vision", bot: true } });
  assert.ok(text(house).includes('⬢ ∞') && text(house).includes('∞ shares') && text(house).includes('The house always wins'), text(house));
  const otherBot = await router.runCommand(balanceCmd, ctxFor(ALICE), { user: { id: '888', username: 'SomeBot', bot: true } });
  assert.ok(text(otherBot).includes("Bots don't play the market"), text(otherBot));
  const invCmd = require('../src/commands/inventory');
  const houseInv = await router.runCommand(invCmd, { ...ctxFor(ALICE), client: { user: { id: '999' } } }, { user: { id: '999', username: "Render's Vision", bot: true } });
  assert.ok(text(houseInv).includes('**Coffee** × ∞') && text(houseInv).includes('**Title** × ∞'), text(houseInv));
  assert.ok(text(await router.runCommand(invCmd, ctxFor(ALICE), { user: { id: '888', username: 'SomeBot', bot: true } })).includes("Bots don't carry"));

  await has('r!daily', 'You received **⬡ 250.00**');
  assert.strictEqual(cash(), 750_00);
  await has('r!daily', 'Come back <t:');
  db.updatePlayer(G, ALICE.id, { daily_day: '2000-01-01' }); // pretend it was yesterday
  await has('r!daily', 'Daily claimed');
  assert.strictEqual(cash(), 1000_00);

  // Midnight reset lands on Eastern midnight, with and without daylight saving
  assert.strictEqual(new Date(fmt.nextMidnight(Date.parse('2026-11-09T12:00:00Z'))).toISOString(), '2026-11-10T05:00:00.000Z');
  assert.strictEqual(new Date(fmt.nextMidnight(Date.parse('2026-07-01T03:30:00Z'))).toISOString(), '2026-07-01T04:00:00.000Z');

  // ---- market, chart, compare ----
  await has('r!market', 'Rend-Conomy Market');
  await has('r!chart', 'Usage');
  await has('r!chart nope', 'No company called NOPE');
  await has('r!chart rrm', 'quickchart');
  await has('r!compare RRM', 'Usage');
  await has('r!compare RRM BLU', 'RRM vs BLU');

  // ---- buy / sell ----
  await has('r!buy', 'Usage');
  await has('r!buy RRM', 'whole number');
  await has('r!buy RRM 0', 'at least 1');
  await has('r!buy RRM 1.5', 'whole shares');
  await has('r!buy RRM 99999', 'Not enough Polygons');
  await has('r!buy RRM 5', 'bought 5 RRM');
  assert.strictEqual(cash(), 950_00);
  await has('r!sell RRM 9', 'only own 5');
  await has('r!sell RRM all', 'sold 5 RRM');
  assert.strictEqual(cash(), 1000_00, 'cents survive a round trip');

  market.set(snapshot((m) => { m.market.status = 'after-hours'; m.market.text = '🌙 After hours'; }));
  await has('r!buy RRM 1', 'After hours');
  market.set(snapshot((m) => { m.market.halted = true; m.market.text = '🛑 Halted'; }));
  await has('r!sell RRM 1', 'Halted');
  market.set(snapshot((m) => { m.statuses.BLU = 'distressed'; m.prices.BLU = 2; }));
  await has('r!buy BLU 2', 'goes **bankrupt**');

  // Bankruptcy blocks trading, then the wipe zeroes everyone's shares
  market.set(snapshot((m) => { m.statuses.BLU = 'bankrupt'; m.statusText.BLU = '💀 Bankrupt'; }));
  await has('r!buy BLU 1', "can't buy shares in a bankrupt company");
  await has('r!sell BLU 1', 'holding the bag');
  assert.strictEqual(db.holding(G, ALICE.id, 'BLU').shares, 2);
  market.set(snapshot((m) => { m.wipes.BLU = 1; }));
  await has('r!sell BLU 1', 'only own 0');
  await has('r!buy BLU 3', 'own **3**'); // buying after a wipe works normally
  market.set(snapshot((m) => { m.wipes.BLU = 1; }));
  await has('r!bal', '3 shares');

  // ---- dividends ----
  const W1 = (m) => { m.wipes.BLU = 1; };
  market.set(snapshot((m) => { W1(m); m.dividends.BLU = 1; }));
  await has('r!dividends', 'collected **⬡ 0.00'); // first claim just starts tracking
  market.set(snapshot((m) => { W1(m); m.dividends.BLU = 3.5051; }));
  await has('r!div', 'collected **⬡ 7.51'); // 3 shares x 2.5051 = 7.5153 -> 7.51, 0.0053 carried
  assert.ok(Math.abs(db.player(G, ALICE).div_carry - 0.0053) < 1e-9, 'fraction carried');
  await has('r!dividends', 'collected **⬡ 0.00');

  // ---- jobs (the Labor Day Update) ----
  market.set(OPEN);
  work.TUNING.tipMax = 0;     // exact pay; tips are tested on their own below
  work.TUNING.kind = 'order'; // pick the task type
  await has('r!work', 'need a job first');
  await has('r!apply XYZ', 'Pick a company');
  await has('r!apply nach', 'Welcome to **De Nacho**! You start as a **Dishwasher**');
  await has('r!apply BLU', 'already work at **NACH**');
  await has('r!quit', 'You can quit <t:');

  random = () => 0.5; // no rush rounds
  const before = cash();
  const q = text(await say('r!work'));
  assert.ok(q.includes('order up') && q.includes('20 seconds'), q);
  await has('r!work', 'mid-shift');
  const ans = work.active.get(`${G}:${ALICE.id}`).ans;
  assert.ok((await reply(ans)).includes('Nice work, Dishwasher! **+⬡ 35.00**'));
  assert.strictEqual(cash(), before + 35_00);
  await has('r!work', "Shift's over");

  db.updatePlayer(G, ALICE.id, { last_work: 0, overtime: 1 });
  await say('r!work');
  assert.ok((await reply('wrong')).includes('Not quite'), 'wrong answer');
  assert.strictEqual(cash(), before + 35_00 + 28_00, 'wrong pays 40%, overtime doubles it: 35*0.4*2 = 28');
  let car = db.career(G, ALICE.id, 'NACH');
  assert.ok(car.shifts === 2 && car.total === 2 && car.correct === 1 && car.rev_total === 2 && car.earned === 63_00, JSON.stringify(car));

  // The review on the 10th shift: 9/10 promotes. And a rush round (forced) that pays 60%
  db.updateCareer(G, ALICE.id, 'NACH', { shifts: 9, rev_total: 9, rev_right: 8 });
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  await say('r!work');
  random = () => 0.1; // forces the 1-in-5 rush
  const pass = await reply(work.active.get(`${G}:${ALICE.id}`).ans);
  assert.ok(pass.includes('Performance review: 9/10') && pass.includes('Promoted to Line Cook') && pass.includes('RUSH ORDER #1'), pass);
  random = () => 0.5;
  const rush = await reply(work.active.get(`${G}:${ALICE.id}`).ans);
  assert.ok(rush.includes('RUSH CLEARED') && rush.includes('+⬡ 26.25'), rush); // 35 * 1.25 * 0.6
  assert.strictEqual(db.career(G, ALICE.id, 'NACH').rank, 1);

  // A bad review demotes
  db.updateCareer(G, ALICE.id, 'NACH', { rev_total: 9, rev_right: 2 });
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  await say('r!work');
  assert.ok((await reply('nope')).includes('Demoted to Dishwasher'));
  db.updateCareer(G, ALICE.id, 'NACH', { rank: 1, rev_total: 0, rev_right: 0 });

  // Quitting keeps your rank there
  db.updatePlayer(G, ALICE.id, { hired_at: 0 });
  await has('r!quit', "You're a **Line Cook** with 11 shifts there");
  const quitCmd = require('../src/commands/quit');
  const quitAsk = await say('r!quit');
  const [yesId, noId] = quitAsk.components[0].components.map((b) => b.custom_id);
  assert.ok((await quitCmd.onButton(ctxFor(BOB), yesId.split(':').slice(1))).reply.includes('not your job'));
  assert.ok((await quitCmd.onButton(ctxFor(ALICE), noId.split(':').slice(1))).update.content.includes('You stayed'));
  assert.strictEqual(db.player(G, ALICE).job, 'NACH', 'Stay keeps the job');
  const quitDone = await quitCmd.onButton(ctxFor(ALICE), yesId.split(':').slice(1));
  assert.ok(quitDone.update.content.includes('quit **NACH** after 11 shifts') && quitDone.update.components.length === 0, JSON.stringify(quitDone));
  assert.strictEqual(db.player(G, ALICE).job, null);

  // ---- gigs ----
  await has('r!gig', 'Gig:');
  assert.ok((await reply(work.active.get(`${G}:${ALICE.id}`).ans)).includes('Gig done! **+⬡ 14.00**'));
  await has('r!gig', 'No gigs right now');
  await has('r!job', 'between jobs');

  // Coming back: welcome back, rank intact
  await has('r!apply NACH', 'Welcome back to **De Nacho**! You\'re still a **Line Cook**, with 11 shifts');
  await has('r!gig', 'already have a job');
  await has('r!job', 'Line Cook');

  // ---- speed tips ----
  work.TUNING.tipMax = 0.5;
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  await say('r!work');
  const tipped = await reply(work.active.get(`${G}:${ALICE.id}`).ans);
  assert.ok(/Speed tip \*\*\+⬡ 2[01]\.\d\d\*\*/.test(tipped), tipped); // 35 * 1.25 = 43.75, instant answer: up to +21.88
  work.TUNING.tipMax = 0;

  // ---- team shifts: a coworker in the same channel ----
  db.updatePlayer(G, BOB.id, { job: 'NACH', hired_at: Date.now(), last_work: 0 });
  await say('r!work', BOB);
  assert.ok((await reply(work.active.get(`${G}:${BOB.id}`).ans, BOB)).includes('Team shift with **alice**: **+15%**'));

  // ---- the market ----
  // Booms pay double
  market.set(snapshot((m) => { m.boost = { tickers: [], until: new Date(Date.now() + 3600e3).toISOString() }; }));
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  await say('r!work');
  assert.ok((await reply(work.active.get(`${G}:${ALICE.id}`).ans)).includes('Boom overtime x2'));
  // Hiring freeze during a crash, layoffs at a bankrupt company
  market.set(snapshot((m) => { m.crash = { phase: 'crash' }; }));
  db.updatePlayer(G, BOB.id, { job: null });
  await has('r!apply RRM', 'Hiring freeze', BOB);
  market.set(snapshot((m) => { m.statuses.NACH = 'bankrupt'; }));
  await has('r!apply NACH', "isn't hiring", BOB);
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  const c0 = cash();
  await has('r!work', 'Laid off');
  assert.strictEqual(db.player(G, ALICE).job, null);
  assert.strictEqual(cash(), c0 + Math.round(35 * 1.25 * 3 * 100), 'three shifts of severance');
  market.set(OPEN);

  // Strikes when the Polygon Reserve is low: join or cross the line
  const reserve = require('../src/reserve');
  const full = reserve.get(db);
  reserve.move(db, Math.round(reserve.RULES.start * 0.2) - full);
  db.updatePlayer(G, ALICE.id, { job: 'NACH', last_work: 0 });
  random = () => 0.1;
  const strike = await say('r!work');
  assert.ok(text(strike).includes('STRIKE at De Nacho'), text(strike));
  const [join, cross] = strike.components[0].components.map((b) => b.custom_id.split(':').slice(1));
  const joined = await work.onButton(ctxFor(ALICE), join);
  assert.ok(joined.update.content.includes('Solidarity'), JSON.stringify(joined));
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  const strike2 = await say('r!work');
  const crossed = await work.onButton(ctxFor(ALICE), strike2.components[0].components[1].custom_id.split(':').slice(1));
  assert.ok(crossed.update.content.includes('cross the picket line'));
  random = () => 0.5;
  assert.ok((await reply(work.active.get(`${G}:${ALICE.id}`).ans)).includes('Crossed the picket line'));
  reserve.move(db, full - reserve.get(db));

  // Memory tasks hide the order, then you press it back in order
  work.TUNING.kind = 'memory';
  db.updatePlayer(G, ALICE.id, { last_work: 0 });
  const mem = await say('r!work');
  assert.ok(mem.later && mem.later.ms === 4000 && mem.components.length === 0, 'shown first, buttons later');
  assert.ok(mem.later.edit.content.includes('Build it from memory') && mem.later.edit.components.length);
  const mst = work.active.get(`${G}:${ALICE.id}`);
  const btnFor = (v) => mem.later.edit.components.flatMap((r) => r.components).find((b, i) => mst.choices[i].value === v).custom_id.split(':').slice(1);
  mst.start = Date.now(); // pretend the order just disappeared
  const words = mst.steps;
  let pressOut;
  for (const w of words) pressOut = await work.onButton(ctxFor(ALICE), btnFor(w));
  assert.ok(String(pressOut.followUp).includes('Nice work'), JSON.stringify(pressOut));
  work.TUNING.kind = null;

  // r!job and reminders
  await has('r!job remind on', 'reminders **on**');
  assert.strictEqual(db.player(G, ALICE).remind, 1);
  await has('r!job remind off', 'reminders **off**');

  // Every task of every job, at every rank, has an answer that fits its own prompt
  const jobs = require('../src/jobs');
  const kinds = { RRM: ['queue', 'links', 'rule'], NACH: ['order', 'memory', 'count'], BLU: ['steps', 'bricks', 'tool'], BNW: ['math', 'sheet', 'percent'], BSTG: ['tile', 'grid', 'repro'] };
  for (const j of Object.keys(jobs.COMPANIES)) {
    for (const kind of kinds[j]) for (const tier of [0, 1, 2, 3]) for (const rushOn of [false, true]) {
      for (let i = 0; i < 15; i++) {
        const t = jobs.task(j, { tier, rush: rushOn, kind, market: OPEN });
        assert.ok(t.q && t.ans && t.limit, `${j} ${kind} task`);
        if (t.check) assert.ok(t.check(t.ans), `${j} ${kind}: its own answer passes`);
        if (t.choices && !t.seq) assert.ok(t.choices.some((c) => c.value === t.ans), `${j} ${kind}: the answer is a button`);
        if (t.seq) assert.ok(t.ans.split(' ').every((w) => t.choices.some((c) => c.value.split(' ').includes(w))), `${j} ${kind}: every step is a button`);
        if (t.choices) assert.ok(t.choices.length <= 25, 'fits in Discord');
        if (kind === 'math') {
          const [, x, op, y, z] = t.q.match(/(\d+) ([+−×]) (\d+)(?: \+ (\d+))?/);
          const want = (op === '+' ? +x + +y : op === '−' ? x - y : x * y) + (z ? +z : 0);
          assert.strictEqual(t.ans, String(want));
        }
        if (kind === 'order') assert.ok(t.q.includes(t.ans));
        if (kind === 'bricks') { const n = t.q.match(/\*\*(\d+)\*\*/g).map((x) => +x.replace(/\*/g, '')); assert.strictEqual(+t.ans, n[0] * n[1] + (n[2] || 0)); }
      }
    }
  }
  assert.ok(jobs.task('BNW', { kind: 'percent' }).check('5') !== undefined);
  db.updatePlayer(G, ALICE.id, { job: null, shifts: 0 });
  db.updatePlayer(G, BOB.id, { job: null, shifts: 0 });

  // ---- shop and inventory ----
  db.updatePlayer(G, ALICE.id, { cash: 10000_00, last_work: 0 });
  random = () => 0.5; // Mystery price this restock: 75 + floor(0.5 * 26) = 88
  await has('r!shop', 'Mystery**: ⬡ 88.00');
  await has('r!shop', 'Title**: ⬡ 5,000.00');
  await has('r!purchase', 'Which item');
  await has('r!inv', 'Empty');
  await has('r!use coffee', "don't have a **Coffee**");
  await has('r!purchase coffee', 'Bought a **Coffee** for ⬡ 100.00');
  assert.strictEqual(cash(), 9900_00);
  await has('r!purchase coffee', 'already bought');
  await has('r!use coffee', 'not on a work cooldown'); // kept, not wasted
  db.updatePlayer(G, ALICE.id, { last_work: Date.now() });
  await has('r!use coffee', 'cooldown is reset');
  assert.strictEqual(db.player(G, ALICE).last_work, 0);
  assert.strictEqual(db.itemCount(G, ALICE.id, 'coffee'), 0);

  await has('r!purchase overtime', 'for ⬡ 250.00');
  await has('r!use overtime', 'Overtime approved');
  db.addItem(G, ALICE.id, 'overtime', 1);
  await has('r!use overtime', 'already have Overtime queued');
  await has('r!purchase resume', 'for ⬡ 350.00');
  await has('r!use resume', "don't have a job");
  await has('r!inventory', 'Resume** × 1');
  await has('r!bag', 'Overtime is queued');

  await has('r!purchase mystery', 'for ⬡ 88.00');
  random = () => 0.2; // Overtime pass
  await has('r!use mystery', 'Overtime pass');
  assert.strictEqual(db.itemCount(G, ALICE.id, 'overtime'), 2);

  await has('r!settitle Boss', 'need a **Title**');
  await has('r!purchase title', 'for ⬡ 5,000.00');
  await has('r!purchase title', 'sold out', BOB); // only 1 Title per restock, shared by everyone
  await has('r!use title', 'settitle');
  await has('r!settitle **Nacho** @Baron', 'Nacho Baron'); // formatting and @ pings are stripped
  await has('r!bal', '🏷️ *Nacho Baron*');
  await has('r!settitle again', 'need a **Title**');
  const bobInv = await router.runCommand(require('../src/commands/inventory'), ctxFor(ALICE), { user: BOB });
  assert.ok(text(bobInv).includes("bob's inventory"));

  // A new restock rolls a new Mystery price and lets players buy again
  db.setMeta('lastRestock', 0);
  random = () => 0.99;
  await has('r!shop', 'Mystery**: ⬡ 100.00');
  await has('r!purchase mystery', 'for ⬡ 100.00');
  random = () => 0.01; // jackpot
  await has('r!use mystery', 'JACKPOT');

  // ---- cleartitle (mods only) ----
  const clear = require('../src/commands/cleartitle');
  assert.ok(text(await router.runCommand(clear, ctxFor(BOB), { user: ALICE })).includes('Only moderators'));
  const modCtx = ctxFor(BOB); modCtx.isMod = true;
  assert.ok(text(await router.runCommand(clear, modCtx, { user: ALICE })).includes("Removed **alice**'s title"));
  assert.strictEqual(db.player(G, ALICE).title, null);

  // ---- TODD: bailout, slots lock, repay ----
  await has('r!bailout', 'NOT broke');
  db.updatePlayer(G, BOB.id, { cash: 50_00 });
  await has('r!bailout', 'TODD LOANS', BOB);
  assert.strictEqual(db.player(G, BOB).debt, 600_00);
  assert.strictEqual(cash(BOB), 550_00);
  await has('r!bailout', 'STiLL owe', BOB);
  await has('r!slots 50', 'GAMBLING', BOB);
  await has('r!repay', 'HOW MUCH', BOB);
  await has('r!repay 100', 'Still owed: **⬡ 500.00', BOB);
  await has('r!repay all', 'Still owed: **⬡ 50.00', BOB); // only had 450 left
  db.updatePlayer(G, BOB.id, { cash: 1000_00 });
  await has('r!repay 9999', 'DEBT CLEARED', BOB); // capped at the debt
  assert.strictEqual(cash(BOB), 950_00);
  await has('r!repay 5', "don't OWE", BOB);

  // ---- slots ----
  await has('r!slots', 'Usage', BOB);
  await has('r!slots 5', 'minimum', BOB);
  await has('r!slots 5000', 'maximum', BOB);
  random = () => 0.99; // 💎💎💎
  await has('r!slots 10', 'Won: ⬡ 250.00', BOB);
  assert.strictEqual(cash(BOB), 950_00 + 240_00);
  await has('r!slots 10', 'cool down', BOB);
  slots.lastSpin.clear();
  let n = 0;
  random = () => [0, 0.3, 0.5][n++ % 3]; // 🍒🍋🔔, no match
  await has('r!slots 12.50', 'Won: ⬡ 0.00', BOB);

  // ---- 404 ----
  dms = [];
  random = () => 0.1;
  assert.strictEqual(await say('r!404'), null, 'no reply in the channel');
  assert.strictEqual(dms[0], '75.40');
  assert.ok(dms[1].includes('Soon, Friend'), 'the secret achievement comes in its own DM');
  random = () => 0.9;
  await say('r!404');
  assert.strictEqual(dms[2], 'Soon, friend.');

  // ---- plumbing ----
  assert.strictEqual(router.parsePrefix('hello r!buy'), null, 'only messages starting with the prefix');
  assert.strictEqual(router.parsePrefix('r!settitle a b c').args.text, 'a b c', 'last option keeps spaces');
  const slash = slashCommands();
  assert.ok(!slash.some((c) => c.name === '404'), '404 stays secret');
  assert.ok(slash.find((c) => c.name === 'cleartitle').default_member_permissions, 'cleartitle hidden from non-mods');
  for (const c of slash) {
    assert.ok(/^[a-z0-9_-]{1,32}$/.test(c.name), 'slash name ' + c.name);
    assert.ok(c.description.length >= 1 && c.description.length <= 100, 'description length ' + c.name);
    for (const o of c.options) assert.ok(o.description.length <= 100 && /^[a-z0-9_-]{1,32}$/.test(o.name), `option ${c.name}.${o.name}`);
  }
  market.set(OPEN);
  const lb = api.leaderboard(db, market, OPEN, G);
  assert.strictEqual(lb.length, 2);
  assert.ok(lb[0].netWorth >= lb[1].netWorth);

  // Market down: commands say so instead of crashing
  market.set(null);
  await has('r!market', 'offline');
  await has('r!buy RRM 1', 'offline');

  console.log(`All command tests passed (${slash.length} slash commands).`);
})().catch((e) => { console.error(e); process.exit(1); });
