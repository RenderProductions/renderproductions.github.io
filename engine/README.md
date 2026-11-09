# Rend-Conomy engine

The Rend-Conomy Discord bot in JavaScript, living next to the site. Every command works both as `r!name` and `/name`.

**Status:** scaffold. Core commands only (market, buy, sell, portfolio, daily, help). The BDFD bot keeps running until this one is ready to replace it.

## Folder map

```
engine/
  src/
    index.js       starts everything (Discord, market feed, web API)
    config.js      settings + economy numbers (start cash, daily amount)
    db.js          player data in SQLite: cash (in cents), shares, trade log
    market.js      reads live prices.json and answers "can this be traded?"
    router.js      turns r! messages and /slash commands into the same call
    api.js         small web API for the site (/health, /api/leaderboard)
    register.js    tells Discord about the slash commands
    format.js      money/percent formatting
    commands/      one file per command; add new ones to commands/index.js
  test/            offline tests, no Discord needed
```

## Adding a command

1. Copy `src/commands/daily.js` to a new file and change `name`, `description`, `options` and `run`.
2. Add it to the list in `src/commands/index.js`.
3. `npm test`, then `npm run register` so the slash version shows up.

Options are listed in order, so `options: [ticker, amount]` means `r!buy RRM 5` and `/buy ticker:RRM amount:5` both work. `run` returns a string or a Discord message object (embeds etc).

## Running it locally

Needs Node 22.13 or newer.

```
cd engine
npm install
cp .env.example .env      # then fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
npm test
npm run register          # once, and after changing commands
npm start
```

## Discord Developer Portal setup

1. Make a **new** application (keep the BDFD one running while testing).
2. Bot tab: reset the token and put it in `.env` as `DISCORD_TOKEN`. Never commit it, the repo is public.
3. Bot tab: switch on **Message Content Intent** (needed for `r!`). Under 100 servers it's just a toggle.
4. OAuth2 > URL Generator: scopes `bot` and `applications.commands`, permissions Send Messages, Embed Links, Read Message History. Invite it to a test server.

## Hosting on Fly.io

`fly.toml` and `Dockerfile` in this folder are already set up: one always-on machine in Chicago, the database on a volume at `/data`, and the web API on HTTPS. Pushing changes to `engine/` deploys automatically once step 5 is done.

One-time setup, from the `engine` folder on your computer (install flyctl first):

```
fly auth login
fly apps create rend-conomy            # if taken, pick another name and update fly.toml
fly volumes create rend_data --region ord --size 1
fly secrets set DISCORD_TOKEN=... DISCORD_CLIENT_ID=...
fly deploy --ha=false                  # exactly ONE machine, or the bot replies twice
```

Then for automatic deploys:

5. `fly tokens create deploy` and copy the token.
6. GitHub repo > Settings > Secrets and variables > Actions > New secret: name `FLY_API_TOKEN`, paste it.

Useful commands: `fly logs` (watch the bot), `fly status`, `fly ssh console` (look at /data).

The API lives at `https://<app name>.fly.dev/health`.

## Data

Money is stored in cents (500 Polygons = `50000`), so balances keep their decimals. Balances are per server, like the BDFD bot. Trades are logged in the `trades` table.

## Next steps

- Jobs (`r!apply`, `r!quit`, `r!work`), shop, slots, bailouts, dividends, `r!chart`, `r!redeem`
- Move the market engine from `.github/scripts/market` into the bot so prices tick here instead of in Actions
- Decide how to carry BDFD balances over (export command or a new season)
- Update the Privacy Policy once data lives here instead of BDFD
