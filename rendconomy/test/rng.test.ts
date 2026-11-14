import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cryptoRng, seededRng } from '../src/core/rng';

test('a seed replays the same luck', () => {
  const a = seededRng(42), b = seededRng(42);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('ranges and weights behave', () => {
  const rng = seededRng(7);
  const counts = { fish: 0, boot: 0 };
  for (let i = 0; i < 10_000; i++) {
    const n = rng.int(1, 6);
    assert.ok(n >= 1 && n <= 6 && Number.isInteger(n));
    counts[rng.pickWeighted([['fish', 70], ['boot', 30]] as const)]++;
  }
  assert.ok(counts.fish > 6700 && counts.fish < 7300, `about 70% fish, got ${counts.fish}`);
  assert.equal(rng.chance(0), false);
  assert.equal(rng.chance(1), true);
  assert.deepEqual(rng.shuffle([1, 2, 3, 4]).sort(), [1, 2, 3, 4]);
});

test('live randomness stays in range', () => {
  const rng = cryptoRng();
  for (let i = 0; i < 1000; i++) { const x = rng.next(); assert.ok(x >= 0 && x < 1); }
});
