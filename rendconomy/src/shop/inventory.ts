// Inventories (items a player owns in a server) and effects (what an item is doing right now).
import type { Db } from '../core/db';

export function count(db: Db, guildId: string, userId: string, item: string): number {
  return db.get<{ qty: number }>('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item = ?', guildId, userId, item)?.qty ?? 0;
}

export function addItem(db: Db, guildId: string, userId: string, item: string, n = 1): void {
  db.run(`INSERT INTO inventory (guild_id, user_id, item, qty) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, item) DO UPDATE SET qty = qty + excluded.qty`, guildId, userId, item, n);
}

/** Takes one (or n) of an item. Returns false, changing nothing, if they don't have enough. */
export function takeItem(db: Db, guildId: string, userId: string, item: string, n = 1): boolean {
  const r = db.run('UPDATE inventory SET qty = qty - ? WHERE guild_id = ? AND user_id = ? AND item = ? AND qty >= ?', n, guildId, userId, item, n);
  if (r.changes === 1) db.run('DELETE FROM inventory WHERE guild_id = ? AND user_id = ? AND item = ? AND qty = 0', guildId, userId, item);
  return r.changes === 1;
}

export function items(db: Db, guildId: string, userId: string): { item: string; qty: number }[] {
  return db.all<{ item: string; qty: number }>('SELECT item, qty FROM inventory WHERE guild_id = ? AND user_id = ? AND qty > 0 ORDER BY item', guildId, userId);
}

// ---------------------------------------------------------------- effects

/** Adds charges to an effect (Overtime: 1 shift, Stopwatch: 3 shifts). */
export function addEffect(db: Db, guildId: string, userId: string, key: string, charges: number): void {
  db.run(`INSERT INTO effects (guild_id, user_id, key, value) VALUES (?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id, key) DO UPDATE SET value = value + excluded.value`, guildId, userId, key, charges);
}

/** Uses one charge of an effect. Returns true if there was one. */
export function useEffect(db: Db, guildId: string, userId: string, key: string): boolean {
  const r = db.run('UPDATE effects SET value = value - 1 WHERE guild_id = ? AND user_id = ? AND key = ? AND value > 0', guildId, userId, key);
  if (r.changes === 1) db.run('DELETE FROM effects WHERE guild_id = ? AND user_id = ? AND key = ? AND value <= 0 AND until IS NULL', guildId, userId, key);
  return r.changes === 1;
}

export function charges(db: Db, guildId: string, userId: string, key: string): number {
  return db.get<{ value: number }>('SELECT value FROM effects WHERE guild_id = ? AND user_id = ? AND key = ?', guildId, userId, key)?.value ?? 0;
}

/** Starts (or extends) a timed effect (Dividend Booster: 24 hours). */
export function startTimed(db: Db, guildId: string, userId: string, key: string, ms: number, now = Date.now()): number {
  const current = timedUntil(db, guildId, userId, key, now);
  const until = Math.max(current, now) + ms;
  db.run(`INSERT INTO effects (guild_id, user_id, key, value, until) VALUES (?, ?, ?, 0, ?)
    ON CONFLICT(guild_id, user_id, key) DO UPDATE SET until = excluded.until`, guildId, userId, key, until);
  return until;
}

export function timedUntil(db: Db, guildId: string, userId: string, key: string, now = Date.now()): number {
  const u = db.get<{ until: number | null }>('SELECT until FROM effects WHERE guild_id = ? AND user_id = ? AND key = ?', guildId, userId, key)?.until ?? 0;
  return u && u > now ? u : 0;
}
