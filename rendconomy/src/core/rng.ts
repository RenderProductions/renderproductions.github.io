// The one source of luck. Every game, drop and event draws from an Rng, so tests can pass a seeded one
// and replay exactly what happened. In the live bot it's backed by crypto-strength randomness.
import { randomInt } from 'node:crypto';

export interface Rng {
  /** A number in [0, 1). */
  next(): number;
  /** A whole number from min to max, both included. */
  int(min: number, max: number): number;
  /** True with probability p (0 to 1). */
  chance(p: number): boolean;
  /** One item from a list. */
  pick<T>(items: readonly T[]): T;
  /** One item, chosen by weight: pickWeighted([['fish', 70], ['boot', 30]]). */
  pickWeighted<T>(items: readonly (readonly [T, number])[]): T;
  /** A shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
}

function build(next: () => number): Rng {
  const rng: Rng = {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) throw new Error(`Bad range ${min}..${max}`);
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) { return p >= 1 ? true : p <= 0 ? false : next() < p; },
    pick(items) {
      if (items.length === 0) throw new Error('Cannot pick from an empty list');
      return items[Math.floor(next() * items.length)]!;
    },
    pickWeighted(items) {
      const total = items.reduce((s, [, w]) => s + Math.max(0, w), 0);
      if (total <= 0) throw new Error('Weights must add up to more than zero');
      let roll = next() * total;
      for (const [item, w] of items) {
        roll -= Math.max(0, w);
        if (roll < 0) return item;
      }
      return items[items.length - 1]![0];
    },
    shuffle(items) {
      const a = [...items];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    }
  };
  return rng;
}

/** Live randomness (crypto). */
export function cryptoRng(): Rng {
  const RANGE = 2 ** 48 - 1; // randomInt's largest allowed range
  return build(() => randomInt(0, RANGE) / RANGE);
}

/** Repeatable randomness for tests and replays (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return build(() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  });
}
