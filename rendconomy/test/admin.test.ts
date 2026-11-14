import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig, economy } from '../src/config';
import { player } from '../src/core/economy';
import { audit, balance, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { execute, press } from '../src/discord/router';

const G = 'g1';
const P1 = '111111111111111111', P2 = '222222222222222222', MOD = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

function setup() {
  const db = freshDb();
  player(db, G, P1, economy.startingCash);
  player(db, G, P2, economy.startingCash);
  const ctx = (user: string, role: 'player' | 'mod' | 'owner' = 'player'): Ctx => ({
    db, config: botConfig(), rng: seededRng(1), now: 1000, guildId: G, channelId: 'c', user: { id: user, name: user },
    isOwner: role === 'owner', isMod: role !== 'player', notes: []
  });
  const run = (name: string, args: Record<string, string>, user = MOD, role: 'player' | 'mod' | 'owner' = 'mod') => execute(find(name)!, ctx(user, role), args);
  return { db, ctx, run };
}

test('players cannot use moderator commands', async () => {
  const { run } = setup();
  assert.match(text(await run('give', { player: P1, amount: '100', reason: 'x' }, P2, 'player')), /restricted to moderators/);
  assert.match(text(await run('wipe', { scope: 'server' }, MOD, 'mod')), /restricted to the bot owner/);
});

test('give and take move money with the Reserve and need a reason', async () => {
  const { db, run } = setup();
  assert.match(text(await run('give', { player: P1, amount: '250' })), /A reason is required/);
  assert.match(text(await run('give', { player: P1, amount: '250', reason: 'event prize' })), /received \*\*⬡250\.00\*\*/);
  assert.equal(balance(db, wallet(G, P1)), polygons(750));
  assert.match(text(await run('take', { player: P1, amount: 'all', reason: 'exploit' })), /⬡750\.00/);
  assert.equal(balance(db, wallet(G, P1)), 0);
  assert.ok(audit(db).ok);
});

test('frozen accounts are refused', async () => {
  const { run } = setup();
  await run('freeze', { player: P1, reason: 'investigating' });
  assert.match(text(await run('daily', {}, P1, 'player')), /frozen/);
  await run('unfreeze', { player: P1, reason: 'cleared' });
  assert.match(text(await run('daily', {}, P1, 'player')), /Daily allowance/);
});

test('wipe asks first, then erases a player and returns their Polygons to the Reserve', async () => {
  const { db, run, ctx } = setup();
  const reserveBefore = balance(db, RESERVE);
  const r = await run('wipe', { scope: 'player', player: P1 }, MOD, 'owner');
  assert.match(text(r), /Confirm erasure/);
  assert.match(press(ctx(P2, 'mod'), sessions.buttonId(r.session!, 'yes')).notice!, /Only the bot owner/);
  const done = press(ctx(MOD, 'owner'), sessions.buttonId(r.session!, 'yes'));
  assert.match(text(done.update), /Erasure complete/);
  assert.equal(db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', G, P1), undefined);
  assert.equal(db.get('SELECT 1 FROM accounts WHERE id = ?', wallet(G, P1)), undefined);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger WHERE from_id = ? OR to_id = ?", wallet(G, P1), wallet(G, P1))!.n, 0);
  assert.equal(balance(db, RESERVE), reserveBefore + polygons(500));
  assert.equal(balance(db, wallet(G, P2)), polygons(500), 'other players untouched');
  assert.ok(audit(db).ok);
});

test('wipe server erases everyone there', async () => {
  const { db, run, ctx } = setup();
  const r = await run('wipe', { scope: 'server' }, MOD, 'owner');
  assert.match(text(press(ctx(MOD, 'owner'), sessions.buttonId(r.session!, 'yes')).update), /2 players/);
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players')!.n, 0);
  assert.ok(audit(db).ok);
});
