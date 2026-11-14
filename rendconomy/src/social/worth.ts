// Net worth: cash + savings + shares at today's prices, plus whatever other systems add (loans, items...).
import type { Db } from '../core/db';
import { balance, wallet } from '../core/ledger';
import type { Cents } from '../core/money';
import type { MarketData } from '../market/engine';
import { portfolio } from '../market/trading';

export type WorthPart = (db: Db, m: MarketData | null, guildId: string, userId: string) => Cents;

/** Systems that change net worth register here (e.g. loans subtract what you owe). */
const parts: WorthPart[] = [];
export const addWorthPart = (fn: WorthPart): void => { parts.push(fn); };

export function savingsTotal(db: Db, guildId: string, userId: string): Cents {
  return db.get<{ s: number }>('SELECT COALESCE(SUM(amount), 0) AS s FROM savings WHERE guild_id = ? AND user_id = ?', guildId, userId)!.s;
}

export function netWorth(db: Db, m: MarketData | null, guildId: string, userId: string): Cents {
  const cash = balance(db, wallet(guildId, userId));
  const shares = m ? portfolio(db, m, guildId, userId).reduce((s, p) => s + p.valueCents, 0) : 0;
  return cash + savingsTotal(db, guildId, userId) + shares + parts.reduce((s, fn) => s + fn(db, m, guildId, userId), 0);
}
