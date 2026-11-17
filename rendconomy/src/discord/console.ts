// The bot's console: type into the host panel (Bot-Hosting's Console tab) to make the bot do things.
// Only whoever can reach the host can use it, so nothing here asks Discord who you are.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { ButtonStyle, ComponentType, type ButtonInteraction, type Client, type Guild, type SendableChannels } from 'discord.js';
import type { Db } from '../core/db';
import type { BotConfig } from '../config';
import { economy } from '../config';
import type { Rng } from '../core/rng';
import { format, parseAmount } from '../core/money';
import { payFromReserve } from '../core/economy';
import { balance } from '../core/ledger';
import { me } from '../commands/shared';
import type { Ctx, ReplyObject } from '../commands/types';
import { execute, parsePrefix } from './router';
import { COLORS } from './style';

export interface ConsoleDeps {
  db: Db; client: Client; config: BotConfig; rng: Rng;
  /** Starts a TODD drop-in in this channel now. */
  todd(ch: SendableChannels, guildId: string): Promise<void>;
  /** Posts the next patch notes entry waiting to go out. Returns its title, or null if none are waiting. */
  postNext(): Promise<string | null>;
}

const HELP = `Console commands (type them in the host console as "rc <command>", or DM the bot "> <command>" from an owner account):
  help                         this list
  servers                      every server the bot is in, with ids
  channels <server>            text channels in a server (id or part of its name)
  say <channel> <text>         the bot posts your text
  reply <message link> <text>  the bot replies to a message
  marquez <channel> <text>     Marquez says something, in a little shop card
  todd <channel>               TODD drops in right now
  rain <channel> <amount> [people]   Polygons rain down: the first few to press Grab split it (default 5 people)
  haunt <channel>              something small and unsettling happens
  status <text> | status clear the bot's status line
  run <server> <command>       any bot command as the owner, e.g. run 1234 give @123 500 thanks
  leave <server>               make the bot leave a server (asks you to confirm)
  additem <server> <player> <item>      put items in someone's inventory, fish bag or basket
  removeitem <server> <player> <item>   e.g. additem 1234 @5678 3 golden pumpkin · additem 1234 nacho white whale
  backup                       save a copy of the database now
  post                         post the next waiting patch notes entry
A <channel> is an id, a <#mention>, or #name (if only one server has it).`;

// ---------------------------------------------------------------- rain (shared with the button handler)
interface Rain { guildId: string; each: number; left: number; got: Set<string>; until: number }
const rains = new Map<string, Rain>();
let deps: ConsoleDeps | null = null;

