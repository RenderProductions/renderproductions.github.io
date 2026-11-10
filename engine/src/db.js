// Player data in SQLite (built into Node 22+, no native installs needed).
// Balances are per server, like the BDFD bot. Money is stored as whole cents.
// The shop's stock is shared by every server, like the BDFD bot.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// Each entry upgrades the database by one version. Never edit an old entry; add a new one.
const MIGRATIONS = [
  null, // version 0 = empty database
  null, // version 1 = the first scaffold (replaced by version 2)
  `
    -- Version 2: the full port of the BDFD bot. Version 1 only held test data, and the
    -- "Crash the Rend-Conomy" update wipes everyone anyway, so its tables are replaced.
    DROP TABLE IF EXISTS players;
    DROP TABLE IF EXISTS holdings;
    DROP TABLE IF EXISTS trades;

    CREATE TABLE players (
      guild_id     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      username     TEXT,
      cash         INTEGER NOT NULL,            -- cents
      debt         INTEGER NOT NULL DEFAULT 0,  -- cents owed to TODD
      title        TEXT,                        -- custom title, null = none
      title_credit INTEGER NOT NULL DEFAULT 0,  -- bought a Title, hasn't set it yet
      daily_day    TEXT NOT NULL DEFAULT '',    -- Eastern date of the last r!daily, like 2026-11-09
      job          TEXT,                        -- ticker of the company they work at, null = none
      shifts       INTEGER NOT NULL DEFAULT 0,
      hired_at     INTEGER NOT NULL DEFAULT 0,  -- ms timestamp
      overtime     INTEGER NOT NULL DEFAULT 0,  -- 1 = next shift pays double
      last_work    INTEGER NOT NULL DEFAULT 0,  -- ms timestamp
      div_carry    REAL NOT NULL DEFAULT 0,     -- dividend fractions of a cent, kept for next claim
      created_at   INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );

    CREATE TABLE holdings (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      ticker     TEXT NOT NULL,
      shares     INTEGER NOT NULL DEFAULT 0,
      div_index  REAL NOT NULL DEFAULT 0,     -- the company's dividend total at the last claim
      div_shares INTEGER NOT NULL DEFAULT 0,  -- shares held at the last claim (only these earn)
      wipe_seen  INTEGER NOT NULL DEFAULT 0,  -- bankruptcy wipes already applied to this player
      PRIMARY KEY (guild_id, user_id, ticker)
    );

    CREATE TABLE trades (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      ticker   TEXT NOT NULL,
      shares   INTEGER NOT NULL,   -- positive = buy, negative = sell
      price    INTEGER NOT NULL,   -- cents per share
      time     INTEGER NOT NULL
    );

    CREATE TABLE shop_stock (
      item  TEXT PRIMARY KEY,
      stock INTEGER NOT NULL
    );

    -- Who bought what in which restock (one of each item per player per restock)
    CREATE TABLE shop_buys (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      item       TEXT NOT NULL,
      restock_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id, item, restock_at)
    );

    CREATE TABLE meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `
];

const PLAYER_COLUMNS = new Set(['username', 'cash', 'debt', 'title', 'title_credit', 'daily_day', 'job',
  'shifts', 'hired_at', 'overtime', 'last_work', 'div_carry']);
const HOLDING_COLUMNS = new Set(['shares', 'div_index', 'div_shares', 'wipe_seen']);

function open(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return wrap(db);
}

