import { balance } from '../core/ledger';
import { format, parseCount } from '../core/money';
import { embed } from '../discord/style';
import { current, quote } from '../market/market';
import { affordable, buy as buyShares, portfolio as positions, sell as sellShares, sharesOf, tradableQuote } from '../market/trading';
import { me } from './shared';
import type { Command } from './types';

const pct = (n: number) => `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`;
const plain = (s: unknown) => String(s ?? '').replace(/\*\*/g, '');

export const market: Command = {
  name: 'market',
  aliases: ['stocks', 'm'],
  description: 'Current stock prices and market status',
  system: 'market',
  run(ctx) {
    const m = current(ctx.db);
    const lines = m.companies.map((c) => {
      const q = quote(m, c.id)!;
      const status = q.status !== 'ok' && q.statusText ? `\n-# ${plain(q.statusText)}` : '';
      return `**${q.id}** · ${q.name}\n${format(q.priceCents)}  ${pct(q.change)}  ${q.spark}${status}`;
    });
    return {
      embeds: [embed('market', 'The market', [
        plain(m.market.text),
        m.crashText && plain(m.crashText),
        m.boostText && plain(m.boostText),
        '',
        ...lines
      ], { footer: { text: 'Change is over the last 24 hours. Prices update every 5 minutes.' } })]
    };
  }
};

export const buy: Command = {
  name: 'buy',
  description: 'Buy shares in a company',
  system: 'market',
  guildOnly: true,
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'Number of shares, or "max"', required: true }
  ],
  run(ctx, args) {
    const m = current(ctx.db);
    const { wallet, guildId } = me(ctx);
    const q = tradableQuote(m, String(args.ticker ?? ''));
    const max = affordable(balance(ctx.db, wallet), q.priceCents);
    const qty = parseCount(args.amount, { all: max, max: undefined });
    const r = buyShares(ctx.db, m, { guildId, userId: ctx.user.id, ticker: q.id, qty, now: ctx.now });
    return {
      embeds: [embed('market', `Purchase complete: ${r.qty} ${q.id}`, [
        `${r.qty} × ${format(r.priceCents)} = **${format(r.totalCents)}**`,
        `Shares of ${q.id} held: ${r.shares}`,
        `Balance: ${format(r.cash)}`
      ])]
    };
  }
};

export const sell: Command = {
  name: 'sell',
  description: 'Sell shares you hold',
  system: 'market',
  guildOnly: true,
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'Number of shares, or "all"', required: true }
  ],
  run(ctx, args) {
    const m = current(ctx.db);
    const { guildId } = me(ctx);
    const q = tradableQuote(m, String(args.ticker ?? ''));
    const owned = sharesOf(ctx.db, m, guildId, ctx.user.id, q.id);
    const qty = parseCount(args.amount, { all: owned });
    const r = sellShares(ctx.db, m, { guildId, userId: ctx.user.id, ticker: q.id, qty, now: ctx.now });
    const cost = (r.sold ?? []).reduce((s, l) => s + l.qty * l.price_cents, 0);
    const gain = r.totalCents - cost;
    return {
      embeds: [embed('market', `Sale complete: ${r.qty} ${q.id}`, [
        `${r.qty} × ${format(r.priceCents)} = **${format(r.totalCents)}**`,
        cost > 0 && `${gain >= 0 ? 'Gain' : 'Loss'} against purchase price: ${format(Math.abs(gain))}`,
        `Shares of ${q.id} held: ${r.shares}`,
        `Balance: ${format(r.cash)}`
      ])]
    };
  }
};

export const portfolio: Command = {
  name: 'portfolio',
  aliases: ['pf'],
  description: 'Your shares, their value, and your net worth',
  system: 'market',
  guildOnly: true,
  run(ctx) {
    const m = current(ctx.db);
    const { wallet, guildId } = me(ctx);
    const cash = balance(ctx.db, wallet);
    const list = positions(ctx.db, m, guildId, ctx.user.id);
    const stocks = list.reduce((s, p) => s + p.valueCents, 0);
    const lines = list.map((p) => {
      const diff = p.valueCents - p.costCents;
      return `**${p.quote.id}** · ${p.shares} × ${format(p.quote.priceCents)} = ${format(p.valueCents)}` +
        (p.costCents > 0 ? `\n-# ${diff >= 0 ? '+' : '−'}${format(Math.abs(diff))} against purchase price` : '');
    });
    return {
      embeds: [embed('market', `Portfolio: ${ctx.user.name}`, [
        ...(lines.length ? lines : ['No shares held.']),
        '',
        `Cash: ${format(cash)}`,
        `Shares: ${format(stocks)}`,
        `**Net worth: ${format(cash + stocks)}**`
      ])]
    };
  }
};
