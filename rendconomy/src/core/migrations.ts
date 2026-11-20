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
  `,

  /* v7: Marquez's shop, inventories, item effects, profile titles. */ `
  CREATE TABLE inventory (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    item     TEXT NOT NULL,
    qty      INTEGER NOT NULL CHECK (qty >= 0),
    PRIMARY KEY (guild_id, user_id, item)
  );
  -- Active item effects: a count (Overtime: 1 shift) and/or an end time (Dividend Booster: 24 hours).
  CREATE TABLE effects (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    key      TEXT NOT NULL,
    value    INTEGER NOT NULL DEFAULT 0,
    until    INTEGER,
    PRIMARY KEY (guild_id, user_id, key)
  );
  -- Stock is shared by every server.
  CREATE TABLE shop_stock (
    item  TEXT PRIMARY KEY,
    stock INTEGER NOT NULL
  );
  -- One collectible per customer per week.
  CREATE TABLE shop_buys (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    item     TEXT NOT NULL,
    period   TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id, item, period)
  );
  ALTER TABLE players ADD COLUMN title TEXT;
  `,

  /* v8: the Rend-Sino. Per-player streaks and TODD's ban, and stats per game. */ `
  CREATE TABLE casino (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    win_streak INTEGER NOT NULL DEFAULT 0,
    ban_until  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE gambling (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    game     TEXT NOT NULL,
    played   INTEGER NOT NULL DEFAULT 0,
    wagered  INTEGER NOT NULL DEFAULT 0,
    paid     INTEGER NOT NULL DEFAULT 0,
    biggest  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, game)
  );
  `,

  /* v9: TODD's bailouts and loans between players. */ `
  ALTER TABLE players ADD COLUMN todd_debt INTEGER NOT NULL DEFAULT 0;   -- cents owed to TODD
  CREATE TABLE loans (
    id           INTEGER PRIMARY KEY,
    guild_id     TEXT NOT NULL,
    lender_id    TEXT NOT NULL,
    borrower_id  TEXT NOT NULL,
    principal    INTEGER NOT NULL,
    rate         REAL NOT NULL,              -- percent per day, compounding until due
    owed         INTEGER NOT NULL,
    created_at   INTEGER NOT NULL,
    due_at       INTEGER NOT NULL,
    last_accrual INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',   -- active | paid | forgiven
    closed_at    INTEGER
  );
  CREATE INDEX loans_borrower ON loans (guild_id, borrower_id, status);
  CREATE INDEX loans_lender ON loans (guild_id, lender_id, status);
  `,

  /* v10: hourly closing prices for the last 7 days (the site's 7-day charts). */ `
  CREATE TABLE price_history (
    ticker TEXT NOT NULL,
    hour   INTEGER NOT NULL,
    price  REAL NOT NULL,
    PRIMARY KEY (ticker, hour)
  );
  `,

  /* v11: Sit Back and Relax and Schemes: limit orders, brokers, short selling. Money set aside for an
     order or a short sits in the player's escrow account ('escrow:<guild>:<user>'). */ `
  CREATE TABLE orders (
    id         INTEGER PRIMARY KEY,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    ticker     TEXT NOT NULL,
    side       TEXT NOT NULL,              -- buy | sell
    kind       TEXT NOT NULL,              -- limit | stop
    qty        INTEGER,                    -- null = all (sells)
    price      INTEGER NOT NULL,           -- cents
    reserved   INTEGER NOT NULL DEFAULT 0, -- cents set aside (buys)
    created_at INTEGER NOT NULL
  );
  CREATE INDEX orders_owner ON orders (guild_id, user_id);
  CREATE TABLE brokers (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    active    INTEGER NOT NULL DEFAULT 0,
    name      TEXT,
    trait     TEXT,
    hired_at  INTEGER,
    paid_at   INTEGER,
    hires     INTEGER NOT NULL DEFAULT 0,
    rules     TEXT NOT NULL DEFAULT '{}',    -- { TICKER: { buyUntil, sellAt, stopAt } } in cents
    holdings  TEXT NOT NULL DEFAULT '{}',    -- { TICKER: { shares, cost, wipes } }
    profit    INTEGER NOT NULL DEFAULT 0,
    ticks     INTEGER NOT NULL DEFAULT 0,
    log       TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE shorts (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    ticker    TEXT NOT NULL,
    shares    INTEGER NOT NULL,
    entry     INTEGER NOT NULL,            -- average price sold at, cents
    margin    INTEGER NOT NULL,            -- cents in escrow
    wipes     INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, ticker)
  );
  `,

  /* v12: the weekly lottery (one per server), and chat pay counters. */ `
  CREATE TABLE lottery (
    guild_id TEXT NOT NULL,
    draw     TEXT NOT NULL,                -- the Sunday it's drawn on, YYYY-MM-DD
    user_id  TEXT NOT NULL,
    tickets  INTEGER NOT NULL,
    PRIMARY KEY (guild_id, draw, user_id)
  );
  CREATE TABLE chat_pay (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    day      TEXT NOT NULL,
    paid     INTEGER NOT NULL DEFAULT 0,
    last_at  INTEGER NOT NULL DEFAULT 0,
    last_text TEXT,
    PRIMARY KEY (guild_id, user_id)
  );
  `,

  /* v13: player companies, their shares, takeover bids and merger proposals. A company's treasury is its
     own ledger account ('company:<TICKER>'). Companies are global; holdings are per server. */ `
  CREATE TABLE companies (
    ticker        TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    owner_id      TEXT NOT NULL,
    owner_name    TEXT,
    owner_guild   TEXT NOT NULL,
    status        TEXT NOT NULL,          -- pending | private | public | dead | rejected
    level         INTEGER NOT NULL DEFAULT 1,
    price         REAL NOT NULL DEFAULT 0,
    offering_left INTEGER NOT NULL DEFAULT 0,
    strikes       INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    approved_at   INTEGER,
    ipo_at        INTEGER,
    died_at       INTEGER,
    last_upkeep   INTEGER,
    last_salary   INTEGER,
    history       TEXT NOT NULL DEFAULT '[]',
    note          TEXT
  );
  CREATE TABLE company_holdings (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    ticker   TEXT NOT NULL,
    shares   INTEGER NOT NULL CHECK (shares >= 0),
    PRIMARY KEY (guild_id, user_id, ticker)
  );
  CREATE TABLE takeovers (
    ticker       TEXT PRIMARY KEY,
    bidder_id    TEXT NOT NULL,
    bidder_guild TEXT NOT NULL,
    premium      INTEGER NOT NULL,       -- cents, held in the bidder's escrow
    ends_at      INTEGER NOT NULL
  );
  `,

  /* v14: heists' history. */ `
  CREATE TABLE heist_log (
    id       INTEGER PRIMARY KEY,
    guild_id TEXT NOT NULL,
    target   TEXT NOT NULL,
    crew     TEXT NOT NULL,                -- JSON [[userId, role, name], ...]
    outcome  TEXT NOT NULL,                -- clean | escaped | caught
    haul     INTEGER NOT NULL DEFAULT 0,
    at       INTEGER NOT NULL
  );
  `,

  /* v15: farming (per server, like balances). */ `
  CREATE TABLE farms (
    guild_id TEXT NOT NULL,
    user_id  TEXT NOT NULL,
    plots    INTEGER NOT NULL DEFAULT 3,
    remind   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE farm_plots (
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    slot          INTEGER NOT NULL,
    crop          TEXT NOT NULL,
    planted_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    progress      REAL NOT NULL DEFAULT 0,     -- ms of growth done
    watered       INTEGER NOT NULL DEFAULT 0,  -- this stage
    stage_since   INTEGER NOT NULL,
    harvests_left INTEGER NOT NULL DEFAULT 1,
    wilted        INTEGER NOT NULL DEFAULT 0,
    crow_at       INTEGER,
    fert          INTEGER NOT NULL DEFAULT 0,
    dry_ms        INTEGER NOT NULL DEFAULT 0,
    ready_at      INTEGER,
    storm_seen    INTEGER NOT NULL DEFAULT 0,
    reminded      INTEGER NOT NULL DEFAULT 0,
    seed          INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, slot)
  );
  `,

  /* v16: Polygon Holidays: advent doors and Secret Santa (per server). */ `
  CREATE TABLE holiday_doors (
    guild_id  TEXT NOT NULL,
    user_id   TEXT NOT NULL,
    year      INTEGER NOT NULL,
    day       INTEGER NOT NULL,
    opened_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id, year, day)
  );
  CREATE TABLE santa (
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    year       INTEGER NOT NULL,
    target_id  TEXT,
    gift_cents INTEGER NOT NULL DEFAULT 0,
    gift_item  TEXT,
    note       TEXT,
    gifted_at  INTEGER,
    delivered  INTEGER NOT NULL DEFAULT 0,
    told       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id, year)
  );
  `,

  /* v17: Connections pt. 2: the inbox, trade offers, and the Farmhand. */ `
  CREATE TABLE inbox (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id  TEXT NOT NULL,
    guild_id TEXT,
    title    TEXT NOT NULL,
    body     TEXT NOT NULL,
    created  INTEGER NOT NULL,
    read     INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX inbox_user ON inbox (user_id, id);
  CREATE TABLE trades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT NOT NULL,
    from_id     TEXT NOT NULL,
    to_id       TEXT NOT NULL,
    give_cents  INTEGER NOT NULL DEFAULT 0,
    give_item   TEXT,
    give_qty    INTEGER NOT NULL DEFAULT 0,
    want_cents  INTEGER NOT NULL DEFAULT 0,
    want_item   TEXT,
    want_qty    INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'open',
    created     INTEGER NOT NULL,
    expires     INTEGER NOT NULL
  );
  ALTER TABLE farms ADD COLUMN farmhand_until INTEGER;
  `,

  /* v18: Room to Grow: each server's 15 lots of real estate. */ `
  CREATE TABLE estates (
    guild_id      TEXT NOT NULL,
    lot           INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    owner_id      TEXT,
    status        TEXT NOT NULL DEFAULT 'bank',
    condition     REAL NOT NULL DEFAULT 100,
    settled_at    INTEGER NOT NULL,
    bought_at     INTEGER,
    squatters     INTEGER NOT NULL DEFAULT 0,
    shield_until  INTEGER NOT NULL DEFAULT 0,
    storefront    TEXT,
    auction_until INTEGER,
    bidder_id     TEXT,
    bid_cents     INTEGER NOT NULL DEFAULT 0,
    bid_until     INTEGER,
    PRIMARY KEY (guild_id, lot)
  );
  CREATE INDEX estates_owner ON estates (guild_id, owner_id);
  `,

  /* v19: No Questions Asked: the Underground (Heat, contraband charges, smuggling) and hot loot. */ `
  CREATE TABLE underground (
    guild_id       TEXT NOT NULL,
    user_id        TEXT NOT NULL,
    heat           REAL NOT NULL DEFAULT 0,
    heat_at        INTEGER NOT NULL DEFAULT 0,
    locked_until   INTEGER NOT NULL DEFAULT 0,
    entered        TEXT,
    dice           INTEGER NOT NULL DEFAULT 0,
    fake_id        INTEGER NOT NULL DEFAULT 0,
    lockpick       INTEGER NOT NULL DEFAULT 0,
    smoke          INTEGER NOT NULL DEFAULT 0,
    raids          INTEGER NOT NULL DEFAULT 0,
    fenced         INTEGER NOT NULL DEFAULT 0,
    runs_ok        INTEGER NOT NULL DEFAULT 0,
    spent          INTEGER NOT NULL DEFAULT 0,
    crew_day       TEXT,
    snitch_day     TEXT,
    smuggle_stake  INTEGER NOT NULL DEFAULT 0,
    smuggle_until  INTEGER,
    smuggle_mult   REAL,
    smuggle_night  TEXT,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE hot_loot (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      TEXT NOT NULL,
    user_id       TEXT NOT NULL,
    kind          TEXT NOT NULL,
    value         INTEGER NOT NULL,
    got_at        INTEGER NOT NULL,
    launder_until INTEGER,
    launder_lot   INTEGER
  );
  CREATE INDEX hot_loot_owner ON hot_loot (guild_id, user_id);
  `,

  /* v20: the Farm Handiness Update: the Farmhand's seed shed, replanting, auto-selling and DMs. */ `
  ALTER TABLE farms ADD COLUMN hand_shed TEXT;
  ALTER TABLE farms ADD COLUMN hand_last TEXT;
  ALTER TABLE farms ADD COLUMN hand_log TEXT;
  ALTER TABLE farms ADD COLUMN hand_at INTEGER;
  ALTER TABLE farms ADD COLUMN hand_sell INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE farms ADD COLUMN hand_dm INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE farms ADD COLUMN hand_out INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE farms ADD COLUMN hand_dm_at INTEGER NOT NULL DEFAULT 0;
  `,

  /* v21: Oh My God, 2 in 1!: the empty 8×8 city map (the old 15 lots are kept as estates_old until the plow
     fix refunds them), freight trains, landmarks, the farmhand's fertilizer, VIP free spins. */ `
  ALTER TABLE estates RENAME TO estates_old;
  CREATE TABLE estates (
    guild_id      TEXT NOT NULL,
    lot           INTEGER NOT NULL,
    kind          TEXT NOT NULL,
    owner_id      TEXT,
    status        TEXT NOT NULL DEFAULT 'owned',
    level         INTEGER NOT NULL DEFAULT 1,
    condition     REAL NOT NULL DEFAULT 100,
    settled_at    INTEGER NOT NULL,
    built_at      INTEGER,
    build_until   INTEGER NOT NULL DEFAULT 0,
    spent         INTEGER NOT NULL DEFAULT 0,
    squatters     INTEGER NOT NULL DEFAULT 0,
    shield_until  INTEGER NOT NULL DEFAULT 0,
    storefront    TEXT,
    auction_until INTEGER,
    bidder_id     TEXT,
    bid_cents     INTEGER NOT NULL DEFAULT 0,
    bid_until     INTEGER,
    PRIMARY KEY (guild_id, lot)
  );
  CREATE INDEX estates_owner_v21 ON estates (guild_id, owner_id);
  CREATE TABLE freight (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    cents      INTEGER NOT NULL,
    robbed     INTEGER NOT NULL DEFAULT 0,
    crops      INTEGER NOT NULL DEFAULT 0,
    goods      INTEGER NOT NULL DEFAULT 0,
    left_at    INTEGER NOT NULL,
    arrives_at INTEGER NOT NULL,
    done       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX freight_guild ON freight (guild_id, done, arrives_at);
  CREATE TABLE landmarks (
    guild_id  TEXT NOT NULL,
    idx       INTEGER NOT NULL,
    funded    INTEGER NOT NULL DEFAULT 0,
    done_at   INTEGER,
    PRIMARY KEY (guild_id, idx)
  );
  CREATE TABLE landmark_donors (
    guild_id  TEXT NOT NULL,
    idx       INTEGER NOT NULL,
    user_id   TEXT NOT NULL,
    cents     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, idx, user_id)
  );
  ALTER TABLE farms ADD COLUMN hand_fert INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE casino ADD COLUMN free_day TEXT;
  ALTER TABLE casino ADD COLUMN free_used INTEGER NOT NULL DEFAULT 0;
  `
];