function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version + 1; v < MIGRATIONS.length; v++) {
    if (MIGRATIONS[v]) db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v}`);
    version = v;
  }
}

function wrap(db) {
  const cache = new Map();
  const st = (sql) => { if (!cache.has(sql)) cache.set(sql, db.prepare(sql)); return cache.get(sql); };

  // Builds "a = ?, b = ?" from an object, only allowing known column names.
  function setClause(fields, allowed) {
    const keys = Object.keys(fields);
    for (const k of keys) if (!allowed.has(k)) throw new Error('Unknown column: ' + k);
    return { sql: keys.map((k) => `${k} = ?`).join(', '), values: keys.map((k) => fields[k]) };
  }

  const api = {
    raw: db,

    // Runs fn inside a transaction so nothing can half-happen. Nested calls join the outer one.
    tx(fn) {
      if (api._inTx) return fn();
      db.exec('BEGIN IMMEDIATE');
      api._inTx = true;
      try { const out = fn(); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
      finally { api._inTx = false; }
    },

    // Gets a player, creating them with starting cash on first use.
    player(guildId, user) {
      let p = st('SELECT * FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, user.id);
      if (!p) {
        st('INSERT INTO players (guild_id, user_id, username, cash, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(guildId, user.id, user.username || null, config.startingCash, Date.now());
        p = st('SELECT * FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, user.id);
      } else if (user.username && p.username !== user.username) {
        api.updatePlayer(guildId, user.id, { username: user.username });
        p.username = user.username;
      }
      return p;
    },
    updatePlayer(guildId, userId, fields) {
      const { sql, values } = setClause(fields, PLAYER_COLUMNS);
      if (sql) st(`UPDATE players SET ${sql} WHERE guild_id = ? AND user_id = ?`).run(...values, guildId, userId);
    },
    addCash(guildId, userId, cents) {
      st('UPDATE players SET cash = cash + ? WHERE guild_id = ? AND user_id = ?').run(cents, guildId, userId);
    },

    holding(guildId, userId, ticker) {
      return st('SELECT * FROM holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?').get(guildId, userId, ticker)
        || { guild_id: guildId, user_id: userId, ticker, shares: 0, div_index: 0, div_shares: 0, wipe_seen: 0 };
    },
    updateHolding(guildId, userId, ticker, fields) {
      st('INSERT OR IGNORE INTO holdings (guild_id, user_id, ticker) VALUES (?, ?, ?)').run(guildId, userId, ticker);
      const { sql, values } = setClause(fields, HOLDING_COLUMNS);
      if (sql) st(`UPDATE holdings SET ${sql} WHERE guild_id = ? AND user_id = ? AND ticker = ?`).run(...values, guildId, userId, ticker);
    },
    logTrade(guildId, userId, ticker, shares, priceCents) {
      st('INSERT INTO trades (guild_id, user_id, ticker, shares, price, time) VALUES (?, ?, ?, ?, ?, ?)')
        .run(guildId, userId, ticker, shares, priceCents, Date.now());
    },

    // Shop (shared by every server)
    meta(key) { const r = st('SELECT value FROM meta WHERE key = ?').get(key); return r ? r.value : null; },
    setMeta(key, value) { st('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, String(value)); },
    stock(item) { const r = st('SELECT stock FROM shop_stock WHERE item = ?').get(item); return r ? r.stock : 0; },
    setStock(item, n) { st('INSERT INTO shop_stock (item, stock) VALUES (?, ?) ON CONFLICT (item) DO UPDATE SET stock = excluded.stock').run(item, n); },
    boughtThisRestock(guildId, userId, item, restockAt) {
      return !!st('SELECT 1 FROM shop_buys WHERE guild_id = ? AND user_id = ? AND item = ? AND restock_at = ?').get(guildId, userId, item, restockAt);
    },
    recordBuy(guildId, userId, item, restockAt) {
      st('INSERT OR IGNORE INTO shop_buys (guild_id, user_id, item, restock_at) VALUES (?, ?, ?, ?)').run(guildId, userId, item, restockAt);
    },

    // For the leaderboard API
    guildPlayers(guildId) { return st('SELECT user_id, username, cash, debt FROM players WHERE guild_id = ?').all(guildId); },
    guildHoldings(guildId) { return st('SELECT user_id, ticker, shares, wipe_seen FROM holdings WHERE guild_id = ? AND shares > 0').all(guildId); }
  };
  return api;
}

module.exports = { open };
