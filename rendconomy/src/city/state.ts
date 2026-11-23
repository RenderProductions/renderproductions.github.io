// Under New Management: what a server's city government has switched on right now, read by the rest of the bot
// (the shop's sales tax, rent, casino winnings, shift pay, frozen companies...). Only database reads here and no
// imports from other systems, so anything can use it without import cycles. The mayor's actions are in city.ts.
import type { Db } from '../core/db';
import { DAY, dayKey, easternAt, nextDay } from '../core/time';

export const cityAccount = (guildId: string): string => `city:${guildId}`;

// ---------------------------------------------------------------- terms (a week, Sunday 9 PM to Sunday 9 PM Eastern)

const weekday = (key: string): number => new Date(`${key}T12:00:00Z`).getUTCDay();   // 0 Sunday … 6 Saturday
const addDays = (key: string, n: number): string => { let k = key; for (let i = 0; i < n; i++) k = nextDay(k); return k; };
/** The Monday (Eastern) that starts the election week `at` falls in. */
export function weekOf(at: number): string {
  let k = dayKey(at);
  const back = (weekday(k) + 6) % 7;
  for (let i = 0; i < back; i++) k = new Date(Date.parse(`${k}T12:00:00Z`) - DAY).toISOString().slice(0, 10);
  return k;
}
export const nextWeek = (week: string): string => addDays(week, 7);
export const prevWeek = (week: string): string => new Date(Date.parse(`${week}T12:00:00Z`) - 7 * DAY).toISOString().slice(0, 10);
/** When the election held in `week` closes and its winner takes office: that Sunday, 9 PM Eastern. */
export const closesAt = (week: string): number => easternAt(addDays(week, 6), 21);
/** When voting opens in `week`: Friday, midnight Eastern. */
export const votingOpensAt = (week: string): number => easternAt(addDays(week, 4), 0);

export type Phase = 'nominations' | 'voting' | 'closed';
export function phaseOf(at: number): { week: string; phase: Phase } {
  const week = weekOf(at);
  if (at >= closesAt(week)) return { week: nextWeek(week), phase: 'nominations' };   // Sunday night: next week's race is open
  return { week, phase: at >= votingOpensAt(week) ? 'voting' : 'nominations' };
}

// ---------------------------------------------------------------- the mayor

export interface Term { guild_id: string; week: string; user_id: string; votes: number; total: number; starts_at: number; ends_at: number; impeached_at: number | null }
/** The mayor in office right now (null: nobody won, or they were impeached). Elections are counted by city.ts. */
export function mayorTerm(db: Db, guildId: string, now = Date.now()): Term | null {
  return db.get<Term>('SELECT * FROM mayors WHERE guild_id = ? AND starts_at <= ? AND ends_at > ? AND impeached_at IS NULL ORDER BY starts_at DESC LIMIT 1', guildId, now, now) ?? null;
}

// ---------------------------------------------------------------- policy (set by the mayor; belongs to their term)

export interface Policy {
  shop: number; property: number; casino: number;          // tax rates, 0..1
  collectFee: number; graceDays: number;                   // Collect Call
  treasurer: string | null; chief: string | null;
  /** Tax changes wait until the next day, so nobody is ambushed. */
  pending: { key: 'shop' | 'property' | 'casino'; rate: number; from: number }[];
}
export const DEFAULT_POLICY: Policy = { shop: 0, property: 0, casino: 0, collectFee: 0.1, graceDays: 3, treasurer: null, chief: null, pending: [] };

export function policyOf(db: Db, guildId: string, now = Date.now()): Policy {
  const t = mayorTerm(db, guildId, now);
  if (!t) return { ...DEFAULT_POLICY };
  let p: Policy;
  try { p = { ...DEFAULT_POLICY, ...(JSON.parse(db.meta(`city.policy:${guildId}:${t.week}`) ?? '{}') as Partial<Policy>) }; } catch { p = { ...DEFAULT_POLICY }; }
  for (const c of p.pending) if (c.from <= now) p[c.key] = c.rate;
  p.pending = p.pending.filter((c) => c.from > now);
  return p;
}
export function savePolicy(db: Db, guildId: string, week: string, p: Policy): void { db.setMeta(`city.policy:${guildId}:${week}`, JSON.stringify(p)); }
/** Midnight Eastern tonight: when a tax change takes effect. */
export const tomorrow = (now: number): number => easternAt(nextDay(dayKey(now)), 0);

