// Helpers commands share, so no command has its own copy.
import { economy } from '../config';
import { player, type Player } from '../core/economy';
import { GameError } from '../core/errors';
import { wallet } from '../core/ledger';
import { format } from '../core/money';
import type { Ctx } from './types';

export function guildOf(ctx: Ctx): string {
  if (!ctx.guildId) throw new GameError('guild.only', 'This command is only available in a server.');
  return ctx.guildId;
}

/**
 * The player using the command, in this server. Opens their account (with starting Polygons)
 * the first time, and refuses frozen accounts.
 */
export function me(ctx: Ctx): { player: Player; wallet: string; guildId: string } {
  const guildId = guildOf(ctx);
  const { player: p, isNew } = player(ctx.db, guildId, ctx.user.id, economy.startingCash, ctx.now);
  if (isNew) ctx.notes.push(`Account opened. ${format(economy.startingCash)} has been deposited as a starting balance.`);
  if (p.frozen) throw new GameError('account.frozen', 'This account is frozen. Contact a moderator.');
  if (p.name !== ctx.user.name) ctx.db.run('UPDATE players SET name = ? WHERE guild_id = ? AND user_id = ?', ctx.user.name, guildId, ctx.user.id);
  return { player: p, wallet: wallet(guildId, ctx.user.id), guildId };
}

/** Plain-language names for ledger reasons, for /history and receipts. */
export const REASONS: Record<string, string> = {
  start: 'Starting balance',
  daily: 'Daily allowance',
  'stock.buy': 'Shares bought',
  'stock.sell': 'Shares sold',
  'work.shift': 'Shift pay',
  'work.rush': 'Rush order',
  'work.review': 'Review bonus',
  'work.gig': 'Gig pay',
  'work.severance': 'Severance',
  gift: 'Gift',
  'gift.fee': 'Gift fee',
  'savings.deposit': 'Savings deposit',
  'savings.return': 'Savings returned',
  'savings.interest': 'Savings interest',
  wipe: 'Account erased',
  'reserve.fund': 'Reserve funded',
  'mod.give': 'Moderator grant',
  'mod.take': 'Moderator removal'
};
export const reasonLabel = (reason: string): string => REASONS[reason] ?? reason;
