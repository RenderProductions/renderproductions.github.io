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
  user: { id: string; name: string };
  isOwner: boolean;
  /** Extra lines the router adds to the reply (e.g. "Account opened"). */
  notes: string[];
  /** Websocket ping, when known. */
  ping?: number;
}

export type Args = Record<string, string | number | undefined>;

export interface ReplyObject {
  content?: string;
  embeds?: APIEmbed[];
  /** Only the person who used the command sees it (slash commands only). */
  ephemeral?: boolean;
}
export type Reply = string | ReplyObject;

/** Which part of the bot a command belongs to: decides its embed color and where /help lists it. */
export type System = 'general' | 'wallet' | 'reserve';

export interface Command {
  name: string;
  description: string;
  system: System;
  aliases?: string[];
  options?: Option[];
  /** Needs a server (balances are per server). Refused in DMs. */
  guildOnly?: boolean;
  run(ctx: Ctx, args: Args): Reply | Promise<Reply>;
}
