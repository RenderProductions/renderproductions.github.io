// The Fishy Deep (the fishing overhaul; fishing itself was NachoBellGrande1065's idea). Six places to fish, each
// with its own fish; rods that open them up; every catch with its own weight (and the odd giant); fish that bite
// by time of day and weather; daily prices; the Fishdex, server records and trophies; treasure and messages in
// bottles. Real fish live in the fish bag (table fish_bag, one row per fish with its weight); junk stays in the
// inventory as fish_<id> (it composts). Reeling in, the tournament and Chuck Alfrey's shop are in their own files.
import type { Db } from '../core/db';
import { polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { dayKey, MINUTE } from '../core/time';

export const FISHING = { cooldownMs: 3 * MINUTE, bait: polygons(5), lureCasts: 25, bagMax: 50, coolerMax: 100, giantChance: 0.01, giant: [4, 12] as [number, number], wormsPerJunk: 2 };

export type Place = 'lake' | 'river' | 'pier' | 'deep' | 'sewer' | 'ice';
export type Size = 0 | 1 | 2 | 3 | 4;
export type When = 'any' | 'night' | 'morning' | 'day';
export interface Species { id: string; emoji: string; name: string; place: Place | 'any'; size: Size; lb: [number, number]; value: number; when: When; strength: number; /** Only during an event (not part of the Fishdex). */ event?: boolean }

const sp = (id: string, emoji: string, name: string, place: Species['place'], size: Size, lb: [number, number], value: number, when: When = 'any', strength: number = size === 4 ? 5 : size): Species =>
  ({ id, emoji, name, place, size, lb, value, when, strength });
/** Every catch. `value` is Polygons at the middle of its weight range; heavier is worth more. Junk has no weight. */
export const SPECIES: Record<string, Species> = Object.fromEntries([
  // junk: anywhere (it composts into Fertilizer and worms)
  sp('boot', '🥾', 'Soggy Boot', 'any', 0, [0, 0], 2), sp('can', '🥫', 'Rusty Can', 'any', 0, [0, 0], 1), sp('tire', '🛞', 'Old Tire', 'any', 0, [0, 0], 4),
  sp('controller', '🎮', 'Waterlogged Controller', 'any', 0, [0, 0], 8),
  // the Lake
  sp('minnow', '🐟', 'Minnow', 'lake', 1, [0.05, 0.2], 6), sp('bluegill', '🐟', 'Bluegill', 'lake', 1, [0.3, 1.2], 9), sp('perch', '🐟', 'Perch', 'lake', 1, [0.3, 1.5], 12),
  sp('bass', '🐠', 'Largemouth Bass', 'lake', 2, [1, 8], 25), sp('catfish', '🐠', 'Catfish', 'lake', 2, [2, 25], 40, 'night'),
  sp('pike', '🦈', 'Northern Pike', 'lake', 3, [4, 20], 80), sp('koi', '✨', 'Golden Polygon Koi', 'lake', 4, [5, 15], 1000),
  // the River
  sp('shiner', '🐟', 'Golden Shiner', 'river', 1, [0.1, 0.4], 7), sp('trout', '🐠', 'Rainbow Trout', 'river', 2, [1, 6], 30, 'morning'),
  sp('smallmouth', '🐠', 'Smallmouth Bass', 'river', 2, [1, 5], 28), sp('walleye', '🐠', 'Walleye', 'river', 2, [2, 10], 45, 'night'),
  sp('salmon', '🦈', 'King Salmon', 'river', 3, [8, 40], 110, 'morning'), sp('sturgeon', '🦈', 'Lake Sturgeon', 'river', 3, [20, 150], 160),
  sp('gar', '🐊', 'The River King', 'river', 4, [80, 200], 1100),
  // the Pier (the ocean)
  sp('sardine', '🐟', 'Sardine', 'pier', 1, [0.1, 0.4], 8), sp('mackerel', '🐟', 'Mackerel', 'pier', 1, [0.5, 2.5], 14), sp('snapper', '🐠', 'Red Snapper', 'pier', 2, [2, 15], 45),
  sp('tuna', '🐟', 'Bluefin Tuna', 'pier', 3, [30, 250], 220), sp('swordfish', '🗡️', 'Swordfish', 'pier', 3, [50, 400], 300),
  sp('hammerhead', '🦈', 'Hammerhead Shark', 'pier', 4, [200, 700], 1600),
  // the Deep (by Boat)
  sp('anglerfish', '🏮', 'Anglerfish', 'deep', 2, [1, 10], 120, 'night'), sp('oarfish', '🐉', 'Oarfish', 'deep', 3, [30, 300], 400),
  sp('squid', '🦑', 'Giant Squid', 'deep', 4, [200, 600], 1800), sp('whale', '🐋', 'White Whale', 'deep', 4, [20_000, 40_000], 2500, 'any', 5.25),
  // the Sewer
  sp('sludge', '🐟', 'Sludge Minnow', 'sewer', 1, [0.05, 0.3], 4), sp('carp', '🐠', 'Three-Eyed Carp', 'sewer', 2, [2, 20], 35),
  sp('eel', '🐍', 'Glowing Eel', 'sewer', 2, [1, 8], 50, 'night'), sp('gator', '🐊', 'Sewer Gator', 'sewer', 4, [50, 300], 1200),
  // Ice fishing (December)
  sp('cisco', '🐟', 'Cisco', 'ice', 1, [0.2, 1], 10), sp('whitefish', '🐟', 'Frozen Whitefish', 'ice', 1, [0.5, 3], 15),
  sp('char', '🐠', 'Arctic Char', 'ice', 2, [2, 10], 50), sp('polarkoi', '❄️', 'Polar Koi', 'ice', 4, [5, 15], 1400),
  // Birthdays only, anywhere (Chuck's Party Fish)
  { ...sp('partyfish', '🎉', 'Party Fish', 'any', 2, [1, 6], 150), event: true }
].map((s) => [s.id, s]));
/** The old name, for anything that still says CATCH. */
export const CATCH = SPECIES;

export const SIZE_NAMES = ['Junk', 'Small', 'Medium', 'Large', 'Legendary'];
export const itemId = (id: string): string => `fish_${id}`;
/** Junk lives in the inventory (fish_boot…); real fish live in the bag. */
export const isJunk = (id: string): boolean => SPECIES[id]?.size === 0;
export const isCatch = (item: string): boolean => item.startsWith('fish_') && !!SPECIES[item.slice(5)];

export interface PlaceInfo { id: Place; name: string; emoji: string; desc: string; needs: string; dexReward: Cents }
export const PLACES: Record<Place, PlaceInfo> = {
  lake: { id: 'lake', name: 'The Lake', emoji: '🏞️', desc: 'Calm water and the classics.', needs: 'Any rod', dexReward: polygons(1000) },
  river: { id: 'river', name: 'The River', emoji: '🌊', desc: 'Fast water. The salmon run in the morning.', needs: 'A Fiberglass Rod or better', dexReward: polygons(2500) },
  pier: { id: 'pier', name: 'The Pier', emoji: '⚓', desc: 'The ocean: tuna, swordfish and sharks.', needs: 'A Carbon Rod or better, or your own Lighthouse', dexReward: polygons(5000) },
  deep: { id: 'deep', name: 'The Deep', emoji: '🛥️', desc: 'Way out past the pier. Things live down there.', needs: 'A Boat', dexReward: polygons(10_000) },
  sewer: { id: 'sewer', name: 'The Sewer', emoji: '🕳️', desc: 'Nobody should fish here. Every cast adds Heat.', needs: 'Any rod', dexReward: polygons(2500) },
  ice: { id: 'ice', name: 'Ice Fishing', emoji: '🧊', desc: 'A hole in the frozen lake. December only.', needs: 'Any rod, in December', dexReward: polygons(5000) }
};
export const speciesAt = (place: Place): Species[] => Object.values(SPECIES).filter((s) => s.place === place);

/** Rods, best last. The Bamboo Rod is Marquez's old Fishing Rod (item id rod). */
export const RODS = [
  { id: 'rod', name: 'Bamboo Rod', tier: 0, tension: 100 },
  { id: 'rod_fiberglass', name: 'Fiberglass Rod', tier: 1, tension: 110 },
  { id: 'rod_carbon', name: 'Carbon Rod', tier: 2, tension: 120 },
  { id: 'rod_polygon', name: 'Polygon Rod', tier: 3, tension: 135 }
];

type Outcome = 'nothing' | 'snag' | 'junk' | 'wallet' | 'chest' | 'bottle' | '1' | '2' | '3' | '4';
/** A cast's odds before the bait, the rod, the hour and the weather. */
const BASE: Record<Place, Record<Outcome, number>> = {
  lake: { nothing: 24, snag: 10, junk: 22, wallet: 4, chest: 0.6, bottle: 0.8, 1: 26, 2: 11, 3: 2.8, 4: 0.2 },
  river: { nothing: 24, snag: 14, junk: 14, wallet: 3, chest: 0.6, bottle: 0.8, 1: 22, 2: 18, 3: 4.5, 4: 0.25 },
  pier: { nothing: 26, snag: 10, junk: 14, wallet: 3, chest: 1, bottle: 1.2, 1: 22, 2: 16, 3: 7, 4: 0.3 },
  deep: { nothing: 34, snag: 12, junk: 6, wallet: 0, chest: 2, bottle: 1.5, 1: 0, 2: 26, 3: 16, 4: 1.2 },
  sewer: { nothing: 18, snag: 10, junk: 38, wallet: 6, chest: 0.5, bottle: 0.5, 1: 16, 2: 9, 3: 0, 4: 0.4 },
  ice: { nothing: 30, snag: 6, junk: 8, wallet: 2, chest: 0.6, bottle: 1, 1: 32, 2: 16, 3: 0, 4: 0.4 }
};

/** What you cast with: plain bait, a Lure, a worm, a carrot, or a fish from your bag (its size). */
export type Bait = 'bait' | 'lure' | 'worm' | 'carrot' | 1 | 2 | 3;
export interface Conditions { rodTier: number; hour: number; rain: boolean; storm: boolean; luck: number }

export function odds(place: Place, bait: Bait, c: Conditions): Record<Outcome, number> {
  const t: Record<Outcome, number> = { ...BASE[place] };
  const boost = (k: Outcome, f: number) => { t[k] *= f; };
  if (bait === 'lure') { boost('junk', 0.7); boost('2', 1.5); boost('3', 2.3); boost('4', 2.5); }
  if (bait === 'worm' || bait === 'carrot') { boost('nothing', 0.75); boost('1', 1.2); boost('2', 1.35); }
  if (bait === 1) { boost('junk', 0.5); boost('1', 0.6); boost('2', 2.2); boost('3', 2.3); boost('4', 2.5); }
  if (bait === 2) { boost('junk', 0.4); boost('1', 0.3); boost('2', 1.8); boost('3', 5); boost('4', 5); }
  if (bait === 3) { boost('junk', 0.25); boost('1', 0); boost('2', 0.5); boost('3', 12); boost('4', 20); }
  // better rods: fewer empty casts, bigger fish
  boost('nothing', 1 - 0.08 * c.rodTier); boost('3', 1 + 0.25 * c.rodTier); boost('4', 1 + 0.35 * c.rodTier);
  if (c.rain) { boost('nothing', 0.7); boost('2', 1.2); }
  if (c.storm) { boost('3', 1.5); boost('4', 3); boost('snag', 1.4); }
  if (c.luck > 0) { boost('nothing', 1 - c.luck); boost('2', 1 + c.luck); boost('3', 1 + 2 * c.luck); boost('4', 1 + 2 * c.luck); }   // the mayor's public work
  for (const k of ['1', '2', '3', '4'] as Outcome[]) if (!speciesAt(place).some((s) => String(s.size) === k)) t[k] = 0;
  return t;
}

export const partOfDay = (hour: number): Exclude<When, 'any'> => (hour >= 20 || hour < 5 ? 'night' : hour < 10 ? 'morning' : 'day');

export type CastResult =
  | { kind: 'nothing' } | { kind: 'snag' } | { kind: 'wallet'; cents: Cents } | { kind: 'chest' } | { kind: 'bottle' }
  | { kind: 'junk'; id: string } | { kind: 'fish'; id: string; lb: number; giant: boolean };

/** One cast. */
export function cast(place: Place, bait: Bait, c: Conditions, rng: Rng): CastResult {
  const k = rng.pickWeighted(Object.entries(odds(place, bait, c)) as [Outcome, number][]);
  if (k === 'nothing' || k === 'snag' || k === 'chest' || k === 'bottle') return { kind: k };
  if (k === 'wallet') return { kind: 'wallet', cents: polygons(rng.int(20, 80)) };
  if (k === 'junk') return { kind: 'junk', id: rng.pick(Object.values(SPECIES).filter((s) => s.size === 0)).id };
  const size = Number(k) as Size;
  const part = partOfDay(c.hour);
  const pool = speciesAt(place).filter((s) => s.size === size);
  const f = rng.pickWeighted(pool.map((s) => [s, s.when === 'any' || s.when === 'day' ? 1 : s.when === part ? 3 : 0.25] as [Species, number]));
  return { kind: 'fish', id: f.id, ...rollWeight(f, rng) };
}

/** A weight in the species' range, leaning to the middle; 1 in 100 is a giant. */
export function rollWeight(f: Species, rng: Rng): { lb: number; giant: boolean } {
  const [lo, hi] = f.lb;
  const t = (rng.next() + rng.next()) / 2;
  const giant = f.size >= 1 && f.size <= 3 && rng.chance(FISHING.giantChance);
  const lb = (lo + (hi - lo) * t) * (giant ? FISHING.giant[0] + rng.next() * (FISHING.giant[1] - FISHING.giant[0]) : 1);
  return { lb: Math.round(lb * 100) / 100, giant };
}
/** What a fish is worth at its weight (before the day's price). Junk is flat. */
export function worth(f: Species, lb: number): Cents {
  if (f.size === 0) return polygons(f.value);
  const mid = (f.lb[0] + f.lb[1]) / 2;
  return Math.max(1, Math.round(polygons(f.value) * (lb / mid) ** 0.8));
}
export const fmtLb = (lb: number): string => (lb >= 100 ? `${Math.round(lb).toLocaleString('en-US')} lb` : `${lb.toFixed(lb < 1 ? 2 : 1)} lb`);

/** Today's price for a species, 80–120%, the same for everyone (like crops). */
export function dailyPrice(id: string, now = Date.now()): number {
  let h = 2166136261;
  for (const ch of `${id}:${dayKey(now)}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return 0.8 + ((h >>> 0) % 4001) / 10_000;
}

// ---------------------------------------------------------------- the bag

export interface BagFish { id: number; guild_id: string; user_id: string; species: string; lb: number; value: number; caught_at: number }
export const bagOf = (db: Db, g: string, u: string): BagFish[] => db.all<BagFish>('SELECT * FROM fish_bag WHERE guild_id = ? AND user_id = ? ORDER BY value DESC, id', g, u);
export const bagCount = (db: Db, g: string, u: string): number => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM fish_bag WHERE guild_id = ? AND user_id = ?', g, u)!.n;
export function addToBag(db: Db, g: string, u: string, species: string, lb: number, now: number): BagFish {
  const id = db.run('INSERT INTO fish_bag (guild_id, user_id, species, lb, value, caught_at) VALUES (?, ?, ?, ?, ?, ?)', g, u, species, lb, worth(SPECIES[species]!, lb), now).lastInsertRowid;
  return db.get<BagFish>('SELECT * FROM fish_bag WHERE id = ?', id)!;
}
export const takeFromBag = (db: Db, id: number): void => { db.run('DELETE FROM fish_bag WHERE id = ?', id); };
