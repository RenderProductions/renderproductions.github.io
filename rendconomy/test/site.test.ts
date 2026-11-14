import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { botConfig, economy } from '../src/config';
import { player } from '../src/core/economy';
import { seededRng } from '../src/core/rng';
import { award } from '../src/achievements/achievements';
import { tick } from '../src/market/market';
import { publish, siteFiles } from '../src/site/publish';

test('site files keep the formats the site reads', () => {
  const db = freshDb();
  const noon = eastern('2026-11-13T12:00', -5);
  tick(db, seededRng(2), noon);
  player(db, 'g1', 'u1', economy.startingCash);
  award(db, 'g1', 'u1', 'day_one');
  const f = siteFiles(db, { serverName: () => 'The Render Room' });
  const prices = JSON.parse(f['prices.json']!);
  assert.ok(prices.prices.RRM && prices.companies.length === 5 && prices.market.status);
  const pc = JSON.parse(f['player-companies.json']!);
  assert.equal(pc.reserve.start, 25_000_000);
  assert.equal(pc.bot.players, 1);
  const profiles = JSON.parse(f['profiles.json']!);
  assert.equal(profiles.users.u1.servers[0].server, 'The Render Room');
  assert.equal(profiles.users.u1.servers[0].worth, 750, '500 start + 250 Day One reward');
  assert.equal(profiles.users.u1.achievements[0][0], 'day_one');
  const hist = JSON.parse(f['history-7d.json']!);
  assert.equal(hist.hourly.RRM.length, 1);
});

test('publishing is off unless PUBLISH_SITE_DATA=1 and a token are set (the test bot never publishes)', async () => {
  const db = freshDb();
  assert.equal((await publish(db, { ...botConfig(), publish: false })), false);
});
