// Automatic daily backups: one copy per Eastern day, keeping the last 7.
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from './db';
import { dayKey } from './time';

export function dailyBackup(db: Db, keep = 7, now = Date.now()): string | null {
  if (db.file === ':memory:') return null;
  const dir = path.join(path.dirname(db.file), 'backups');
  const dest = path.join(dir, `daily-${dayKey(now)}.db`);
  if (fs.existsSync(dest)) return null;
  db.backup(dest);
  const old = fs.readdirSync(dir).filter((f) => /^daily-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of old.slice(0, Math.max(0, old.length - keep))) fs.rmSync(path.join(dir, f));
  return dest;
}
