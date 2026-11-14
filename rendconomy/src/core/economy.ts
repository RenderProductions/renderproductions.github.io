// Economy setup on top of the ledger: funding the Reserve once, and creating players.
import type { Db } from './db';
import { RESERVE, ensureAccount, ensureWallet, mint, transfer, balance } from './ledger';
import type { Cents } from './money';

/** Funds the Reserve the first time the database is used. Safe to call on every start. */
export function ensureReserve(db: Db, startCents: Cents, now = Date.now()): void {
  db.tx(() => {
    ensureAccount(db, RESERVE, 'reserve', null, null, now);
    if (db.meta('reserve.funded') !== null) return;
    mint(db, startCents, 'reserve.fund', { now });
    db.setMeta('reserve.funded', now);
  });
}

export interface Player {
  guild_id: string;
  user_id: string;
  joined_at: number;
  daily_day: string | null;
  daily_streak: number;
  frozen: number;
}

/**
 * Gets a player in a server, creating them (with a wallet and their starting Polygons, paid from
 * the Reserve) the first time. Returns the player and whether they're new.
 */
export function player(db: Db, guildId: string, userId: string, startingCash: Cents, now = Date.now()): { player: Player; isNew: boolean } {
  return db.tx(() => {
    const existing = db.get<Player>('SELECT * FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId);
    if (existing) return { player: existing, isNew: false };
    db.run('INSERT INTO players (guild_id, user_id, joined_at) VALUES (?, ?, ?)', guildId, userId, now);
    const w = ensureWallet(db, guildId, userId, now);
    if (startingCash > 0 && balance(db, RESERVE) >= startingCash) {
      transfer(db, { from: RESERVE, to: w, cents: startingCash, reason: 'start', guildId, actorId: userId, now });
    }
    return { player: db.get<Player>('SELECT * FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)!, isNew: true };
  });
}
