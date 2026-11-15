// Net worth: cash + savings + shares at today's prices, plus whatever other systems add (loans, items...).
import type { Db } from '../core/db';
import { balance, wallet } from '../core/ledger';
import type { Cents } from '../core/money';
import type { MarketData } from '../market/engine';
import { portfolio } from '../market/trading';

/** One labeled piece of net worth, so /balance can show where it comes from. Negative cents are debts. */
export interface WorthLine { label: string; emoji: string; cents: Cents; note?: string }
export type WorthPart = (db: Db, m: MarketData | null, guildId: string, userId: string) => WorthLine[];

/** Systems that change net worth register here (e.g. loans subtract what you owe). */
const parts: WorthPart[] = [];
export const addWorthPart = (fn: WorthPart): void => { parts.push(fn); };
/** Everything other systems add or take away, skipping zeros. */
export const worthLines = (db: Db, m: MarketData | null, guildId: string, userId: string): WorthLine[] =>
  parts.flatMap((fn) => fn(db, m, guildId, userId)).filter((l) => l.cents !== 0);

export function savingsTotal(db: Db, guildId: string, userId: string): Cents {
  return db.get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM savings WHERE guild_id = ? AND user_id = ?', guildId, userId)!.s;
}

export function netWorth(db: Db, m: MarketData | null, guildId: string, userId: string): Cents {
  const cash = balance(db, wallet(guildId, userId));
  const shares = m ? portfolio(db, m, guildId, userId).reduce((s, p) => s + p.valueCents, 0) : 0;
  return cash + savingsTotal(db, guildId, userId) + shares + worthLines(db, m, guildId, userId).reduce((s, l) => s + l.cents, 0);
}
