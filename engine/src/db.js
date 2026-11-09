// Player data in SQLite (built into Node 22+, no native installs needed).
// Balances are per server, like the BDFD bot. Money is stored as whole cents.
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

function open(file = config.dbPath) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS players (
      guild_id   TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      username   TEXT,
      cash       INTEGER NOT NULL,       -- cents
      last_daily INTEGER NOT NULL DEFAULT 0,  -- ms timestamp
      created_at INTEGER NOT NULL,
      PRIMARY KEY (guild_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS holdings (
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      ticker   TEXT NOT NULL,
      shares   INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (guild_id, user_id, ticker)
    );
    CREATE TABLE IF NOT EXISTS trades (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      guild_id TEXT NOT NULL,
      user_id  TEXT NOT NULL,
      ticker   TEXT NOT NULL,
      shares   INTEGER NOT NULL,   -- positive = buy, negative = sell
      price    INTEGER NOT NULL,   -- cents per share
      time     INTEGER NOT NULL
    );
  `);
  return wrap(db);
}

function wrap(db) {
  const q = {
    getPlayer: db.prepare('SELECT * FROM players WHERE guild_id = ? AND user_id = ?'),
    addPlayer: db.prepare('INSERT INTO players (guild_id, user_id, username, cash, created_at) VALUES (?, ?, ?, ?, ?)'),
    setName: db.prepare('UPDATE players SET username = ? WHERE guild_id = ? AND user_id = ?'),
    addCash: db.prepare('UPDATE players SET cash = cash + ? WHERE guild_id = ? AND user_id = ?'),
    setDaily: db.prepare('UPDATE players SET last_daily = ? WHERE guild_id = ? AND user_id = ?'),
    getHoldings: db.prepare('SELECT ticker, shares FROM holdings WHERE guild_id = ? AND user_id = ? AND shares > 0 ORDER BY ticker'),
    getShares: db.prepare('SELECT shares FROM holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?'),
    addShares: db.prepare(`INSERT INTO holdings (guild_id, user_id, ticker, shares) VALUES (?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id, ticker) DO UPDATE SET shares = shares + excluded.shares`),
    logTrade: db.prepare('INSERT INTO trades (guild_id, user_id, ticker, shares, price, time) VALUES (?, ?, ?, ?, ?, ?)'),
    guildPlayers: db.prepare('SELECT user_id, username, cash FROM players WHERE guild_id = ?'),
    guildHoldings: db.prepare('SELECT user_id, ticker, shares FROM holdings WHERE guild_id = ? AND shares > 0')
  };

  // Runs fn inside a transaction so a trade can never half-happen.
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const out = fn(); db.exec('COMMIT'); return out; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  return {
    raw: db,
    tx,

    // Gets a player, creating them with starting cash on their first command.
    player(guildId, user) {
      let p = q.getPlayer.get(guildId, user.id);
      if (!p) {
        q.addPlayer.run(guildId, user.id, user.username, config.startingCash, Date.now());
        p = q.getPlayer.get(guildId, user.id);
      } else if (user.username && p.username !== user.username) {
        q.setName.run(user.username, guildId, user.id);
      }
      return p;
    },
    addCash(guildId, userId, cents) { q.addCash.run(cents, guildId, userId); },
    setDaily(guildId, userId, time) { q.setDaily.run(time, guildId, userId); },
    holdings(guildId, userId) { return q.getHoldings.all(guildId, userId); },
    shares(guildId, userId, ticker) { const r = q.getShares.get(guildId, userId, ticker); return r ? r.shares : 0; },
    addShares(guildId, userId, ticker, n) { q.addShares.run(guildId, userId, ticker, n); },
    logTrade(guildId, userId, ticker, n, priceCents) { q.logTrade.run(guildId, userId, ticker, n, priceCents, Date.now()); },
    guildPlayers(guildId) { return q.guildPlayers.all(guildId); },
    guildHoldings(guildId) { return q.guildHoldings.all(guildId); }
  };
}

module.exports = { open };
