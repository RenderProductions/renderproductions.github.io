import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { seededRng } from '../src/core/rng';
import { execute, parsePrefix } from '../src/discord/router';
import { tick } from '../src/market/market';

const G = 'g1', A = '111111111111111111', BOT = '999999999999999999';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

test('easter egg: the bot\'s own balance and profile are infinite', async () => {
  const db = freshDb();
  tick(db, seededRng(5), Date.UTC(2026, 10, 24, 17));
  const ctx = (): Ctx => ({ db, config: botConfig(), rng: seededRng(7), now: Date.UTC(2026, 10, 24, 17), guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [], botId: BOT });
  const bal = parsePrefix(`r!bal <@${BOT}>`, 'r!');
  assert.ok(bal && 'cmd' in bal);
  const b = text(await execute(bal.cmd, ctx(), bal.args));
  assert.match(b, /The House[\s\S]*Cash:\*\* ⬡∞[\s\S]*∞ shares[\s\S]*The house always wins/);
  const p = text(await execute(find('profile')!, ctx(), { action: `<@${BOT}>` }));
  assert.match(p, /The House[\s\S]*Net worth:\*\* ⬡∞[\s\S]*Achievements:\*\* ∞ of \d+[\s\S]*White Whale, ∞ lb/);
  assert.ok(!db.get('SELECT 1 FROM players WHERE user_id = ?', BOT), 'no account is opened for the bot');
});
