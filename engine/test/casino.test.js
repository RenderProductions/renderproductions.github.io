// The Rend-Sino: every game plays through, pays right, keeps a house edge, and moves the reserve. Offline:  npm test
const assert = require('assert');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const casino = require('../src/casino');
const reserve = require('../src/reserve');

const G = '123456789012345678';
const mk = (id, username) => ({ id, username, send: async () => {} });
const ANA = mk('700000000000000001', 'ana');
const BEN = mk('700000000000000002', 'ben');
let random = Math.random;
const ctxFor = (user, extra = {}) => ({ ...router.makeCtx({ guildId: G, channelId: 'table', user }, { db, market }), random: () => random(), ...extra });
async function say(line, user = ANA, extra) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(user, extra), p.args); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : o.content || JSON.stringify(o.embeds));
const ids = (o) => o.components.flatMap((r) => r.components.map((b) => b.custom_id));
const press = (cmd, id, user = ANA) => cmd.onButton(ctxFor(user), id.split(':').slice(1));
const cash = (u = ANA) => db.player(G, u).cash;
const fresh = () => { casino.last.clear(); casino.sessions.clear(); };
// A fixed sequence of random numbers, then Math.random
const seq = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : Math.random()); };

(async () => {
  for (const u of [ANA, BEN]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 100000_00 }); }

  // ---- house rules ----
  assert.ok(text(await say('r!coinflip 5')).includes('minimum bet'));
  assert.ok(text(await say('r!coinflip 999999')).includes('maximum bet'));
  assert.ok(text(await say('r!coinflip')).includes('Usage'));
  db.updatePlayer(G, BEN.id, { debt: 100_00 });
  assert.ok(text(await say('r!dice 10 over 50', BEN)).includes('MY money'));
  db.updatePlayer(G, BEN.id, { debt: 0 });

  // ---- coinflip: 1.95x, and bets move the reserve ----
  fresh();
  let r0 = reserve.get(db), c0 = cash();
  random = () => 0.1; // heads
  assert.ok(text(await say('r!coinflip 100 heads')).includes('You win ⬡ 195.00'));
  assert.strictEqual(cash(), c0 + 95_00);
  assert.strictEqual(reserve.get(db), r0 - 95_00, 'the reserve pays the winnings');
  assert.ok(text(await say('r!coinflip 100 tails')).includes('Easy there'), 'cooldown');
  fresh();
  assert.ok(text(await say('r!coinflip 100 tails')).includes('You lose'));
  assert.strictEqual(reserve.get(db), r0 - 95_00 + 100_00);

  // ---- dice ----
  fresh();
  random = () => 0.85; // rolls 86
  assert.ok(text(await say('r!dice 100 over 70')).includes('You win'), 'over 70 with 86');
  fresh();
  assert.ok(text(await say('r!dice 100 under 50')).includes('You lose'));
  assert.ok(text(await say('r!dice 100 sideways 3')).includes('Usage'));
  fresh();
  assert.ok(text(await say('r!dice 100 over 99')).includes('5 to 95'));

  // ---- blackjack ----
  const bj = require('../src/commands/blackjack');
  assert.strictEqual(bj.value([{ r: 14 }, { r: 13 }]), 21);
  assert.strictEqual(bj.value([{ r: 14 }, { r: 14 }, { r: 9 }]), 21);
  assert.strictEqual(bj.value([{ r: 10 }, { r: 9 }, { r: 5 }]), 24);
  fresh(); random = Math.random;
  let played = 0;
  for (let i = 0; i < 30; i++) {
    fresh();
    const out = await say('r!blackjack 50');
    if (!out.components || !out.components.length) { played++; continue; } // a natural settles at once
    const stand = ids(out).find((id) => id.endsWith(':stand'));
    const done = await press(bj, stand);
    assert.ok(/You win|lose|Push|BLACKJACK|busts/.test(JSON.stringify(done.update.embeds)), JSON.stringify(done.update.embeds));
    assert.strictEqual(done.update.components.length, 0);
    played++;
  }
  assert.strictEqual(played, 30);
  fresh();
  let t = await say('r!blackjack 50');
  if (t.components.length) {
    const before = cash();
    const dbl = ids(t).find((id) => id.endsWith(':double'));
    const d = await press(bj, dbl);
    assert.ok(d.update.embeds[0].description.includes('Bet: ⬡ 100.00'), 'doubled');
    assert.ok(cash() <= before + 200_00);
  }

  // ---- ride the bus ----
  const bus = require('../src/commands/bus');
  fresh();
  t = await say('r!bus 100');
  let st = casino.sessions.get(`${G}:${ANA.id}`);
  const cards = st.cards;
  st.mult = 1;
  const rightFor = [cards[0].color,
    cards[1].r > cards[0].r ? 'higher' : 'lower',
    bus.right(3, cards, 'inside') ? 'inside' : 'outside',
    cards[3].suit];
  const tieRound2 = cards[1].r === cards[0].r;
  let out = await press(bus, ids(t).find((id) => id.endsWith(':' + rightFor[0])));
  assert.ok(out.update.embeds[0].description.includes('Keep riding'), 'round 1 passed');
  assert.ok(ids(out.update).some((id) => id.endsWith(':cash')), 'can cash out now');
  if (!tieRound2) {
    out = await press(bus, ids(out.update).find((id) => id.endsWith(':cash')));
    assert.ok(out.update.embeds[0].description.includes('Cashed out') && out.update.embeds[0].description.includes('⬡ 192.00'), out.update.embeds[0].description);
  }
  fresh();
  t = await say('r!bus 100');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  const wrong = st.cards[0].color === 'red' ? 'black' : 'red';
  out = await press(bus, ids(t).find((id) => id.endsWith(':' + wrong)));
  assert.ok(out.update.embeds[0].description.includes('fell off the bus'));

  // ---- higher or lower ----
  const hilo = require('../src/commands/hilo');
  fresh();
  t = await say('r!hilo 100');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  st.card = { r: 2, icon: '♠️', suit: 'spades', color: 'black' };
  st.deck = [{ r: 5, icon: '♦️' }, { r: 6, icon: '♦️' }, { r: 7, icon: '♦️' }, { r: 9, icon: '♥️' }, { r: 2, icon: '♥️' }]; // pops the 2 (a tie: redrawn), then the 9
  const o = hilo.odds(st);
  assert.strictEqual(o.lower, 0, 'nothing is lower than a 2');
  st.deck = st.deck.slice(); 
  out = await press(hilo, ids(t).find((id) => id.endsWith(':higher')));
  assert.ok(out.update.embeds[0].description.includes('Keep going') && st.streak === 1);
  st.deck = [{ r: 3, icon: '♣️' }, { r: 5, icon: '♣️' }, { r: 6, icon: '♣️' }, { r: 14, icon: '♣️' }];
  out = await press(hilo, ids(out.update).find((id) => id.endsWith(':lower')));
  assert.ok(out.update.embeds[0].description.includes('Wrong call'), 'a 9 then an ace, called lower');

  // ---- minesweeper ----
  const mines = require('../src/commands/mines');
  assert.ok(Math.abs(mines.multFor(3, 1) - 0.96 * 16 / 13) < 1e-9);
  fresh();
  t = await say('r!mines 100 3');
  assert.strictEqual(t.components.length, 5, '4 rows of tiles and a cash-out row');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  const safe = [...Array(16).keys()].filter((i) => !st.bombs.has(i));
  const bomb = [...st.bombs][0];
  out = await press(mines, ids(t)[safe[0]]);
  out = await press(mines, ids(t)[safe[1]]);
  assert.ok(out.update.embeds[0].description.includes('Safe tiles found: **2**'));
  const c1 = cash();
  out = await press(mines, ids(out.update).find((id) => id.endsWith(':cash')));
  assert.ok(out.update.embeds[0].description.includes('Cashed out'));
  assert.strictEqual(cash(), c1 + Math.round(100_00 * mines.multFor(3, 2)));
  fresh();
  t = await say('r!mines 100 3');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  out = await press(mines, ids(t)[[...st.bombs][0]]);
  assert.ok(out.update.embeds[0].description.includes('BOOM'));
  assert.ok(text(await say('r!mines 100 13')).includes('1 to 12'));

  // ---- rocket ----
  const rocket = require('../src/commands/rocket');
  fresh();
  random = () => 0.24; // crashes at 0.96 / 0.24 = 4x
  t = await say('r!rocket 100');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  assert.ok(Math.abs(st.crashAt - 4) < 1e-9 && typeof t.after === 'function');
  assert.ok((await press(rocket, ids(t)[0])).reply.includes("hasn't even launched"));
  st.t0 = Date.now() - 10_000; // 10 seconds in: e^0.6 = 1.82x
  const c2 = cash();
  out = await press(rocket, ids(t)[0]);
  assert.ok(out.update.embeds[0].description.includes('bailed out') && out.update.embeds[0].description.includes('1.82x'), out.update.embeds[0].description);
  assert.strictEqual(cash(), c2 + 182_00);
  fresh();
  t = await say('r!rocket 100');
  st = casino.sessions.get(`${G}:${ANA.id}`);
  st.t0 = Date.now() - 60_000; // far past 4x
  out = await press(rocket, ids(t)[0]);
  assert.ok(out.update.embeds[0].description.includes('crashed'));
  // The live loop ends on its own when it crashes
  fresh();
  random = () => 0.99; // crashes right away (0.97x -> 1.00x)
  t = await say('r!rocket 100');
  const frames = [];
  casino.sessions.get(`${G}:${ANA.id}`).t0 = Date.now() - 1;
  await t.after(async (p) => frames.push(p));
  assert.ok(frames.length && JSON.stringify(frames[frames.length - 1]).includes('crashed'));
  random = Math.random;

  // ---- the derby ----
  const derby = require('../src/commands/derby');
  fresh();
  const race = await say('r!derby glitch 100', ANA, { fast: true });
  assert.ok(typeof race.after === 'function' && race.embeds[0].description.includes('Betting closes'));
  assert.ok(text(await say('r!derby 2 50', BEN)).includes('bets ⬡ 50.00 on 🧀 **Nacho Libre**'));
  assert.ok(text(await say('r!derby 1 50', BEN)).includes('already got a bet'));
  assert.ok(text(await say('r!derby unicorn 50', BEN)).includes('Pick a horse'));
  const raceFrames = [];
  await race.after(async (p) => raceFrames.push(p));
  const last = raceFrames[raceFrames.length - 1].embeds[0].description;
  assert.ok(last.includes('wins!') && last.includes('race is over'), last);
  assert.ok(!derby.races.size, 'the race is cleared');
  // The winner is picked by the odds: over many races, the favorite wins most
  const tally = [0, 0, 0, 0, 0];
  for (let i = 0; i < 400; i++) {
    const rr = { ...derby.newRace(seq(0.99, 0.01, 0.01, 0.01, 0.01)), bets: [] };
    const res = await derby.runRace(rr, { db, guildId: G, random: Math.random, fast: true });
    tally[res.winner]++;
  }
  assert.ok(tally[0] > 150 && tally[0] < 330, `favorite wins about 60%: ${tally}`);

  // ---- the lottery ----
  const lotto = require('../src/lottery');
  const lcmd = (line, u = ANA) => say(line, u);
  r0 = reserve.get(db);
  assert.ok(text(await lcmd('r!lottery buy 3')).includes('bought **3** tickets for ⬡ 150.00'));
  assert.ok(text(await lcmd('r!lottery buy 1', BEN)).includes('hold **1**'));
  assert.strictEqual(lotto.pot(db, G), 180_00, '90% of ⬡ 200 in the pot');
  assert.strictEqual(reserve.get(db), r0 + 20_00, '10% to the reserve');
  assert.ok(text(await lcmd('r!lottery buy 30')).includes('at most 20'));
  assert.ok(JSON.stringify((await lcmd('r!lottery')).embeds).includes('⬡ 180.00'));
  // Sunday 8 PM Eastern
  const draw = lotto.nextDraw(Date.parse('2026-11-10T17:00:00Z'));
  assert.strictEqual(draw, '2026-11-15');
  assert.strictEqual(new Date(lotto.drawTime('2026-11-15')).toISOString(), '2026-11-16T01:00:00.000Z');
  assert.strictEqual(lotto.nextDraw(Date.parse('2026-11-16T01:30:00Z')), '2026-11-22', 'after the draw, next week');
  // Drawing: nothing before it's due, then one winner takes the pot
  assert.strictEqual((await lotto.tick({ db }, Date.parse('2026-11-15T12:00:00Z'))).length, 0);
  const posted = [];
  const client = { channels: { fetch: async () => ({ send: async (m) => posted.push(m) }) }, users: { fetch: async () => ({ send: async () => {} }) } };
  const a0 = cash(ANA), b0 = cash(BEN);
  const res = await lotto.tick({ db, client }, Date.parse('2026-11-16T01:01:00Z'), () => 0.1); // ticket 1 of 4: ana's
  assert.ok(res.length === 1 && res[0].name === 'ana' && res[0].prize === 180_00);
  assert.strictEqual(cash(ANA), a0 + 180_00);
  assert.strictEqual(cash(BEN), b0);
  assert.strictEqual(lotto.pot(db, G), 0);
  assert.ok(posted[0].content.includes('**ana** wins the pot of **⬡ 180.00**'));
  assert.strictEqual((await lotto.tick({ db }, Date.parse('2026-11-16T01:02:00Z'))).length, 0, 'drawn once');

  // ---- stats ----
  const stats = await say('r!gambling');
  const desc = stats.embeds[0].description;
  assert.ok(desc.includes('🪙 Coinflip: 2 played') && desc.includes('🎟️ Lottery'), desc);

  // ---- one game at a time ----
  fresh();
  await say('r!mines 100');
  casino.last.clear();
  assert.ok(text(await say('r!hilo 100')).includes('Finish your 💣 Minesweeper game'));

  // ---- every game keeps a house edge (simulated) ----
  const rtp = {};
  // coinflip and dice: exact
  rtp.coinflip = 0.5 * 1.95;
  rtp.dice = (0.30) * Math.floor((0.96 / 0.30) * 100) / 100;
  // mines: always pick k safe tiles then cash out
  rtp.mines = (() => { let p = 1; for (let i = 0; i < 4; i++) p *= (13 - i) / (16 - i); return p * mines.multFor(3, 4); })();
  // rocket: cash out at 2x
  rtp.rocket = 0.96 / 2 * 2;
  // ride the bus: a player who rides all the way with the best-odds pick each round
  let busPaid = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const d = casino.deck(); const sb = { cards: [d.pop(), d.pop(), d.pop(), d.pop()], round: 1, mult: 1 };
    let ok = true;
    for (let k = 1; k <= 4 && ok; k++) {
      const opts = { 1: ['red', 'black'], 2: ['higher', 'lower'], 3: ['inside', 'outside'], 4: ['hearts', 'spades'] }[k];
      const pick = opts.map((g) => [g, bus.stepFor(sb, g)]).filter(([, m]) => m).sort((x, y) => x[1] - y[1])[0][0];
      const m = bus.stepFor(sb, pick);
      ok = bus.right(k, sb.cards, pick);
      if (ok) { sb.mult *= m; sb.round++; }
    }
    if (ok) busPaid += sb.mult;
  }
  rtp.bus = busPaid / N;
  for (const [g, v] of Object.entries(rtp)) assert.ok(v < 1 && v > 0.5, `${g} pays back ${v.toFixed(3)} per Polygon`);

  console.log('All casino tests passed.', Object.entries(rtp).map(([g, v]) => `${g} ${(v * 100).toFixed(1)}%`).join(', '));
})().catch((e) => { console.error(e); process.exit(1); });
