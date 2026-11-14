import { balance } from '../core/ledger';
import { format, parseCount } from '../core/money';
import { embed } from '../discord/style';
import { current, quote } from '../market/market';
import { affordable, buy as buyShares, pendingDividends, portfolio as positions, sell as sellShares, sharesOf, tradableQuote } from '../market/trading';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { me } from './shared';
import { netWorth, savingsTotal } from '../social/worth';
import { timedUntil } from '../shop/inventory';
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
        savingsTotal(ctx.db, guildId, ctx.user.id) > 0 && `Savings: ${format(savingsTotal(ctx.db, guildId, ctx.user.id))}`,
        `**Net worth: ${format(netWorth(ctx.db, m, guildId, ctx.user.id))}**`
      ])]
    };
  }
};

export const dividends: Command = {
  name: 'dividends',
  aliases: ['div', 'divs'],
  description: 'Collect what your shares have earned',
  system: 'market',
  guildOnly: true,
  run(ctx) {
    const m = current(ctx.db);
    const { wallet, guildId } = me(ctx);
    return ctx.db.tx(() => {
      const p = pendingDividends(ctx.db, m, guildId, ctx.user.id);
      const cents = Math.floor(p.total * 100 + 1e-9);
      ctx.db.run('UPDATE players SET div_pending = ? WHERE guild_id = ? AND user_id = ?', Math.max(0, p.total - cents / 100), guildId, ctx.user.id);
      const boosted = timedUntil(ctx.db, guildId, ctx.user.id, 'divBoost', ctx.now) > 0;
      const paid = cents > 0 ? payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: boosted ? Math.round(cents * 1.5) : cents, reason: 'dividends', guildId, actorId: ctx.user.id, now: ctx.now }) : 0;
      if (paid > 0) emit('dividends.claimed', { guildId, userId: ctx.user.id, cents: paid });
      const lines = m.companies.map((c) => {
        const held = sharesOf(ctx.db, m, guildId, ctx.user.id, c.id);
        const text = plain((m.divText as Record<string, string> | undefined)?.[c.id] ?? '');
        return held > 0 ? `**${c.id}** · ${held} shares${text ? ` · ${text}` : ''}` : null;
      }).filter(Boolean) as string[];
      return { embeds: [embed('market', 'Dividends', [
        paid > 0 ? `**${format(paid)}** has been collected.` : 'No dividends are due.',
        paid > 0 && boosted ? 'Dividend Booster: +50%.' : null,
        paid > 0 && paid < cents ? 'The Polygon Reserve is low. Payouts are reduced.' : null,
        '',
        ...(lines.length ? lines : ['No shares held. Shares earn dividends from the moment they are bought.']),
        '',
        `Balance: ${format(balance(ctx.db, wallet))}`
      ], { footer: { text: 'Dividends accumulate until collected. Smaller companies pay higher yields.' } })] };
    });
  }
};

export const chart: Command = {
  name: 'chart',
  description: 'A price chart for a company (last 24 hours)',
  system: 'market',
  options: [{ name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true }],
  run(ctx, args) {
    const m = current(ctx.db);
    const t = String(args.ticker ?? '').trim().toUpperCase();
    const q = quote(m, t);
    if (!q) throw new GameError('stock.unknown', `There is no company with the ticker ${t}. Tickers: ${m.companies.map((c) => c.id).join(', ')}.`);
    const url = (m.charts as Record<string, string> | undefined)?.[t];
    return { embeds: [embed('market', `${q.name} (${t})`, [`**${format(q.priceCents)}**  ${pct(q.change)}`, q.spark, q.status !== 'ok' ? plain(q.statusText) : null],
      url ? { image: { url }, footer: { text: 'Last 24 hours · prices update every 5 minutes' } } : { footer: { text: 'Last 24 hours' } })] };
  }
};
