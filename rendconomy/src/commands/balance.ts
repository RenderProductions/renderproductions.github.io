import { economy } from '../config';
import { GameError } from '../core/errors';
import { balance as balanceOf, wallet } from '../core/ledger';
import { format } from '../core/money';
import { embed } from '../discord/style';
import { guildOf, me } from './shared';
import type { Command } from './types';

export const balance: Command = {
  name: 'balance',
  aliases: ['bal'],
  description: 'Show your Polygons, or another player\'s',
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'player', type: 'user', description: 'Whose balance to show (default: yours)' }],
  run(ctx, args) {
    const target = typeof args.player === 'string' && args.player !== ctx.user.id ? args.player : null;
    if (!target) {
      const { wallet: w } = me(ctx);
      return { embeds: [embed('wallet', `Balance: ${ctx.user.name}`, [`**${format(balanceOf(ctx.db, w))}**`])] };
    }
    const guildId = guildOf(ctx);
    const exists = ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, target);
    if (!exists) throw new GameError('player.none', `That player has no account in this server. Accounts open with ${format(economy.startingCash)} on first use.`);
    return { embeds: [embed('wallet', 'Balance', [`<@${target}>`, `**${format(balanceOf(ctx.db, wallet(guildId, target)))}**`])] };
  }
};
