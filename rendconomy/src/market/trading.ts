// Buying and selling house company shares. The house (the Reserve) is the other side of every trade:
// buying pays the Reserve, selling is paid by it. Both fill at the current price, and a trade never
// moves the price, so buying and selling straight back can never make money.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import { closedReason, quote, type Quote } from './market';
import type { MarketData } from './engine';

export interface Lot { id: number; qty: number; price_cents: Cents; bought_at: number }

interface Holding { shares: number; wipes_seen: number }

/**
 * Shares a player owns, after any bankruptcy since they last looked: a company that went bankrupt
 * wipes its shares, and its lots with them.
 */
export function sharesOf(db: Db, m: MarketData, guildId: string, userId: string, ticker: string): number {
  const h = db.get<Holding>('SELECT shares, wipes_seen FROM holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?', guildId, userId, ticker);
  if (!h) return 0;
  const wipes = quote(m, ticker)?.wipes ?? 0;
  if (wipes > h.wipes_seen) {
    if (h.shares > 0) emit('stock.wiped', { guildId, userId, ticker, shares: h.shares });
    db.tx(() => {
      db.run('UPDATE holdings SET shares = 0, wipes_seen = ? WHERE guild_id = ? AND user_id = ? AND ticker = ?', wipes, guildId, userId, ticker);
      db.run('DELETE FROM lots WHERE guild_id = ? AND user_id = ? AND ticker = ?', guildId, userId, ticker);
    });
    return 0;
  }
  return h.shares;
}

function setShares(db: Db, m: MarketData, guildId: string, userId: string, ticker: string, shares: number): void {
  const wipes = quote(m, ticker)?.wipes ?? 0;
  db.run(
    `INSERT INTO holdings (guild_id, user_id, ticker, shares, wipes_seen, div_index) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id, ticker) DO UPDATE SET shares = excluded.shares, wipes_seen = excluded.wipes_seen`,
    guildId, userId, ticker, shares, wipes, divIndexOf(m, ticker)
  );
}

// ---------------------------------------------------------------- dividends
// Each company's dividend index (Polygons paid per share, ever) only goes up. A holding earns
// (index now - index when last settled) x shares. Settling happens before every trade and on claim,
// so new shares start earning at once and sold shares keep what they earned.

export const divIndexOf = (m: MarketData, ticker: string): number => Number(m.dividends?.[ticker] ?? 0) || 0;

/** Moves what a holding has earned into the player's pending dividends. Returns Polygons earned. */
export function settleDividends(db: Db, m: MarketData, guildId: string, userId: string, ticker: string): number {
  const shares = sharesOf(db, m, guildId, userId, ticker);
  const h = db.get<{ div_index: number }>('SELECT div_index FROM holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?', guildId, userId, ticker);
  if (!h) return 0;
  const now = divIndexOf(m, ticker);
  const earned = shares > 0 ? Math.max(0, (now - h.div_index) * shares) : 0;
  db.run('UPDATE holdings SET div_index = ? WHERE guild_id = ? AND user_id = ? AND ticker = ?', now, guildId, userId, ticker);
  if (earned > 0) db.run('UPDATE players SET div_pending = div_pending + ? WHERE guild_id = ? AND user_id = ?', earned, guildId, userId);
  return earned;
}

