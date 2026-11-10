// Starts the Rend-Conomy bot: Discord connection, market feed, and web API.
//   npm start
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const config = require('./config');
const db = require('./db').open();
const market = require('./market');
const router = require('./router');
const api = require('./api');
const { slashCommands } = require('./slash');

const deps = { db, market }; // the Discord client is added once it exists

// Show that saved data survived the restart, and keep backups in data/backups
console.log(`[db] ${db.playerCount()} player record(s) loaded from ${config.dbPath}`);
const saveBackup = () => { try { console.log('[db] Backup saved:', db.backup()); } catch (e) { console.error('[db] Backup failed:', e.message); } };
saveBackup();
setInterval(saveBackup, 6 * 60 * 60 * 1000).unref();

// Player companies: upkeep and prices move every 5 minutes, and the site gets a copy
const companies = require('./companies');
const tickCompanies = () => {
  try {
    for (const e of companies.tick(db)) {
      console.log(`[companies] ${e.ticker}: ${e.type === 'dead' ? 'went under' : `missed upkeep (${e.strikes} in a row)`}`);
    }
  } catch (e) { console.error('[companies] Tick failed:', e); }
};
tickCompanies();
setInterval(tickCompanies, companies.RULES.tickMs).unref();

// The Polygon Reserve: refills during a crash recovery, and starts a crash when it runs dry
const reserve = require('./reserve');
console.log(`[reserve] ${Math.round(reserve.level(db) * 100)}% full (${reserve.get(db) / 100} Polygons)`);
// Warnings go to the market news feed, through the same webhook the market news uses
const announce = (text, color = 0xf0b232) => {
  console.log('[reserve]', text.replace(/\*/g, ''));
  if (!config.newsWebhook) return;
  const body = JSON.stringify({
    username: 'Rend-Conomy Market', avatar_url: 'https://renderproductions.github.io/bot/market-icon.png',
    embeds: [{ color, description: text + `\nCheck it with \`${config.prefix}reserve\`.` }], allowed_mentions: { parse: [] }
  });
  fetch(config.newsWebhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    .then((r) => { if (!r.ok) console.error('[reserve] Webhook said', r.status); })
    .catch((e) => console.error('[reserve] Could not post the warning:', e.message));
};
reserve.events.on('low', ({ line }) => announce(line <= 0
  ? '💀 **THE POLYGON RESERVE IS EMPTY.** The house is out of Polygons. Brace for a crash.'
  : line <= 0.1 ? '🚨 **The Polygon Reserve is under 10%.** Payouts are way down. One more big cash-out and the market crashes.'
  : line <= 0.25 ? '⚠️ **The Polygon Reserve is under 25%.** Payouts are shrinking. Buy stock and shop to fill it back up!'
  : '😬 **The Polygon Reserve is under half.** TODD is starting to sweat.', line <= 0.1 ? 0x992d22 : line <= 0.25 ? 0xff6b6b : 0xf0b232));
reserve.events.on('safe', () => announce('🏦 **The Polygon Reserve is back above half.** Crisis averted. For now.', 0x57f287));
const tickReserve = async () => {
  try {
    const m = await market.get();
    reserve.recover(db, m);
    const r = await reserve.maybeCrash(db, m);
    if (r.started) announce('💥 **The Polygon Reserve ran dry. The market is about to crash.**', 0x992d22);
    else if (r.error && r.error !== 'no GITHUB_TOKEN') console.error('[reserve] Could not start the crash:', r.error, '(the GitHub token needs Actions: Read and write)');
  } catch (e) { console.error('[reserve] Tick failed:', e.message); }
};
setInterval(tickReserve, 5 * 60 * 1000).unref();
require('./publish').start(db);

// Start the web API first, so the host's health check passes even if Discord has trouble.
// /health reports whether the bot is actually connected.
api.start(deps, () => ({ discord: client.isReady() ? 'connected' : 'not connected' }));
// The market: run it here (MARKET_ENGINE=bot), or read the GitHub Action's prices.json (the default)
const marketEngine = require('./marketEngine');
if (marketEngine.enabled()) marketEngine.start(db).catch((e) => console.error('[market] Could not start the market:', e));
else market.startAutoRefresh();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // needed for r! commands; switch it on in the Developer Portal
  ]
});
deps.client = client; // lets commands look up users (r!balance @someone)

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Online as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);

  // Rotating status (the list lives in src/statuses.js)
  const statuses = require('./statuses');
  const TYPES = { watching: ActivityType.Watching, listening: ActivityType.Listening, playing: ActivityType.Playing,
    competing: ActivityType.Competing, custom: ActivityType.Custom };
  const rotate = async () => {
    try {
      const m = await market.get();
      const s = statuses.next({ market: m, db });
      c.user.setPresence({
        status: statuses.presence(m), // online while trading, idle after hours, do not disturb during halts
        activities: [s.type === 'custom' ? { name: 'custom', state: s.text, type: TYPES.custom } : { name: s.text, type: TYPES[s.type] }]
      });
    } catch (e) { console.error('[status]', e.message); }
  };
  rotate();
  setInterval(rotate, statuses.ROTATE_MS).unref();

  // Shift-ready DMs that were waiting when the bot restarted
  const restored = require('./reminders').restore(deps);
  if (restored) console.log(`[work] ${restored} shift reminder(s) restored`);

  // Register slash commands on every start, so new or changed commands just appear.
  // DEV_GUILD_ID puts them in one test server (instant); otherwise they're global.
  try {
    const body = slashCommands();
    if (config.devGuildId) await c.application.commands.set(body, config.devGuildId);
    else await c.application.commands.set(body);
    console.log(`[bot] Registered ${body.length} slash commands ${config.devGuildId ? 'in the test server' : 'globally'}`);
  } catch (e) {
    console.error('[bot] Could not register slash commands (r! commands still work):', e.message);
  }
});

client.on(Events.MessageCreate, (msg) => router.handleMessage(msg, deps).catch((e) => console.error('[message]', e)));
client.on(Events.InteractionCreate, (i) => router.handleInteraction(i, deps).catch((e) => console.error('[interaction]', e)));

if (!config.token) {
  console.error('[bot] DISCORD_TOKEN is missing. Put it in engine/.env (or your host secrets). The bot stays offline until then.');
} else {
  client.login(config.token).catch((e) => {
    console.error('[bot] Could not log in to Discord:', e.message);
    if (/disallowed intents/i.test(e.message)) {
      console.error('[bot] Fix: Developer Portal > Bot > switch on Message Content Intent, then restart.');
    } else if (/token/i.test(e.message)) {
      console.error('[bot] Fix: the DISCORD_TOKEN secret is wrong. Reset it in the Developer Portal and set it again.');
    }
  });
}

// Close the database cleanly when the host stops the bot.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { client.destroy(); db.raw.close(); process.exit(0); });
}
