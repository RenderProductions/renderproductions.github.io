import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH } from '../src/achievements/achievements';
ACH.pay = false;
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { DAY } from '../src/core/time';
import { execute, press } from '../src/discord/router';
import { load, tick } from '../src/market/market';
import type { MarketData } from '../src/market/engine';
import { brokerOf, brokerTick, checkOrders, checkShorts, listShorts } from '../src/market/schemes';
import { sharesOf } from '../src/market/trading';

const G = 'g1', A = '111111111111111111', OWNER = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);
const at = (m: MarketData, t: string, price: number): MarketData => ({ ...m, prices: { ...m.prices, [t]: price } });

function setup() {
  const db = freshDb();
  tick(db, seededRng(8), noon);
  const ctx = (user = A, owner = false): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now: noon, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: owner, isMod: owner, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A, owner = false) => execute(find(name)!, ctx(user, owner), args);
  return { db, ctx, run, fund: (p: number) => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(p), reason: 'mod.give' }) };
}

test('a buy order sets money aside and fills when the price drops to it', async () => {
  const { db, run } = setup();
  await run('balance');
  assert.match(text(await run('order', { action: 'buy BLU 2 at 40' })), /Order #1 placed[\s\S]*⬡80\.00 is set aside/);
  assert.equal(balance(db, wallet(G, A)), polygons(420));
  const m = load(db)!;
  assert.equal(checkOrders(db, at(m, 'BLU', 45), noon).length, 0, 'not yet');
  assert.equal(checkOrders(db, at(m, 'BLU', 39.5), noon).length, 1);
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 2);
  assert.equal(balance(db, wallet(G, A)), polygons(500) - 2 * 3950, 'filled at the market price, the rest returned');
  assert.ok(audit(db).ok);
});

test('sell and stop orders, and cancelling returns the money', async () => {
  const { db, run } = setup();
  await run('buy', { ticker: 'BLU', amount: '4' });
  await run('order', { action: 'sell BLU all below 30' });
  const m = load(db)!;
  checkOrders(db, at(m, 'BLU', 29), noon);
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 0, 'stop-loss sold everything');
  const placed = text(await run('order', { action: 'buy RRM 1 at 100' }));
  const id = /Order #(\d+)/.exec(placed)![1]!;
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('order', { action: `cancel ${id}` })), /⬡100\.00 returned/);
  assert.equal(balance(db, wallet(G, A)), before + polygons(100));
});

test('brokers: hire with a button, follow rules, take their cut, quit when unpaid', async () => {
  const { db, run, ctx, fund } = setup();
  await run('balance');
  fund(3000);
  const r = await run('broker', { action: 'hire' });
  assert.match(text(r), /Sign-on bonus: \*\*⬡1,000\.00/);
  assert.match(text(press(ctx(), sessions.buttonId(r.session!, '0')).update), /Hired/);
  await run('broker', { action: 'buy BLU until 50' });
  await run('broker', { action: 'sell BLU at 60' });
  const m = load(db)!;
  const b = brokerOf(db, G, A)!;
  b.trait = 'steady';
  brokerTick(db, b, at(m, 'BLU', 45), noon, seededRng(1));
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 5, 'bought 5 (steady) at 45');
  const cashBefore = balance(db, wallet(G, A));
  brokerTick(db, brokerOf(db, G, A)!, at(m, 'BLU', 61), noon, seededRng(1));
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 0, 'sold at the target');
  const profit = 5 * (6100 - 4500);
  assert.equal(balance(db, wallet(G, A)) - cashBefore, 5 * 6100 - Math.floor(profit * 0.1), '10% cut of the profit');
  // A day later with no money: they quit
  transfer(db, { from: wallet(G, A), to: RESERVE, cents: balance(db, wallet(G, A)), reason: 'mod.take' });
  brokerTick(db, brokerOf(db, G, A)!, m, noon + DAY, seededRng(1));
  assert.equal(brokerOf(db, G, A), null);
  assert.ok(audit(db).ok);
});

test('shorts: margin set aside, profit when it falls, margin call when it rises, full payout on bankruptcy', async () => {
  const { db, run, fund } = setup();
  await run('balance');
  fund(5000);
  const m = load(db)!;
  const p = Math.round(m.prices.BLU! * 100);
  assert.match(text(await run('short', { ticker: 'BLU', amount: '10' })), /Short opened: 10 BLU/);
  const after = balance(db, wallet(G, A));
  assert.equal(polygons(5500) - after, Math.ceil(10 * p * 0.5) + Math.ceil(10 * p * 0.01));
  checkShorts(db, at(m, 'BLU', (p * 1.46) / 100), noon);
  assert.equal(listShorts(db, G, A).length, 0, 'margin call at a 46% rise (90% of a 50% margin)');
  await run('short', { ticker: 'BNW', amount: '5' });
  checkShorts(db, { ...m, wipes: { ...m.wipes, BNW: (m.wipes.BNW ?? 0) + 1 } }, noon);
  assert.equal(listShorts(db, G, A).length, 0, 'bankruptcy covers at 0');
  assert.ok(audit(db).ok);
});

test('owner controls: crash and boost change the market settings', async () => {
  const { db, run } = setup();
  assert.match(text(await run('crash', { action: 'start brutal 0 1 1' })), /restricted to the bot owner/);
  assert.match(text(await run('crash', { action: 'start brutal 0 1 1' }, OWNER, true)), /Done: start/);
  assert.equal(JSON.parse(db.meta('market.crash')!).severity, 'brutal');
  assert.match(text(await run('boost', { action: 'start big 2 bstg' }, OWNER, true)), /Done: start/);
  assert.deepEqual(JSON.parse(db.meta('market.boost')!).tickers, ['BSTG']);
  assert.match(text(await run('crash', { action: 'cancel' }, OWNER, true)), /Done: cancel/);
});
