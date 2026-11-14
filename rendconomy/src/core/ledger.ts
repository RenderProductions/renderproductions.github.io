// The one place money moves. Every change to any balance is a transfer between two accounts,
// written to the ledger in the same transaction. Nothing else in the bot may UPDATE a balance.
//
// The economy is closed: Polygons are only ever minted into the Reserve (its starting 25M and
// deliberate refills). Players earn by transfers out of the Reserve and spend by transfers back in,
// so the total in every account always equals minted minus burned. audit() checks exactly that.
import type { Db } from './db';
import { GameError } from './errors';
import { assertCents, format, type Cents } from './money';

export const RESERVE = 'reserve';
export const wallet = (guildId: string, userId: string): string => `wallet:${guildId}:${userId}`;

export type AccountKind = 'reserve' | 'wallet';

export interface Account {
  id: string;
  kind: AccountKind;
  guild_id: string | null;
  owner_id: string | null;
  balance: Cents;
  created_at: number;
}

export interface TransferInput {
  from: string;
  to: string;
  cents: Cents;
  /** Short dotted code for what this was: 'daily', 'stock.buy', 'mod.give'. */
  reason: string;
  guildId?: string | null;
  actorId?: string | null;
  note?: Record<string, unknown>;
  now?: number;
}

export interface LedgerEntry {
  id: number;
  at: number;
  from_id: string | null;
  to_id: string | null;
  cents: Cents;
  reason: string;
  guild_id: string | null;
  actor_id: string | null;
  note: string | null;
}

export function ensureAccount(db: Db, id: string, kind: AccountKind, guildId: string | null = null, ownerId: string | null = null, now = Date.now()): void {
  db.run('INSERT OR IGNORE INTO accounts (id, kind, guild_id, owner_id, balance, created_at) VALUES (?, ?, ?, ?, 0, ?)', id, kind, guildId, ownerId, now);
}

/** Makes sure a player's wallet exists in this server. */
export function ensureWallet(db: Db, guildId: string, userId: string, now = Date.now()): string {
  const id = wallet(guildId, userId);
  ensureAccount(db, id, 'wallet', guildId, userId, now);
  return id;
}

export function account(db: Db, id: string): Account | undefined {
  return db.get<Account>('SELECT * FROM accounts WHERE id = ?', id);
}

export function balance(db: Db, id: string): Cents {
  return db.get<{ balance: number }>('SELECT balance FROM accounts WHERE id = ?', id)?.balance ?? 0;
}

function write(db: Db, from: string | null, to: string | null, cents: Cents, input: Omit<TransferInput, 'from' | 'to' | 'cents'>): number {
  const note = input.note ? JSON.stringify(input.note) : null;
  return db.run(
    'INSERT INTO ledger (at, from_id, to_id, cents, reason, guild_id, actor_id, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    input.now ?? Date.now(), from, to, cents, input.reason, input.guildId ?? null, input.actorId ?? null, note
  ).lastInsertRowid;
}

function debit(db: Db, id: string, cents: Cents): void {
  const r = db.run('UPDATE accounts SET balance = balance - ? WHERE id = ? AND balance >= ?', cents, id, cents);
  if (r.changes === 1) return;
  const acct = account(db, id);
  if (!acct) throw new Error(`No such account: ${id}`);
  if (id === RESERVE) throw new GameError('reserve.empty', 'The Polygon Reserve cannot cover this payout.', { needed: cents, have: acct.balance });
  throw new GameError('funds.short', `Insufficient Polygons. This requires ${format(cents)}; the balance is ${format(acct.balance)}.`, { needed: cents, have: acct.balance });
}

function credit(db: Db, id: string, cents: Cents): void {
  const r = db.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', cents, id);
  if (r.changes !== 1) throw new Error(`No such account: ${id}`);
}

/**
 * Moves Polygons from one account to another. All or nothing: if the sender is short,
 * a GameError is thrown and nothing changes. Returns the ledger entry id.
 */
export function transfer(db: Db, input: TransferInput): number {
  assertCents(input.cents);
  if (input.cents <= 0) throw new Error(`Transfers must be positive, got ${input.cents}`);
  if (input.from === input.to) throw new Error(`Cannot transfer from an account to itself (${input.from})`);
  return db.tx(() => {
    debit(db, input.from, input.cents);
    credit(db, input.to, input.cents);
    return write(db, input.from, input.to, input.cents, input);
  });
}

/** Creates new Polygons in the Reserve. Only for its starting balance and deliberate refills. */
export function mint(db: Db, cents: Cents, reason: string, opts: { actorId?: string; note?: Record<string, unknown>; now?: number } = {}): number {
  assertCents(cents);
  if (cents <= 0) throw new Error('Mint amount must be positive');
  return db.tx(() => {
    ensureAccount(db, RESERVE, 'reserve', null, null, opts.now);
    credit(db, RESERVE, cents);
    return write(db, null, RESERVE, cents, { reason, ...opts });
  });
}

/** Destroys Polygons (e.g. the reset wiping wallets). They leave the economy entirely. */
export function burn(db: Db, from: string, cents: Cents, reason: string, opts: { actorId?: string; note?: Record<string, unknown>; now?: number; guildId?: string } = {}): number {
  assertCents(cents);
  if (cents <= 0) throw new Error('Burn amount must be positive');
  return db.tx(() => {
    debit(db, from, cents);
    return write(db, from, null, cents, { reason, ...opts });
  });
}

/** An account's recent history, newest first. */
export function history(db: Db, id: string, limit = 20): LedgerEntry[] {
  return db.all<LedgerEntry>(
    'SELECT * FROM ledger WHERE from_id = ? OR to_id = ? ORDER BY id DESC LIMIT ?', id, id, limit
  );
}

export interface Audit { inAccounts: Cents; minted: Cents; burned: Cents; ok: boolean }

/** Every Polygon is accounted for: what's in all accounts equals what was minted minus what was burned. */
export function audit(db: Db): Audit {
  const inAccounts = db.get<{ s: number }>('SELECT COALESCE(SUM(balance), 0) AS s FROM accounts')!.s;
  const minted = db.get<{ s: number }>('SELECT COALESCE(SUM(cents), 0) AS s FROM ledger WHERE from_id IS NULL')!.s;
  const burned = db.get<{ s: number }>('SELECT COALESCE(SUM(cents), 0) AS s FROM ledger WHERE to_id IS NULL')!.s;
  return { inAccounts, minted, burned, ok: inAccounts === minted - burned };
}
