// Starts the Rend-Conomy bot: Discord connection, market feed, and web API.
//   npm start
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const config = require('./config');
const db = require('./db').open();
const market = require('./market');
const router = require('./router');
const api = require('./api');
const { slashCommands } = require('./slash');

const deps = { db, market };

// Start the web API first, so the host's health check passes even if Discord has trouble.
// /health reports whether the bot is actually connected.
api.start(deps, () => ({ discord: client.isReady() ? 'connected' : 'not connected' }));
market.startAutoRefresh();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent // needed for r! commands; switch it on in the Developer Portal
  ]
});

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Online as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);
  c.user.setActivity(`${config.prefix}help · /help`, { type: ActivityType.Watching });

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
