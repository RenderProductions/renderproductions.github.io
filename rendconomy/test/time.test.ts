import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDaily, cooldown, dayKey, duration, nextReset, previousDay, startCooldown, takeCooldown, MINUTE } from '../src/core/time';
import { eastern, freshDb } from './helpers';

test('the day follows Eastern time, not UTC', () => {
  assert.equal(dayKey(eastern('2026-11-13T23:59', -5)), '2026-11-13');
  assert.equal(dayKey(eastern('2026-11-14T00:00', -5)), '2026-11-14');
  assert.equal(dayKey(Date.parse('2026-11-14T03:00:00Z')), '2026-11-13', '10 PM Eastern is still the 13th');
  assert.equal(previousDay('2026-03-01'), '2026-02-28');
  assert.equal(previousDay('2027-01-01'), '2026-12-31');
});

test('the reset is midnight Eastern, through daylight saving', () => {
  assert.equal(nextReset(eastern('2026-11-13T22:15', -5)), Date.parse('2026-11-14T05:00:00Z'), 'winter: 05:00 UTC');
  assert.equal(nextReset(eastern('2026-07-04T12:00', -4)), Date.parse('2026-07-05T04:00:00Z'), 'summer: 04:00 UTC');
  assert.equal(nextReset(eastern('2026-03-07T20:00', -5)), Date.parse('2026-03-08T05:00:00Z'), 'night before clocks spring forward');
  assert.equal(nextReset(eastern('2026-10-31T20:00', -4)), Date.parse('2026-11-01T04:00:00Z'), 'night before clocks fall back');
  assert.equal(nextReset(eastern('2026-11-14T00:00', -5)), Date.parse('2026-11-15T05:00:00Z'), 'right at midnight: the next one');
});

test('dailies: once per Eastern day, streaks count yesterday', () => {
  const late = eastern('2026-11-13T23:59', -5);
  const first = checkDaily(null, 0, late);
  assert.deepEqual([first.ready, first.streak], [true, 1]);

  assert.equal(checkDaily('2026-11-13', 1, late).ready, false, 'already claimed today');
  const afterMidnight = checkDaily('2026-11-13', 1, eastern('2026-11-14T00:00', -5));
  assert.deepEqual([afterMidnight.ready, afterMidnight.streak], [true, 2], 'a minute later is a new day, and the streak continues');

  const missed = checkDaily('2026-11-12', 7, eastern('2026-11-14T09:00', -5));
  assert.deepEqual([missed.ready, missed.streak], [true, 1], 'skipping a day resets the streak');
});

test('cooldowns are stored and two clicks at once only get one through', () => {
  const db = freshDb();
  const now = 1_000_000;
  assert.equal(cooldown(db, 'work', 'g:a', now).ready, true);
  assert.equal(takeCooldown(db, 'work', 'g:a', 15 * MINUTE, now), true);
  assert.equal(takeCooldown(db, 'work', 'g:a', 15 * MINUTE, now), false, 'the second click is refused');
  assert.equal(cooldown(db, 'work', 'g:a', now + 5 * MINUTE).remaining, 10 * MINUTE);
  assert.equal(takeCooldown(db, 'work', 'g:a', 15 * MINUTE, now + 15 * MINUTE), true, 'it opens again when it ends');
  startCooldown(db, 'heist', 'g:a', MINUTE, now);
  assert.equal(cooldown(db, 'heist', 'g:b', now).ready, true, 'per subject');
});

test('durations read naturally', () => {
  assert.equal(duration(45_000), '45s');
  assert.equal(duration(14 * MINUTE + 1000), '14m 1s');
  assert.equal(duration(3 * 60 * MINUTE + 12 * MINUTE), '3h 12m');
});
