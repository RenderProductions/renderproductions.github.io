// Settings. Secrets and per-bot choices come from .env; the economy's numbers live here so they're
// reviewed in code like everything else. Each bot (the main bot, the test bot) has its own .env.
import fs from 'node:fs';
import path from 'node:path';
import { polygons } from './core/money';

/** Reads KEY=value lines from a .env file into process.env (without overwriting what's set). */
export function loadEnv(file = path.join(__dirname, '..', '..', '.env')): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}

const env = (key: string, fallback = ''): string => process.env[key] ?? fallback;

export const economy = {
  /** Every new player (and everyone after the reset) starts with this. */
  startingCash: polygons(500),
  /** r!daily, once per Eastern day. */
  dailyAmount: polygons(250),
  /** The Polygon Reserve's full size. */
  reserveStart: polygons(25_000_000),
  /** Market prices after the reset (decided Nov 13). */
  startingPrices: { RRM: polygons(167), NACH: polygons(120), BNW: polygons(80), BSTG: polygons(75), BLU: polygons(47) }
} as const;

export function botConfig() {
  return {
    name: env('BOT_NAME', 'RendConomy'),
    token: env('DISCORD_TOKEN'),
    clientId: env('DISCORD_CLIENT_ID'),
    /** Register slash commands to one server only (fast, for the test bot). Empty = everywhere. */
    devGuildId: env('DEV_GUILD_ID'),
    prefix: env('PREFIX', 'r!'),
    // Deliberately not the old bot's DB_PATH: the rewrite must never open the old bot's database
    dbFile: env('DB_FILE', path.join(__dirname, '..', '..', 'data', 'rendconomy.db')),
    // OWNER_IDS, or the old bot's BOT_OWNER_ID so its .env can be pasted in as-is
    /** Publish prices, profiles and stats to the site's data branch. Only the main bot should: PUBLISH_SITE_DATA=1 */
    publish: env('PUBLISH_SITE_DATA') === '1' && !!env('GITHUB_TOKEN'),
    githubToken: env('GITHUB_TOKEN'),
    githubRepo: env('GITHUB_REPO', 'RenderProductions/renderproductions.github.io'),
    dataBranch: env('DATA_BRANCH', 'data'),
    /** Market news webhook(s), comma-separated. Only the main bot should post. */
    newsWebhook: env('NEWS_WEBHOOK'),
    /** Where moderator actions are posted. Empty = not posted. */
    modLogChannelId: env('MOD_LOG_CHANNEL_ID'),
    ownerIds: (env('OWNER_IDS') || env('BOT_OWNER_ID')).split(',').map((s) => s.trim()).filter(Boolean)
  };
}

export type BotConfig = ReturnType<typeof botConfig>;
