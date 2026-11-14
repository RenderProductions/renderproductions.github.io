// TODD's bailouts and loans between players (KorbedOut's idea).
//   TODD: borrow ⬡500 when broke, owe ⬡600. No gambling or gifting until he's repaid.
//   Players: a loan at up to 25% a day, compounding daily for 7 days. After that interest stops and half
//   of the borrower's earnings (shifts, gigs, daily, dividends) go to the lender until it's paid.
import { addGamblingGate } from '../casino/core';
import { economy } from '../config';
import type { Db } from '../core/db';
import { onPayout, payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import { currentRequest } from '../core/request';
import { DAY } from '../core/time';
import { addWorthPart } from '../social/worth';

export const LOANS = {
  todd: { lend: polygons(500), owe: polygons(600), brokeBelow: polygons(100) },
  maxRate: 25,
  termMs: 7 * DAY,
  garnishShare: 0.5,
  requestMs: 10 * 60_000,
  /** Earnings that overdue loans take a share of. */
  garnished: ['work.shift', 'work.rush', 'work.gig', 'work.review', 'daily', 'dividends']
};

export interface Loan { id: number; guild_id: string; lender_id: string; borrower_id: string; principal: Cents; rate: number; owed: Cents; created_at: number; due_at: number; last_accrual: number; status: string; closed_at: number | null }

// ---------------------------------------------------------------- TODD

export const toddDebt = (db: Db, guildId: string, userId: string): Cents =>
  db.get<{ todd_debt: number }>('SELECT todd_debt FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)?.todd_debt ?? 0;

export function bailout(db: Db, guildId: string, userId: string, worth: Cents, now = Date.now()): Cents {
  const debt = toddDebt(db, guildId, userId);
  if (debt > 0) throw new GameError('todd.owed', `TODD: "MORE?!? You STILL owe me ${format(debt)}! Pay up first!"`);
  if (worth >= LOANS.todd.brokeBelow) throw new GameError('todd.notbroke', `TODD: "You're NOT broke! You're worth ${format(worth)}! TODD is NOT a CHARITY!!"`);
  return db.tx(() => {
    const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: LOANS.todd.lend, reason: 'todd.bailout', guildId, actorId: userId, now });
    if (paid <= 0) throw new GameError('reserve.empty', 'TODD: "The Reserve is EMPTY. Even I can\'t print Polygons. ...Yet."');
    db.run('UPDATE players SET todd_debt = ? WHERE guild_id = ? AND user_id = ?', Math.round(paid * (LOANS.todd.owe / LOANS.todd.lend)), guildId, userId);
    return paid;
  });
}

/** Pays TODD back from the wallet. Returns { paid, left }. */
export function repayTodd(db: Db, guildId: string, userId: string, cents: Cents, now = Date.now()): { paid: Cents; left: Cents } {
  const debt = toddDebt(db, guildId, userId);
  if (debt <= 0) throw new GameError('todd.none', 'You do not owe TODD anything.');
  const pay = Math.min(cents, debt);
  return db.tx(() => {
    transfer(db, { from: wallet(guildId, userId), to: RESERVE, cents: pay, reason: 'todd.repay', guildId, actorId: userId, now });
    db.run('UPDATE players SET todd_debt = todd_debt - ? WHERE guild_id = ? AND user_id = ?', pay, guildId, userId);
    return { paid: pay, left: debt - pay };
  });
}

// ---------------------------------------------------------------- player loans

/** Adds the daily interest that's due (only up to the due date). */
export function accrue(db: Db, loan: Loan, now = Date.now()): Loan {
  if (loan.status !== 'active') return loan;
  const days = Math.floor((Math.min(now, loan.due_at) - loan.last_accrual) / DAY);
  if (days <= 0) return loan;
  const owed = Math.round(loan.owed * Math.pow(1 + loan.rate / 100, days));
  const last = loan.last_accrual + days * DAY;
  db.run('UPDATE loans SET owed = ?, last_accrual = ? WHERE id = ?', owed, last, loan.id);
  return { ...loan, owed, last_accrual: last };
}

export function activeLoans(db: Db, guildId: string, who: { borrower?: string; lender?: string }, now = Date.now()): Loan[] {
  let sql = "SELECT * FROM loans WHERE guild_id = ? AND status = 'active'";
  const args: string[] = [guildId];
  if (who.borrower) { sql += ' AND borrower_id = ?'; args.push(who.borrower); }
  if (who.lender) { sql += ' AND lender_id = ?'; args.push(who.lender); }
  return db.all<Loan>(sql + ' ORDER BY due_at, id', ...args).map((l) => accrue(db, l, now));
}

