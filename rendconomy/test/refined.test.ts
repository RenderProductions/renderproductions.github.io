import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH, has } from '../src/achievements/achievements';
ACH.pay = false;
import { freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng, type Rng } from '../src/core/rng';
import { HOUR } from '../src/core/time';
import { execute } from '../src/discord/router';
import { addItem, count } from '../src/shop/inventory';
import { buy, stockOf } from '../src/shop/shop';

const G = 'g1', A = '111111111111111111';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
function setup(seed = 1) {
  const db = freshDb();
  let now = 1_000_000, rng: Rng = seededRng(seed);
  const ctx = (): Ctx => ({ db, config: botConfig(), rng, now, guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] });
  const run = async (name: string, args: Record<string, string> = {}) => { const r = await execute(find(name)!, ctx(), args as never); now += 3000; return r; };
  return { db, ctx, run, setRng: (r: Rng) => { rng = r; }, later: (ms: number) => { now += ms; }, now: () => now, fund: (p: number) => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(p), reason: 'mod.give' }) };
}

test('bulk use: one message for many, "all" caps at 25, one-at-a-time items refuse', async () => {
  const { db, run } = setup();
  await run('balance');
  addItem(db, G, A, 'mystery', 30);
  const r = text(await run('use', { item: 'mystery', amount: '5' }));
  assert.match(r, /Mystery × 5/);
  assert.equal(count(db, G, A, 'mystery'), 25);
  await run('use', { item: 'mystery all' });
  assert.equal(count(db, G, A, 'mystery'), 0, '"all" in the item text works too, up to 25');
  addItem(db, G, A, 'coffee', 3);
  assert.match(text(await run('use', { item: 'coffee', amount: '2' })), /one at a time/);
  assert.equal(count(db, G, A, 'coffee'), 3);
  assert.match(text(await run('use', { item: 'coffee', amount: '9' })), /one at a time|You have 3/);
  assert.ok(audit(db).ok);
});

test('a Rush Order restocks one item for everyone in the server', async () => {
  const { db, run, ctx, fund } = setup();
  await run('balance');
  fund(10_000);
  for (let i = 0; i < 20 && stockOf(db, G, 'coffee') !== 0; i++) { try { buy(db, ctx().rng, G, A, 'coffee', 1, ctx().now); } catch { break; } }
  assert.equal(stockOf(db, G, 'coffee'), 0);
  addItem(db, G, A, 'rushorder', 2);
  assert.match(text(await run('use', { item: 'rush order' })), /Which item/);
  assert.match(text(await run('use', { item: 'rush order', amount: 'col_nacho' })), /can't rush|doesn't|Which item/);
  const r = text(await run('use', { item: 'rush order coffee' }));
  assert.match(r, /\d+ Coffee\*\* back on the shelf/);
  assert.ok(stockOf(db, G, 'coffee') > 0);
  assert.equal(count(db, G, A, 'rushorder'), 1);
  assert.ok(has(db, A, 'rush_order'));
  assert.match(text(await run('use', { item: 'rush order', amount: 'coffee' })), /already fully stocked/);
  assert.equal(count(db, G, A, 'rushorder'), 1, 'kept when nothing needed restocking');
});

test('r!beg: once an hour; rich beggars get caught', async () => {
  const { db, run, later, setRng, fund } = setup(3);
  await run('balance');
  const b = balance(db, wallet(G, A));
  setRng({ ...seededRng(1), next: () => 0.1, chance: () => false, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0]! } as unknown as Rng);
  assert.match(text(await run('beg')), /drops \*\*⬡5\.00\*\*/);
  assert.equal(balance(db, wallet(G, A)) - b, polygons(5));
  assert.ok(has(db, A, 'spare_change'));
  assert.match(text(await run('beg')), /recognize you/);
  later(HOUR);
  fund(200_000);
  setRng({ ...seededRng(1), next: () => 0.1, chance: () => true, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0]! } as unknown as Rng);
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('beg')), /TODD rolls up/);
  assert.equal(before - balance(db, wallet(G, A)), polygons(1_000), 'fined 5%, at most ⬡1,000');
  assert.ok(audit(db).ok);
});

test('sell items back to Marquez, throw them away, clear your title', async () => {
  const { db, run } = setup();
  await run('balance');
  addItem(db, G, A, 'coffee', 4);
  const b0 = balance(db, wallet(G, A));
  assert.match(text(await run('sellitem', { item: 'coffee 3' })), /gives you \*\*⬡120(\.00)?\*\*/);
  assert.equal(balance(db, wallet(G, A)) - b0, polygons(120), '40% of ⬡100, three times');
  assert.equal(count(db, G, A, 'coffee'), 1);
  assert.match(text(await run('sellitem', { item: 'coffee', amount: '5' })), /You have 1/);
  addItem(db, G, A, 'col_nacho', 1);
  assert.match(text(await run('sellitem', { item: 'golden nacho' })), /doesn't buy collectibles/);
  assert.match(text(await run('discard', { item: 'golden nacho' })), /Gone/);
  assert.equal(count(db, G, A, 'col_nacho'), 0);
  assert.match(text(await run('discard', { item: 'coffee', amount: 'all' })), /Gone[\s\S]*would have paid ⬡40/);
  assert.match(text(await run('discard', { item: 'coffee' })), /don't have any/);
  addItem(db, G, A, 'title', 1);
  await run('settitle', { title: 'Big Cheese' });
  assert.match(text(await run('settitle', { title: 'clear' })), /Title cleared/);
  assert.equal(db.get<{ title: string | null }>('SELECT title FROM players WHERE guild_id = ? AND user_id = ?', G, A)!.title, null);
  assert.ok(audit(db).ok);
});

test('achievements: a row of rarity buttons shows every achievement of one rarity', async () => {
  const { run } = setup();
  await run('balance');
  const r = await run('achievements');
  const last = r!.buttons!.at(-1)!;
  assert.deepEqual(last.map((b) => b.label), ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic']);
  assert.ok(last[3]!.id.endsWith('r:legendary'));
});

test('money lists use Discord\'s colored diff blocks: green in, red out', async () => {
  const { diffBlock } = await import('../src/discord/diff.js');
  const { receiptView } = await import('../src/social/receipts.js');
  assert.equal(diffBlock([['+', '⬡120.00', 'Sold back'], ['-', '⬡8,000.00', 'Rebuilt C4']]), '```diff\n+ ⬡120.00    Sold back\n- ⬡8,000.00  Rebuilt C4\n```');
  const v = receiptView({ guildId: 'g', userId: 'u', title: 'Bought a Coffee', lines: [['Item', '☕ Coffee'], ['Price', '⬡100.00', '-'], ['Balance', '⬡400.00']] });
  assert.equal(v.description, '```diff\n- ⬡100.00  Price\n  ⬡400.00  Balance\n```');
  assert.deepEqual(v.fields.map((f) => f.name), ['Item']);
});
