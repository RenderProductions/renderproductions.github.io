import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, eastern } from './helpers';
import { commands, find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, RESERVE, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute, parsePrefix, slashBody } from '../src/discord/router';

const G = 'guild1';
const db = freshDb();
const config = { ...botConfig(), prefix: 'r!' };

function ctx(userId: string, now: number, guildId: string | null = G): Ctx {
  return { db, config, rng: seededRng(1), now, guildId, user: { id: userId, name: userId }, isOwner: false, notes: [] };
}
async function run(line: string, userId = 'alice', now = eastern('2026-11-13T22:00', -5), guildId: string | null = G): Promise<ReplyObject> {
  const p = parsePrefix(line, 'r!');
  if (!p || 'unknown' in p) throw new Error(`not a command: ${line}`);
  return execute(p.cmd, ctx(userId, now, guildId), p.args);
}
const text = (r: ReplyObject) => [r.content ?? '', ...(r.embeds ?? []).flatMap((e) => [e.title ?? '', e.description ?? '', e.footer?.text ?? ''])].join('\n');

test('the first command opens an account with 500 Polygons', async () => {
  const r = await run('r!bal');
  assert.match(text(r), /⬡500\.00/);
  assert.match(text(r), /Account opened/);
  assert.doesNotMatch(text(await run('r!balance')), /Account opened/, 'only the first time');
});

test('daily pays 250 once per Eastern day, and streaks count yesterday', async () => {
  const night = eastern('2026-11-13T23:59', -5);
  assert.match(text(await run('r!daily', 'alice', night)), /⬡250\.00 has been deposited[\s\S]*⬡750\.00[\s\S]*Streak: 1 day/);
  const again = await run('r!daily', 'alice', night);
  assert.equal(again.ephemeral, true);
  assert.match(text(again), /already been collected/);
  assert.equal(balance(db, wallet(G, 'alice')), polygons(750), 'no second payout');

  assert.match(text(await run('r!daily', 'alice', eastern('2026-11-14T00:00', -5))), /Streak: 2 days/, 'midnight is a new day');
  assert.match(text(await run('r!daily', 'alice', eastern('2026-11-16T12:00', -5))), /Streak: 1 day/, 'a missed day resets it');
  assert.ok(audit(db).ok);
});

test('balance of another player, and of someone with no account', async () => {
  await run('r!daily', '222222222222222222');
  assert.match(text(await run('r!bal <@222222222222222222>')), /⬡750\.00/);
  assert.match(text(await run('r!bal <@333333333333333333>')), /no account in this server/);
});

test('history shows where the money came from, privately', async () => {
  const r = await run('r!history');
  assert.equal(r.ephemeral, true);
  assert.match(text(r), /\+⬡250\.00 · Daily allowance/);
  assert.match(text(r), /\+⬡500\.00 · Starting balance/);
});

test('reserve shows what the house has left', async () => {
  const left = balance(db, RESERVE);
  assert.ok(left < polygons(25_000_000));
  assert.match(text(await run('r!reserve')), /The Polygon Reserve/);
});

test('server-only commands are refused in DMs', async () => {
  assert.match(text(await run('r!daily', 'alice', Date.now(), null)), /only available in a server/);
  assert.match(text(await run('r!ping', 'alice', Date.now(), null)), /Online/);
});

test('help lists every command', async () => {
  const t = text(await run('r!help'));
  for (const c of commands) assert.ok(t.includes(`/${c.name}`), `help is missing ${c.name}`);
});

test('prefix parsing', () => {
  assert.equal(parsePrefix('hello', 'r!'), null);
  assert.deepEqual(parsePrefix('r!nope', 'r!'), { unknown: 'nope' });
  const p = parsePrefix('R!BAL <@!123456789012345678>', 'r!');
  assert.ok(p && 'cmd' in p);
  assert.equal(p.cmd.name, 'balance');
  assert.equal(p.args.player, '123456789012345678');
  assert.equal(find('tx')?.name, 'history');
});

test('slash definitions are valid for Discord', () => {
  const body = slashBody();
  assert.equal(body.length, commands.length);
  for (const c of body) {
    assert.match(c.name, /^[a-z0-9_-]{1,32}$/);
    assert.ok(c.description.length > 0 && c.description.length <= 100);
  }
  const names = new Set<string>();
  for (const c of commands) for (const n of [c.name, ...(c.aliases ?? [])]) {
    assert.ok(!names.has(n), `duplicate command name or alias: ${n}`);
    names.add(n);
  }
});
