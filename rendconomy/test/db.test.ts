import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { open, migrate, Db } from '../src/core/db';
import { MIGRATIONS } from '../src/core/migrations';

test('a new database is migrated to the newest version', () => {
  const db = open(':memory:', { log: () => {} });
  assert.equal(db.version(), MIGRATIONS.length);
});

test('nested transactions roll back only their own part', () => {
  const db = open(':memory:', { log: () => {} });
  db.tx(() => {
    db.setMeta('outer', 1);
    assert.throws(() => db.tx(() => { db.setMeta('inner', 1); throw new Error('nope'); }));
    assert.equal(db.meta('inner'), null);
  });
  assert.equal(db.meta('outer'), '1');
  assert.equal(db.inTransaction, false);
});

test('an existing database is backed up before it is migrated', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rendconomy-'));
  const file = path.join(dir, 'bot.db');
  const v1 = [MIGRATIONS[0]!];
  const v2 = [...v1, 'ALTER TABLE players ADD COLUMN nickname TEXT;'];

  const db = new Db(file);
  migrate(db, { log: () => {} }, v1);
  db.setMeta('hello', 'world');
  const logs: string[] = [];
  migrate(db, { log: (m) => logs.push(m), now: () => 0 }, v2);
  assert.equal(db.version(), 2);
  assert.equal(db.meta('hello'), 'world', 'migrations keep the data');
  db.close();

  assert.match(logs[0]!, /backed up/);
  const backups = fs.readdirSync(path.join(dir, 'backups'));
  assert.deepEqual(backups, ['bot-v1-1970-01-01T00-00-00-000Z.db']);
  const copy = new Db(path.join(dir, 'backups', backups[0]!));
  assert.equal(copy.version(), 1, 'the backup is the old version');
  assert.equal(copy.meta('hello'), 'world');
  copy.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('code refuses a database newer than itself', () => {
  const db = new Db(':memory:');
  db.raw.exec(`PRAGMA user_version = ${MIGRATIONS.length + 1}`);
  assert.throws(() => migrate(db, { log: () => {} }), /newer than this code/);
});
