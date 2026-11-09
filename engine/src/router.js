// Turns r! messages and /slash commands into the same command call.
const config = require('./config');
const commands = require('./commands');

function toPayload(out) {
  const payload = typeof out === 'string' ? { content: out } : out;
  return { ...payload, allowedMentions: { parse: [] } }; // never ping anyone by accident
}

async function runCommand(cmd, ctx, args) {
  try {
    return toPayload(await cmd.run(ctx, args));
  } catch (e) {
    console.error(`[${cmd.name}]`, e);
    return toPayload(e.message && e.message.startsWith('Market data') ? e.message : 'Something broke running that command. It has been logged.');
  }
}

// "r!buy rrm 5" -> { cmd, args: { ticker: 'rrm', amount: '5' } }, or null if it isn't a command.
function parsePrefix(content) {
  if (!content.toLowerCase().startsWith(config.prefix.toLowerCase())) return null;
  const parts = content.slice(config.prefix.length).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const cmd = commands.find(parts.shift());
  if (!cmd) return null;

  const args = {};
  const opts = cmd.options || [];
  opts.forEach((o, i) => {
    // The last option soaks up the rest of the message, so text arguments can have spaces.
    args[o.name] = i === opts.length - 1 ? parts.slice(i).join(' ') || undefined : parts[i];
  });
  const missing = opts.find((o) => o.required && !args[o.name]);
  return { cmd, args, missing };
}

async function handleMessage(message, deps) {
  if (message.author.bot || !message.guildId) return;
  const parsed = parsePrefix(message.content);
  if (!parsed) return;
  const { cmd, args, missing } = parsed;
  if (missing) {
    return message.reply(toPayload(`Usage: \`${config.prefix}${cmd.name} ${cmd.usage || ''}\``.trim()));
  }
  const ctx = { guildId: message.guildId, user: message.author, ...deps };
  return message.reply(await runCommand(cmd, ctx, args));
}

async function handleInteraction(interaction, deps) {
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.find(interaction.commandName);
  if (!cmd) return;
  if (!interaction.guildId) return interaction.reply({ content: 'Use Rend-Conomy inside a server.', ephemeral: true });

  const args = {};
  for (const o of cmd.options || []) {
    const v = interaction.options.get(o.name);
    if (v) args[o.name] = String(v.value);
  }
  await interaction.deferReply();
  const ctx = { guildId: interaction.guildId, user: interaction.user, ...deps };
  return interaction.editReply(await runCommand(cmd, ctx, args));
}

module.exports = { parsePrefix, runCommand, handleMessage, handleInteraction };
