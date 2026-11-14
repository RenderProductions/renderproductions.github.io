// Erasing players. Every table that holds per-player data is listed here, so a new system only has to
// add its table to PLAYER_TABLES to be covered by /wipe.
import type { Db } from './db';
import { RESERVE, transfer } from './ledger';

/** Tables keyed by (guild_id, user_id). Add new per-player tables here. */
export const PLAYER_TABLES: string[] = ['holdings', 'lots', 'careers', 'savings', 'inventory', 'effects', 'shop_buys', 'casino', 'gambling', 'orders', 'brokers', 'shorts', 'lottery', 'chat_pay', 'company_holdings', 'sessions', 'players'];

/** Hooks for systems whose data isn't a simple (guild_id, user_id) table. */
const extraErasers: ((db: Db, guildId: string, userId: string) => void)[] = [];
export const onErase = (fn: (db: Db, guildId: string, userId: string) => void): void => { extraErasers.push(fn); };

/**
 * Erases one player's data in one server. Their Polygons (wallet, savings) go back to the Reserve, so
 * the books still balance; then every trace of them is deleted, including their ledger history.
 */
export function erasePlayer(db: Db, guildId: string, userId: string, now = Date.now()): void {
  db.tx(() => {
    const accounts = db.all<{ id: string; balance: number }>('SELECT id, balance FROM accounts WHERE guild_id = ? AND owner_id = ?', guildId, userId);
    for (const a of accounts) {
      if (a.balance > 0) transfer(db, { from: a.id, to: RESERVE, cents: a.balance, reason: 'wipe', guildId, now });
    }
    for (const a of accounts) {
      db.run('DELETE FROM ledger WHERE from_id = ? OR to_id = ?', a.id, a.id);
      db.run('DELETE FROM accounts WHERE id = ?', a.id);
    }
    for (const t of PLAYER_TABLES) db.run(`DELETE FROM ${t} WHERE guild_id = ? AND user_id = ?`, guildId, userId);
    db.run('DELETE FROM cooldowns WHERE subject = ? OR subject LIKE ?', `${guildId}:${userId}`, `${guildId}:${userId}:%`);
    db.run('DELETE FROM loans WHERE guild_id = ? AND (lender_id = ? OR borrower_id = ?)', guildId, userId, userId);
    for (const fn of extraErasers) fn(db, guildId, userId);
  });
}

/** Erases every player in a server. Returns how many. */
export function eraseServer(db: Db, guildId: string, now = Date.now()): number {
  const ids = db.all<{ user_id: string }>('SELECT user_id FROM players WHERE guild_id = ?', guildId).map((r) => r.user_id);
  db.tx(() => { for (const id of ids) erasePlayer(db, guildId, id, now); });
  return ids.length;
}