/** Unclaimed dividends in Polygons (settles every holding first). */
export function pendingDividends(db: Db, m: MarketData, guildId: string, userId: string): { total: number; byTicker: Record<string, number> } {
  return db.tx(() => {
    const byTicker: Record<string, number> = {};
    for (const c of m.companies) byTicker[c.id] = settleDividends(db, m, guildId, userId, c.id);
    const total = db.get<{ div_pending: number }>('SELECT div_pending FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)?.div_pending ?? 0;
    return { total, byTicker };
  });
}

export function lotsOf(db: Db, guildId: string, userId: string, ticker: string): Lot[] {
  return db.all<Lot>('SELECT id, qty, price_cents, bought_at FROM lots WHERE guild_id = ? AND user_id = ? AND ticker = ? ORDER BY id', guildId, userId, ticker);
}

/** Removes `qty` shares from the oldest lots first. Returns what was taken. */
function takeLots(db: Db, guildId: string, userId: string, ticker: string, qty: number): Lot[] {
  const taken: Lot[] = [];
  let left = qty;
  for (const lot of lotsOf(db, guildId, userId, ticker)) {
    if (left <= 0) break;
    const n = Math.min(left, lot.qty);
    if (n === lot.qty) db.run('DELETE FROM lots WHERE id = ?', lot.id);
    else db.run('UPDATE lots SET qty = qty - ? WHERE id = ?', n, lot.id);
    taken.push({ ...lot, qty: n });
    left -= n;
  }
  return taken;
}

/** The quote for a trade, or a GameError explaining why it can't happen. */
export function tradableQuote(m: MarketData, ticker: string): Quote {
  const q = quote(m, ticker);
  if (!q) throw new GameError('stock.unknown', `There is no company with the ticker ${ticker.toUpperCase()}. Tickers: ${m.companies.map((c) => c.id).join(', ')}.`);
  const closed = closedReason(m);
  if (closed) throw new GameError('market.closed', closed);
  if (q.status === 'bankrupt') throw new GameError('stock.bankrupt', `${q.name} (${q.id}) is bankrupt. Its shares cannot be traded.`);
  if (q.priceCents <= 0) throw new GameError('stock.worthless', `${q.id} has no value at present. Trading is paused.`);
  return q;
}

export interface TradeInput { guildId: string; userId: string; ticker: string; qty: number; now?: number }
export interface TradeResult { quote: Quote; qty: number; priceCents: Cents; totalCents: Cents; shares: number; cash: Cents; sold?: Lot[] }

export function buy(db: Db, m: MarketData, input: TradeInput): TradeResult {
  const q = tradableQuote(m, input.ticker);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new GameError('count.small', 'The number of shares must be at least 1.');
  const total = input.qty * q.priceCents;
  const w = wallet(input.guildId, input.userId);
  return db.tx(() => {
    settleDividends(db, m, input.guildId, input.userId, q.id);
    const shares = sharesOf(db, m, input.guildId, input.userId, q.id) + input.qty;
    transfer(db, { from: w, to: RESERVE, cents: total, reason: 'stock.buy', guildId: input.guildId, actorId: input.userId, now, note: { ticker: q.id, qty: input.qty, price: q.priceCents } });
    setShares(db, m, input.guildId, input.userId, q.id, shares);
    db.run('INSERT INTO lots (guild_id, user_id, ticker, qty, price_cents, bought_at) VALUES (?, ?, ?, ?, ?, ?)', input.guildId, input.userId, q.id, input.qty, q.priceCents, now);
    emit('stock.bought', { guildId: input.guildId, userId: input.userId, ticker: q.id, qty: input.qty, priceCents: q.priceCents });
    return { quote: q, qty: input.qty, priceCents: q.priceCents, totalCents: total, shares, cash: balance(db, w) };
  });
}

export function sell(db: Db, m: MarketData, input: TradeInput): TradeResult {
  const q = tradableQuote(m, input.ticker);
  const now = input.now ?? Date.now();
  if (!Number.isSafeInteger(input.qty) || input.qty <= 0) throw new GameError('count.small', 'The number of shares must be at least 1.');
  const w = wallet(input.guildId, input.userId);
  return db.tx(() => {
    settleDividends(db, m, input.guildId, input.userId, q.id);
    const owned = sharesOf(db, m, input.guildId, input.userId, q.id);
    if (owned < input.qty) throw new GameError('stock.short', `You hold ${owned} ${owned === 1 ? 'share' : 'shares'} of ${q.id}.`);
    const total = input.qty * q.priceCents;
    transfer(db, { from: RESERVE, to: w, cents: total, reason: 'stock.sell', guildId: input.guildId, actorId: input.userId, now, note: { ticker: q.id, qty: input.qty, price: q.priceCents } });
    setShares(db, m, input.guildId, input.userId, q.id, owned - input.qty);
    const sold = takeLots(db, input.guildId, input.userId, q.id, input.qty);
    emit('stock.sold', { guildId: input.guildId, userId: input.userId, ticker: q.id, qty: input.qty, priceCents: q.priceCents, costCents: sold.reduce((s, l) => s + l.qty * l.price_cents, 0), lots: sold });
    return { quote: q, qty: input.qty, priceCents: q.priceCents, totalCents: total, shares: owned - input.qty, cash: balance(db, w), sold };
  });
}

export interface Position { quote: Quote; shares: number; valueCents: Cents; costCents: Cents }

/** Everything a player holds in this server, valued at current prices. */
export function portfolio(db: Db, m: MarketData, guildId: string, userId: string): Position[] {
  const out: Position[] = [];
  for (const c of m.companies) {
    const shares = sharesOf(db, m, guildId, userId, c.id);
    if (shares <= 0) continue;
    const q = quote(m, c.id)!;
    const costCents = lotsOf(db, guildId, userId, c.id).reduce((s, l) => s + l.qty * l.price_cents, 0);
    out.push({ quote: q, shares, valueCents: shares * Math.max(0, q.priceCents), costCents });
  }
  return out;
}

/** "max" for buying: how many shares the wallet can afford. */
export const affordable = (cash: Cents, priceCents: Cents): number => (priceCents > 0 ? Math.floor(cash / priceCents) : 0);

export const describeTotal = (r: TradeResult): string => `${r.qty} × ${format(r.priceCents)} = ${format(r.totalCents)}`;
