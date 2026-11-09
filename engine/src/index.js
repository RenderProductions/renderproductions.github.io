// Starts the Rend-Conomy bot: Discord connection, market feed, and web API.
//   npm start
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const config = require('./config');
const db = require('./db').open();
const market = require('./market');
const router = require('./router');
const api = require('./api');

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

client.once(Events.ClientReady, (c) => {
  console.log(`[bot] Online as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);
  c.user.setActivity(`${config.prefix}help · /help`, { type: ActivityType.Watching });
});

client.on(Events.MessageCreate, (msg) => router.handleMessage(msg, deps).catch((e) => console.error('[message]', e)));
client.on(Events.InteractionCreate, (i) => router.handleInteraction(i, deps).catch((e) => console.error('[interaction]', e)));

if (!config.token) {
  console.error('[bot] DISCORD_TOKEN is missing. Set it as a secret on Fly (or in .env locally). The bot stays offline until then.');
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
