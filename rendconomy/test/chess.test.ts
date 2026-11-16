import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { RESERVE, balance, transfer, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute } from '../src/discord/router';
import { CHESS, chessFinish, chessStatus } from '../src/games/chess';

const G = 'g1', A = '111111111111111111';
const text = (r: ReplyObject) => [r.content ?? '', ...(r.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

test('Iso-Chess: unlocks are one per player, and show up in the status', async () => {
  const db = freshDb();
  const ctx = (): Ctx => ({ db, config: botConfig(), rng: seededRng(2), now: Date.now(), guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] });
  await execute(find('balance')!, ctx(), {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  assert.deepEqual(chessStatus(db, G, A).owned, []);
  assert.match(text(await execute(find('purchase')!, ctx(), { item: 'chess_gambit' })), /Gambit/);
  assert.deepEqual(chessStatus(db, G, A).owned, ['chess_gambit']);
  assert.match(text(await execute(find('purchase')!, ctx(), { item: 'chess_gambit' })), /already have/);
});

test('Iso-Chess: runs pay once, are capped per day, and impossible runs pay nothing', async () => {
  const db = freshDb();
  const now = Date.now();
  await execute(find('balance')!, { db, config: botConfig(), rng: seededRng(2), now, guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] }, {});
  const w = wallet(G, A);
  const before = balance(db, w);
  const run = (o: object) => chessFinish(db, G, A, JSON.stringify(o), now);
  assert.match(run({ id: 'run1', b: 3, e: 1, x: 1, v: 0, t: 900 }), /paid you ⬡115\.00/);   // 3 battles, an elite and a boss: 30 + 25 + 60
  assert.equal(balance(db, w) - before, polygons(115));
  assert.match(run({ id: 'run1', b: 3, e: 1, x: 1, v: 0, t: 900 }), /already been paid/);
  assert.match(run({ id: 'run2', b: 40, e: 0, x: 0, v: 0, t: 9000 }), /didn't believe it/);
  assert.match(run({ id: 'run3', b: 2, e: 0, x: 0, v: 1, t: 900 }), /didn't believe it/, 'a victory needs all three bosses');
  assert.match(run({ id: 'run4', b: 5, e: 0, x: 0, v: 0, t: 10 }), /didn't believe it/, 'too fast');
  assert.match(run({ id: 'run5', b: 12, e: 3, x: 3, v: 1, t: 9000 }), /today's cap/);
  assert.equal(chessStatus(db, G, A, now).paid, CHESS.dailyCap / 100);
  assert.match(run({ id: 'run6', b: 1, e: 0, x: 0, v: 0, t: 900 }), /already earned today's/);
});
