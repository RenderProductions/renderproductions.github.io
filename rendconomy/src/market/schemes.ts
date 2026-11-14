// Sit Back and Relax and Schemes: limit/stop orders, brokers, and short selling. All three act on their
// own once per market tick (installed with installSchemes()).
//
//  Orders: "buy 10 RRM at 150 or less" sets the money aside (escrow) until it fills; "sell all BNW at 90 or
//          more" and stop-losses ("sell all BLU if it falls to 30"). Up to 10, expiring after 7 days.
//  Brokers: hired for a sign-on bonus (1.25x more each rehire), paid a daily salary plus a cut of profits.
//          They follow your rules (buy until, sell at, stop at) with up to 25 shares per company, trading in
//          your own portfolio. Miss a payday and they quit (KorbedOut's idea).
//  Shorts: borrow and sell shares; half the position is set aside as margin (plus a 1% fee). Covering buys
//          them back. A loss of 90% of the margin covers it for you; a bankruptcy pays out in full.
import { award } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, ensureEscrow, escrow, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { DAY } from '../core/time';
import { addWorthPart } from '../social/worth';
import type { MarketData } from './engine';
import { closedReason, onTick, quote, type Quote } from './market';
import { buy, sell, sharesOf } from './trading';

/** DMs to players about things that happened while they were away (filled orders, broker reports). */
type Notify = (guildId: string, userId: string, text: string) => void;
let notify: Notify = () => {};
export const setNotifier = (fn: Notify): void => { notify = fn; };

// ================================================================ orders

export const ORDERS = { max: 10, expireMs: 7 * DAY };
export interface Order { id: number; guild_id: string; user_id: string; ticker: string; side: 'buy' | 'sell'; kind: 'limit' | 'stop'; qty: number | null; price: Cents; reserved: Cents; created_at: number }

