import { economy } from '../config';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format } from '../core/money';
import { checkDaily, dayKey, discordTime } from '../core/time';
import { embed } from '../discord/style';
import { me } from './shared';
import type { Command } from './types';

export const daily: Command = {
  name: 'daily',
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

      transfer(ctx.db, { from: RESERVE, to: wallet, cents: economy.dailyAmount, reason: 'daily', guildId, actorId: ctx.user.id, now: ctx.now });
      return {
        embeds: [embed('wallet', 'Daily allowance', [
          `${format(economy.dailyAmount)} has been deposited.`,
          `Balance: **${format(balance(ctx.db, wallet))}**`,
          `Streak: ${check.streak} ${check.streak === 1 ? 'day' : 'days'}`,
          `Next allowance: ${discordTime(check.resetsAt)}`
        ])]
      };
    });
  }
};
