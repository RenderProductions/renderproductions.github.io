// Carrying achievements over from the old bot (the reset keeps them). Reads the old bot's SQLite file
// directly, read-only, and copies its achievements and progress counters.
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../core/db';
import { BY_ID } from './list';

export interface ImportResult { achievements: number; progress: number; players: number; skipped: number }

export function importFromOldBot(db: Db, file: string): ImportResult {
  if (!fs.existsSync(file)) throw new Error(`The old bot's database was not found at ${file}`);
  const old = new DatabaseSync(file, { readOnly: true });
  try {
    const ach = old.prepare('SELECT user_id, id, guild_id, unlocked_at FROM achievements').all() as { user_id: string; id: string; guild_id: string | null; unlocked_at: number }[];
    let prog: { user_id: string; key: string; value: number }[] = [];
    try { prog = old.prepare('SELECT user_id, key, value FROM progress').all() as typeof prog; } catch { /* older file without counters */ }
    let achievements = 0, skipped = 0, progress = 0;
    db.tx(() => {
      for (const a of ach) {
        if (!BY_ID[a.id]) { skipped++; continue; }
        achievements += db.run('INSERT OR IGNORE INTO achievements (user_id, id, guild_id, unlocked_at) VALUES (?, ?, ?, ?)', a.user_id, a.id, a.guild_id, a.unlocked_at).changes;
      }
      for (const p of prog) {
        progress += db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = MAX(value, excluded.value)', p.user_id, p.key, p.value).changes;
      }
    });
    return { achievements, progress, players: new Set(ach.map((a) => a.user_id)).size, skipped };
  } finally {
    old.close();
  }
}
