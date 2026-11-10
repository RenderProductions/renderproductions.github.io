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
  dbPath: process.env.DB_PATH || path.join(__dirname, '..', 'data', 'rend-conomy.db'),
  port: Number(process.env.PORT) || 8080,
  siteUrl: 'https://renderproductions.github.io',

  // The market's time zone. r!daily resets at midnight here.
  timeZone: 'America/New_York',

  // Fallback ticker list, used in messages if prices.json can't be reached.
  tickers: ['RRM', 'NACH', 'BLU', 'BNW', 'BSTG'],

  // Economy numbers. Money is stored in cents so nothing gets rounded away.
  startingCash: 500_00,        // new players start with 500 Polygons
  dailyAmount: 250_00,         // r!daily gives 250 Polygons

  color: 0xffe600,             // site yellow
  colorTodd: 0xff6b6b,         // TODD red
  colorGood: 0x57f287          // debt cleared green
};
