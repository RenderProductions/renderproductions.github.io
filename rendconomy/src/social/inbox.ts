// The inbox: everything the bot would tell you (receipts, market reports, takeover bids, crops, trade offers),
// kept for the site's notification bell and r!inbox. The newest 60 per player are kept.
import type { Db } from '../core/db';

export interface InboxRow { id: number; user_id: string; guild_id: string | null; title: string; body: string; created: number; read: number }
const KEEP = 60;

export function addInbox(db: Db, userId: string, guildId: string | null, title: string, body: string, now = Date.now()): void {
  db.run('INSERT INTO inbox (user_id, guild_id, title, body, created) VALUES (?, ?, ?, ?, ?)', userId, guildId, title.slice(0, 120), body.slice(0, 1500), now);
  db.run('DELETE FROM inbox WHERE user_id = ? AND id NOT IN (SELECT id FROM inbox WHERE user_id = ? ORDER BY id DESC LIMIT ?)', userId, userId, KEEP);
}
export const inboxOf = (db: Db, userId: string, limit = 10): InboxRow[] => db.all<InboxRow>('SELECT * FROM inbox WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, limit);
export const unread = (db: Db, userId: string): number => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM inbox WHERE user_id = ? AND read = 0', userId)!.n;
export const markRead = (db: Db, userId: string): void => { db.run('UPDATE inbox SET read = 1 WHERE user_id = ? AND read = 0', userId); };
