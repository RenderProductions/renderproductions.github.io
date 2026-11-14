// Carrying achievements over from the old bot (the reset keeps them). Reads the old bot's SQLite file
// directly, read-only, and copies its achievements and progress counters.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../core/db';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import type { Cents } from '../core/money';
import { BY_ID, RARITY } from './list';

export interface ImportResult { achievements: number; progress: number; players: number; skipped: number; caughtUp: number; caughtUpCents: Cents }

export function importFromOldBot(db: Db, file: string): ImportResult {
  if (!fs.existsSync(file)) throw new Error(`The old bot's database was not found at ${file}`);
  const old = new DatabaseSync(file, { readOnly: true });
  try {
    const ach = old.prepare('SELECT user_id, id, guild_id, unlocked_at FROM achievements').all() as { user_id: string; id: string; guild_id: string | null; unlocked_at: number }[];
    let prog: { user_id: string; key: string; value: number }[] = [];
    try { prog = old.prepare('SELECT user_id, key, value FROM progress').all() as typeof prog; } catch { /* older file without counters */ }
    let achievements = 0, skipped = 0, progress = 0;
    // What each player gains in each server from achievements that are new to this database
    const owed = new Map<string, Cents>();
    db.tx(() => {
      for (const a of ach) {
        if (!BY_ID[a.id]) { skipped++; continue; }
        const added = db.run('INSERT OR IGNORE INTO achievements (user_id, id, guild_id, unlocked_at) VALUES (?, ?, ?, ?)', a.user_id, a.id, a.guild_id, a.unlocked_at).changes;
        achievements += added;
        if (added && a.guild_id) {
          const k = `${a.guild_id}\u0000${a.user_id}`;
          owed.set(k, (owed.get(k) ?? 0) + RARITY[BY_ID[a.id]!.rarity].pay);
        }
      }
      for (const p of prog) {
        progress += db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = MAX(value, excluded.value)', p.user_id, p.key, p.value).changes;
      }
    });
    // Players who already started in the new economy missed these in their fresh-start payout: pay them now.
    // Everyone else gets them with the fresh-start payout on their first action.
    let caughtUp = 0, caughtUpCents = 0;
    const now = Date.now();
    for (const [k, cents] of owed) {
      const [guildId, userId] = k.split('\u0000') as [string, string];
      if (!db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)) continue;
      const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents, reason: 'achievement.restart', guildId, actorId: userId, now });
      if (paid > 0) { caughtUp++; caughtUpCents += paid; }
    }
    return { achievements, progress, players: new Set(ach.map((a) => a.user_id)).size, skipped, caughtUp, caughtUpCents };
  } finally {
    old.close();
  }
}

/** Where the old bot kept its database: OLD_DB_FILE, or engine/data/rend-conomy.db at the repo root. */
export function oldDbFile(): string {
  return process.env.OLD_DB_FILE || path.join(__dirname, '..', '..', '..', '..', 'engine', 'data', 'rend-conomy.db');
}

/**
 * Runs once, at startup, before the bot connects: brings the old achievements over so the
 * fresh-start payout (paid on a player's first action) already counts them. Returns null when
 * it has already run or there is no old database.
 */
export function importOnStartup(db: Db): ImportResult | null {
  if (db.meta('achievements.imported')) return null;
  const file = oldDbFile();
  if (!fs.existsSync(file)) return null;
  const r = importFromOldBot(db, file);
  db.setMeta('achievements.imported', Date.now());
  return r;
}
