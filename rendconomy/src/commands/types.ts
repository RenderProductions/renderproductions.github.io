// What every command looks like. A command is a plain function from (context, arguments) to a reply,
// so the same code serves /slash commands, r! messages, tests, and later the site and the Activity.
import type { APIEmbed } from 'discord.js';
import type { BotConfig } from '../config';
import type { Db } from '../core/db';
import type { Rng } from '../core/rng';

export type OptionType = 'string' | 'integer' | 'user';

export interface Option {
  name: string;
  type: OptionType;
  description: string;
  required?: boolean;
}

export interface Ctx {
  db: Db;
  config: BotConfig;
  rng: Rng;
  now: number;
  /** null in DMs */
  guildId: string | null;
  channelId: string | null;
  user: { id: string; name: string };
  /** Bot owner (OWNER_IDS). */
  isOwner: boolean;
  /** Has Manage Server in this server (or is a bot owner). */
  isMod: boolean;
  /** Extra lines the router adds to the reply (e.g. "Account opened"). */
  notes: string[];
  /** The bot's own user id, when known. */
  botId?: string;
  /** Websocket ping, when known. */
  ping?: number;
}

export type Args = Record<string, string | number | undefined>;

export interface Button {
  label: string;
  /** The custom id: for session buttons, sessions.buttonId(session, value). */
  id: string;
  style?: 'primary' | 'secondary' | 'success' | 'danger';
  emoji?: string;
  disabled?: boolean;
}

export interface ReplyObject {
  content?: string;
  embeds?: APIEmbed[];
  /** Rows of buttons (up to 5 rows of 5). An empty array removes the message's buttons. */
  buttons?: Button[][];
  /** Only the person who used the command sees it (slash commands only). */
  ephemeral?: boolean;
  /** The session these buttons belong to: the router records which message holds them. */
  session?: string;
  /** Edit the message after a delay (memory tasks hide their prompt). */
  later?: { ms: number; edit: ReplyObject };
  /** Send this to the player by DM (instead of, or as well as, the reply). */
  dm?: string;
  /** Post nothing in the channel (a secret). */
  silent?: boolean;
  /** Delete the message that ran the command (prefix commands; needs Manage Messages). */
  deleteTrigger?: boolean;
  /** Keep editing the message every `everyMs` until next() returns null (the Rocket's live multiplier). */
  live?: { everyMs: number; next: () => ReplyObject | null };
}

/** What a button press or typed answer does to the message it belongs to. */
export interface SessionReply {
  /** Edit the message with the buttons. */
  update?: ReplyObject;
  /** Send a new message after it. */
  followUp?: ReplyObject;
  /** A private note to the presser only (e.g. "this isn't your task"). */
  notice?: string;
}
export type Reply = string | ReplyObject;

/** Which part of the bot a command belongs to: decides its embed color and where /help lists it. */
export type System = 'general' | 'wallet' | 'market' | 'work' | 'reserve' | 'admin' | 'social' | 'casino';

export interface Command {
  name: string;
  description: string;
  system: System;
  aliases?: string[];
  options?: Option[];
  /** Prefix-only and left out of /help and the slash command list (secrets). */
  hidden?: boolean;
  /** Needs a server (balances are per server). Refused in DMs. */
  guildOnly?: boolean;
  run(ctx: Ctx, args: Args): Reply | Promise<Reply>;
}
