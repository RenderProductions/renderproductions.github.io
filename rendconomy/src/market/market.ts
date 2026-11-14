// The market: runs the price engine every 5 minutes and answers "what does this stock cost right now?".
// Prices and the engine's hidden state live in the database, so a restart picks up exactly where it was.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import type { Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { ENGINE, TICK_MS, type MarketData, type MarketPost } from './engine';

export const KEY = { data: 'market.data', state: 'market.state', crash: 'market.crash', boost: 'market.boost', nudges: 'market.nudges' } as const;

const readJson = <T>(db: Db, key: string): T | null => {
  const raw = db.meta(key);
  if (raw === null) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
};
const writeJson = (db: Db, key: string, value: unknown) => db.setMeta(key, JSON.stringify(value));

/** The current market, or null before the first tick. */
export const load = (db: Db): MarketData | null => readJson<MarketData>(db, KEY.data);

/** Tickers of the house companies, in board order. */
export const TICKERS: readonly string[] = ENGINE.COMPANIES.map((c) => c.id);

/** Starting prices, in cents (what the reset restores). */
export const startingPrices = (): Record<string, Cents> =>
  Object.fromEntries(ENGINE.COMPANIES.map((c) => [c.id, Math.round(c.start * 100)]));

/** Runs after every tick with the new prices (orders, brokers, shorts, companies...). */
type TickHook = (db: Db, m: MarketData, now: number, rng: Rng) => void;
const tickHooks: TickHook[] = [];
export const onTick = (fn: TickHook): void => { tickHooks.push(fn); };

/** Moves the market forward one step. Returns the news posts it produced (empty if nothing changed). */
export function tick(db: Db, rng: Rng, now = Date.now()): MarketPost[] {
  ENGINE.configure({ crash: readJson(db, KEY.crash) ?? {}, boost: readJson(db, KEY.boost) ?? {} });
  const r = ENGINE.tick({
    old: load(db) ?? {}, state: readJson(db, KEY.state), now,
    rand: () => rng.next(), nudges: readJson<Record<string, number>>(db, KEY.nudges) ?? {}
  });
  if (r.skip) return [];
  db.tx(() => {
    writeJson(db, KEY.data, r.data);
    writeJson(db, KEY.state, r.state);
    db.setMeta(KEY.nudges, '{}');
    // This hour's closing price, kept for 7 days
    const hour = Math.floor(now / 3_600_000) * 3_600_000;
    for (const [t, p] of Object.entries(r.data.prices)) if (Number.isFinite(Number(p))) db.run('INSERT OR REPLACE INTO price_history (ticker, hour, price) VALUES (?, ?, ?)', t, hour, Number(p));
    db.run('DELETE FROM price_history WHERE hour < ?', now - 7 * 24 * 3_600_000);
  });
  for (const fn of tickHooks) {
    try { db.tx(() => fn(db, r.data, now, rng)); } catch (e) { console.error('[market] tick hook failed:', e); }
  }
  return r.posts;
}

/** Work shifts and events nudge a stock (log terms), applied on the next tick. */
export function nudge(db: Db, ticker: string, amount: number): void {
  if (!amount) return;
  const n = readJson<Record<string, number>>(db, KEY.nudges) ?? {};
  n[ticker] = (n[ticker] ?? 0) + amount;
  writeJson(db, KEY.nudges, n);
}

/** Runs the market: one tick now if it has never run, then every 5 minutes on the mark. */
export function start(db: Db, rng: Rng, onPosts: (posts: MarketPost[]) => void = () => {}): () => void {
  const step = () => {
    try { const posts = tick(db, rng); if (posts.length) onPosts(posts); }
    catch (e) { console.error('[market] tick failed:', e); }
  };
  if (!load(db)) step();
  let interval: NodeJS.Timeout | undefined;
  const first = setTimeout(() => { step(); interval = setInterval(step, TICK_MS); }, TICK_MS - (Date.now() % TICK_MS) + 2000);
  return () => { clearTimeout(first); if (interval) clearInterval(interval); };
}

export interface Quote {
  id: string;
  name: string;
  priceCents: Cents;
  change: number;
  status: string;
  statusText: string;
  wipes: number;
  spark: string;
}

export function quote(m: MarketData, ticker: string): Quote | null {
  const id = ticker.trim().toUpperCase();
  const c = m.companies.find((x) => x.id === id);
  if (!c) return null;
  const price = m.prices[id] ?? c.price;
  return {
    id, name: m.names?.[id] ?? c.name,
    priceCents: Math.round(price * 100),
    change: m.changes?.[id] ?? c.change ?? 0,
    status: m.statuses?.[id] ?? c.status ?? 'ok',
    statusText: m.statusText?.[id] ?? '',
    wipes: Number(m.wipes?.[id] ?? c.wipes ?? 0),
    spark: m.sparks?.[id] ?? ''
  };
}

/** The market, or a GameError if it hasn't started yet. */
export function current(db: Db): MarketData {
  const m = load(db);
  if (!m) throw new GameError('market.offline', 'The market is not available yet. Try again shortly.');
  return m;
}

/** Why trading is blocked right now, or null if it's open. */
export function closedReason(m: MarketData): string | null {
  const mk = m.market;
  if (mk.halted) return 'Trading is halted. ' + stripMarkdown(mk.text);
  if (mk.status !== 'open') return 'The market is closed. ' + stripMarkdown(mk.text);
  return null;
}

const stripMarkdown = (s: string) => String(s ?? '').replace(/\*\*/g, '');