export function placeOrder(db: Db, guildId: string, userId: string, o: { side: 'buy' | 'sell'; kind: 'limit' | 'stop'; ticker: string; qty: number | null; price: Cents }, now = Date.now()): Order {
  const n = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE guild_id = ? AND user_id = ?', guildId, userId)!.n;
  if (n >= ORDERS.max) throw new GameError('order.max', `At most ${ORDERS.max} orders can be open at once.`);
  if (o.side === 'buy' && (o.qty === null || o.kind !== 'limit')) throw new GameError('order.buy', 'A buy order needs a number of shares and a limit price.');
  return db.tx(() => {
    const reserved = o.side === 'buy' ? o.qty! * o.price : 0;
    if (reserved) transfer(db, { from: wallet(guildId, userId), to: ensureEscrow(db, guildId, userId, now), cents: reserved, reason: 'order.reserve', guildId, actorId: userId, now });
    const id = db.run('INSERT INTO orders (guild_id, user_id, ticker, side, kind, qty, price, reserved, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      guildId, userId, o.ticker, o.side, o.kind, o.qty, o.price, reserved, now).lastInsertRowid;
    return db.get<Order>('SELECT * FROM orders WHERE id = ?', id)!;
  });
}

export const listOrders = (db: Db, guildId: string, userId: string): Order[] => db.all<Order>('SELECT * FROM orders WHERE guild_id = ? AND user_id = ? ORDER BY id', guildId, userId);

export function cancelOrder(db: Db, o: Order, now = Date.now()): void {
  db.tx(() => {
    if (o.reserved > 0) transfer(db, { from: escrow(o.guild_id, o.user_id), to: wallet(o.guild_id, o.user_id), cents: o.reserved, reason: 'order.release', guildId: o.guild_id, actorId: o.user_id, now });
    db.run('DELETE FROM orders WHERE id = ?', o.id);
  });
}

export function describeOrder(o: Order): string {
  const n = o.qty ?? 'all';
  if (o.side === 'buy') return `Buy ${n} ${o.ticker} at ${format(o.price)} or less`;
  return o.kind === 'stop' ? `Sell ${n} ${o.ticker} if it falls to ${format(o.price)}` : `Sell ${n} ${o.ticker} at ${format(o.price)} or more`;
}

/** Fills whatever orders the new prices reach, and expires old ones. */
export function checkOrders(db: Db, m: MarketData, now = Date.now()): Order[] {
  const filled: Order[] = [];
  if (closedReason(m)) return filled;
  for (const o of db.all<Order>('SELECT * FROM orders ORDER BY id')) {
    if (now - o.created_at > ORDERS.expireMs) { cancelOrder(db, o, now); notify(o.guild_id, o.user_id, `Your order expired: ${describeOrder(o)}.`); continue; }
    const q = quote(m, o.ticker);
    if (!q || q.status === 'bankrupt' || q.priceCents <= 0) continue;
    const hit = o.side === 'buy' ? q.priceCents <= o.price : o.kind === 'stop' ? q.priceCents <= o.price : q.priceCents >= o.price;
    if (!hit) continue;
    try {
      db.tx(() => {
        if (o.side === 'buy') {
          transfer(db, { from: escrow(o.guild_id, o.user_id), to: wallet(o.guild_id, o.user_id), cents: o.reserved, reason: 'order.release', guildId: o.guild_id, actorId: o.user_id, now });
          buy(db, m, { guildId: o.guild_id, userId: o.user_id, ticker: o.ticker, qty: o.qty!, now });
        } else {
          const held = sharesOf(db, m, o.guild_id, o.user_id, o.ticker);
          const qty = Math.min(o.qty ?? held, held);
          if (qty > 0) sell(db, m, { guildId: o.guild_id, userId: o.user_id, ticker: o.ticker, qty, now });
        }
        db.run('DELETE FROM orders WHERE id = ?', o.id);
      });
      filled.push(o);
      award(db, o.guild_id, o.user_id, 'set_and_forget', now);
      notify(o.guild_id, o.user_id, `Order filled at ${format(q.priceCents)}: ${describeOrder(o)}.`);
    } catch (e) { console.error('[orders]', e); }
  }
  return filled;
}

// ================================================================ brokers

export const BROKERS = { cap: 25, baseBonus: polygons(1000), growth: 1.25, logSize: 8, profitAchievement: polygons(10_000) };
export const TRAITS = {
  steady: { emoji: '😐', label: 'Steady', salary: polygons(100), cut: 0.10, perTick: 5, everyOther: false, wild: 0, desc: 'Does exactly what you say. No surprises.' },
  cautious: { emoji: '🐢', label: 'Cautious', salary: polygons(75), cut: 0.08, perTick: 3, everyOther: true, wild: 0, desc: 'Cheaper, but only acts every other tick, so trades land a little late.' },
  aggressive: { emoji: '🐺', label: 'Aggressive', salary: polygons(150), cut: 0.15, perTick: 10, everyOther: false, wild: 0, desc: 'Buys fast and big. Takes a bigger cut for the trouble.' },
  gambler: { emoji: '🎲', label: 'Gambler', salary: polygons(60), cut: 0.10, perTick: 5, everyOther: false, wild: 0.08, desc: 'The cheapest. Every so often makes a trade you never asked for.' }
} as const;
export type Trait = keyof typeof TRAITS;
const NAMES = ['Chad Bullworth', 'Penny Pincher', 'Vinnie "The Ticker"', 'Margaret Ledger', 'Trent Hedgely', 'Dot Com', 'Barry Bearish',
  'Sally Shortsworth', 'Gus Greenbacks', 'Wendy Windfall', 'Hank Hedgefund', 'Ivy Index', 'Duke Dividend', 'Polly Polygon'];

export interface Rule { buyUntil?: Cents; sellAt?: Cents; stopAt?: Cents }
export interface Broker { guild_id: string; user_id: string; active: number; name: string; trait: Trait; hired_at: number; paid_at: number; hires: number; rules: Record<string, Rule>; holdings: Record<string, { shares: number; cost: Cents }>; profit: Cents; ticks: number; log: string[] }

interface BrokerRow { guild_id: string; user_id: string; active: number; name: string; trait: string; hired_at: number; paid_at: number; hires: number; rules: string; holdings: string; profit: number; ticks: number; log: string }
const parseBroker = (r: BrokerRow | undefined): Broker | null => r ? { ...r, trait: (r.trait in TRAITS ? r.trait : 'steady') as Trait, rules: JSON.parse(r.rules), holdings: JSON.parse(r.holdings), log: JSON.parse(r.log) } : null;
export const brokerRow = (db: Db, g: string, u: string): Broker | null => parseBroker(db.get<BrokerRow>('SELECT * FROM brokers WHERE guild_id = ? AND user_id = ?', g, u));
export const brokerOf = (db: Db, g: string, u: string): Broker | null => { const b = brokerRow(db, g, u); return b?.active ? b : null; };
function saveBroker(db: Db, b: Broker): void {
  db.run(`INSERT INTO brokers (guild_id, user_id, active, name, trait, hired_at, paid_at, hires, rules, holdings, profit, ticks, log) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET active = excluded.active, name = excluded.name, trait = excluded.trait, hired_at = excluded.hired_at, paid_at = excluded.paid_at,
    hires = excluded.hires, rules = excluded.rules, holdings = excluded.holdings, profit = excluded.profit, ticks = excluded.ticks, log = excluded.log`,
    b.guild_id, b.user_id, b.active, b.name, b.trait, b.hired_at, b.paid_at, b.hires, JSON.stringify(b.rules), JSON.stringify(b.holdings), b.profit, b.ticks, JSON.stringify(b.log.slice(0, BROKERS.logSize)));
}
export const signOnBonus = (hires: number): Cents => Math.round(BROKERS.baseBonus * Math.pow(BROKERS.growth, hires));

/** Today's three candidates for this player (the same all day). */
export function candidates(userId: string, now: number, rng: (seed: number) => Rng): { name: string; trait: Trait }[] {
  let seed = Math.floor(now / DAY);
  for (const ch of userId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = rng(seed);
  const names = r.shuffle(NAMES);
  return [0, 1, 2].map((i) => ({ name: names[i]!, trait: r.pick(Object.keys(TRAITS) as Trait[]) }));
}

export function hireBroker(db: Db, g: string, u: string, cand: { name: string; trait: Trait }, now = Date.now()): Broker {
  if (brokerOf(db, g, u)) throw new GameError('broker.have', 'You already have a broker.');
  const prev = brokerRow(db, g, u);
  const bonus = signOnBonus(prev?.hires ?? 0);
  return db.tx(() => {
    transfer(db, { from: wallet(g, u), to: RESERVE, cents: bonus, reason: 'broker.bonus', guildId: g, actorId: u, now });
    const b: Broker = { guild_id: g, user_id: u, active: 1, name: cand.name, trait: cand.trait, hired_at: now, paid_at: now, hires: (prev?.hires ?? 0) + 1, rules: {}, holdings: {}, profit: 0, ticks: 0, log: [] };
    saveBroker(db, b);
    award(db, g, u, 'hired_help', now);
    return b;
  });
}

export function setBrokerRule(db: Db, b: Broker, ticker: string, field: keyof Rule, cents: Cents | null): void {
  const r = (b.rules[ticker] ??= {});
  if (cents === null) delete r[field]; else r[field] = cents;
  if (!Object.keys(r).length) delete b.rules[ticker];
  saveBroker(db, b);
}

export function dismissBroker(db: Db, b: Broker, why: string): void {
  b.active = 0; b.rules = {}; b.holdings = {};
  b.log.unshift(why);
  saveBroker(db, b);
}

const blog = (b: Broker, line: string) => b.log.unshift(line);

/** One tick of a broker's work: payday, then the rules, then (gamblers) the odd surprise. */
export function brokerTick(db: Db, b: Broker, m: MarketData, now: number, rng: Rng): void {
  const tr = TRAITS[b.trait];
  const w = wallet(b.guild_id, b.user_id);
  if (now - b.paid_at >= DAY) {
    if (balance(db, w) < tr.salary) {
      dismissBroker(db, b, `Quit: could not be paid ${format(tr.salary)}.`);
      award(db, b.guild_id, b.user_id, 'youre_fired', now);
      notify(b.guild_id, b.user_id, `Your broker ${b.name} quit: you could not pay their ${format(tr.salary)} salary. The shares they bought stay in your portfolio.`);
      return;
    }
    transfer(db, { from: w, to: RESERVE, cents: tr.salary, reason: 'broker.salary', guildId: b.guild_id, actorId: b.user_id, now });
    b.paid_at += DAY;
    blog(b, `Paid salary ${format(tr.salary)}.`);
  }
  b.ticks++;
  if (closedReason(m) || (tr.everyOther && b.ticks % 2)) { saveBroker(db, b); return; }
  for (const [t, rule] of Object.entries(b.rules)) {
    const q = quote(m, t);
    if (!q || q.status === 'bankrupt' || q.priceCents <= 0) continue;
    const h = (b.holdings[t] ??= { shares: 0, cost: 0 });
    h.shares = Math.min(h.shares, sharesOf(db, m, b.guild_id, b.user_id, t)); // a wipe or a manual sale shrinks what they manage
    const sellAll = (why: string) => brokerSell(db, b, m, q, h.shares, why, now);
    if (h.shares > 0 && rule.stopAt !== undefined && q.priceCents <= rule.stopAt) sellAll('stop');
    else if (h.shares > 0 && rule.sellAt !== undefined && q.priceCents >= rule.sellAt) sellAll('target');
    else if (rule.buyUntil !== undefined && q.priceCents <= rule.buyUntil && h.shares < BROKERS.cap) {
      const qty = Math.min(tr.perTick, BROKERS.cap - h.shares, Math.floor(balance(db, w) / q.priceCents));
      if (qty > 0) brokerBuy(db, b, m, q, qty, now);
    }
  }
  if (tr.wild && rng.chance(tr.wild)) {
    const t = rng.pick(m.companies.map((c) => c.id));
    const q = quote(m, t);
    if (q && q.priceCents > 0 && q.status !== 'bankrupt') {
      const h = (b.holdings[t] ??= { shares: 0, cost: 0 });
      if (h.shares > 0 && rng.chance(0.5)) brokerSell(db, b, m, q, Math.min(h.shares, rng.int(1, 3)), 'hunch', now);
      else { const qty = Math.min(rng.int(1, 3), BROKERS.cap - h.shares, Math.floor(balance(db, w) / q.priceCents)); if (qty > 0) brokerBuy(db, b, m, q, qty, now, 'hunch'); }
    }
  }
  for (const t of Object.keys(b.holdings)) if (!b.holdings[t]!.shares) delete b.holdings[t];
  saveBroker(db, b);
}

function brokerBuy(db: Db, b: Broker, m: MarketData, q: Quote, qty: number, now: number, why = 'rule'): void {
  buy(db, m, { guildId: b.guild_id, userId: b.user_id, ticker: q.id, qty, now });
  const h = (b.holdings[q.id] ??= { shares: 0, cost: 0 });
  h.shares += qty; h.cost += qty * q.priceCents;
  blog(b, `${why === 'hunch' ? 'On a hunch, bought' : 'Bought'} ${qty} ${q.id} at ${format(q.priceCents)}.`);
}

function brokerSell(db: Db, b: Broker, m: MarketData, q: Quote, qty: number, why: string, now: number): void {
  if (qty <= 0) return;
  const h = b.holdings[q.id]!;
  const costPart = Math.round((h.cost * qty) / h.shares);
  sell(db, m, { guildId: b.guild_id, userId: b.user_id, ticker: q.id, qty, now });
  const proceeds = qty * q.priceCents;
  const profit = proceeds - costPart;
  let cut = 0;
  if (profit > 0) {
    cut = Math.floor(profit * TRAITS[b.trait].cut);
    if (cut > 0) transfer(db, { from: wallet(b.guild_id, b.user_id), to: RESERVE, cents: Math.min(cut, balance(db, wallet(b.guild_id, b.user_id))), reason: 'broker.cut', guildId: b.guild_id, actorId: b.user_id, now });
    b.profit += profit;
    if (b.profit >= BROKERS.profitAchievement) award(db, b.guild_id, b.user_id, 'retirement_plan', now);
  }
  h.shares -= qty; h.cost -= costPart;
  blog(b, `Sold ${qty} ${q.id} at ${format(q.priceCents)} (${why === 'stop' ? 'stop-loss' : why === 'hunch' ? 'on a hunch' : 'target reached'})${profit > 0 ? `, profit ${format(profit)}, cut ${format(cut)}` : ''}.`);
  notify(b.guild_id, b.user_id, `Broker report from ${b.name}: sold ${qty} ${q.id} at ${format(q.priceCents)}.`);
}

// ================================================================ shorts

export const SHORTS = { maxShares: 100, margin: 0.5, fee: 0.01, call: 0.9 };
export interface Short { guild_id: string; user_id: string; ticker: string; shares: number; entry: Cents; margin: Cents; wipes: number; opened_at: number }

export const listShorts = (db: Db, g: string, u: string): Short[] => db.all<Short>('SELECT * FROM shorts WHERE guild_id = ? AND user_id = ? ORDER BY ticker', g, u);
const getShort = (db: Db, g: string, u: string, t: string) => db.get<Short>('SELECT * FROM shorts WHERE guild_id = ? AND user_id = ? AND ticker = ?', g, u, t) ?? null;
/** The price a short settles at: 0 once the company has gone bankrupt since it was opened. */
export const settlePrice = (s: Short, q: Quote | null): Cents => (!q ? s.entry : q.wipes > s.wipes || q.status === 'bankrupt' ? 0 : q.priceCents);
export const shortPnl = (s: Short, price: Cents): Cents => (s.entry - price) * s.shares;
export const shortWorth = (s: Short, price: Cents): Cents => Math.max(0, s.margin + shortPnl(s, price));

/** Extra checks on opening a short (world events can waive the fee). */
let feeWaived: (db: Db, ticker: string) => boolean = () => false;
export const setShortFeeWaiver = (fn: (db: Db, ticker: string) => boolean): void => { feeWaived = fn; };

export function openShort(db: Db, m: MarketData, g: string, u: string, q: Quote, qty: number, now = Date.now()): { short: Short; fee: Cents; margin: Cents } {
  const closed = closedReason(m);
  if (closed) throw new GameError('market.closed', closed);
  if (q.priceCents <= 0 || q.status === 'bankrupt') throw new GameError('short.price', `${q.id} cannot be shorted right now.`);
  const cur = getShort(db, g, u, q.id);
  if ((cur?.shares ?? 0) + qty > SHORTS.maxShares) throw new GameError('short.max', `At most ${SHORTS.maxShares} shares of one company can be shorted. Room left: ${SHORTS.maxShares - (cur?.shares ?? 0)}.`);
  const value = qty * q.priceCents;
  const margin = Math.ceil(value * SHORTS.margin);
  const fee = feeWaived(db, q.id) ? 0 : Math.ceil(value * SHORTS.fee);
  const w = wallet(g, u);
  if (balance(db, w) < margin + fee) throw new GameError('funds.short', `Shorting ${qty} ${q.id} sets aside ${format(margin)} as margin plus a ${format(fee)} fee. The balance is ${format(balance(db, w))}.`);
  return db.tx(() => {
    transfer(db, { from: w, to: ensureEscrow(db, g, u, now), cents: margin, reason: 'short.margin', guildId: g, actorId: u, now });
    if (fee) transfer(db, { from: w, to: RESERVE, cents: fee, reason: 'short.fee', guildId: g, actorId: u, now });
    if (cur) {
      const shares = cur.shares + qty;
      db.run('UPDATE shorts SET shares = ?, entry = ?, margin = margin + ? WHERE guild_id = ? AND user_id = ? AND ticker = ?', shares, Math.round((cur.entry * cur.shares + q.priceCents * qty) / shares), margin, g, u, q.id);
    } else {
      db.run('INSERT INTO shorts (guild_id, user_id, ticker, shares, entry, margin, wipes, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', g, u, q.id, qty, q.priceCents, margin, q.wipes, now);
    }
    award(db, g, u, 'bear', now);
    return { short: getShort(db, g, u, q.id)!, fee, margin };
  });
}

/** Closes a short at a price: profit from the Reserve, a loss out of the margin. Returns what came back. */
export function coverShort(db: Db, s: Short, price: Cents, now = Date.now()): { back: Cents; pnl: Cents } {
  const p = shortPnl(s, price);
  return db.tx(() => {
    db.run('DELETE FROM shorts WHERE guild_id = ? AND user_id = ? AND ticker = ?', s.guild_id, s.user_id, s.ticker);
    const w = wallet(s.guild_id, s.user_id), e = escrow(s.guild_id, s.user_id);
    let back = s.margin;
    if (p < 0) {
      const loss = Math.min(s.margin, -p);
      if (loss > 0) transfer(db, { from: e, to: RESERVE, cents: loss, reason: 'short.loss', guildId: s.guild_id, actorId: s.user_id, now });
      back -= loss;
    }
    if (back > 0) transfer(db, { from: e, to: w, cents: back, reason: 'short.release', guildId: s.guild_id, actorId: s.user_id, now });
    let profit = 0;
    if (p > 0) profit = payFromReserve(db, economy.reserveStart, { to: w, cents: p, reason: 'short.profit', guildId: s.guild_id, actorId: s.user_id, now });
    if (profit >= polygons(1000)) award(db, s.guild_id, s.user_id, 'big_short', now);
    return { back: back + profit, pnl: back + profit - s.margin };
  });
}

/** Each tick: margin calls and bankruptcies. */
export function checkShorts(db: Db, m: MarketData, now = Date.now()): void {
  for (const s of db.all<Short>('SELECT * FROM shorts')) {
    const q = quote(m, s.ticker);
    if (!q) continue;
    const price = settlePrice(s, q);
    if (price === 0) {
      const r = coverShort(db, s, 0, now);
      notify(s.guild_id, s.user_id, `${s.ticker} went bankrupt. Your short paid out in full: ${format(r.back)}.`);
    } else if (-shortPnl(s, price) >= s.margin * SHORTS.call) {
      const r = coverShort(db, s, price, now);
      award(db, s.guild_id, s.user_id, 'margin_call', now);
      notify(s.guild_id, s.user_id, `Margin call: your ${s.ticker} short was covered at ${format(price)}. Returned: ${format(r.back)}.`);
    }
  }
}

// ================================================================ wiring

let installed = false;
export function installSchemes(): void {
  if (installed) return;
  installed = true;
  onTick((db, m, now, rng) => {
    checkOrders(db, m, now);
    for (const r of db.all<BrokerRow>('SELECT * FROM brokers WHERE active = 1')) brokerTick(db, parseBroker(r)!, m, now, rng);
    checkShorts(db, m, now);
  });
  // Orders' set-aside money, and open shorts, are still the player's
  addWorthPart((db, m, g, u) =>
    listOrders(db, g, u).reduce((s, o) => s + o.reserved, 0) +
    listShorts(db, g, u).reduce((s, x) => s + shortWorth(x, settlePrice(x, m ? quote(m, x.ticker) : null)), 0));
}
