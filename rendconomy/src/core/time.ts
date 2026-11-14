// Time rules. The bot's day runs on Eastern time: every daily resets at 12 AM Eastern for everyone,
// and a streak continues if the last claim was "yesterday" (the previous Eastern date).
import type { Db } from './db';

export const ZONE = 'America/New_York';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** The Eastern calendar date of an instant, as YYYY-MM-DD. */
export function dayKey(at: number = Date.now()): string {
  return fmt.format(new Date(at));
}

/** The date before a YYYY-MM-DD date. */
export function previousDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/** The date after a YYYY-MM-DD date. */
export function nextDay(key: string): string {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** The instant of the next 12 AM Eastern after `at`. Handles daylight saving (04:00 or 05:00 UTC). */
export function nextReset(at: number = Date.now()): number {
  const tomorrow = nextDay(dayKey(at));
  const [y, m, d] = tomorrow.split('-').map(Number) as [number, number, number];
  // Midnight Eastern is 04:00 UTC in summer (EDT) and 05:00 UTC in winter (EST).
  for (const hour of [4, 5]) {
    const t = Date.UTC(y, m - 1, d, hour);
    if (dayKey(t) === tomorrow && dayKey(t - 1) !== tomorrow) return t;
  }
  throw new Error(`Could not find midnight Eastern for ${tomorrow}`);
}

/** "3h 12m", "45s": how long until something, for cooldown messages. */
export function duration(ms: number): string {
  const s = Math.max(1, Math.ceil(ms / SECOND));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const parts = d ? [`${d}d`, `${h}h`] : h ? [`${h}h`, `${m}m`] : m ? [`${m}m`, sec ? `${sec}s` : ''] : [`${sec}s`];
  return parts.filter(Boolean).join(' ');
}

/** Discord's live timestamp: shows "in 3 hours" in each reader's own time zone. */
export const discordTime = (at: number, style: 'R' | 't' | 'f' = 'R'): string => `<t:${Math.floor(at / 1000)}:${style}>`;

// ---------------------------------------------------------------- daily claims

export interface DailyCheck {
  /** True if the player can claim now. */
  ready: boolean;
  /** The streak they'd have after claiming now (or have now, if not ready). */
  streak: number;
  /** When the next daily opens (the next 12 AM Eastern). */
  resetsAt: number;
}

/** Works out a daily claim from the last claimed date and streak. Pure: doesn't touch the database. */
export function checkDaily(lastDay: string | null, streak: number, now: number = Date.now()): DailyCheck {
  const today = dayKey(now);
  const resetsAt = nextReset(now);
  if (lastDay === today) return { ready: false, streak, resetsAt };
  const continues = lastDay !== null && lastDay === previousDay(today);
  return { ready: true, streak: continues ? streak + 1 : 1, resetsAt };
}

// ---------------------------------------------------------------- cooldowns

export interface CooldownState { ready: boolean; remaining: number; until: number }

export function cooldown(db: Db, name: string, subject: string, now = Date.now()): CooldownState {
  const until = db.get<{ until: number }>('SELECT until FROM cooldowns WHERE name = ? AND subject = ?', name, subject)?.until ?? 0;
  return { ready: until <= now, remaining: Math.max(0, until - now), until };
}

/** Starts (or restarts) a cooldown. */
export function startCooldown(db: Db, name: string, subject: string, ms: number, now = Date.now()): number {
  const until = now + ms;
  db.run('INSERT INTO cooldowns (name, subject, until) VALUES (?, ?, ?) ON CONFLICT(name, subject) DO UPDATE SET until = excluded.until', name, subject, until);
  return until;
}

/**
 * Starts a cooldown only if it isn't already running, in one statement, so two clicks at once
 * can't both get through. Returns true if this call started it.
 */
export function takeCooldown(db: Db, name: string, subject: string, ms: number, now = Date.now()): boolean {
  const r = db.run(
    `INSERT INTO cooldowns (name, subject, until) VALUES (?, ?, ?)
     ON CONFLICT(name, subject) DO UPDATE SET until = excluded.until WHERE cooldowns.until <= ?`,
    name, subject, now + ms, now
  );
  return r.changes === 1;
}

export function clearCooldown(db: Db, name: string, subject: string): void {
  db.run('DELETE FROM cooldowns WHERE name = ? AND subject = ?', name, subject);
}

/** Drops cooldowns that have finished. Run now and then; they're harmless either way. */
export function pruneCooldowns(db: Db, now = Date.now()): number {
  return db.run('DELETE FROM cooldowns WHERE until <= ?', now).changes;
}
