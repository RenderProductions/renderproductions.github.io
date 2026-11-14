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
  `,

  /* v3: jobs and stored interactions. */ `
  ALTER TABLE players ADD COLUMN job TEXT;            -- ticker of the company they work for
  ALTER TABLE players ADD COLUMN hired_at INTEGER;
  ALTER TABLE players ADD COLUMN quit_at INTEGER;     -- quitting locks applying for 24 hours

  -- A player's record at each company. Kept when they quit, so coming back keeps their rank.
  CREATE TABLE careers (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    ticker    TEXT NOT NULL,
    rank      INTEGER NOT NULL DEFAULT 0,
    shifts    INTEGER NOT NULL DEFAULT 0,
    correct   INTEGER NOT NULL DEFAULT 0,
    rev_total INTEGER NOT NULL DEFAULT 0,   -- shifts since the last performance review
    rev_right INTEGER NOT NULL DEFAULT 0,
    earned    INTEGER NOT NULL DEFAULT 0,   -- cents
    PRIMARY KEY (guild_id, user_id, ticker)
  );

  -- Anything waiting for a player's answer: a work task, later a blackjack hand or a heist.
  -- Stored so buttons keep working after a restart; the state is JSON owned by the kind's handler.
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    guild_id   TEXT,
    channel_id TEXT,
    user_id    TEXT NOT NULL,
    message_id TEXT,                         -- the bot message holding its buttons, once sent
    state      TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id, kind);
  `,

  /* v4: display names (for leaderboards), savings accounts. */ `
  ALTER TABLE players ADD COLUMN name TEXT;

  -- A savings account's Polygons sit in their own ledger account ('savings:<id>') until it closes.
  CREATE TABLE savings (
    id         INTEGER PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    amount     INTEGER NOT NULL,               -- cents put in
    rate_bp    INTEGER NOT NULL,               -- interest at the end, basis points
    days       INTEGER NOT NULL,
    opened_at  INTEGER NOT NULL,
    ends_at    INTEGER NOT NULL
  );
  CREATE INDEX savings_owner ON savings (guild_id, user_id);
  `,

  /* v5: dividends. Each holding remembers the company's dividend index when it was last settled;
     earnings wait in div_pending (Polygons, with fractions) until claimed. */ `
  ALTER TABLE holdings ADD COLUMN div_index REAL NOT NULL DEFAULT 0;
  ALTER TABLE players ADD COLUMN div_pending REAL NOT NULL DEFAULT 0;
  `,

  /* v6: achievements. Global per player (they follow you across servers) and kept through the reset. */ `
  CREATE TABLE achievements (
    user_id     TEXT NOT NULL,
    id          TEXT NOT NULL,
    guild_id    TEXT,                          -- where it was unlocked (its payout went there)
    unlocked_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  );
  -- Counters toward achievements ("25 gigs").
  CREATE TABLE progress (
    user_id TEXT NOT NULL,
    key     TEXT NOT NULL,
    value   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, key)
  );
  `
];
