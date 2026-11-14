// The database: SQLite built into Node (no native installs). One file per bot.
// Schema changes are numbered migrations that run on startup, after a backup.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { MIGRATIONS } from './migrations';

export type Row = Record<string, SQLInputValue>;

export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;
  private readonly statements = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  private prepare(sql: string) {
    let st = this.statements.get(sql);
    if (!st) { st = this.raw.prepare(sql); this.statements.set(sql, st); }
    return st;
  }

  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: SQLInputValue[]): { changes: number; lastInsertRowid: number } {
    const r = this.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  }

  /**
   * Runs fn inside a transaction: all of it happens or none of it does.
   * Nested calls use savepoints, so a helper that opens its own transaction is safe to call from another.
   */
  tx<T>(fn: () => T): T {
    const sp = `sp${this.depth}`;
    this.raw.exec(this.depth === 0 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
    this.depth++;
    try {
      const result = fn();
      if (result instanceof Promise) throw new Error('db.tx() callbacks must be synchronous');
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'COMMIT' : `RELEASE ${sp}`);
      return result;
    } catch (e) {
      this.depth--;
      this.raw.exec(this.depth === 0 ? 'ROLLBACK' : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
      throw e;
    }
  }

  get inTransaction(): boolean { return this.depth > 0; }

  version(): number {
    return Number((this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  }

  /** A consistent copy of the whole database, safe to take while the bot runs. */
  backup(dest: string): string {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest)) fs.rmSync(dest);
    this.raw.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    return dest;
  }

  /** Small key/value settings that don't deserve a table. */
  meta(key: string): string | null {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value ?? null;
  }
  setMeta(key: string, value: string | number): void {
    this.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
  }

  close(): void { this.raw.close(); }
}

export interface OpenOptions {
  /** Where backups go before a migration. Default: a backups folder next to the database. */
  backupDir?: string;
  now?: () => number;
  log?: (msg: string) => void;
}

/** Opens the database and brings it up to the newest schema, backing it up first if it changes. */
export function open(file: string, opts: OpenOptions = {}): Db {
  const db = new Db(file);
  migrate(db, opts);
  return db;
}

export function migrate(db: Db, opts: OpenOptions = {}, migrations: readonly string[] = MIGRATIONS): void {
  const target = migrations.length;
  const from = db.version();
  if (from > target) throw new Error(`Database is version ${from}, newer than this code (${target}). Update the bot.`);
  if (from === target) return;

  const log = opts.log ?? ((m: string) => console.log(`[db] ${m}`));
  if (from > 0 && db.file !== ':memory:') {
    const dir = opts.backupDir ?? path.join(path.dirname(db.file), 'backups');
    const stamp = new Date((opts.now ?? Date.now)()).toISOString().replace(/[:.]/g, '-');
    const dest = db.backup(path.join(dir, `${path.basename(db.file, '.db')}-v${from}-${stamp}.db`));
    log(`backed up to ${dest}`);
  }

  for (let v = from; v < target; v++) {
    db.tx(() => {
      db.raw.exec(migrations[v]!);
      db.raw.exec(`PRAGMA user_version = ${v + 1}`);
    });
    log(`migrated to version ${v + 1}`);
  }
}
