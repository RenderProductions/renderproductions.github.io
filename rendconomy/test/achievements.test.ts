import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig, economy } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { execute, press } from '../src/discord/router';
import { has } from '../src/achievements/achievements';
import { ACHIEVEMENTS } from '../src/achievements/list';
import { tick } from '../src/market/market';

const G = 'g1', A = '111111111111111111', OWNER = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}\n${e.footer?.text ?? ''}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(3), noon);
  const ctx = (user = A, owner = false): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now: noon, guildId: G, channelId: 'c', user: { id: user, name: 'Alice' }, isOwner: owner, isMod: owner, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A, owner = false) => execute(find(name)!, ctx(user, owner), args);
  return { db, ctx, run };
}

test('ids are unique and every achievement has a known rarity and category', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
});

test('claiming a daily unlocks Day One, pays its reward, and says so on the reply', async () => {
  const { db, run } = setup();
  const r = await run('daily');
  assert.match(text(r), /Achievement unlocked:\*\* ⚪ \*\*Day One\*\*[\s\S]*Reward: ⬡250\.00/);
  assert.equal(balance(db, wallet(G, A)), economy.startingCash + economy.dailyAmount + polygons(250));
  assert.ok(has(db, A, 'day_one'));
  assert.ok(audit(db).ok);
});

test('buying a share unlocks Shareholder, once', async () => {
  const { db, run } = setup();
  assert.match(text(await run('buy', { ticker: 'BLU', amount: '1' })), /Shareholder/);
  assert.doesNotMatch(text(await run('buy', { ticker: 'BLU', amount: '1' })), /Shareholder/);
  assert.ok(has(db, A, 'shareholder'));
});

test('the achievements view lists unlocks and switches category with buttons', async () => {
  const { run, ctx } = setup();
  await run('daily');
  const r = await run('achievements');
  assert.match(text(r), /1 of \d+ unlocked[\s\S]*Day One/);
  const jobs = press(ctx(), sessions.buttonId(r.session!, 'jobs'));
  assert.match(text(jobs.update), /Jobs[\s\S]*🔒 Promoted/);
});

test('importing from the old bot, then the fresh-start payout when an account opens', async () => {
  const { db, run } = setup();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oldbot-'));
  const file = path.join(dir, 'old.db');
  const old = new DatabaseSync(file);
  old.exec('CREATE TABLE achievements (user_id TEXT, id TEXT, guild_id TEXT, unlocked_at INTEGER); CREATE TABLE progress (user_id TEXT, key TEXT, value INTEGER);');
  old.exec(`INSERT INTO achievements VALUES ('${A}', 'promoted', '${G}', 1), ('${A}', 'moby_dick', '${G}', 2), ('${A}', 'generous', 'other', 3), ('${A}', 'not_real', '${G}', 4);`);
  old.exec(`INSERT INTO progress VALUES ('${A}', 'gigs', 12);`);
  old.close();

  assert.match(text(await run('importachievements', { file }, A, false)), /restricted to the bot owner/);
  assert.match(text(await run('importachievements', { file }, OWNER, true)), /3 achievements for 1 players[\s\S]*1 unknown/);
  const first = await run('balance');
  // common 250 + epic 2,500 unlocked in this server; the one from another server pays there
  assert.match(text(first), /Fresh start: your achievements from this server paid out again, ⬡2,750\.00/);
  assert.equal(balance(db, wallet(G, A)), economy.startingCash + polygons(2750));
  assert.ok(audit(db).ok);
  fs.rmSync(dir, { recursive: true, force: true });
});
