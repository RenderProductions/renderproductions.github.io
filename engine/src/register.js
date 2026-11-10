// The bot registers its slash commands by itself every time it starts, so you normally
// don't need this. It's here for registering by hand without starting the bot:
//   npm run register
// With DEV_GUILD_ID set, commands go to that test server only (they appear instantly).
// Without it, they're registered globally for every server.
const { REST, Routes } = require('discord.js');
const config = require('./config');
const { slashCommands } = require('./slash');

(async () => {
  if (!config.token || !config.clientId) {
    console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID first.');
    process.exit(1);
  }
  const body = slashCommands();
  const rest = new REST().setToken(config.token);
  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`Registered ${body.length} slash commands ${config.devGuildId ? 'in the test server' : 'globally'}.`);
})().catch((e) => { console.error(e); process.exit(1); });
