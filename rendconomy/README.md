# RendConomy

The ground-up TypeScript rewrite of the Rend-Conomy Discord bot. It lives on the `rewrite` branch next to the old bot (`engine/`) until it ships, together with the economy reset.

The rules every feature follows are on the **RendConomy Rewrite Baselines** whiteboard. The short version is below.

## Baselines in code

- **Money is whole cents.** ⬡12.34 is `1234`. Only `src/core/money.ts` converts. Amounts typed by players go through `parseAmount` / `parseCount` (500, 1.5k, 2m, 50%, all, max, half).
- **All money moves through `transfer()`** in `src/core/ledger.ts`, inside a transaction, and every move is written to the ledger with a reason. Nothing else may change a balance. Balances can't go negative (the database refuses).
- **Closed economy.** Polygons are minted only into the Reserve. Players earn from it and spend back into it. `audit()` checks that every Polygon is accounted for.
- **Errors players should see are `GameError`s** (with a code). Anything else is a bug.
- **Buttons and typed answers go through sessions** (`src/core/sessions.ts`), stored in the database: they survive restarts, and `sessions.end()` succeeds once, so an answer is graded exactly once. Every button press gets a response.
- **Game events** (`src/core/events.ts`): systems announce what happened (`work.shift`, `stock.sold`...) so achievements and stats can listen instead of being called from every command.
- **Time:** the day is Eastern. Dailies reset at 12 AM Eastern for everyone; a streak continues if the last claim was yesterday. Cooldowns are stored in the database (`takeCooldown` refuses a second click at the same moment).
- **Luck** comes from an `Rng` (`src/core/rng.ts`): crypto randomness live, a seeded one in tests.
- **Schema changes** are numbered migrations in `src/core/migrations.ts`. They run on startup, after a backup. Never edit one that has shipped; add a new one.
- **Voice:** the narrator is very formal and to the point. TODD is the lender and casino enforcer. Marquez runs the shop.

## Folder map

```
rendconomy/
  src/
    index.ts          starts the bot
    config.ts         .env settings + the economy's numbers (starting cash, Reserve, starting prices)
    core/
      db.ts           SQLite, transactions (nested = savepoints), backups, migrations runner
      migrations.ts   the schema, one entry per version
      money.ts        cents, formatting, the one amount format
      ledger.ts       accounts, transfer/mint/burn, history, audit
      economy.ts      funding the Reserve, creating players
      time.ts         Eastern days, the daily reset, cooldowns
      rng.ts          the one source of luck
      errors.ts       GameError
      backups.ts      one backup per day, last 7 kept
    market/
      engine/         the price engine (carried over from .github/scripts/market, plain JS; starting prices live here)
      engine.ts       typed doorway to it
      market.ts       runs a tick every 5 minutes, stores prices + hidden state, quotes
      trading.ts      buy/sell against the Reserve, lots (oldest first), bankruptcy wipes, portfolio
    work/
      jobs.ts         companies, ranks, pay, the rules (cooldowns, reviews, rushes)
      tasks.ts        the tasks, as plain data with a grading rule (so they can be stored)
      shift.ts        hand out a task, grade it once, pay, reviews, rush orders, layoffs
    commands/         one file per command, plus shared helpers; sessions.ts says who answers which buttons
    discord/          router (slash + r! into one call), style (colors, narrator voice)
  start.js            the host's startup file: install, build, run
  test/               node:test, no Discord needed
```

## Commands so far

`/daily`, `/balance` (`r!bal`), `/history` (`r!tx`), `/work`, `/gig`, `/apply`, `/quit`, `/job`, `/market` (`r!m`), `/buy`, `/sell`, `/portfolio` (`r!pf`), `/reserve`, `/ping`, `/help`. Every command works as `/name` and `r!name`.
Commands are plain functions in `src/commands/` (see `types.ts`); add new ones to `src/commands/index.ts`.

## Hosting on Bot-Hosting.net

1. Startup tab: set the **Git branch** to `rewrite` (until switch-over day) and keep auto-update on.
2. Set the **main file** to `rendconomy/start.js`. It installs packages, builds the TypeScript and starts the bot.
3. Put the `.env` in `rendconomy/.env` (the old bot's `.env` can be pasted in as-is).
4. Restart. The bot makes its own database in `rendconomy/data/` and backs it up daily (last 7 kept).

## Running it locally

Needs Node 22.13 or newer.

```
cd rendconomy
npm install
cp .env.example .env    # fill in the token for the test bot
npm test                # builds, then runs every test
npm start               # builds, then starts
```
