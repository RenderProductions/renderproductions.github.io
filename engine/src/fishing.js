// Fishing (NachoBellGrande1065's idea): an early-game way to make Polygons.
// You need a Fishing Rod from Marquez. Every cast costs a little for bait, unless you have a Lure on
// (no bait needed for 25 casts, and bigger fish bite more). A cast can catch nothing, snag the line,
// pull up junk, find a lost wallet, or land a fish. Fish and junk go in your bag; sell them to Marquez.
// Use a small fish as bait and the big ones come out to play.
const reserve = require('./reserve');

const RULES = {
  cooldownMs: 3 * 60 * 1000,
  bait: 5_00,        // per cast without a lure
  lureCasts: 25,
  bagMax: 50         // how many catches you can carry before you have to sell
};

// size: 0 junk, 1 small, 2 medium, 3 large, 4 legendary. value in cents (what Marquez pays)
const CATCH = {
  boot:      { emoji: '🥾', name: 'Soggy Boot',        size: 0, value: 2_00 },
  can:       { emoji: '🥫', name: 'Rusty Can',         size: 0, value: 1_00 },
  tire:      { emoji: '🛞', name: 'Old Tire',          size: 0, value: 4_00 },
  controller:{ emoji: '🎮', name: 'Waterlogged Controller', size: 0, value: 8_00 },
  minnow:    { emoji: '🐟', name: 'Minnow',            size: 1, value: 6_00 },
  bluegill:  { emoji: '🐟', name: 'Bluegill',          size: 1, value: 9_00 },
  perch:     { emoji: '🐟', name: 'Perch',             size: 1, value: 12_00 },
  bass:      { emoji: '🐠', name: 'Largemouth Bass',   size: 2, value: 25_00 },
  trout:     { emoji: '🐠', name: 'Rainbow Trout',     size: 2, value: 30_00 },
  catfish:   { emoji: '🐠', name: 'Catfish',           size: 2, value: 40_00 },
  pike:      { emoji: '🦈', name: 'Northern Pike',     size: 3, value: 80_00 },
  salmon:    { emoji: '🦈', name: 'King Salmon',       size: 3, value: 110_00 },
  sturgeon:  { emoji: '🦈', name: 'Lake Sturgeon',     size: 3, value: 160_00 },
  koi:       { emoji: '✨', name: 'Golden Polygon Koi', size: 4, value: 1000_00 },
  whale:     { emoji: '🐋', name: 'White Whale',       size: 4, value: 1500_00 }
};
const SIZE = ['Junk', 'Small', 'Medium', 'Large', 'Legendary'];
const BY_SIZE = (n) => Object.keys(CATCH).filter((k) => CATCH[k].size === n);
const item = (id) => `fish_${id}`;
const isCatch = (itemId) => !!itemId && itemId.startsWith('fish_') && !!CATCH[itemId.slice(5)];

// What a cast can do, as weights. Bait: plain bait. lure: a Lure. 1/2/3: a small/medium/large fish as bait.
const TABLES = {
  bait:  { nothing: 24, snag: 10, junk: 22, wallet: 4, 1: 26, 2: 11, 3: 2.8, 4: 0.2 },
  lure:  { nothing: 20, snag: 10, junk: 16, wallet: 4, 1: 26, 2: 17, 3: 6.5, 4: 0.5 },
  // A fish as bait: usually worth a bit more than the fish you gave up. A large one is a gamble for the Koi.
  1:     { nothing: 30, snag: 12, junk: 10, wallet: 1, 1: 15, 2: 25, 3: 6.5, 4: 0.5 },
  2:     { nothing: 32, snag: 14, junk: 8, wallet: 1, 1: 8, 2: 20, 3: 16, 4: 1 },
  3:     { nothing: 30, snag: 15, junk: 5, wallet: 0, 1: 0, 2: 6, 3: 40, 4: 4 }
};

function roll(table, random = Math.random) {
  const t = TABLES[table];
  const total = Object.values(t).reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (const [k, w] of Object.entries(t)) { if ((r -= w) < 0) return k; }
  return 'nothing';
}

// Does one cast. with: 'bait' | 'lure' | a fish id from the bag used as bait.
// Returns { kind: 'nothing'|'snag'|'junk'|'wallet'|'fish', id?, cents? }
function cast(with_, random = Math.random) {
  const table = with_ === 'bait' || with_ === 'lure' ? with_ : CATCH[with_] ? String(Math.min(3, Math.max(1, CATCH[with_].size))) : 'bait';
  const k = roll(table, random);
  if (k === 'nothing' || k === 'snag') return { kind: k };
  if (k === 'wallet') return { kind: 'wallet', cents: (20 + Math.floor(random() * 61)) * 100 };
  const size = k === 'junk' ? 0 : Number(k);
  const pool = BY_SIZE(size);
  const id = pool[Math.floor(random() * pool.length)];
  return { kind: size === 0 ? 'junk' : 'fish', id };
}

const bag = (db, guildId, userId) => db.inventory(guildId, userId).filter((r) => isCatch(r.item)).map((r) => ({ ...r, id: r.item.slice(5), ...CATCH[r.item.slice(5)] }));
const bagCount = (db, guildId, userId) => bag(db, guildId, userId).reduce((t, r) => t + r.qty, 0);

// Sells catches to Marquez. which: 'all' | 'junk' | a catch id. Returns { count, cents }
function sell(db, guildId, userId, which = 'all') {
  const rows = bag(db, guildId, userId).filter((r) => which === 'all' || (which === 'junk' ? r.size === 0 : r.id === which));
  if (!rows.length) return { count: 0, cents: 0 };
  return db.tx(() => {
    let count = 0, cents = 0;
    for (const r of rows) { db.addItem(guildId, userId, r.item, -r.qty); count += r.qty; cents += r.value * r.qty; }
    const got = reserve.pay(db, cents); // Marquez pays out of the reserve, like any payout
    db.addCash(guildId, userId, got);
    return { count, cents: got };
  });
}

module.exports = { RULES, CATCH, SIZE, TABLES, item, isCatch, roll, cast, bag, bagCount, sell };
