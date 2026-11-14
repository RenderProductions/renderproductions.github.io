import { embed } from '../discord/style';
import { GameError } from '../core/errors';
import * as sessions from '../core/sessions';
import type { Button, Command, Ctx, ReplyObject, SessionReply, System } from './types';

export const ping: Command = {
  name: 'ping', aliases: ['latency'],
  description: 'Check that the bot is responding',
  system: 'general',
  run(ctx) {
    return ctx.ping !== undefined && ctx.ping >= 0 ? `Online. Latency: ${Math.round(ctx.ping)} ms.` : 'Online.';
  }
};

const SECTIONS: Record<System, { label: string; emoji: string }> = {
  wallet: { label: 'Wallet', emoji: '👛' }, social: { label: 'Players', emoji: '👥' }, work: { label: 'Work', emoji: '💼' },
  market: { label: 'Stock market', emoji: '📈' }, casino: { label: 'Rend-Sino', emoji: '🎰' }, reserve: { label: 'The Reserve', emoji: '🏦' },
  general: { label: 'General', emoji: 'ℹ️' }, admin: { label: 'Moderators', emoji: '🛡️' }
};
const ORDER: System[] = ['wallet', 'social', 'work', 'market', 'casino', 'reserve', 'general', 'admin'];

let listCommands: () => Command[] = () => [];

function visible(ctx: Ctx): Command[] {
  return listCommands().filter((c) => !c.hidden && (c.system !== 'admin' || ctx.isMod));
}

function line(c: Command, p: string): string {
  return `\`/${c.name}\`${c.aliases?.length ? ` (${c.aliases.map((a) => p + a).join(', ')})` : ''}: ${c.description}`;
}

/** One page of help: the overview, or one section. Every page stays well inside Discord's limits. */
function helpPage(ctx: Ctx, page: System | 'home', sessionId: string): ReplyObject {
  const p = ctx.config.prefix;
  const cmds = visible(ctx);
  const systems = ORDER.filter((s) => cmds.some((c) => c.system === s));
  let lines: string[];
  if (page === 'home') {
    lines = [
      'Choose a section below, or look up one command with `' + p + 'help <command>`.',
      '',
      ...systems.map((s) => `${SECTIONS[s].emoji} **${SECTIONS[s].label}**: ${((n) => `${n} ${n === 1 ? "command" : "commands"}`)(cmds.filter((c) => c.system === s).length)}`),
      '',
      `Every command works as \`/command\` or with the \`${p}\` prefix, for example \`${p}daily\`.`
    ];
  } else {
    lines = [`${SECTIONS[page].emoji} **${SECTIONS[page].label}**`, ...cmds.filter((c) => c.system === page).map((c) => line(c, p))];
    // A section that ever grows past the limit is cut short, never refused by Discord
    while (lines.join('\n').length > 3900) lines.pop();
  }
  const btns: Button[] = [{ label: 'Overview', id: sessions.buttonId(sessionId, 'home'), style: page === 'home' ? 'primary' : 'secondary' },
    ...systems.map((s) => ({ label: SECTIONS[s].label, emoji: SECTIONS[s].emoji, id: sessions.buttonId(sessionId, s), style: (s === page ? 'primary' : 'secondary') as Button['style'] }))];
  const rows: Button[][] = [];
  btns.forEach((b, i) => { if (i % 5 === 0) rows.push([]); rows[rows.length - 1]!.push(b); });
  return { embeds: [embed(page === 'home' ? 'general' : page, `${ctx.config.name} commands`, lines)], buttons: rows, session: sessionId };
}

/** Built from the command list, so it can never fall out of date. */
export function makeHelp(list: () => Command[]): Command {
  listCommands = list;
  return {
    name: 'help', aliases: ['h', 'commands'],
    description: 'List every command, by section, or look up one',
    system: 'general',
    options: [{ name: 'command', type: 'string', description: 'A command, alias or section to look up' }],
    run(ctx, args) {
      const q = String(args.command ?? '').trim().toLowerCase().replace(/^\//, '').replace(ctx.config.prefix.toLowerCase(), '');
      if (q) {
        const c = visible(ctx).find((x) => x.name === q || x.aliases?.includes(q));
        if (c) {
          return { embeds: [embed(c.system, `/${c.name}`, [
            c.description,
            c.aliases?.length ? `Also: ${c.aliases.map((a) => `\`${ctx.config.prefix}${a}\``).join(', ')}` : null,
            ...(c.options ?? []).map((o) => `\`${o.name}\`: ${o.description}`)
          ])] };
        }
      }
      const section = ORDER.find((s) => q && (s === q || SECTIONS[s].label.toLowerCase().includes(q)));
      if (q && !section) throw new GameError('help.unknown', `There is no command or section called "${q}".`);
      const s = sessions.create(ctx.db, { kind: 'help', guildId: ctx.guildId, channelId: ctx.channelId, userId: ctx.user.id, state: {}, ttlMs: 10 * 60_000, now: ctx.now });
      return helpPage(ctx, section && (section !== 'admin' || ctx.isMod) ? section : 'home', s.id);
    }
  };
}

export function onHelpButton(ctx: Ctx, s: sessions.Session<Record<string, never>>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}help\` to open your own.` };
  if (value !== 'home' && !(ORDER as string[]).includes(value)) return {};
  if (value === 'admin' && !ctx.isMod) return {};
  const { session: _s, ...v } = helpPage(ctx, value as System | 'home', s.id);
  return { update: v };
}
