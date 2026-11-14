// Achievements: earned once, kept forever (through the reset too), and they follow a player across
// servers. Each pays out once by rarity, from the Reserve, in the server it was unlocked in.
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve, player } from '../core/economy';
import { emit } from '../core/events';
import { wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import { currentRequest } from '../core/request';
import { ACHIEVEMENTS, BY_ID, RARITY } from './list';

/** Tests that check exact balances switch payouts off. */
export const TUNING = { pay: true };

export const has = (db: Db, userId: string, id: string): boolean => !!db.get('SELECT 1 FROM achievements WHERE user_id = ? AND id = ?', userId, id);

export function unlocked(db: Db, userId: string): { id: string; guild_id: string | null; unlocked_at: number }[] {
  return db.all<{ id: string; guild_id: string | null; unlocked_at: number }>('SELECT id, guild_id, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at', userId)
    .filter((r) => BY_ID[r.id]);
}

/**
 * Unlocks an achievement: records it, pays its reward in that server, and announces it on the reply
 * when the player is the one using the command. Returns the announcement, or '' if they had it already.
 */
export function award(db: Db, guildId: string | null, userId: string, id: string, now = Date.now()): string {
  const a = BY_ID[id];
  if (!a) throw new Error(`Unknown achievement: ${id}`);
  const r = db.run('INSERT OR IGNORE INTO achievements (user_id, id, guild_id, unlocked_at) VALUES (?, ?, ?, ?)', userId, id, guildId, now);
  if (r.changes === 0) return '';
  const rarity = RARITY[a.rarity];
  let line = `**Achievement unlocked:** ${rarity.emoji} **${a.name}**: ${a.desc}.`;
  if (guildId && TUNING.pay) {
    player(db, guildId, userId, economy.startingCash, now);
    const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: rarity.pay, reason: 'achievement', guildId, actorId: userId, now, note: { id } });
    if (paid > 0) line += ` Reward: ${format(paid)}.`;
  }
  emit('achievement.unlocked', { guildId, userId, id });
  const req = currentRequest();
  if (req && req.userId === userId) req.notes.push(line);
  if (id !== 'completionist') {
    const n = db.get<{ n: number }>("SELECT COUNT(*) AS n FROM achievements WHERE user_id = ? AND id != 'completionist'", userId)!.n;
    if (n >= ACHIEVEMENTS.length - 1) {
      const more = award(db, guildId, userId, 'completionist', now);
      if (more) line += '\n' + more;
    }
  }
  return line;
}

/** Awards in the current request (the usual case: something the player just did). */
export function awardHere(id: string, userId?: string): string {
  const req = currentRequest();
  if (!req) return '';
  return award(req.db, req.guildId, userId ?? req.userId, id, req.now);
}

// ---------------------------------------------------------------- counters

export function bump(db: Db, userId: string, key: string, by = 1): number {
  db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = value + excluded.value', userId, key, by);
  return getProgress(db, userId, key);
}
export function setProgress(db: Db, userId: string, key: string, value: number): void {
  db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value', userId, key, value);
}
export function getProgress(db: Db, userId: string, key: string): number {
  return db.get<{ value: number }>('SELECT value FROM progress WHERE user_id = ? AND key = ?', userId, key)?.value ?? 0;
}

/** Share of players who have each achievement. */
export function rarityStats(db: Db): { players: number; pct: (id: string) => number } {
  const players = db.get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM players')!.n;
  const counts = Object.fromEntries(db.all<{ id: string; n: number }>('SELECT id, COUNT(*) AS n FROM achievements GROUP BY id').map((r) => [r.id, r.n]));
  return { players, pct: (id) => (players ? Math.round(((counts[id] ?? 0) / players) * 1000) / 10 : 0) };
}

/** What a player's achievements unlocked in a server are worth (the fresh-start payout after the reset). */
export function payoutValue(db: Db, guildId: string, userId: string): Cents {
  return unlocked(db, userId).filter((r) => r.guild_id === guildId).reduce((s, r) => s + RARITY[BY_ID[r.id]!.rarity].pay, 0);
}
