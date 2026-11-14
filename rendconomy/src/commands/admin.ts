// Moderator tools. Every action needs a reason, is written to the ledger (for money), and is posted to
// the mod log channel when one is set (MOD_LOG_CHANNEL_ID).
import path from 'node:path';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, parseAmount } from '../core/money';
import { eraseServer, erasePlayer } from '../core/players';
import * as sessions from '../core/sessions';
import { embed } from '../discord/style';
import { guildOf } from './shared';
import type { Command, Ctx, SessionReply } from './types';

function needMod(ctx: Ctx): string {
  const g = guildOf(ctx);
  if (!ctx.isMod) throw new GameError('mod.only', 'This command is restricted to moderators (Manage Server).');
  return g;
}
function needOwner(ctx: Ctx): string {
  const g = guildOf(ctx);
  if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
  return g;
}
function target(ctx: Ctx, guildId: string, id: unknown): string {
  if (typeof id !== 'string' || !/^\d{5,22}$/.test(id)) throw new GameError('mod.target', 'Name a player, for example @someone.');
  if (!ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, id)) throw new GameError('mod.noaccount', 'That player has no account in this server.');
  return id;
}
const reasonOf = (r: unknown): string => {
  const s = String(r ?? '').trim();
  if (!s) throw new GameError('mod.reason', 'A reason is required.');
  return s.slice(0, 300);
};

export const give: Command = {
  name: 'give',
  description: 'Moderators: give a player Polygons from the Reserve',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'player', type: 'user', description: 'Who receives it', required: true },
    { name: 'amount', type: 'string', description: 'How much', required: true },
    { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
  ],
  run(ctx, args) {
    const g = needMod(ctx);
    const who = target(ctx, g, args.player);
    const cents = parseAmount(args.amount);
    const reason = reasonOf(args.reason);
    transfer(ctx.db, { from: RESERVE, to: wallet(g, who), cents, reason: 'mod.give', guildId: g, actorId: ctx.user.id, now: ctx.now, note: { reason } });
    emit('mod.action', { guildId: g, modId: ctx.user.id, action: 'give', targetId: who, cents, reason });
    return { embeds: [embed('admin', 'Polygons granted', [`<@${who}> received **${format(cents)}** from the Reserve.`, `Reason: ${reason}`, `Their balance: ${format(balance(ctx.db, wallet(g, who)))}`])] };
  }
};

export const take: Command = {
  name: 'take',
  description: 'Moderators: take Polygons from a player back to the Reserve',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'player', type: 'user', description: 'Who loses it', required: true },
    { name: 'amount', type: 'string', description: 'How much, or "all"', required: true },
    { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
  ],
  run(ctx, args) {
    const g = needMod(ctx);
    const who = target(ctx, g, args.player);
    const cents = parseAmount(args.amount, { all: balance(ctx.db, wallet(g, who)) });
    const reason = reasonOf(args.reason);
    transfer(ctx.db, { from: wallet(g, who), to: RESERVE, cents, reason: 'mod.take', guildId: g, actorId: ctx.user.id, now: ctx.now, note: { reason } });
    emit('mod.action', { guildId: g, modId: ctx.user.id, action: 'take', targetId: who, cents, reason });
    return { embeds: [embed('admin', 'Polygons removed', [`**${format(cents)}** was returned to the Reserve from <@${who}>.`, `Reason: ${reason}`, `Their balance: ${format(balance(ctx.db, wallet(g, who)))}`])] };
  }
};

function setFrozen(frozen: boolean): Command {
  return {
    name: frozen ? 'freeze' : 'unfreeze',
    description: frozen ? 'Moderators: freeze a player (no commands that use their account)' : 'Moderators: unfreeze a player',
    system: 'admin',
    guildOnly: true,
    options: [
      { name: 'player', type: 'user', description: 'Which player', required: true },
      { name: 'reason', type: 'string', description: 'Why (recorded)', required: true }
    ],
    run(ctx, args) {
      const g = needMod(ctx);
      const who = target(ctx, g, args.player);
      const reason = reasonOf(args.reason);
      ctx.db.run('UPDATE players SET frozen = ? WHERE guild_id = ? AND user_id = ?', frozen ? 1 : 0, g, who);
      emit('mod.action', { guildId: g, modId: ctx.user.id, action: frozen ? 'freeze' : 'unfreeze', targetId: who, reason });
      return { embeds: [embed('admin', frozen ? 'Account frozen' : 'Account unfrozen', [`<@${who}>`, `Reason: ${reason}`])] };
    }
  };
}
export const freeze = setFrozen(true);
export const unfreeze = setFrozen(false);

interface WipeState { scope: 'player' | 'server'; targetId: string | null }

export const wipe: Command = {
  name: 'wipe',
  description: 'Bot owner: erase one player\'s data, or the whole server\'s (backup first, asks to confirm)',
  system: 'admin',
  guildOnly: true,
  options: [
    { name: 'scope', type: 'string', description: '"player" or "server"', required: true },
    { name: 'player', type: 'user', description: 'Which player (for scope: player)' }
  ],
  run(ctx, args) {
    const g = needOwner(ctx);
    const scope = String(args.scope ?? '').trim().toLowerCase();
    if (scope !== 'player' && scope !== 'server') throw new GameError('wipe.scope', 'The scope must be "player" or "server".');
    const who = scope === 'player' ? target(ctx, g, args.player) : null;
    const count = ctx.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE guild_id = ?', g)!.n;
    const s = sessions.create<WipeState>(ctx.db, { kind: 'wipe', guildId: g, channelId: ctx.channelId, userId: ctx.user.id, state: { scope, targetId: who }, ttlMs: 2 * 60_000, now: ctx.now });
    return {
      embeds: [embed('admin', 'Confirm erasure', [
        who ? `Every record of <@${who}> in this server will be erased: balance, shares, jobs and history. Their Polygons return to the Reserve.`
          : `Every record of all **${count}** players in this server will be erased. Their Polygons return to the Reserve.`,
        'A backup of the database is taken first. This cannot be undone from Discord.'
      ])],
      buttons: [[{ label: 'Erase', id: sessions.buttonId(s.id, 'yes'), style: 'danger' }, { label: 'Cancel', id: sessions.buttonId(s.id, 'no') }]],
      session: s.id
    };
  }
};

export function onWipeButton(ctx: Ctx, s: sessions.Session<WipeState>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id || !ctx.isOwner) return { notice: 'Only the bot owner who started this can confirm it.' };
  if (!sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  if (value !== 'yes') return { update: { embeds: [embed('admin', 'Erasure cancelled', ['Nothing was changed.'])], buttons: [] } };
  const g = s.guild_id!;
  let backup = 'not taken (in-memory database)';
  if (ctx.db.file !== ':memory:') {
    const stamp = new Date(ctx.now).toISOString().replace(/[:.]/g, '-');
    backup = path.basename(ctx.db.backup(path.join(path.dirname(ctx.db.file), 'backups', `before-wipe-${stamp}.db`)));
  }
  let summary: string;
  if (s.state.scope === 'player') {
    erasePlayer(ctx.db, g, s.state.targetId!, ctx.now);
    summary = `All records of <@${s.state.targetId}> in this server have been erased.`;
  } else {
    summary = `All records of ${eraseServer(ctx.db, g, ctx.now)} players in this server have been erased.`;
  }
  emit('mod.action', { guildId: g, modId: ctx.user.id, action: `wipe ${s.state.scope}`, targetId: s.state.targetId ?? undefined });
  return { update: { embeds: [embed('admin', 'Erasure complete', [summary, `Backup: ${backup}`])], buttons: [] } };
}
