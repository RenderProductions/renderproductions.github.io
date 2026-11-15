import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx } from '../src/commands/types';
import { botConfig } from '../src/config';
import { RESERVE, transfer, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute } from '../src/discord/router';
import { tick } from '../src/market/market';
import { setReceiptSender, type Receipt } from '../src/social/receipts';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(5), noon);
  const sent: Receipt[] = [];
  setReceiptSender((r) => sent.push(r));
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(7), now: noon, guildId: G, channelId: 'c', user: { id: user, name: user === A ? 'Alice' : 'Bob' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, run, sent };
}

test('receipts: one per trade or purchase, only after it succeeds', async () => {
  const { db, run, sent } = setup();
  await run('balance');
  sent.length = 0;
  await run('buy', { ticker: 'BLU', amount: '2' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.title, 'Bought 2 BLU');
  assert.deepEqual(sent[0]!.lines.map((l) => l[0]), ['Company', 'Shares', 'Price per share', 'Total cost', 'You now own', 'Balance']);
  assert.equal(sent[0]!.guildId, G);
  await run('sell', { ticker: 'BLU', amount: 'all' });
  assert.equal(sent[1]!.title, 'Sold 2 BLU');
  await run('purchase', { item: 'coffee' });
  assert.match(sent[2]!.title, /Bought a Coffee/);
  // a refused command sends nothing
  const before = sent.length;
  await run('buy', { ticker: 'RRM', amount: '99999' });
  await run('purchase', { item: 'nothing like this' });
  assert.equal(sent.length, before);
  assert.ok(db);
});

test('receipts: a gift reaches both players; the off switch is respected', async () => {
  const { db, run, sent } = setup();
  await run('balance'); await run('balance', {}, B);
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(1000), reason: 'mod.give' });
  sent.length = 0;
  await run('gift', { player: B, amount: '100', note: 'for lunch' });
  assert.deepEqual(sent.map((r) => [r.userId, r.title]), [[A, 'Gift to Bob'], [B, 'Gift from Alice']]);
  assert.deepEqual(sent[1]!.lines.find((l) => l[0] === 'Note'), ['Note', 'for lunch']);
  await run('receipts', { setting: 'off' }, B);
  sent.length = 0;
  await run('gift', { player: B, amount: '100' });
  assert.deepEqual(sent.map((r) => r.userId), [A], 'Bob turned his off');
});
