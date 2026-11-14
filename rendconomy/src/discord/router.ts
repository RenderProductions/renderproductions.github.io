// Turns /slash commands and r! messages into the same command call, and turns the result into a reply.
import {
  ApplicationCommandOptionType, MessageFlags,
  type ChatInputCommandInteraction, type Message, type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';
import { commands, find } from '../commands';
import type { Args, Command, Ctx, Reply, ReplyObject } from '../commands/types';
import type { BotConfig } from '../config';
import type { Db } from '../core/db';
import { isGameError } from '../core/errors';
import type { Rng } from '../core/rng';
import { COLORS } from './style';

export interface Deps { db: Db; config: BotConfig; rng: Rng; ping?: () => number }

/** Runs a command and always returns something to show: the reply, or a message for the player. */
export async function execute(cmd: Command, ctx: Ctx, args: Args): Promise<ReplyObject> {
  try {
    if (cmd.guildOnly && !ctx.guildId) return { content: 'This command is only available in a server.', ephemeral: true };
    const reply = normalize(await cmd.run(ctx, args));
    return withNotes(reply, ctx.notes);
  } catch (e) {
    if (isGameError(e)) return { embeds: [{ color: COLORS.error, description: e.message }], ephemeral: true };
    console.error(`[command ${cmd.name}]`, e);
    return { content: 'An internal error occurred. It has been logged.', ephemeral: true };
  }
}

const normalize = (r: Reply): ReplyObject => (typeof r === 'string' ? { content: r } : r);

function withNotes(r: ReplyObject, notes: string[]): ReplyObject {
  if (!notes.length) return r;
  const text = notes.join('\n');
  const first = r.embeds?.[0];
  if (first) return { ...r, embeds: [{ ...first, footer: { text: first.footer ? `${first.footer.text}\n${text}` : text } }, ...r.embeds!.slice(1)] };
  return { ...r, content: r.content ? `${r.content}\n-# ${text}` : text };
}

/**
 * Reads "r!name a b c" into a command and its arguments, matched to the options in order.
 * The last string option takes the rest of the line. Returns null if it isn't a command.
 */
export function parsePrefix(content: string, prefix: string): { cmd: Command; args: Args } | { unknown: string } | null {
  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const [name, ...words] = content.slice(prefix.length).trim().split(/\s+/);
  if (!name) return null;
  const cmd = find(name);
  if (!cmd) return { unknown: name };
  const args: Args = {};
  const opts = cmd.options ?? [];
  opts.forEach((o, i) => {
    const isLastString = o.type === 'string' && i === opts.length - 1;
    const raw = isLastString ? words.slice(i).join(' ') : words[i];
    if (raw === undefined || raw === '') return;
    if (o.type === 'user') args[o.name] = /^<@!?(\d+)>$/.exec(raw)?.[1] ?? raw;
    else if (o.type === 'integer') args[o.name] = Number.isInteger(Number(raw)) ? Number(raw) : raw;
    else args[o.name] = raw;
  });
  return { cmd, args };
}

function ctxFor(deps: Deps, guildId: string | null, user: { id: string; username: string; globalName?: string | null }): Ctx {
  return {
    db: deps.db, config: deps.config, rng: deps.rng, now: Date.now(), guildId,
    user: { id: user.id, name: user.globalName || user.username },
    isOwner: deps.config.ownerIds.includes(user.id),
    notes: [],
    ping: deps.ping?.()
  };
}

export async function onMessage(deps: Deps, msg: Message): Promise<void> {
  if (msg.author.bot) return;
  const parsed = parsePrefix(msg.content, deps.config.prefix);
  if (!parsed || 'unknown' in parsed) return; // stay quiet about unknown commands in chat
  const reply = await execute(parsed.cmd, ctxFor(deps, msg.guildId, msg.author), parsed.args);
  const { ephemeral: _e, ...payload } = reply;
  await msg.reply({ ...payload, allowedMentions: { repliedUser: false, parse: [] } });
}

export async function onSlash(deps: Deps, i: ChatInputCommandInteraction): Promise<void> {
  const cmd = find(i.commandName);
  if (!cmd) return;
  const args: Args = {};
  for (const o of cmd.options ?? []) {
    if (o.type === 'user') args[o.name] = i.options.getUser(o.name)?.id;
    else if (o.type === 'integer') args[o.name] = i.options.getInteger(o.name) ?? undefined;
    else args[o.name] = i.options.getString(o.name) ?? undefined;
  }
  const reply = await execute(cmd, ctxFor(deps, i.guildId, i.user), args);
  const { ephemeral, ...payload } = reply;
  await i.reply({ ...payload, allowedMentions: { parse: [] }, ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) });
}

const TYPES = { string: ApplicationCommandOptionType.String, integer: ApplicationCommandOptionType.Integer, user: ApplicationCommandOptionType.User } as const;

/** The slash command definitions Discord needs. */
export function slashBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands.map((c) => ({
    name: c.name,
    description: c.description.slice(0, 100),
    dm_permission: !c.guildOnly,
    options: (c.options ?? []).map((o) => ({ name: o.name, description: o.description.slice(0, 100), type: TYPES[o.type], required: !!o.required }))
  })) as RESTPostAPIChatInputApplicationCommandsJSONBody[];
}
