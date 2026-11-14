// Each entry upgrades the database by one version (entry 0 takes an empty database to version 1).
// Never edit an entry that has shipped; add a new one. Upgrades only ADD (tables, columns, indexes).

export const MIGRATIONS: readonly string[] = [
  /* v1: the core. Settings, money (accounts + ledger), players, cooldowns. */ `
  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Anything that can hold Polygons: the Reserve, a player's wallet in one server, later company treasuries.
  -- Balances can never go below zero: debt is tracked separately (loans), never as a negative balance.
  CREATE TABLE accounts (
    id         TEXT PRIMARY KEY,               -- 'reserve', 'wallet:<guild>:<user>', ...
    kind       TEXT NOT NULL,                  -- reserve | wallet | ...
    guild_id   TEXT,
    owner_id   TEXT,
    balance    INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX accounts_owner ON accounts (kind, guild_id, owner_id);

  -- Every Polygon that moves. from_id NULL = minted (only the Reserve's own funding); to_id NULL = burned.
  CREATE TABLE ledger (
    id       INTEGER PRIMARY KEY,
    at       INTEGER NOT NULL,
    from_id  TEXT REFERENCES accounts (id),
    to_id    TEXT REFERENCES accounts (id),
    cents    INTEGER NOT NULL CHECK (cents > 0),
    reason   TEXT NOT NULL,                    -- 'daily', 'stock.buy', 'mod.give', ...
    guild_id TEXT,
    actor_id TEXT,                             -- who caused it (the player, or the mod)
    note     TEXT                              -- optional JSON details
  );
  CREATE INDEX ledger_from ON ledger (from_id, at);
  CREATE INDEX ledger_to ON ledger (to_id, at);
  CREATE INDEX ledger_reason ON ledger (reason, at);

  -- One row per player per server.
  CREATE TABLE players (
    guild_id     TEXT NOT NULL,
    user_id      TEXT NOT NULL,
    joined_at    INTEGER NOT NULL,
    daily_day    TEXT,                         -- Eastern date of the last daily claimed, YYYY-MM-DD
    daily_streak INTEGER NOT NULL DEFAULT 0,
    frozen       INTEGER NOT NULL DEFAULT 0,   -- mods can freeze an account
    PRIMARY KEY (guild_id, user_id)
  );

  -- Every cooldown in the bot. Stored, so a restart never resets one.
  CREATE TABLE cooldowns (
    name    TEXT NOT NULL,                     -- 'work', 'heist', ...
    subject TEXT NOT NULL,                     -- usually '<guild>:<user>'
    until   INTEGER NOT NULL,
    PRIMARY KEY (name, subject)
  );
  `,

  /* v2: the stock market. Holdings per server, and lots (what each batch of shares cost, and when). */ `
  CREATE TABLE holdings (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    ticker     TEXT NOT NULL,
    shares     INTEGER NOT NULL DEFAULT 0 CHECK (shares >= 0),
    wipes_seen INTEGER NOT NULL DEFAULT 0,   -- bankruptcies already applied to these shares
    PRIMARY KEY (guild_id, user_id, ticker)
  );

  CREATE TABLE lots (
    id          INTEGER PRIMARY KEY,
    guild_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    ticker      TEXT NOT NULL,
    qty         INTEGER NOT NULL CHECK (qty > 0),
    price_cents INTEGER NOT NULL,
    bought_at   INTEGER NOT NULL
  );
  CREATE INDEX lots_owner ON lots (guild_id, user_id, ticker, id);
  `
];
