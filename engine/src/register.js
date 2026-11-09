// Tells Discord about the slash commands. Run it again whenever you add or change a command:
//   npm run register
// With DEV_GUILD_ID set, commands go to that test server only (they appear instantly).
// Without it, they're registered globally for every server.
const { REST, Routes, ApplicationCommandOptionType } = require('discord.js');
const config = require('./config');
const { list } = require('./commands');

const TYPES = { string: ApplicationCommandOptionType.String, integer: ApplicationCommandOptionType.Integer };

const body = list.map((c) => ({
  name: c.name,
  description: c.description,
  dm_permission: false,
  options: (c.options || []).map((o) => ({
    name: o.name,
    description: o.description,
    type: TYPES[o.type] || TYPES.string,
    required: !!o.required
  }))
}));

(async () => {
  if (!config.token || !config.clientId) {
    console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID first.');
    process.exit(1);
  }
  const rest = new REST().setToken(config.token);
  const route = config.devGuildId
    ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
    : Routes.applicationCommands(config.clientId);
  await rest.put(route, { body });
  console.log(`Registered ${body.length} slash commands ${config.devGuildId ? 'in the test server' : 'globally'}.`);
})().catch((e) => { console.error(e); process.exit(1); });
