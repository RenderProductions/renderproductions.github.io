// Starts the Rend-Conomy bot: Discord connection, market feed, and web API.
//   npm start
const { Client, GatewayIntentBits, Events, ActivityType } = require('discord.js');
const config = require('./config');
const db = require('./db').open();
const market = require('./market');
const router = require('./router');
const api = require('./api');

if (!config.token) {
  console.error('DISCORD_TOKEN is missing. Copy .env.example to .env and fill it in (or set it on your host).');
  process.exit(1);
}

const deps = { db, market };

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

market.startAutoRefresh();
api.start(deps);
client.login(config.token);

// Close the database cleanly when the host stops the bot.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { client.destroy(); db.raw.close(); process.exit(0); });
}
