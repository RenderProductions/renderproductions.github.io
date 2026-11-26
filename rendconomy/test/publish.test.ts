import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PUBLISH, takeSlot } from '../src/discord/publish';

test('publishing keeps under Discord\'s 10 an hour per channel', () => {
  const book = new Map<string, number[]>();
  const t0 = 1_000_000;
  for (let i = 0; i < PUBLISH.perHour; i++) assert.equal(takeSlot('news', t0 + i, book), true);
  assert.equal(takeSlot('news', t0 + 100, book), false, 'over the hourly allowance');
  assert.equal(takeSlot('updates', t0 + 100, book), true, 'each channel has its own allowance');
  assert.equal(takeSlot('news', t0 + PUBLISH.windowMs + 1, book), true, 'a slot frees up an hour later');
  assert.ok(PUBLISH.perHour < 10);
});
