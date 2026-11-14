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
  job: string | null;
  hired_at: number | null;
  quit_at: number | null;
  name: string | null;
  title: string | null;
}

/** Called once when a player's account is created in a server (inside the same transaction). */
type NewPlayerHook = (db: Db, guildId: string, userId: string, now: number) => void;
const newPlayerHooks: NewPlayerHook[] = [];
export const onNewPlayer = (fn: NewPlayerHook): void => { newPlayerHooks.push(fn); };

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
    for (const fn of newPlayerHooks) fn(db, guildId, userId, now);
    return { player: db.get<Player>('SELECT * FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)!, isNew: true };
  });
}

// ---------------------------------------------------------------- paying out of the Reserve

/** Below this share of its full size, payouts shrink. At the floor they're a tenth. */
export const RESERVE_RULES = { shrinkBelow: 0.25, minFactor: 0.1 } as const;

/** What share of a payout is actually paid right now (1 = all of it). */
export function payoutFactor(db: Db, fullSize: Cents): number {
  const level = balance(db, RESERVE) / fullSize;
  return level >= RESERVE_RULES.shrinkBelow ? 1 : Math.max(RESERVE_RULES.minFactor, level / RESERVE_RULES.shrinkBelow);
}

export interface Payout { to: string; cents: Cents; reason: string; guildId?: string | null; actorId?: string | null; note?: Record<string, unknown>; now?: number }

/**
 * Pays from the Reserve, shrunk when it's running low, and never more than it holds.
 * Returns what was actually paid (0 if the Reserve is empty).
 */
export function payFromReserve(db: Db, fullSize: Cents, p: Payout): Cents {
  return db.tx(() => {
    const want = Math.floor(p.cents * payoutFactor(db, fullSize));
    const paid = Math.min(want, balance(db, RESERVE));
    if (paid > 0) {
      transfer(db, { from: RESERVE, ...p, cents: paid });
      for (const fn of payoutHooks) fn(db, p, paid);
    }
    return paid;
  });
}

/** Runs after every Reserve payout (loans use it to garnish earnings for overdue debts). */
type PayoutHook = (db: Db, p: Payout, paid: Cents) => void;
const payoutHooks: PayoutHook[] = [];
export const onPayout = (fn: PayoutHook): void => { payoutHooks.push(fn); };
