import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { ROLE_METADATA, roleStats } from '../src/site/roles';
import { player } from '../src/core/economy';
import { transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { award } from '../src/achievements/achievements';
import { newLot, saveLot } from '../src/estate/estate';

const A = '111111111111111111', t0 = Date.UTC(2026, 10, 9), t1 = Date.UTC(2026, 10, 14);

test('Linked Roles: five stats, each the player\'s best across servers', () => {
  assert.equal(ROLE_METADATA.length, 5, 'Discord allows at most five');
  assert.ok(ROLE_METADATA.every((m) => /^[a-z0-9_]{1,50}$/.test(m.key) && m.name.length <= 100 && m.description.length <= 200));
  const db = freshDb();
  player(db, 'g1', A, polygons(1000), t1);
  player(db, 'g2', A, polygons(1000), t0);
  transfer(db, { from: RESERVE, to: wallet('g2', A), cents: polygons(50_000), reason: 'mod.give' });
  award(db, 'g1', A, 'first_home', t1);
  for (const n of [1, 2, 3]) saveLot(db, newLot('g1', n, 'shack', A, t1, 0));
  saveLot(db, newLot('g2', 1, 'shack', A, t1, 0));
  const s = roleStats(db)[A]!;
  assert.ok(s.networth >= 51_000, 'the richer server');
  assert.ok(s.achievements >= 1);
  assert.equal(s.properties, 3, 'most lots in one server');
  assert.equal(s.company, 0);
  assert.equal(s.since, new Date(t0).toISOString(), 'the earliest server');
});
