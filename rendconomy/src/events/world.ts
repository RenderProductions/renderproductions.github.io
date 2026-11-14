// World events: every few hours something happens across the whole economy for an hour, announced in the
// market news. Some follow the market: a booming company gets a hiring spree, a sliding one a fire sale.
import type { Db } from '../core/db';
import type { Rng } from '../core/rng';
import { HOUR } from '../core/time';
import type { MarketData } from '../market/engine';

export const EVENTS: Record<string, { emoji: string; name: string; desc: (t?: string) => string }> = {
  labor_shortage: { emoji: '👷', name: 'Labor Shortage', desc: () => 'Nobody wants to work. Shifts and gigs pay **1.5x**.' },
  fish_frenzy: { emoji: '🎣', name: 'Fish Frenzy', desc: () => 'The fish are biting. Cast every **90 seconds**, and plain bait works like a lure.' },
  police_strike: { emoji: '🚔', name: 'Police Strike', desc: () => "TODD's security team walked out. Heists get **+15%** odds." },
  bear_rumors: { emoji: '🐻', name: 'Bear Rumors', desc: () => 'Everyone smells a drop. Shorts open with **no fee**.' },
  chatty: { emoji: '💬', name: 'Gossip Hour', desc: () => 'Chat pay is **doubled**, and so is the daily cap.' },
  spotlight: { emoji: '🔦', name: 'Hiring Spree', desc: (t) => `**${t}** is hiring heavily. Its shifts pay **2x**.` },
  fire_sale: { emoji: '🔥', name: 'Fire Sale', desc: (t) => `**${t}** is sliding. Shorts on it open with **no fee**.` }
};
export const WORLD = { lengthMs: HOUR, gapMinMs: 3 * HOUR, gapMaxMs: 6 * HOUR, firstMs: HOUR };

export interface WorldEvent { id?: string; ticker?: string; until?: number; next?: number }
const read = (db: Db): WorldEvent => { try { return JSON.parse(db.meta('world.event') ?? '{}') as WorldEvent; } catch { return {}; } };
const write = (db: Db, e: WorldEvent) => db.setMeta('world.event', JSON.stringify(e));

export function activeEvent(db: Db, now = Date.now()): WorldEvent | null { const s = read(db); return s.id && (s.until ?? 0) > now ? s : null; }
export const isEvent = (db: Db, id: string, ticker?: string, now = Date.now()): boolean => { const e = activeEvent(db, now); return !!e && e.id === id && (!ticker || e.ticker === ticker); };
export const describeEvent = (e: WorldEvent): string => { const E = EVENTS[e.id!]!; return `${E.emoji} **${E.name}**: ${E.desc(e.ticker)}`; };

export function pickEvent(m: MarketData | null, rng: Rng): WorldEvent {
  const changes = m ? m.companies.map((c) => [c.id, Number(m.changes?.[c.id] ?? 0)] as const).filter(([id]) => m.statuses?.[id] !== 'bankrupt') : [];
  const up = changes.filter(([, x]) => x >= 8).sort((a, b) => b[1] - a[1])[0];
  const down = changes.filter(([, x]) => x <= -8).sort((a, b) => a[1] - b[1])[0];
  const r = rng.next();
  if (up && r < 0.3) return { id: 'spotlight', ticker: up[0] };
  if (down && r < 0.6) return { id: 'fire_sale', ticker: down[0] };
  return { id: rng.pick(['labor_shortage', 'fish_frenzy', 'police_strike', 'bear_rumors', 'chatty']) };
}

/** Once per market tick. Returns an event that just started (to announce), or null. */
export function worldTick(db: Db, m: MarketData | null, now: number, rng: Rng): WorldEvent | null {
  const s = read(db);
  if (!s.next) { write(db, { next: now + WORLD.firstMs }); return null; }
  if (s.id && (s.until ?? 0) > now) return null;
  if (now < s.next) { if (s.id) write(db, { next: s.next }); return null; }
  const e: WorldEvent = { ...pickEvent(m, rng), until: now + WORLD.lengthMs };
  e.next = e.until! + WORLD.gapMinMs + Math.floor(rng.next() * (WORLD.gapMaxMs - WORLD.gapMinMs));
  write(db, e);
  return e;
}

/** Starts a specific event now (the bot owner's /event start). */
export function startEvent(db: Db, id: string, ticker: string | undefined, now: number): WorldEvent {
  const s = read(db);
  const e: WorldEvent = { id, ticker, until: now + WORLD.lengthMs, next: Math.max(s.next ?? 0, now + WORLD.lengthMs + WORLD.gapMinMs) };
  write(db, e);
  return e;
}
export const endEvent = (db: Db): void => { const s = read(db); write(db, { next: s.next }); };

// Effects, read by the systems they change
export const shiftMultiplier = (db: Db, ticker: string | null, now = Date.now()): number =>
  (isEvent(db, 'labor_shortage', undefined, now) ? 1.5 : 1) * (ticker && isEvent(db, 'spotlight', ticker, now) ? 2 : 1);
export const heistBonus = (db: Db, now = Date.now()): number => (isEvent(db, 'police_strike', undefined, now) ? 0.15 : 0);
