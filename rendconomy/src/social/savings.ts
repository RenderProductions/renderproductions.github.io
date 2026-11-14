// Savings accounts: lock Polygons away for 3, 7 or 14 days and get them back with interest.
// The Polygons sit in their own ledger account while locked (they still count toward net worth).
// Interest is paid from the Reserve, so it shrinks while the Reserve is low. Closing early returns
// what was put in, without interest.
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { balance, ensureAccount, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import { DAY } from '../core/time';

export const SAVINGS = {
  /** days -> interest at the end, in basis points (2%, 6%, 15%) */
  plans: { 3: 200, 7: 600, 14: 1500 } as Record<number, number>,
  min: polygons(100),
  maxTotal: polygons(50_000),
  maxAccounts: 3
};

export interface SavingsAccount { id: number; guild_id: string; user_id: string; amount: Cents; rate_bp: number; days: number; opened_at: number; ends_at: number }

export const accountId = (id: number): string => `savings:${id}`;
export const interestOf = (a: SavingsAccount): Cents => Math.floor((a.amount * a.rate_bp) / 10000);

export function list(db: Db, guildId: string, userId: string): SavingsAccount[] {
  return db.all<SavingsAccount>('SELECT * FROM savings WHERE guild_id = ? AND user_id = ? ORDER BY ends_at', guildId, userId);
}
const total = (db: Db, guildId: string, userId: string): Cents => list(db, guildId, userId).reduce((s, a) => s + a.amount, 0);

export function deposit(db: Db, guildId: string, userId: string, cents: Cents, days: number, now = Date.now()): SavingsAccount {
  const rate = SAVINGS.plans[days];
  if (!rate) throw new GameError('savings.plan', `Choose a plan: ${Object.keys(SAVINGS.plans).join(', ')} days.`);
  if (cents < SAVINGS.min) throw new GameError('savings.min', `The minimum deposit is ${format(SAVINGS.min)}.`);
  if (list(db, guildId, userId).length >= SAVINGS.maxAccounts) throw new GameError('savings.accounts', `At most ${SAVINGS.maxAccounts} savings accounts can be open at once.`);
  const room = SAVINGS.maxTotal - total(db, guildId, userId);
  if (cents > room) throw new GameError('savings.max', `At most ${format(SAVINGS.maxTotal)} can be saved. Remaining room: ${format(Math.max(0, room))}.`);
  return db.tx(() => {
    const id = db.run('INSERT INTO savings (guild_id, user_id, amount, rate_bp, days, opened_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      guildId, userId, cents, rate, days, now, now + days * DAY).lastInsertRowid;
    ensureAccount(db, accountId(id), 'savings', guildId, userId, now);
    transfer(db, { from: wallet(guildId, userId), to: accountId(id), cents, reason: 'savings.deposit', guildId, actorId: userId, now });
    return db.get<SavingsAccount>('SELECT * FROM savings WHERE id = ?', id)!;
  });
}

export interface Closed { account: SavingsAccount; interest: Cents; early: boolean }

/** Closes an account: matured ones pay interest, early ones don't. */
export function close(db: Db, a: SavingsAccount, now = Date.now()): Closed {
  const early = now < a.ends_at;
  return db.tx(() => {
    const w = wallet(a.guild_id, a.user_id);
    const held = balance(db, accountId(a.id));
    if (held > 0) transfer(db, { from: accountId(a.id), to: w, cents: held, reason: 'savings.return', guildId: a.guild_id, actorId: a.user_id, now });
    db.run('DELETE FROM savings WHERE id = ?', a.id);
    const interest = early ? 0 : payFromReserve(db, economy.reserveStart, { to: w, cents: interestOf(a), reason: 'savings.interest', guildId: a.guild_id, actorId: a.user_id, now });
    return { account: a, interest, early };
  });
}

/** Pays out every account that has finished. */
export function collect(db: Db, guildId: string, userId: string, now = Date.now()): Closed[] {
  return list(db, guildId, userId).filter((a) => a.ends_at <= now).map((a) => close(db, a, now));
}
