import { history as entries } from '../core/ledger';
import { format } from '../core/money';
import { ago, diffBlock } from '../discord/diff';
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
    const block = rows.length ? diffBlock(rows.map((e) => [e.to_id === wallet ? '+' : '-', format(e.cents), reasonLabel(e.reason), ago(e.at, ctx.now)])) : null;
    return {
      embeds: [embed('wallet', 'Transaction history', block ? [block, '-# Green came in, red went out.'] : ['No transactions on record.'])],
      ephemeral: true
    };
  }
};
