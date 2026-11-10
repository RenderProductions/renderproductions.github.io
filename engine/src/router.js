// Turns r! messages and /slash commands into the same command call.
// Commands can also wait for the player's next message (r!work's tasks) with ctx.awaitNext.
const { PermissionFlagsBits } = require('discord.js');
const config = require('./config');
const commands = require('./commands');

// channelId:userId -> { handler, expires }
const pending = new Map();

function toPayload(out) {
  const payload = typeof out === 'string' ? { content: out } : out;
  // Never ping anyone by accident. A command can ping specific users on purpose (r!loan pings the lender).
  return { ...payload, allowedMentions: payload.allowedMentions || { parse: [] } };
}

async function runCommand(cmd, ctx, args) {
  try {
    const out = await cmd.run(ctx, args);
    return out == null ? null : toPayload(out);
  } catch (e) {
    console.error(`[${cmd.name}]`, e);
    return toPayload('Something broke running that command. It has been logged.');
  }
}

// Shared context every command gets.
function makeCtx({ guildId, channelId, user, message, isMod = false }, deps) {
  return {
    ...deps,
    isMod, // has Manage Messages in this server
    guildId,
    channelId,
    user,
    message,
    // Waits for this player's next non-command message in this channel.
    // handler(msg) returns what to reply with (or null). One wait per player per channel.
    awaitNext(handler, ms = 60_000) {
      pending.set(`${channelId}:${user.id}`, { handler, expires: Date.now() + ms });
    },
    // Stops waiting (used when a button answered instead)
    cancelAwait() { pending.delete(`${channelId}:${user.id}`); }
  };
}

// "r!buy rrm 5" -> { cmd, args: { ticker: 'rrm', amount: '5' } }, or null if it isn't a command.
// Missing arguments are left undefined; each command explains its own usage, like BDFD did.
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
  return { cmd, args };
}

// Turns "<@123>" or "123" into a Discord user, for options of type "user".
async function resolveUser(raw, message, client) {
  const id = String(raw || '').match(/\d{15,25}/);
  if (!id) return undefined;
  const mentioned = message.mentions && message.mentions.users && message.mentions.users.get(id[0]);
  if (mentioned) return mentioned;
  return client ? client.users.fetch(id[0]).catch(() => undefined) : undefined;
}

async function handleMessage(message, deps) {
  if (message.author.bot || !message.guildId) return;
  const parsed = parsePrefix(message.content);

  // Answering a task the bot is waiting on?
  const key = `${message.channelId}:${message.author.id}`;
  const wait = pending.get(key);
  if (wait && !parsed) {
    pending.delete(key);
    if (Date.now() > wait.expires) return;
    let out = null;
    try { out = await wait.handler(message); } catch (e) { console.error('[await]', e); }
    if (out != null) return message.reply(toPayload(out));
    return;
  }
  if (!parsed) return;

  const { cmd, args } = parsed;
  for (const o of cmd.options || []) {
    if (o.type === 'user') args[o.name] = await resolveUser(args[o.name], message, deps.client);
  }
  const isMod = !!(message.member && message.member.permissions.has(PermissionFlagsBits.ManageMessages));
  const ctx = makeCtx({ guildId: message.guildId, channelId: message.channelId, user: message.author, message, isMod }, deps);
  const out = await runCommand(cmd, ctx, args);
  if (out) return message.reply(out);
}

// Buttons: custom ids look like "loan:accept:abc123". The command whose buttonPrefix matches handles it.
// onButton returns any of:
//   { update }   edit the message the button is on
//   { followUp } send a new message after the update (or { followUp, private: true } for only the presser)
//   { reply }    answer only the person who pressed it
//   { say }      answer in the channel for everyone
async function handleButton(interaction, deps) {
  const [prefix, ...parts] = interaction.customId.split(':');
  const cmd = commands.list.find((c) => c.buttonPrefix === prefix && c.onButton);
  if (!cmd) return;
  const isMod = !!(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages));
  const ctx = makeCtx({ guildId: interaction.guildId, channelId: interaction.channelId, user: interaction.user, isMod }, deps);
  let out;
  try { out = await cmd.onButton(ctx, parts); } catch (e) {
    console.error(`[${cmd.name} button]`, e);
    out = { reply: 'Something broke. It has been logged.' };
  }
  if (!out) return interaction.deferUpdate();
  if (out.update) {
    await interaction.update(toPayload(out.update));
    if (out.followUp) await interaction.followUp({ ...toPayload(out.followUp), ephemeral: !!out.private });
    return;
  }
  if (out.reply) return interaction.reply({ ...toPayload(out.reply), ephemeral: true });
  if (out.say) return interaction.reply(toPayload(out.say));
}

async function handleInteraction(interaction, deps) {
  if (interaction.isButton()) return handleButton(interaction, deps);
  if (!interaction.isChatInputCommand()) return;
  const cmd = commands.find(interaction.commandName);
  if (!cmd || cmd.hidden) return;
  if (!interaction.guildId) return interaction.reply({ content: 'Use Rend-Conomy inside a server.', ephemeral: true });

  const args = {};
  for (const o of cmd.options || []) {
    if (o.type === 'user') { args[o.name] = interaction.options.getUser(o.name) || undefined; continue; }
    const v = interaction.options.get(o.name);
    if (v) args[o.name] = String(v.value);
  }
  await interaction.deferReply();
  const isMod = !!(interaction.memberPermissions && interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages));
  const ctx = makeCtx({ guildId: interaction.guildId, channelId: interaction.channelId, user: interaction.user, isMod }, deps);
  const out = await runCommand(cmd, ctx, args);
  return out ? interaction.editReply(out) : interaction.deleteReply();
}

module.exports = { parsePrefix, runCommand, makeCtx, handleMessage, handleInteraction, handleButton, pending };
