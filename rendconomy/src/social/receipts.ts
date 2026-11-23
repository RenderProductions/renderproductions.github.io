// DM receipts: a short record of a trade, purchase, gift, loan or company payment, sent to the player.
// On by default; r!receipts off turns them off (the same switch covers filled orders and broker reports).
// Receipts are queued with the request and only sent once it succeeds.
import type { Db } from '../core/db';
import { SYMBOL } from '../core/money';
import { afterRequest } from '../core/request';
import { diffBlock } from '../discord/diff';
import { addInbox } from './inbox';

/** A line of a receipt. The sign colors money lines in Discord: + green (money in), - red (money out). */
export type ReceiptLine = [label: string, value: string, sign?: '+' | '-'];
export interface Receipt { guildId: string; userId: string; title: string; lines: ReceiptLine[] }

let sender: (r: Receipt) => void = () => {};
export const setReceiptSender = (fn: (r: Receipt) => void): void => { sender = fn; };
export const receiptsOn = (db: Db, userId: string): boolean => db.meta(`receipts.off:${userId}`) !== '1';

export function receipt(db: Db, guildId: string, userId: string, title: string, lines: (ReceiptLine | false | null | undefined)[]): void {
  const r: Receipt = { guildId, userId, title, lines: lines.filter((l): l is ReceiptLine => !!l) };
  addInbox(db, userId, guildId, title, r.lines.map(([k, v]) => `${k}: ${v}`).join('\n'));
  if (!receiptsOn(db, userId)) return;
  afterRequest(() => sender(r));
}

/** How a receipt shows in Discord: its money lines (values in Polygons) as one colored \`diff\` block, everything
 *  else (the item, the company, how to answer) as fields. */
export function receiptView(r: Receipt): { description?: string; fields: { name: string; value: string; inline: boolean }[] } {
  const money = r.lines.filter(([, v]) => v.startsWith(SYMBOL));
  const rest = r.lines.filter(([, v]) => !v.startsWith(SYMBOL));
  const fields = rest.map(([name, value]) => ({ name, value: value.slice(0, 1024), inline: true }));
  if (!money.length) return { fields };
  return { description: diffBlock(money.map(([label, value, sign]) => [sign ?? ' ', value, label])), fields };
}

/** A player's name as the bot last saw it, for receipts about someone else. */
export function nameOf(db: Db, userId: string): string {
  return db.get<{ name: string | null }>('SELECT name FROM players WHERE user_id = ? AND name IS NOT NULL LIMIT 1', userId)?.name ?? 'another player';
}
