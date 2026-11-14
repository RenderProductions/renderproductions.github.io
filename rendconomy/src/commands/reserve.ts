import { economy } from '../config';
import { RESERVE, balance } from '../core/ledger';
import { format } from '../core/money';
import { embed } from '../discord/style';
import type { Command } from './types';

export const reserve: Command = {
  name: 'reserve', aliases: ['vault'],
  description: 'The Polygon Reserve: what the house has left to pay out',
  system: 'reserve',
  run(ctx) {
    const left = balance(ctx.db, RESERVE);
    const pct = (left / economy.reserveStart) * 100;
    return {
      embeds: [embed('reserve', 'The Polygon Reserve', [
        `**${format(left)}** of ${format(economy.reserveStart)}`,
        `Level: ${pct.toFixed(pct < 10 ? 2 : 1)}%`,
        'Every payout is drawn from the Reserve. Every purchase is returned to it.'
      ])]
    };
  }
};
