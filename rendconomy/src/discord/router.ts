// Turns /slash commands, r! messages, button presses and typed answers into the same plain calls,
// and turns the results into Discord messages. Every interaction always gets a response, so Discord
// never shows "This interaction failed".
import {
  ActionRowBuilder, ApplicationCommandOptionType, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, type PermissionsBitField,
  type ButtonInteraction, type ChatInputCommandInteraction, type Message, type RESTPostAPIChatInputApplicationCommandsJSONBody
} from 'discord.js';
import { commands, find } from '../commands';
import { handlers } from '../commands/sessions';
import type { Args, Button, Command, Ctx, Reply, ReplyObject, SessionReply } from '../commands/types';
import type { BotConfig } from '../config';
import type { Db } from '../core/db';
import { isGameError } from '../core/errors';
import type { Rng } from '../core/rng';
import { runInRequest } from '../core/request';
import * as sessions from '../core/sessions';
import { COLORS } from './style';

export interface Deps { db: Db; config: BotConfig; rng: Rng; ping?: () => number; botId?: () => string | undefined; onChat?: (ctx: Ctx, msg: Message) => Promise<void> }

const errorReply = (e: unknown, where: string): ReplyObject => {
  if (isGameError(e)) return { embeds: [{ color: COLORS.error, description: e.message }], ephemeral: true };
  console.error(`[${where}]`, e);
  return { content: 'An internal error occurred. It has been logged.', ephemeral: true };
};

/** Runs a command and always returns something to show: the reply, or a message for the player. */
export async function execute(cmd: Command, ctx: Ctx, args: Args): Promise<ReplyObject> {
  try {
    if (cmd.guildOnly && !ctx.guildId) return { content: 'This command is only available in a server.', ephemeral: true };
    ctx.db.setMeta('commands_run', Number(ctx.db.meta('commands_run') ?? 0) + 1);
    const reply = await runInRequest(requestOf(ctx), () => cmd.run(ctx, args));
    return withNotes(normalize(reply), ctx.notes);
  } catch (e) {
    return errorReply(e, `command ${cmd.name}`);
  }
}

const requestOf = (ctx: Ctx) => ({ db: ctx.db, guildId: ctx.guildId, userId: ctx.user.id, now: ctx.now, notes: ctx.notes });

/** Puts notes from listeners (e.g. achievements) on a button's reply. */
function notesOnSession(r: SessionReply, notes: string[]): SessionReply {
  if (!notes.length) return r;
  if (r.followUp) return { ...r, followUp: withNotes(r.followUp, notes) };
  return { ...r, followUp: { content: notes.join('\n') } };
}

/** Runs a session's button handler and always returns something. */
export function press(ctx: Ctx, customId: string): SessionReply {
  const ref = sessions.parseButtonId(customId);
  if (!ref) return { notice: 'This button is no longer active.' };
  const s = sessions.get(ctx.db, ref.sessionId, ctx.now);
  if (!s) return { update: { buttons: [] }, notice: 'This has expired.' };
  const h = handlers[s.kind];
  if (!h) return { update: { buttons: [] } };
  try {
    return notesOnSession(runInRequest(requestOf(ctx), () => h.onButton(ctx, s, ref.value)), ctx.notes);
  } catch (e) {
    const r = errorReply(e, `button ${s.kind}`);
    return { notice: r.embeds?.[0]?.description ?? r.content };
  }
}

/** Offers a typed message to any session waiting in that channel. Returns the reply, or null. */
export function typedAnswer(ctx: Ctx, text: string): { reply: ReplyObject; session: sessions.Session } | null {
  if (!ctx.channelId) return null;
  for (const s of sessions.inChannel(ctx.db, ctx.channelId, ctx.user.id, ctx.now)) {
    const h = handlers[s.kind];
    if (!h?.onText) continue;
    try {
      const reply = runInRequest(requestOf(ctx), () => h.onText!(ctx, s, text));
      if (reply) return { reply: withNotes(reply, ctx.notes), session: s };
    } catch (e) {
      return { reply: errorReply(e, `answer ${s.kind}`), session: s };
    }
  }
  return null;
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

// ---------------------------------------------------------------- Discord payloads

const STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger } as const;

function rows(buttons: Button[][]) {
  return buttons.filter((r) => r.length).slice(0, 5).map((r) => new ActionRowBuilder<ButtonBuilder>().addComponents(
    r.slice(0, 5).map((b) => {
      const btn = new ButtonBuilder().setCustomId(b.id).setLabel(b.label.slice(0, 80)).setStyle(STYLES[b.style ?? 'secondary']).setDisabled(!!b.disabled);
      if (b.emoji) btn.setEmoji(b.emoji);
      return btn;
    })
  ));
}

/** A ReplyObject as a Discord message payload. Fields left out stay as they are when editing. */
function payload(r: ReplyObject) {
  const out: { content?: string; embeds?: ReplyObject['embeds']; components?: ReturnType<typeof rows>; allowedMentions: { parse: []; repliedUser: boolean } } =
    { allowedMentions: { parse: [], repliedUser: false } };
  if (r.content !== undefined) out.content = r.content;
  if (r.embeds !== undefined) out.embeds = r.embeds;
  if (r.buttons !== undefined) out.components = rows(r.buttons);
  return out;
}

