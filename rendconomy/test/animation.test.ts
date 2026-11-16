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
import { emojiOr, setCustomEmojis, syncAppEmojis } from '../src/discord/emoji';
import { bigNumber, compactPolygons } from '../src/discord/icons';
import { cardBack, cardText } from '../src/casino/core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

test('roulette pockets, cards and mines tiles use the bot\'s emojis once uploaded', async () => {
  const names = [...Array.from({ length: 37 }, (_, n) => `r${n}`), 'cah', 'c10s', 'cardback', 'tile', 'diamond', 'mines'];
  setCustomEmojis(names.map((n, k) => ({ name: `rc_${n}`, id: String(500 + k) })));
  const { db, run } = setup();
  await run('balance', {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  const r = await run('roulette', { amount: '10', on: '17' });
  assert.match(desc(r), /You bet on \*\*<:rc_r17:\d+>\*\*/);
  assert.match(desc(r), /\*\*\[ <:rc_r\d+:\d+> \]\*\*/, 'the strip is made of pockets');
  assert.match(desc(r), /drops into\.\.\. \*\*<:rc_r\d+:\d+>!\*\*/);
  assert.match(cardText({ r: 14, suit: 'hearts', icon: '♥️', red: true }), /^<:rc_cah:\d+>$/);
  assert.equal(cardText({ r: 13, suit: 'clubs', icon: '♣️', red: false }), '`K♣️`', 'not uploaded yet: text');
  assert.match(cardBack(), /^<:rc_cardback:\d+>$/);
  const m = await run('mines', { amount: '10', bombs: '3' });
  const b = m.buttons![0]![0]!;
  assert.equal(b.label, '');
  assert.match(b.emoji!, /^<:rc_tile:\d+>$/, 'hidden tiles show the tile emoji');
});

test('the bot uploads the emojis it is missing, then uses them', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emo-'));
  for (const f of ['rc_one.png', 'rc_two.png', 'preview.png']) fs.writeFileSync(path.join(dir, f), 'x');
  const uploaded: string[] = [];
  const existing = [{ name: 'rc_one', id: '1', animated: false }];
  const list = () => { const all = [...existing]; return { map: <T>(f: (e: typeof all[number]) => T) => all.map(f), values: () => all.values() }; };
  const client = { application: { emojis: { fetch: async () => list(), create: async ({ name }: { name: string }) => { uploaded.push(name); existing.push({ name, id: String(existing.length + 1), animated: false }); } } } };
  const n = await syncAppEmojis(client as unknown as Parameters<typeof syncAppEmojis>[0], dir, () => {});
  assert.equal(n, 1);
  assert.deepEqual(uploaded, ['rc_two'], 'only the missing one, and never the previews');
  assert.equal(emojiOr('two', '?'), '<:rc_two:2>');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('big numbers: gold digits for wins, dice rolls and the Rocket, once uploaded', async () => {
  const names = ['n0', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7', 'n8', 'n9', 'ndot', 'nx', 'npct', 'nplus', 'nminus', 'nk', 'nm'];
  assert.equal(bigNumber('+1.2K'), null, 'not uploaded yet: nothing');
  setCustomEmojis(names.map((n, k) => ({ name: `rc_${n}`, id: String(900 + k) })));
  assert.equal(compactPolygons(polygons(450)), '450');
  assert.equal(compactPolygons(polygons(1250)), '1.25K');
  assert.equal(compactPolygons(polygons(12_000)), '12K');
  assert.equal(compactPolygons(polygons(3_500_000)), '3.5M');
  assert.equal(bigNumber('+1.2K'), '<:rc_nplus:913><:rc_n1:901><:rc_ndot:910><:rc_n2:902><:rc_nk:915>');
  assert.equal(bigNumber('hello'), null);
  const { db, run } = setup();
  await run('balance', {});
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(5000), reason: 'mod.give' });
  const d = await run('dice', { amount: '10', call: 'over 50' });
  assert.match(desc(d), /## (<:rc_n\d:\d+>)+/, 'the roll in big digits, in the card');
  // a big enough win shows its amount above the result
  let big = false;
  for (let i = 0; i < 40 && !big; i++) { const r = await run('coinflip', { amount: '200' }); big = /^## <:rc_nplus:\d+>/.test(desc(r)); }
  assert.ok(big, 'a ⬡190 coinflip win shows +190 in big digits');
});
