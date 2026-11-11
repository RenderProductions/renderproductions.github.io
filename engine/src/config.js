// Settings come from environment variables (or engine/.env when running locally).
const fs = require('fs');
const path = require('path');

// Tiny .env loader so there is no extra dependency. Real env vars win.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

module.exports = {
  token: process.env.DISCORD_TOKEN || '',
  clientId: process.env.DISCORD_CLIENT_ID || '',
  devGuildId: process.env.DEV_GUILD_ID || '',
  prefix: process.env.PREFIX || 'r!',
  pricesUrl: process.env.PRICES_URL || 'https://renderproductions.github.io/prices.json',
  // A relative DB_PATH is read from the engine folder, so it doesn't depend on where the host starts the bot
  dbPath: path.resolve(path.join(__dirname, '..'), process.env.DB_PATH || path.join('data', 'rend-conomy.db')),
  port: Number(process.env.PORT) || 8080,
  siteUrl: 'https://renderproductions.github.io',

  // Player company approvals: your Discord user ID, and/or The Render Room's server ID
  // (mods with Manage Messages there can approve). Companies can't be approved until one is set.
  ownerId: process.env.BOT_OWNER_ID || '',
  homeGuildId: process.env.HOME_GUILD_ID || '',

  // Publishing player companies to the site: a GitHub token that can write to the repo.
  // The bot saves player-companies.json on the "data" branch, which the exchange page reads.
  githubToken: process.env.GITHUB_TOKEN || '',
  githubRepo: process.env.GITHUB_REPO || 'RenderProductions/renderproductions.github.io',
  dataBranch: process.env.DATA_BRANCH || 'data',

  // Who moves prices: "github" (the GitHub Action writes prices.json, the default) or "bot" (the bot
  // runs the market itself, see src/marketEngine.js). MARKET_SECRET decrypts the Action's hidden state.
  marketEngine: (process.env.MARKET_ENGINE || 'github').toLowerCase(),
  marketSecret: process.env.MARKET_SECRET || '',

  // The market's time zone. r!daily resets at midnight here.
  timeZone: 'America/New_York',

  // Fallback ticker list, used in messages if prices.json can't be reached.
  tickers: ['RRM', 'NACH', 'BLU', 'BNW', 'BSTG'],

  // Economy numbers. Money is stored in cents so nothing gets rounded away.
  startingCash: 500_00,        // new players start with 500 Polygons
  achievementPay: true,        // achievements pay out by rarity (off in the older tests, which count exact balances)
  dailyAmount: 250_00,         // r!daily gives 250 Polygons
  // The Polygon Reserve (src/reserve.js): how many Polygons the house starts with, shared by every server
  reserveStart: Math.round((Number(process.env.RESERVE_START) || 250_000) * 100),
  // Optional: the market news webhook URL (the same one as the DISCORD_WEBHOOK secret on GitHub),
  // so Polygon Reserve warnings post in the market news feed
  newsWebhook: process.env.NEWS_WEBHOOK || '',
  // The Discord Activity's Cloudflare Worker (activity/worker.js) and the secret the bot uses with it
  activityUrl: (process.env.ACTIVITY_URL || '').replace(/\/+$/, ''),
  activitySecret: process.env.ACTIVITY_SECRET || '',

  color: 0xffe600,             // site yellow
  colorTodd: 0xff6b6b,         // TODD red
  colorGood: 0x57f287          // debt cleared green
};