export const overdue = (l: Loan, now = Date.now()): boolean => now >= l.due_at;

export function between(db: Db, guildId: string, a: string, b: string, now = Date.now()): Loan | null {
  const l = db.get<Loan>(`SELECT * FROM loans WHERE guild_id = ? AND status = 'active' AND ((lender_id = ? AND borrower_id = ?) OR (lender_id = ? AND borrower_id = ?))`, guildId, a, b, b, a);
  return l ? accrue(db, l, now) : null;
}

export function createLoan(db: Db, guildId: string, lenderId: string, borrowerId: string, cents: Cents, rate: number, now = Date.now()): Loan {
  if (between(db, guildId, lenderId, borrowerId, now)) throw new GameError('loan.exists', 'There is already an active loan between you two.');
  return db.tx(() => {
    transfer(db, { from: wallet(guildId, lenderId), to: wallet(guildId, borrowerId), cents, reason: 'loan.issued', guildId, actorId: lenderId, now, note: { rate } });
    const id = db.run('INSERT INTO loans (guild_id, lender_id, borrower_id, principal, rate, owed, created_at, due_at, last_accrual) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      guildId, lenderId, borrowerId, cents, rate, cents, now, now + LOANS.termMs, now).lastInsertRowid;
    return db.get<Loan>('SELECT * FROM loans WHERE id = ?', id)!;
  });
}

/** The borrower pays from their wallet. Returns what was paid. */
export function payLoan(db: Db, loan: Loan, cents: Cents, now = Date.now(), reason = 'loan.repay'): Cents {
  const amount = Math.min(cents, loan.owed);
  if (amount <= 0) return 0;
  return db.tx(() => {
    transfer(db, { from: wallet(loan.guild_id, loan.borrower_id), to: wallet(loan.guild_id, loan.lender_id), cents: amount, reason, guildId: loan.guild_id, actorId: loan.borrower_id, now, note: { loan: loan.id } });
    const left = loan.owed - amount;
    db.run('UPDATE loans SET owed = ?, status = ?, closed_at = ? WHERE id = ?', left, left <= 0 ? 'paid' : 'active', left <= 0 ? now : null, loan.id);
    return amount;
  });
}

export function forgive(db: Db, loan: Loan, now = Date.now()): void {
  db.run("UPDATE loans SET status = 'forgiven', owed = 0, closed_at = ? WHERE id = ?", now, loan.id);
}

// ---------------------------------------------------------------- wiring

let installed = false;
export function installLoans(): void {
  if (installed) return;
  installed = true;

  // No gambling with TODD's money
  addGamblingGate((ctx, guildId) => {
    const d = toddDebt(ctx.db, guildId, ctx.user.id);
    return d > 0 ? `TODD: "GAMBLING?!? With MY money?! NOT a CHANCE. You owe me ${format(d)}." (\`${ctx.config.prefix}repay\`)` : null;
  });

  // Debts count against net worth; money you've lent counts for it
  addWorthPart((db, _m, guildId, userId) =>
    -toddDebt(db, guildId, userId)
    - activeLoans(db, guildId, { borrower: userId }).reduce((s, l) => s + l.owed, 0)
    + activeLoans(db, guildId, { lender: userId }).reduce((s, l) => s + l.owed, 0));

  // Overdue loans take half of earnings, oldest loan first
  onPayout((db, p, paid) => {
    if (!LOANS.garnished.includes(p.reason) || !p.guildId) return;
    const m = /^wallet:([^:]+):(.+)$/.exec(p.to);
    if (!m) return;
    const [, guildId, userId] = m as unknown as [string, string, string];
    const now = p.now ?? Date.now();
    const due = activeLoans(db, guildId, { borrower: userId }, now).filter((l) => overdue(l, now));
    let pool = due.length ? Math.floor(paid * LOANS.garnishShare) : 0;
    for (const l of due) {
      if (pool <= 0) break;
      const went = payLoan(db, l, pool, now, 'loan.garnish');
      pool -= went;
      const req = currentRequest();
      if (went > 0 && req && req.userId === userId) req.notes.push(`${format(went)} of that went to <@${l.lender_id}> for an overdue loan${went >= l.owed ? ' (paid off)' : ''}.`);
    }
  });
}

