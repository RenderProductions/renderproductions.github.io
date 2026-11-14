import { economy } from '../config';
import { GameError } from '../core/errors';
import { payFromReserve } from '../core/economy';
import { emit } from '../core/events';
import { balance } from '../core/ledger';
import { format } from '../core/money';
import { checkDaily, dayKey, discordTime } from '../core/time';
import { embed } from '../discord/style';
import { useEffect } from '../shop/inventory';
import { me } from './shared';
import type { Command } from './types';

export const daily: Command = {
  name: 'daily', aliases: ['d'],
  description: 'Collect your daily allowance (resets at 12 AM Eastern)',
  system: 'wallet',
  guildOnly: true,
  run(ctx) {
    return ctx.db.tx(() => {
      const { player, wallet, guildId } = me(ctx);
      const check = checkDaily(player.daily_day, player.daily_streak, ctx.now);
      if (!check.ready) {
        throw new GameError('daily.claimed', `Today's allowance has already been collected. The next is available ${discordTime(check.resetsAt)}.`);
      }
      // Marks today as claimed only if it isn't already, so a double click can't claim twice
      const today = dayKey(ctx.now);
      const r = ctx.db.run(
        'UPDATE players SET daily_day = ?, daily_streak = ? WHERE guild_id = ? AND user_id = ? AND (daily_day IS NULL OR daily_day <> ?)',
        today, check.streak, guildId, ctx.user.id, today
      );
      if (r.changes !== 1) throw new GameError('daily.claimed', "Today's allowance has already been collected.");

      const twice = useEffect(ctx.db, guildId, ctx.user.id, 'dailyDouble'); // TODD's Floppy Disk
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: economy.dailyAmount * (twice ? 2 : 1), reason: 'daily', guildId, actorId: ctx.user.id, now: ctx.now });
      emit('daily.claimed', { guildId, userId: ctx.user.id, streak: check.streak, cents: paid });
      return {
        embeds: [embed('wallet', 'Daily allowance', [
          `${format(paid)} has been deposited.`,
          twice && 'DAILY_X2.BAT: this allowance is doubled.',
          paid < economy.dailyAmount * (twice ? 2 : 1) && 'The Polygon Reserve is low. Payouts are reduced.',
          `Balance: **${format(balance(ctx.db, wallet))}**`,
          `Streak: ${check.streak} ${check.streak === 1 ? 'day' : 'days'}`,
          `Next allowance: ${discordTime(check.resetsAt)}`
        ])]
      };
    });
  }
};
