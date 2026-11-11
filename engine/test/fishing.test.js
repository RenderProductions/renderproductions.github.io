// Fishing: rod, bait, lure, catches, selling, fish as bait, achievements. Offline:  npm test
const assert = require('assert');
const config = require('../src/config');
config.achievementPay = false; // counts exact balances
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const F = require('../src/fishing');
const A = require('../src/achievements');
const effects = require('../src/effects');
const fish = require('../src/commands/fish');

const G = '123456789012345678';
const ANA = { id: '940000000000000001', username: 'ana' };
let random = Math.random;
const ctxFor = (u = ANA) => ({ ...router.makeCtx({ guildId: G, channelId: 'lake', user: u }, { db, market }), random: () => random() });
const go = async (action = '') => { fish.lastCast.clear(); const o = await fish.run(ctxFor(), { action }); return o && o._final ? o._final : o; };
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const cash = () => db.player(G, ANA).cash;
// Weighted rolls: a number that lands in a table's slot
const slot = (table, key) => { const t = F.TABLES[table]; const total = Object.values(t).reduce((a, b) => a + b, 0); let acc = 0;
  for (const [k, w] of Object.entries(t)) { if (k === String(key)) return (acc + w / 2) / total; acc += w; } throw new Error(key); };
const seq = (...xs) => { let i = 0; return () => (i < xs.length ? xs[i++] : 0); };

(async () => {
  db.player(G, ANA); db.updatePlayer(G, ANA.id, { cash: 1000_00 });

  // No rod, no fishing
  assert.ok(text(await go()).includes('need a **Fishing Rod**'));
  db.addItem(G, ANA.id, 'rod', 1);

  // Bait costs 5, and a fish lands in the bag
  random = seq(slot('bait', 1), 0); // a small fish, the first one (minnow)
  let c0 = cash();
  let out = text(await go());
  assert.ok(out.includes('You caught a Minnow') && out.includes("Gone Fishin'"), out);
  assert.strictEqual(cash(), c0 - 5_00, 'bait');
  assert.strictEqual(db.itemCount(G, ANA.id, 'fish_minnow'), 1);

  // The cooldown
  const k = fish.run(ctxFor(), {}); // without clearing lastCast
  assert.ok(text(await k).includes('forget about you'));

  // Junk, a wallet, a snag, nothing
  random = seq(slot('bait', 'junk'), 0); out = text(await go()); assert.ok(out.includes('Soggy Boot'), out);
  random = seq(slot('bait', 'wallet'), 0); c0 = cash(); out = text(await go());
  assert.ok(out.includes('soggy wallet') && cash() === c0 - 5_00 + 20_00, out);
  random = seq(slot('bait', 'snag')); assert.ok(text(await go()).includes('snagged'));
  random = seq(slot('bait', 'nothing'), 0); assert.ok(text(await go()).includes('🌊'));

  // A fish as bait, and a bigger catch: There's Always a Bigger Fish
  random = seq(slot('1', 3), 0); // minnow as bait -> a large fish (pike)
  out = text(await go('minnow'));
  assert.ok(out.includes('Northern Pike') && out.includes('Bigger Fish'), out);
  assert.strictEqual(db.itemCount(G, ANA.id, 'fish_minnow'), 0, 'the minnow was the bait');
  assert.ok(text(await go('minnow')).includes("don't have a Minnow"));
  assert.ok(text(await go('boot')).includes('Nothing bites on a Soggy Boot'));

  // The Lure: no bait cost, uses charges; a snag costs an extra one
  db.addItem(G, ANA.id, 'lure', 1);
  assert.ok(text(await router.runCommand(require('../src/commands/use'), ctxFor(), { item: 'lure' })).includes('Lure tied on'));
  c0 = cash();
  random = seq(slot('lure', 2), 0); await go();
  assert.strictEqual(cash(), c0, 'no bait with a lure');
  assert.strictEqual(effects.get(db, G, ANA.id).lure, 24);
  random = seq(slot('lure', 'snag')); await go();
  assert.strictEqual(effects.get(db, G, ANA.id).lure, 22, 'a snag costs an extra cast');

  // The White Whale: Moby Dick
  db.updatePlayer(G, ANA.id, { cash: cash() + 100_00 });
  random = seq(slot('lure', 4), 0.99); // a legendary catch (the lure is on), the second one: the whale
  out = text(await go());
  assert.ok(out.includes('White Whale') && out.includes('Moby Dick'), out);

  // The bag and selling
  out = text(await go('bag'));
  assert.ok(out.includes('Northern Pike') && out.includes('Marquez would pay'), out);
  c0 = cash();
  out = text(await go('sell junk'));
  assert.ok(out.includes('⬡ 2.00') && cash() === c0 + 2_00, out);
  const worth = F.bag(db, G, ANA.id).reduce((t, r) => t + r.value * r.qty, 0);
  c0 = cash();
  out = text(await go('sell'));
  assert.strictEqual(cash(), c0 + worth);
  assert.strictEqual(F.bagCount(db, G, ANA.id), 0);
  assert.ok(text(await go('sell')).includes('Nothing to sell'));

  // A full bag
  db.addItem(G, ANA.id, 'fish_perch', F.RULES.bagMax);
  assert.ok(text(await go()).includes('bag is full'));
  F.sell(db, G, ANA.id, 'all');

  // 200 fish: Plenty of Fish in the Sea
  A.set(ctxFor(), 'fish_caught', 199);
  random = seq(slot('bait', 1), 0);
  assert.ok(text(await go()).includes('Plenty of Fish'));

  // The inventory shows the catch
  assert.ok(text(await router.runCommand(require('../src/commands/inventory'), ctxFor(), {})).includes('🎣 Catch'));

  // The economy: fishing is a little earner, never a money printer
  const avg = (n) => { const ks = Object.keys(F.CATCH).filter((x) => F.CATCH[x].size === n); return ks.reduce((t, x) => t + F.CATCH[x].value, 0) / ks.length; };
  const ev = (w) => { let t = 0; const N = 40000; for (let i = 0; i < N; i++) { const r = F.cast(w); t += r.kind === 'wallet' ? r.cents : r.id ? F.CATCH[r.id].value : 0; } return t / N; };
  assert.ok(ev('bait') - F.RULES.bait < 15_00, 'bait');
  assert.ok(ev('bass') - avg(2) < 15_00, 'a medium fish as bait');
  assert.ok(ev('pike') < avg(3), 'a large fish as bait is a gamble');

  console.log('All fishing tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
