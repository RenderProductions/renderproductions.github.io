// Fishing (NachoBellGrande1065's idea): an early-game way to earn. Needs a Fishing Rod from Marquez.
// Each cast costs a little bait (to the Reserve) unless a Lure is on. A cast can catch nothing, snag,
// pull up junk, find a lost wallet, or land a fish. Catches go in the bag (the inventory, as fish_<id>)
// and sell to Marquez. A small fish used as bait brings the big ones out.
import { polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { MINUTE } from '../core/time';

export const FISHING = { cooldownMs: 3 * MINUTE, bait: polygons(5), lureCasts: 25, bagMax: 50 };

export interface Catch { emoji: string; name: string; size: 0 | 1 | 2 | 3 | 4; value: Cents }

const c = (emoji: string, name: string, size: Catch['size'], value: number): Catch => ({ emoji, name, size, value: polygons(value) });
export const CATCH: Record<string, Catch> = {
  boot: c('🥾', 'Soggy Boot', 0, 2), can: c('🥫', 'Rusty Can', 0, 1), tire: c('🛞', 'Old Tire', 0, 4), controller: c('🎮', 'Waterlogged Controller', 0, 8),
  minnow: c('🐟', 'Minnow', 1, 6), bluegill: c('🐟', 'Bluegill', 1, 9), perch: c('🐟', 'Perch', 1, 12),
  bass: c('🐠', 'Largemouth Bass', 2, 25), trout: c('🐠', 'Rainbow Trout', 2, 30), catfish: c('🐠', 'Catfish', 2, 40),
  pike: c('🦈', 'Northern Pike', 3, 80), salmon: c('🦈', 'King Salmon', 3, 110), sturgeon: c('🦈', 'Lake Sturgeon', 3, 160),
  koi: c('✨', 'Golden Polygon Koi', 4, 1000), whale: c('🐋', 'White Whale', 4, 1500)
};
export const SIZE_NAMES = ['Junk', 'Small', 'Medium', 'Large', 'Legendary'];
export const itemId = (id: string): string => `fish_${id}`;
export const isCatch = (item: string): boolean => item.startsWith('fish_') && !!CATCH[item.slice(5)];

type Outcome = 'nothing' | 'snag' | 'junk' | 'wallet' | '1' | '2' | '3' | '4';
/** What a cast can do, as weights. bait: plain bait. lure: a Lure. 1/2/3: a small/medium/large fish as bait. */
export const TABLES: Record<string, Record<Outcome, number>> = {
  bait: { nothing: 24, snag: 10, junk: 22, wallet: 4, 1: 26, 2: 11, 3: 2.8, 4: 0.2 },
  lure: { nothing: 20, snag: 10, junk: 16, wallet: 4, 1: 26, 2: 17, 3: 6.5, 4: 0.5 },
  1: { nothing: 30, snag: 12, junk: 10, wallet: 1, 1: 15, 2: 25, 3: 6.5, 4: 0.5 },
  2: { nothing: 32, snag: 14, junk: 8, wallet: 1, 1: 8, 2: 20, 3: 16, 4: 1 },
  3: { nothing: 30, snag: 15, junk: 5, wallet: 0, 1: 0, 2: 6, 3: 40, 4: 4 }
};

export type CastResult = { kind: 'nothing' } | { kind: 'snag' } | { kind: 'wallet'; cents: Cents } | { kind: 'junk'; id: string } | { kind: 'fish'; id: string };

/** One cast. `using`: 'bait', 'lure', or the id of a fish used as bait. */
export function cast(using: string, rng: Rng): CastResult {
  const table = using === 'bait' || using === 'lure' ? using : CATCH[using] ? String(Math.min(3, Math.max(1, CATCH[using]!.size))) : 'bait';
  const k = rng.pickWeighted(Object.entries(TABLES[table]!) as [Outcome, number][]);
  if (k === 'nothing') return { kind: 'nothing' };
  if (k === 'snag') return { kind: 'snag' };
  if (k === 'wallet') return { kind: 'wallet', cents: polygons(rng.int(20, 80)) };
  const size = k === 'junk' ? 0 : Number(k);
  const id = rng.pick(Object.keys(CATCH).filter((x) => CATCH[x]!.size === size));
  return size === 0 ? { kind: 'junk', id } : { kind: 'fish', id };
}
