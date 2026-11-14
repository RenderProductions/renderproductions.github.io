import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { economy } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { player } from '../src/core/economy';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { GameError } from '../src/core/errors';
import { TICK_MS } from '../src/market/engine';
import { load, quote, startingPrices, tick, TICKERS } from '../src/market/market';
import { buy, lotsOf, pendingDividends, portfolio, sell, sharesOf } from '../src/market/trading';

const G = 'guild1', A = 'alice';
const noon = eastern('2026-11-13T12:00', -5);
const code = (fn: () => unknown) => { try { fn(); } catch (e) { if (e instanceof GameError) return e.code; throw e; } return 'ok'; };

function openMarket() {
  const db = freshDb();
  tick(db, seededRng(1), noon);
  player(db, G, A, economy.startingCash);
  return db;
}

test('starting prices are the ones decided for the reset', () => {
  assert.deepEqual(startingPrices(), economy.startingPrices);
  assert.deepEqual([...TICKERS], ['RRM', 'NACH', 'BLU', 'BNW', 'BSTG']);
});

test('the market runs from the starting prices and remembers its state', () => {
  const db = freshDb();
  const rng = seededRng(5);
  tick(db, rng, noon);
  const first = load(db)!;
  for (const t of TICKERS) {
    const p = quote(first, t)!.priceCents, s = startingPrices()[t]!;
    assert.ok(Math.abs(p - s) / s < 0.1, `${t} starts near its starting price (${p} vs ${s})`);
  }
  for (let i = 1; i <= 288; i++) tick(db, rng, noon + i * TICK_MS); // a day
  const day = load(db)!;
  assert.notDeepEqual(day.prices, first.prices, 'prices move');
  assert.equal(day.companies[0]!.history.length, 288, 'a day of history is kept');
});

test('buying and selling straight back is exactly even', () => {
  const db = openMarket();
  const m = load(db)!;
  const before = balance(db, wallet(G, A));
  buy(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 3 });
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 3);
  sell(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 3 });
  assert.equal(balance(db, wallet(G, A)), before, 'no profit, no loss');
  assert.equal(sharesOf(db, m, G, A, 'BLU'), 0);
  assert.equal(lotsOf(db, G, A, 'BLU').length, 0);
  assert.ok(audit(db).ok);
});

test('trades are refused when they should be', () => {
  const db = openMarket();
  const m = load(db)!;
  assert.equal(code(() => buy(db, m, { guildId: G, userId: A, ticker: 'RRM', qty: 100 })), 'funds.short');
  assert.equal(code(() => sell(db, m, { guildId: G, userId: A, ticker: 'RRM', qty: 1 })), 'stock.short');
  assert.equal(code(() => buy(db, m, { guildId: G, userId: A, ticker: 'NOPE', qty: 1 })), 'stock.unknown');
  const closed = { ...m, market: { ...m.market, status: 'after-hours' } };
  assert.equal(code(() => buy(db, closed, { guildId: G, userId: A, ticker: 'BLU', qty: 1 })), 'market.closed');
  const broke = { ...m, statuses: { ...m.statuses, BNW: 'bankrupt' } };
  assert.equal(code(() => buy(db, broke, { guildId: G, userId: A, ticker: 'BNW', qty: 1 })), 'stock.bankrupt');
  assert.equal(balance(db, wallet(G, A)), economy.startingCash, 'nothing changed');
});

test('selling takes the oldest shares first', () => {
  const db = openMarket();
  const m = load(db)!;
  buy(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 2, now: 1 });
  buy(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 3, now: 2 });
  const r = sell(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 3 });
  assert.deepEqual(r.sold!.map((l) => [l.qty, l.bought_at]), [[2, 1], [1, 2]]);
  assert.deepEqual(lotsOf(db, G, A, 'BLU').map((l) => l.qty), [2]);
});

test('a bankruptcy wipes the shares', () => {
  const db = openMarket();
  const m = load(db)!;
  buy(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 2 });
  const after = { ...m, wipes: { ...m.wipes, BLU: (m.wipes.BLU ?? 0) + 1 } };
  assert.equal(sharesOf(db, after, G, A, 'BLU'), 0);
  assert.equal(lotsOf(db, G, A, 'BLU').length, 0);
  buy(db, after, { guildId: G, userId: A, ticker: 'BLU', qty: 1 });
  assert.equal(sharesOf(db, after, G, A, 'BLU'), 1, 'new shares after the wipe are kept');
});

test('portfolio values holdings at the current price', () => {
  const db = openMarket();
  const m = load(db)!;
  buy(db, m, { guildId: G, userId: A, ticker: 'BLU', qty: 2 });
  const [pos] = portfolio(db, m, G, A);
  assert.equal(pos!.quote.id, 'BLU');
  assert.equal(pos!.valueCents, 2 * quote(m, 'BLU')!.priceCents);
  assert.equal(pos!.costCents, pos!.valueCents);
  assert.ok(polygons(500) >= pos!.valueCents);
});

test('dividends: shares earn from the moment they are bought, and keep what they earned when sold', () => {
  const db = openMarket();
  const m = load(db)!;
  const withIndex = (idx: number) => ({ ...m, dividends: { ...m.dividends, BLU: idx } });
  const base = m.dividends.BLU ?? 0;
  buy(db, withIndex(base), { guildId: G, userId: A, ticker: 'BLU', qty: 4 });
  // The index rises by ⬡0.50 per share, then half the shares are sold
  sell(db, withIndex(base + 0.5), { guildId: G, userId: A, ticker: 'BLU', qty: 2 });
  const p = pendingDividends(db, withIndex(base + 1.0), G, A);
  assert.ok(Math.abs(p.total - (4 * 0.5 + 2 * 0.5)) < 1e-9, `4 shares x 0.50 then 2 shares x 0.50 = 3.00, got ${p.total}`);
});
