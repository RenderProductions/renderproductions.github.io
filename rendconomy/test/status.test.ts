import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { addMoment, clearMoments, takeMoment } from '../src/core/moments';
import { happenings, nextStatus } from '../src/discord/status';
import { startEvent } from '../src/events/world';
import { award } from '../src/achievements/achievements';

const now = Date.UTC(2026, 10, 16, 18);

test('status: a fresh big moment comes first, once, then what\'s happening', () => {
  const db = freshDb(); clearMoments();
  addMoment('🎰 Someone just won ⬡12.4K on Slots', now);
  assert.equal(nextStatus(db, now, 3), '🎰 Someone just won ⬡12.4K on Slots');
  const next = nextStatus(db, now + 1000, 3);
  assert.notEqual(next, '🎰 Someone just won ⬡12.4K on Slots', 'shown once');
  addMoment('old news', now);
  assert.equal(takeMoment(now + 11 * 60_000), null, 'stale moments are skipped');
});

test('status: the world event, the Reserve and the server count; the console still overrides', () => {
  const db = freshDb(); clearMoments();
  startEvent(db, 'fish_frenzy', undefined, now);
  const list = happenings(db, now, 1);
  assert.match(list[0]!, /^🎣 Fish Frenzy: The fish are biting\./);
  assert.ok(!list[0]!.includes('**'), 'no markdown');
  assert.ok(list.some((l) => /The Reserve holds ⬡/.test(l)));
  assert.ok(list.includes('👀 Watching 1 server · r!help'));
  assert.ok(list.every((l) => l.length <= 128));
  clearMoments();
  db.setMeta('status.custom', 'Down for snacks');
  assert.equal(nextStatus(db, now, 1), 'Down for snacks');
});

test('status: big moments never name the player', () => {
  const db = freshDb(); clearMoments();
  award(db, 'g1', '111111111111111111', 'millionaire', now);
  const m = takeMoment(now);
  assert.equal(m?.text, '💰 We just got a new millionaire');
});
