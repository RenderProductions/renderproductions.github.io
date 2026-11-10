// Player data in SQLite (built into Node 22+, no native installs needed).
// Balances are per server, like the BDFD bot. Money is stored as whole cents.
// The shop's stock is shared by every server, like the BDFD bot.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// Each entry upgrades the database by one version. Never edit an old entry; add a new one.
// From version 3 on, upgrades must only ADD things (tables, columns). Never drop player data.
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
  `,
  `
    -- Version 3: inventory. Shop items go here and are used later with r!use.
    CREATE TABLE inventory (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      item     TEXT NOT NULL,
      qty      INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, item)
    );
    -- Titles bought before the inventory existed become a Title in the inventory
    INSERT INTO inventory (guild_id, user_id, item, qty)
      SELECT guild_id, user_id, 'title', title_credit FROM players WHERE title_credit > 0;
    UPDATE players SET title_credit = 0;
  `,
  `
    -- Version 4: player companies. Companies are shared by every server; shares are per server
    -- like balances (you buy with the Polygons you have in that server).
    CREATE TABLE pc_companies (
      ticker        TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      owner_id      TEXT NOT NULL,
      owner_name    TEXT,
      owner_guild   TEXT NOT NULL,             -- where the founding cost was paid (refunds go here)
      level         INTEGER NOT NULL DEFAULT 1,
      treasury      INTEGER NOT NULL DEFAULT 0, -- cents
      status        TEXT NOT NULL,             -- pending, private, public, dead, rejected
      price         REAL,                      -- Polygons per share, once public
      offering_left INTEGER NOT NULL DEFAULT 0, -- IPO shares not sold yet (their money goes to the treasury)
      strikes       INTEGER NOT NULL DEFAULT 0, -- missed upkeep payments in a row
      created_at    INTEGER NOT NULL,
      approved_at   INTEGER,
      ipo_at        INTEGER,
      died_at       INTEGER,
      last_upkeep   INTEGER NOT NULL DEFAULT 0,
      last_salary   INTEGER NOT NULL DEFAULT 0,
      history       TEXT NOT NULL DEFAULT '[]', -- recent prices, newest last
      note          TEXT                        -- rejection reason or cause of death
    );
    CREATE TABLE pc_holdings (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      ticker   TEXT NOT NULL,
      shares   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, ticker)
    );
  `,
  `
    -- Version 5: loans between players (per server, like balances)
    CREATE TABLE loans (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id      TEXT NOT NULL,
      lender_id     TEXT NOT NULL,
      lender_name   TEXT,
      borrower_id   TEXT NOT NULL,
      borrower_name TEXT,
      principal     INTEGER NOT NULL,        -- cents lent
      rate          REAL NOT NULL,           -- percent per day
      owed          INTEGER NOT NULL,        -- cents still owed, interest included
      created_at    INTEGER NOT NULL,
      due_at        INTEGER NOT NULL,        -- interest stops and garnishing starts here
      last_accrual  INTEGER NOT NULL,        -- when interest was last added
      status        TEXT NOT NULL DEFAULT 'active', -- active, paid
      paid_at       INTEGER
    );
    CREATE INDEX loans_borrower ON loans (guild_id, borrower_id, status);
    CREATE INDEX loans_lender ON loans (guild_id, lender_id, status);
  `,
  `
    -- Version 6: DM receipts on/off (on by default)
    ALTER TABLE players ADD COLUMN receipts INTEGER NOT NULL DEFAULT 1;
  `,
  `
    -- Version 7: the Labor Day Update. A career at each company you've worked for (kept when you quit),
    -- shift-ready DMs, and gigs. players.shifts stays as the shifts at your current job.
    CREATE TABLE careers (
      guild_id  TEXT NOT NULL,
      user_id   TEXT NOT NULL,
      ticker    TEXT NOT NULL,
      shifts    INTEGER NOT NULL DEFAULT 0,
      rank      INTEGER NOT NULL DEFAULT 0,  -- 0-3, set by performance reviews
      rev_right INTEGER NOT NULL DEFAULT 0,  -- tasks right since the last review
      rev_total INTEGER NOT NULL DEFAULT 0,
      correct   INTEGER NOT NULL DEFAULT 0,  -- lifetime
      total     INTEGER NOT NULL DEFAULT 0,
      earned    INTEGER NOT NULL DEFAULT 0,  -- cents, lifetime
      PRIMARY KEY (guild_id, user_id, ticker)
    );
    INSERT INTO careers (guild_id, user_id, ticker, shifts, rank)
      SELECT guild_id, user_id, job, shifts,
        CASE WHEN shifts >= 50 THEN 3 WHEN shifts >= 25 THEN 2 WHEN shifts >= 10 THEN 1 ELSE 0 END
      FROM players WHERE job IS NOT NULL;
    ALTER TABLE players ADD COLUMN remind INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN last_gig INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players ADD COLUMN gig_earned INTEGER NOT NULL DEFAULT 0;
  `
];

const PLAYER_COLUMNS = new Set(['receipts', 'remind', 'last_gig', 'gig_earned', 'username', 'cash', 'debt', 'title', 'title_credit', 'daily_day', 'job',
  'shifts', 'hired_at', 'overtime', 'last_work', 'div_carry']);
const HOLDING_COLUMNS = new Set(['shares', 'div_index', 'div_shares', 'wipe_seen']);
const CAREER_COLUMNS = new Set(['shifts', 'rank', 'rev_right', 'rev_total', 'correct', 'total', 'earned']);

function open(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  const before = db.prepare('PRAGMA user_version').get().user_version;
  if (file !== ':memory:' && before > 0 && before < MIGRATIONS.length - 1) {
    backup(db, path.join(path.dirname(file), 'backups'), `before-v${MIGRATIONS.length - 1}`); // safety copy before upgrading
  }
  migrate(db);
  return wrap(db, file);
}

// Copies the whole database to backups/rend-conomy-<label>.db, keeping the newest `keep` copies.
function backup(db, dir, label, keep = 10) {
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `rend-conomy-${label}.db`);
  if (fs.existsSync(out)) fs.unlinkSync(out);
  db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.db'))
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of files.slice(keep)) fs.unlinkSync(path.join(dir, old.f));
  return out;
}

function migrate(db) {
  let version = db.prepare('PRAGMA user_version').get().user_version;
  for (let v = version + 1; v < MIGRATIONS.length; v++) {
    if (MIGRATIONS[v]) db.exec(MIGRATIONS[v]);
    db.exec(`PRAGMA user_version = ${v}`);
    version = v;
  }
}

function wrap(db, file = ':memory:') {
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

    // Saves a dated copy in data/backups (keeps the newest 10). Called on start and every 6 hours.
    backup() {
      if (file === ':memory:') return null;
      const stamp = new Date().toISOString().slice(0, 13).replace('T', '_'); // 2026-11-09_22
      return backup(db, path.join(path.dirname(file), 'backups'), stamp);
    },
    playerCount() { return st('SELECT count(*) AS n FROM players').get().n; },

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
        require('./reserve').spend(api, config.startingCash); // starting Polygons come out of the reserve
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
    // Your record at one company (kept even after you quit)
    career(guildId, userId, ticker) {
      return st('SELECT * FROM careers WHERE guild_id = ? AND user_id = ? AND ticker = ?').get(guildId, userId, ticker)
        || { guild_id: guildId, user_id: userId, ticker, shifts: 0, rank: 0, rev_right: 0, rev_total: 0, correct: 0, total: 0, earned: 0 };
    },
    careers(guildId, userId) {
      return st('SELECT * FROM careers WHERE guild_id = ? AND user_id = ? ORDER BY shifts DESC').all(guildId, userId);
    },
    updateCareer(guildId, userId, ticker, fields) {
      st('INSERT OR IGNORE INTO careers (guild_id, user_id, ticker) VALUES (?, ?, ?)').run(guildId, userId, ticker);
      const { sql, values } = setClause(fields, CAREER_COLUMNS);
      if (sql) st(`UPDATE careers SET ${sql} WHERE guild_id = ? AND user_id = ? AND ticker = ?`).run(...values, guildId, userId, ticker);
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

    // Inventory
    inventory(guildId, userId) {
      return st('SELECT item, qty FROM inventory WHERE guild_id = ? AND user_id = ? AND qty > 0 ORDER BY item').all(guildId, userId);
    },
    itemCount(guildId, userId, item) {
      const r = st('SELECT qty FROM inventory WHERE guild_id = ? AND user_id = ? AND item = ?').get(guildId, userId, item);
      return r ? r.qty : 0;
    },
    addItem(guildId, userId, item, n = 1) {
      st(`INSERT INTO inventory (guild_id, user_id, item, qty) VALUES (?, ?, ?, ?)
        ON CONFLICT (guild_id, user_id, item) DO UPDATE SET qty = MAX(0, qty + excluded.qty)`).run(guildId, userId, item, n);
    },

    // For the leaderboard API
    guildPlayers(guildId) { return st('SELECT user_id, username, cash, debt FROM players WHERE guild_id = ?').all(guildId); },
    guildHoldings(guildId) { return st('SELECT user_id, ticker, shares, wipe_seen FROM holdings WHERE guild_id = ? AND shares > 0').all(guildId); }
  };
  return api;
}

module.exports = { open };