/** Grab buttons on a Polygon rain. Returns false if the button isn't a rain button. */
export async function onRainButton(i: ButtonInteraction): Promise<boolean> {
  if (!i.customId.startsWith('rain:')) return false;
  const r = rains.get(i.customId.slice(5));
  if (!r || !deps || Date.now() > r.until || r.left <= 0) { await i.reply({ content: 'The rain has stopped.', ephemeral: true }); return true; }
  if (r.got.has(i.user.id)) { await i.reply({ content: 'You already grabbed some. Leave a little for everyone else.', ephemeral: true }); return true; }
  r.got.add(i.user.id); r.left--;
  const ctx: Ctx = { db: deps.db, config: deps.config, rng: deps.rng, now: Date.now(), guildId: r.guildId, channelId: i.channelId, user: { id: i.user.id, name: i.user.globalName ?? i.user.username }, isOwner: false, isMod: false, notes: [] };
  const { wallet } = me(ctx);
  const paid = payFromReserve(deps.db, economy.reserveStart, { to: wallet, cents: r.each, reason: 'rain', guildId: r.guildId, actorId: i.user.id, now: ctx.now });
  await i.reply({ content: `☔ You caught **${format(paid)}**. Balance ${format(balance(deps.db, wallet))}.${ctx.notes.length ? '\n-# ' + ctx.notes.join(' ') : ''}`, ephemeral: true });
  if (r.left <= 0) await i.message.edit({ content: `☔ The rain has stopped. Caught by ${[...r.got].map((u) => `<@${u}>`).join(', ')}.`, components: [], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------- the console
export function startConsole(d: ConsoleDeps): void {
  deps = d;
  if (process.env.CONSOLE === '0') return;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    // some host panels keep words like "help" for themselves, so "rc help" (or "/help") works too
    const text = line.trim().replace(/^(rc\s+|\/)/i, '');
    if (!text) return;
    console.log(`[console] > ${text}`);
    run(d, text).then((out) => { if (out) console.log(out); }).catch((e: unknown) => console.log(`[console] ${e instanceof Error ? e.message : String(e)}`));
  });
  console.log(`[console] ready: type "rc help" here, or DM the bot "> help" from an owner account`);
}

/** The same console from Discord: an owner DMs the bot a line starting with ">". Returns the output to send back. */
export async function consoleFromDm(text: string): Promise<string> {
  if (!deps) return 'The console is not ready yet.';
  try { return (await run(deps, text.replace(/^>\s*/, '').trim())) ?? 'Done.'; }
  catch (e) { return e instanceof Error ? e.message : String(e); }
}

function guildFrom(c: Client, q: string): Guild {
  const id = q.replace(/\D/g, '');
  const g = (id && c.guilds.cache.get(id)) || [...c.guilds.cache.values()].find((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  if (!g) throw new Error(`No server matches "${q}". Try "servers".`);
  return g;
}

async function channelFrom(c: Client, q: string): Promise<SendableChannels & { guildId: string }> {
  const id = /^<#(\d+)>$/.exec(q)?.[1] ?? (/^\d{15,}$/.test(q) ? q : null);
  if (id) {
    const ch = await c.channels.fetch(id).catch(() => null);
    if (!ch || !ch.isSendable() || !('guildId' in ch)) throw new Error(`Can't post in channel ${id}.`);
    return ch as SendableChannels & { guildId: string };
  }
  const name = q.replace(/^#/, '').toLowerCase();
  const found = [...c.channels.cache.values()].filter((ch) => 'name' in ch && (ch as { name: string }).name.toLowerCase() === name && ch.isSendable());
  if (!found.length) throw new Error(`No channel called #${name}. Use an id (try "channels <server>").`);
  if (found.length > 1) throw new Error(`#${name} is in more than one server. Use an id:\n` + found.map((ch) => `  ${ch.id}  ${(ch as { guild?: Guild }).guild?.name}`).join('\n'));
  return found[0] as SendableChannels & { guildId: string };
}

const words = (s: string) => { const m = /^(\S+)\s*([\s\S]*)$/.exec(s); return m ? [m[1]!, m[2]!] as const : ['', ''] as const; };
const plain = (r: ReplyObject) => [r.content, ...(r.embeds ?? []).flatMap((e) => [e.title && `== ${e.title} ==`, e.description, ...(e.fields ?? []).map((f) => `${f.name}: ${f.value}`)])]
  .filter(Boolean).join('\n').replace(/<a?:\w+:\d+>\s?/g, '').replace(/\*\*|__|`/g, '');

async function run(d: ConsoleDeps, text: string): Promise<string | null> {
  const c = d.client;
  const [cmd, rest] = words(text);
  switch (cmd.toLowerCase()) {
    case 'help': case '?': return HELP;

    case 'servers': return [...c.guilds.cache.values()].map((g) => `${g.id}  ${g.name} (${g.memberCount} members)`).join('\n') || 'Not in any servers.';

    case 'channels': {
      const g = guildFrom(c, rest);
      return `${g.name}:\n` + [...g.channels.cache.values()].filter((ch) => ch.isSendable()).map((ch) => `  ${ch.id}  #${ch.name}`).join('\n');
    }

    case 'say': {
      const [where, msg] = words(rest);
      if (!msg) return 'Usage: say <channel> <text>';
      const ch = await channelFrom(c, where);
      await ch.send({ content: msg.replace(/\\n/g, '\n'), allowedMentions: { parse: ['users'] } });
      return `Posted in #${'name' in ch ? ch.name : ch.id}.`;
    }

    case 'reply': {
      const [link, msg] = words(rest);
      const m = /channels\/\d+\/(\d+)\/(\d+)/.exec(link);
      if (!m || !msg) return 'Usage: reply <message link> <text>   (right-click a message, Copy Message Link)';
      const ch = await c.channels.fetch(m[1]!).catch(() => null);
      if (!ch || !ch.isTextBased()) return 'Can\'t see that channel.';
      const target = await ch.messages.fetch(m[2]!).catch(() => null);
      if (!target) return 'Can\'t find that message.';
      await target.reply({ content: msg.replace(/\\n/g, '\n'), allowedMentions: { repliedUser: false, parse: ['users'] } });
      return 'Replied.';
    }

    case 'marquez': {
      const [where, msg] = words(rest);
      if (!msg) return 'Usage: marquez <channel> <text>';
      const ch = await channelFrom(c, where);
      await ch.send({ embeds: [{ author: { name: 'Marquez, behind the counter' }, description: `*"${msg.replace(/\\n/g, '\n')}"*`, color: COLORS.wallet }], allowedMentions: { parse: [] } });
      return 'Marquez has spoken.';
    }

    case 'todd': {
      const ch = await channelFrom(c, rest);
      await d.todd(ch, ch.guildId);
      return 'TODD has entered the chat.';
    }

    case 'rain': {
      const [where, more] = words(rest);
      const [amt, ppl] = words(more);
      const total = parseAmount(amt || '');
      const people = Math.max(1, Math.min(25, Number(ppl) || 5));
      if (!total || total <= 0) return 'Usage: rain <channel> <amount> [people]';
      const ch = await channelFrom(c, where);
      const id = `${Date.now().toString(36)}${d.rng.int(0, 1295).toString(36)}`;
      rains.set(id, { guildId: ch.guildId, each: Math.floor(total / people), left: people, got: new Set(), until: Date.now() + 5 * 60_000 });
      await ch.send({
        content: `☔ **It's raining Polygons!** ${format(total)} is coming down. The first ${people} to grab it get ${format(Math.floor(total / people))} each.`,
        components: [{ type: ComponentType.ActionRow, components: [{ type: ComponentType.Button, style: ButtonStyle.Success, label: 'Grab', emoji: { name: '☔' }, custom_id: `rain:${id}` }] }],
        allowedMentions: { parse: [] }
      });
      setTimeout(() => rains.delete(id), 5 * 60_000).unref();
      return `Rain started: ${format(total)} for ${people} people (paid from the Reserve, so it shrinks when the Reserve is low).`;
    }

    case 'haunt': {
      const ch = await channelFrom(c, rest);
      const pick = d.rng.int(0, 2);
      if (pick === 0) { await ch.sendTyping(); return 'The bot started typing... and will never finish.'; }
      if (pick === 1 && 'messages' in ch) {
        const last = (await ch.messages.fetch({ limit: 5 }).catch(() => null))?.filter((m) => !m.author.bot).first();
        if (last) { await last.react(d.rng.pick(['👀', '👁️', '🫥', '🕯️', '📡'])).catch(() => {}); return `Reacted to ${last.author.username}'s message.`; }
      }
      const m = await ch.send({ content: d.rng.pick(['...', 'hello?', 'did you hear that', '█▓▒░ 104.7 ░▒▓█', 'TODD is watching']), allowedMentions: { parse: [] } });
      setTimeout(() => { m.delete().catch(() => {}); }, 2500).unref();
      return 'Posted something and deleted it a moment later.';
    }

    case 'status': {
      if (!rest || rest.toLowerCase() === 'clear') { d.db.setMeta('status.custom', ''); return 'Status is back to normal (it changes within 90 seconds).'; }
      d.db.setMeta('status.custom', rest.slice(0, 128));
      c.user?.setPresence({ activities: [{ name: 'Custom', state: rest.slice(0, 128), type: 4 }], status: 'online' });
      return `Status set: ${rest.slice(0, 128)}`;
    }

    case 'run': {
      const [server, line] = words(rest);
      if (!line) return 'Usage: run <server> <command and arguments>   e.g. run 1234 give <@5678> 500 contest prize';
      const g = guildFrom(c, server);
      const parsed = parsePrefix(d.config.prefix + line, d.config.prefix);
      if (!parsed || 'unknown' in parsed) return `Unknown command "${line.split(/\s+/)[0]}".`;
      const owner = d.config.ownerIds[0] ?? c.user!.id;
      const ctx: Ctx = { db: d.db, config: d.config, rng: d.rng, now: Date.now(), guildId: g.id, channelId: `console:${g.id}`, user: { id: owner, name: 'Console' }, isOwner: true, isMod: true, notes: [] };
      return plain(await execute(parsed.cmd, ctx, parsed.args)) || 'Done.';
    }

    case 'leave': {
      const confirmed = /\s+confirm$/i.test(rest), server = rest.replace(/\s+confirm$/i, '').trim();
      if (!server) return 'Usage: leave <server>   (see "servers")';
      const g = guildFrom(c, server);
      if (!confirmed) return `This makes the bot leave ${g.name} (${g.memberCount} members). Its game data there is kept.\nTo go ahead: leave ${g.id} confirm`;
      if (server !== g.id) return `To be sure it's the right one, confirm with the id: leave ${g.id} confirm`;
      await g.leave();
      console.log(`[console] left ${g.name} (${g.id})`);
      return `Left ${g.name}.`;
    }

    case 'additem': case 'giveitem': case 'removeitem': case 'takeitem': {
      const [server, more] = words(rest);
      const [who, item] = words(more);
      if (!item) return `Usage: ${cmd} <server> <player> <item>   (player: id, <@mention> or name)`;
      const g = guildFrom(c, server);
      let id = who.replace(/\D/g, '');
      if (!/^\d{5,22}$/.test(id)) {
        const p = d.db.all<{ user_id: string; name: string | null }>('SELECT user_id, name FROM players WHERE guild_id = ? AND LOWER(name) LIKE ?', g.id, `%${who.toLowerCase()}%`);
        if (p.length !== 1) return p.length ? `"${who}" matches ${p.map((x) => `${x.name} (${x.user_id})`).join(', ')}. Use an id.` : `No player called "${who}" in ${g.name}.`;
        id = p[0]!.user_id;
      }
      return run(d, `run ${g.id} ${/^(add|give)/.test(cmd.toLowerCase()) ? 'giveitem' : 'takeitem'} <@${id}> ${item}`);
    }

    case 'backup': {
      if (d.db.file === ':memory:') return 'No database file to back up.';
      const dir = path.join(path.dirname(d.db.file), 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, `manual-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
      d.db.backup(dest);
      return `Saved ${dest}`;
    }

    case 'post': {
      const t = await d.postNext();
      return t ? `Posted "${t}".` : 'No patch notes entries are waiting.';
    }

    default: return `Unknown console command "${cmd}". Type "help".`;
  }
}

export const consoleRun = run;
