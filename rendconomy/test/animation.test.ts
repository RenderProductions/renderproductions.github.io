import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { RESERVE, transfer, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute, revealThen } from '../src/discord/router';
import { tick } from '../src/market/market';
import { setCustomEmojis } from '../src/discord/emoji';

const G = 'g1', A = '111111111111111111';
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(5), noon);
  let now = noon, seed = 1;
  const ctx = (): Ctx => ({ db, config: botConfig(), rng: seededRng(seed++), now, guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string>) => { now += 60_000; return execute(find(name)!, ctx(), args); };
  return { db, run };
}
const desc = (r: { embeds?: { description?: string }[] }) => r.embeds![0]!.description!;

test('slots: the reels stop one at a time, ending on the result', async () => {
  const { db, run } = setup();
  await run('balance', {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  for (let k = 0; k < 10; k++) {
    const r = await run('slots', { amount: '10' });
    const final = /## \[ (\S+) \| (\S+) \| (\S+) \]/.exec(desc(r))!;
    const [f1, f2] = r.teaser!.frames!.map((f) => /## \[ (\S+) \| (\S+) \| (\S+) \]/.exec(desc(f))!);
    assert.equal(f1![1], final[1], 'reel one has stopped on its symbol');
    assert.deepEqual([f2![1], f2![2]], [final[1], final[2]], 'then reel two');
    if (final[1] === final[2]) assert.match(desc(r.teaser!.frames![1]!), /👀/);
  }
});

test('roulette: the ball slows down along the real wheel and lands in the middle', async () => {
  const { db, run } = setup();
  await run('balance', {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  const r = await run('roulette', { amount: '10', on: 'red' });
  const landed = /The ball drops into\.\.\. \*\*\S+ (\d+)!\*\*/.exec(desc(r))![1];
  assert.match(desc(r), new RegExp(`\\*\\*\\[ \\S+ ${landed} \\]\\*\\*`), 'the final strip centres on the pocket');
  assert.equal(r.teaser!.frames!.length, 2);
  assert.match(desc(r.teaser!.frames![1]!), /Almost/);
});

test('the router plays every frame, then the result, in order', async () => {
  const shown: string[] = [];
  const reply: ReplyObject = { embeds: [{ description: 'result' }], teaser: { embeds: [{ description: 'one' }], ms: 5, frames: [{ embeds: [{ description: 'two' }], ms: 5 }, { embeds: [{ description: 'three' }], ms: 5 }] } };
  const deps = { db: freshDb() } as unknown as Parameters<typeof revealThen>[0];
  const keepAlive = setInterval(() => {}, 1000);   // the animation's timers don't hold the process open by themselves
  await new Promise<void>((done) => {
    revealThen(deps, reply, { id: 'm', channelId: 'c' }, async (p) => { shown.push(p.embeds![0]!.description!); if (shown.length === 3) done(); });
  });
  clearInterval(keepAlive);
  assert.deepEqual(shown, ['two', 'three', 'result']);
});

test('slots show the bot\'s own reel emojis once they are uploaded', async () => {
  setCustomEmojis(['cherry', 'lemon', 'bell', 'triangle', 'diamond'].map((n, k) => ({ name: `rc_${n}`, id: String(100 + k) })));
  const { db, run } = setup();
  await run('balance', {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  const r = await run('slots', { amount: '10' });
  assert.match(desc(r), /^## \[ <:rc_\w+:\d+> \| <:rc_\w+:\d+> \| <:rc_\w+:\d+> \]/);
  assert.doesNotMatch(desc(r.teaser!), /🍒|🍋|🔔|🔺|💎/);
});
