// DM receipts: a short record of a trade, purchase, gift, loan or company payment, sent to the player.
// On by default; r!receipts off turns them off (the same switch covers filled orders and broker reports).
// Receipts are queued with the request and only sent once it succeeds.
import type { Db } from '../core/db';
import { afterRequest } from '../core/request';

export type ReceiptLine = [label: string, value: string];
export interface Receipt { guildId: string; userId: string; title: string; lines: ReceiptLine[] }

let sender: (r: Receipt) => void = () => {};
export const setReceiptSender = (fn: (r: Receipt) => void): void => { sender = fn; };
export const receiptsOn = (db: Db, userId: string): boolean => db.meta(`receipts.off:${userId}`) !== '1';

export function receipt(db: Db, guildId: string, userId: string, title: string, lines: (ReceiptLine | false | null | undefined)[]): void {
  if (!receiptsOn(db, userId)) return;
  const r: Receipt = { guildId, userId, title, lines: lines.filter((l): l is ReceiptLine => !!l) };
  afterRequest(() => sender(r));
}

/** A player's name as the bot last saw it, for receipts about someone else. */
export function nameOf(db: Db, userId: string): string {
  return db.get<{ name: string | null }>('SELECT name FROM players WHERE user_id = ? AND name IS NOT NULL LIMIT 1', userId)?.name ?? 'another player';
}
