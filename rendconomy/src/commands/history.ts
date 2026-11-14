import { history as entries } from '../core/ledger';
import { format } from '../core/money';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { me, reasonLabel } from './shared';
import type { Command } from './types';

export const history: Command = {
  name: 'history',
  aliases: ['transactions', 'tx'],
  description: 'Your last 10 transactions: where your Polygons came from and went',
  system: 'wallet',
  guildOnly: true,
  run(ctx) {
    const { wallet } = me(ctx);
    const rows = entries(ctx.db, wallet, 10);
    const lines = rows.map((e) => {
      const incoming = e.to_id === wallet;
      return `${incoming ? '+' : '−'}${format(e.cents)} · ${reasonLabel(e.reason)} · ${discordTime(e.at)}`;
    });
    return {
      embeds: [embed('wallet', 'Transaction history', lines.length ? lines : ['No transactions on record.'])],
      ephemeral: true
    };
  }
};