function ctxFor(deps: Deps, guildId: string | null, channelId: string | null, user: { id: string; username: string; globalName?: string | null }, perms?: Readonly<PermissionsBitField> | null): Ctx {
  const isOwner = deps.config.ownerIds.includes(user.id);
  return {
    isMod: isOwner || !!perms?.has(PermissionFlagsBits.ManageGuild),
    db: deps.db, config: deps.config, rng: deps.rng, now: Date.now(), guildId, channelId,
    user: { id: user.id, name: user.globalName || user.username },
    isOwner,
    notes: [],
    ping: deps.ping?.(),
    botId: deps.botId?.()
  };
}

/** After sending: remember which message holds a session's buttons, and run any delayed edit. */
function afterSend(deps: Deps, r: ReplyObject, msg: { id: string; channelId: string }, edit: (p: ReplyObject) => Promise<unknown>): void {
  if (r.session) sessions.attachMessage(deps.db, r.session, msg.id, msg.channelId);
  if (r.live) {
    const live = r.live;
    const timer = setInterval(() => {
      let next: ReplyObject | null = null;
      try { next = live.next(); } catch (e) { console.error('[live]', e); }
      if (!next) { clearInterval(timer); return; }
      edit(next).catch(() => clearInterval(timer));
    }, live.everyMs);
    timer.unref();
  }
  if (r.later) {
    const later = r.later;
    setTimeout(() => {
      // Only if the session is still waiting (a fast typed answer may already have ended it)
      if (r.session && !sessions.get(deps.db, r.session)) return;
      edit(later.edit).catch((e: unknown) => console.error('[later edit]', e));
    }, later.ms).unref();
  }
}

async function clearButtons(msg: Message, sessionMessageId: string | null): Promise<void> {
  if (!sessionMessageId) return;
  try {
    const m = await msg.channel.messages.fetch(sessionMessageId);
    if (m.components.length) await m.edit({ components: [] });
  } catch { /* deleted or no access: nothing to clear */ }
}

export async function onMessage(deps: Deps, msg: Message): Promise<void> {
  if (msg.author.bot) return;
  const ctx = ctxFor(deps, msg.guildId, msg.channelId, msg.author, msg.member?.permissions);
  const parsed = parsePrefix(msg.content, deps.config.prefix);

  if (!parsed) {
    // Not a command: maybe a typed answer to a task waiting in this channel
    const t = typedAnswer(ctx, msg.content);
    if (!t) { if (deps.onChat && msg.guildId) await deps.onChat(ctx, msg); return; }
    await clearButtons(msg, t.session.message_id);
    const sent = await msg.reply(payload(t.reply));
    afterSend(deps, t.reply, sent, (p) => sent.edit(payload(p)));
    return;
  }
  if ('unknown' in parsed) return; // stay quiet about unknown commands in chat
  const reply = await execute(parsed.cmd, ctx, parsed.args);
  if (reply.deleteTrigger) msg.delete().catch(() => { /* no Manage Messages */ });
  if (reply.dm) msg.author.send({ content: reply.dm, allowedMentions: { parse: [] } }).catch(() => { /* DMs closed */ });
  if (reply.silent) return;
  const sent = await msg.reply(payload(reply));
  afterSend(deps, reply, sent, (p) => sent.edit(payload(p)));
}

export async function onSlash(deps: Deps, i: ChatInputCommandInteraction): Promise<void> {
  const cmd = find(i.commandName);
  if (!cmd || cmd.hidden) { await i.reply({ content: 'This command is no longer available.', flags: MessageFlags.Ephemeral }); return; }
  const args: Args = {};
  for (const o of cmd.options ?? []) {
    if (o.type === 'user') args[o.name] = i.options.getUser(o.name)?.id;
    else if (o.type === 'integer') args[o.name] = i.options.getInteger(o.name) ?? undefined;
    else args[o.name] = i.options.getString(o.name) ?? undefined;
  }
  const reply = await execute(cmd, ctxFor(deps, i.guildId, i.channelId, i.user, i.memberPermissions), args);
  const res = await i.reply({ ...payload(reply), ...(reply.ephemeral ? { flags: MessageFlags.Ephemeral as const } : {}), withResponse: true });
  const sent = res.resource?.message;
  if (sent) afterSend(deps, reply, sent, (p) => i.editReply(payload(p)));
}

export async function onButton(deps: Deps, i: ButtonInteraction): Promise<void> {
  const r = press(ctxFor(deps, i.guildId, i.channelId, i.user, i.memberPermissions), i.customId);
  if (r.update) await i.update(payload(r.update));
  else if (r.notice && !r.followUp) { await i.reply({ content: r.notice, flags: MessageFlags.Ephemeral }); return; }
  else await i.deferUpdate();
  if (r.notice) await i.followUp({ content: r.notice, flags: MessageFlags.Ephemeral });
  if (r.followUp) {
    const sent = await i.followUp({ ...payload(r.followUp), ...(r.followUp.ephemeral ? { flags: MessageFlags.Ephemeral as const } : {}) });
    afterSend(deps, r.followUp, sent, (p) => sent.edit(payload(p)));
  }
}

const TYPES = { string: ApplicationCommandOptionType.String, integer: ApplicationCommandOptionType.Integer, user: ApplicationCommandOptionType.User } as const;

/** The slash command definitions Discord needs. */
export function slashBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  return commands.filter((c) => !c.hidden).map((c) => ({
    name: c.name,
    description: c.description.slice(0, 100),
    dm_permission: !c.guildOnly,
    options: (c.options ?? []).map((o) => ({ name: o.name, description: o.description.slice(0, 100), type: TYPES[o.type], required: !!o.required }))
  })) as RESTPostAPIChatInputApplicationCommandsJSONBody[];
}