export const shopTax = (db: Db, g: string, now = Date.now()): number => policyOf(db, g, now).shop;
export const propertyTax = (db: Db, g: string, now = Date.now()): number => policyOf(db, g, now).property;
export const casinoTax = (db: Db, g: string, now = Date.now()): number => policyOf(db, g, now).casino;

// ---------------------------------------------------------------- public works and decrees in effect

export type WorkEffect = 'rent' | 'chat' | 'shifts' | 'crops' | 'happyhour';
export interface Work { id: number; guild_id: string; effect: WorkEffect; name: string; size: number; starts_at: number; ends_at: number; cost: number }
export const worksNow = (db: Db, g: string, now = Date.now()): Work[] =>
  db.all<Work>('SELECT * FROM city_works WHERE guild_id = ? AND starts_at <= ? AND ends_at > ? ORDER BY ends_at', g, now, now);
/** The extra a running public work gives (0.1 = +10%); a chat work's size is its extra too (×1.5 → 0.5). */
export const workBonus = (db: Db, g: string, effect: WorkEffect, now = Date.now()): number =>
  worksNow(db, g, now).filter((w) => w.effect === effect).reduce((s, w) => s + w.size, 0);

export type Decree = 'happyhour' | 'noheist' | 'doubledaily' | 'marketholiday' | 'amnesty';
/** A decree with a duration that's running now. */
export const decreeOn = (db: Db, g: string, d: Decree, now = Date.now()): boolean => Number(db.meta(`city.decree:${g}:${d}`) ?? 0) > now;
export const happyHourHere = (db: Db, g: string, now = Date.now()): boolean => decreeOn(db, g, 'happyhour', now) || workBonus(db, g, 'happyhour', now) > 0;

// ---------------------------------------------------------------- business powers in effect

/** A player company whose trading the mayor froze (or a market holiday): when it opens again, else 0. */
export function frozenUntil(db: Db, guildId: string | null, ticker: string, now = Date.now()): number {
  const t = Number(db.meta(`city.freeze:${ticker}`) ?? 0);
  const holiday = guildId && decreeOn(db, guildId, 'marketholiday', now) ? Number(db.meta(`city.decree:${guildId}:marketholiday`)) : 0;
  return Math.max(t > now ? t : 0, holiday);
}
export const investigated = (db: Db, g: string, u: string, now = Date.now()): boolean => Number(db.meta(`city.investigate:${g}:${u}`) ?? 0) > now;

// ---------------------------------------------------------------- the public record

export function cityLog(db: Db, g: string, actor: string | null, action: string, detail: string, cents = 0, now = Date.now()): void {
  db.run('INSERT INTO city_log (guild_id, at, actor_id, action, detail, cents) VALUES (?, ?, ?, ?, ?, ?)', g, now, actor, action, detail.slice(0, 500), cents);
}

/** Records a day a player was active in a server (any command). Candidates need 3 of the last 7. */
export function markActive(db: Db, g: string, u: string, now = Date.now()): void {
  db.run('INSERT OR IGNORE INTO activity (guild_id, user_id, day) VALUES (?, ?, ?)', g, u, dayKey(now));
}
export const activeDays = (db: Db, g: string, u: string, now = Date.now()): number =>
  db.get<{ n: number }>('SELECT COUNT(*) AS n FROM activity WHERE guild_id = ? AND user_id = ? AND day > ?', g, u, dayKey(now - 7 * DAY))!.n;
export const activePlayers = (db: Db, g: string, now = Date.now()): number =>
  db.get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM activity WHERE guild_id = ? AND day > ?', g, dayKey(now - 7 * DAY))!.n;
