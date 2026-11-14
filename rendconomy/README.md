# RendConomy

The ground-up TypeScript rewrite of the Rend-Conomy Discord bot. It lives on the `rewrite` branch next to the old bot (`engine/`) until it ships, together with the economy reset.

The rules every feature follows are on the **RendConomy Rewrite Baselines** whiteboard. The short version is below.

## Baselines in code

- **Money is whole cents.** ⬡12.34 is `1234`. Only `src/core/money.ts` converts. Amounts typed by players go through `parseAmount` / `parseCount` (500, 1.5k, 2m, 50%, all, max, half).
- **All money moves through `transfer()`** in `src/core/ledger.ts`, inside a transaction, and every move is written to the ledger with a reason. Nothing else may change a balance. Balances can't go negative (the database refuses).
- **Closed economy.** Polygons are minted only into the Reserve. Players earn from it and spend back into it. `audit()` checks that every Polygon is accounted for.
- **Errors players should see are `GameError`s** (with a code). Anything else is a bug.
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
  test/               node:test, no Discord needed
```

## Running it

Needs Node 22.13 or newer.

```
cd rendconomy
npm install
cp .env.example .env    # fill in the token for the test bot
npm test                # builds, then runs every test
npm start               # builds, then starts
```
