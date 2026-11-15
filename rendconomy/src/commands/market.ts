import { emoji } from '../discord/emoji';
import { nameOf, receipt } from '../social/receipts';
import { balance, wallet } from '../core/ledger';
import { format, parseCount } from '../core/money';
import { embed } from '../discord/style';
import { current, load, quote } from '../market/market';
import { affordable, buy as buyShares, pendingDividends, portfolio as positions, sell as sellShares, sharesOf, tradableQuote } from '../market/trading';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { guildOf, me } from './shared';
import { buyShares as buyCompanyShares, getCompany, holding as companyHolding, sellShares as sellCompanyShares } from '../companies/companies';
import { TICKERS } from '../market/market';
import type { Ctx } from './types';

/** A public player company, if that's what the ticker is (house tickers win). */
function playerCompany(t: string, ctx: Ctx) {
  const id = t.trim().toUpperCase();
  if (TICKERS.includes(id)) return null;
  const c = getCompany(ctx.db, id);
  return c && c.status === 'public' ? c : null;
}
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
    const pc = playerCompany(String(args.ticker ?? ''), ctx);
    if (pc) {
      const qty = parseCount(args.amount, { all: affordable(balance(ctx.db, wallet), Math.ceil(pc.price * 100 * 1.5)) });
      const r = buyCompanyShares(ctx.db, guildId, ctx.user.id, pc, qty, ctx.now);
      receipt(ctx.db, guildId, ctx.user.id, `Bought ${qty} ${pc.ticker}`, [['Company', `${pc.name} (${pc.ticker})`], ['Shares', String(qty)], ['Price per share', format(r.priceCents)], ['Total cost', format(r.cost)], ['You now own', `${r.held} ${pc.ticker}`], ['Balance', format(balance(ctx.db, wallet))]]);
      return { embeds: [embed('market', `📈 Bought ${qty} ${pc.ticker}`, [`${qty} × ${format(r.priceCents)} = **${format(r.cost)}**`, `Shares of ${pc.ticker} held: ${r.held}`, `Balance: ${format(balance(ctx.db, wallet))}`])] };
    }
    const q = tradableQuote(m, String(args.ticker ?? ''));
    const max = affordable(balance(ctx.db, wallet), q.priceCents);
    const qty = parseCount(args.amount, { all: max, max: undefined });
    const r = buyShares(ctx.db, m, { guildId, userId: ctx.user.id, ticker: q.id, qty, now: ctx.now });
    receipt(ctx.db, guildId, ctx.user.id, `Bought ${r.qty} ${q.id}`, [['Company', `${q.name} (${q.id})`], ['Shares', String(r.qty)], ['Price per share', format(r.priceCents)], ['Total cost', format(r.totalCents)], ['You now own', `${r.shares} ${q.id}`], ['Balance', format(r.cash)]]);
    return {
      embeds: [embed('market', `📈 Bought ${r.qty} ${q.id}`, [
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
    const pc = playerCompany(String(args.ticker ?? ''), ctx);
    if (pc) {
      const qty = parseCount(args.amount, { all: companyHolding(ctx.db, guildId, ctx.user.id, pc.ticker) });
      const r = sellCompanyShares(ctx.db, guildId, ctx.user.id, pc, qty, ctx.now);
      receipt(ctx.db, guildId, ctx.user.id, `Sold ${qty} ${pc.ticker}`, [['Company', `${pc.name} (${pc.ticker})`], ['Shares', String(qty)], ['Price per share', format(r.priceCents)], ['You received', format(r.proceeds)], ['You still own', `${r.held} ${pc.ticker}`]]);
      return { embeds: [embed('market', `📉 Sold ${qty} ${pc.ticker}`, [`${qty} × ${format(r.priceCents)} = **${format(r.proceeds)}**`, `Shares of ${pc.ticker} held: ${r.held}`])] };
    }
    const q = tradableQuote(m, String(args.ticker ?? ''));
    const owned = sharesOf(ctx.db, m, guildId, ctx.user.id, q.id);
    const qty = parseCount(args.amount, { all: owned });
    const r = sellShares(ctx.db, m, { guildId, userId: ctx.user.id, ticker: q.id, qty, now: ctx.now });
    const cost = (r.sold ?? []).reduce((s, l) => s + l.qty * l.price_cents, 0);
    const gain = r.totalCents - cost;
    receipt(ctx.db, guildId, ctx.user.id, `Sold ${r.qty} ${q.id}`, [['Company', `${q.name} (${q.id})`], ['Shares', String(r.qty)], ['Price per share', format(r.priceCents)], ['You received', format(r.totalCents)],
      cost > 0 && [gain >= 0 ? 'Gain' : 'Loss', format(Math.abs(gain))], ['You still own', `${r.shares} ${q.id}`], ['Balance', format(r.cash)]]);
    return {
      embeds: [embed('market', `${gain >= 0 ? '💰' : '📉'} Sold ${r.qty} ${q.id}`, [
        `${r.qty} × ${format(r.priceCents)} = **${format(r.totalCents)}**`,
        cost > 0 && `${gain >= 0 ? 'Gain' : 'Loss'} against purchase price: ${format(Math.abs(gain))}`,
        `Shares of ${q.id} held: ${r.shares}`,
        `Balance: ${format(r.cash)}`
      ])]
    };
  }
};

/** Your money in one place: cash, savings, shares and net worth. r!bal, r!balance, r!portfolio and r!pf. */
export const money: Command = {
  name: 'balance',
  aliases: ['bal', 'portfolio', 'pf', 'wallet'],
  description: 'Your Polygons, savings, shares and net worth, or another player\'s',
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'player', type: 'user', description: 'Whose to show (default: yours)' }],
  run(ctx, args) {
    const m = load(ctx.db); // balance still works while the market is offline
    const other = typeof args.player === 'string' && args.player !== ctx.user.id ? args.player : null;
    let guildId: string, userId: string;
    if (other) {
      guildId = guildOf(ctx); userId = other;
      if (!ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, other)) throw new GameError('player.none', `That player has no account in this server. Accounts open with ${format(economy.startingCash)} on first use.`);
    } else ({ guildId } = me(ctx), userId = ctx.user.id);
    const cash = balance(ctx.db, wallet(guildId, userId));
    const saved = savingsTotal(ctx.db, guildId, userId);
    const list = m ? positions(ctx.db, m, guildId, userId) : [];
    const stocks = list.reduce((s, p) => s + p.valueCents, 0);
    const lines = list.map((p) => {
      const diff = p.valueCents - p.costCents;
      return `**${p.quote.id}** · ${p.shares} × ${format(p.quote.priceCents)} = ${format(p.valueCents)}` +
        (p.costCents > 0 ? ` · ${diff >= 0 ? '▲' : '▼'} ${format(Math.abs(diff))}` : '');
    });
    return {
      embeds: [embed('wallet', other ? 'Balance' : `Balance: ${ctx.user.name}`, [
        other ? `<@${other}>` : null,
        `${emoji('polygon')} Cash: **${format(cash)}**`,
        saved > 0 ? `${emoji('savings')} Savings: **${format(saved)}**` : null,
        list.length ? `${emoji('stonks')} Shares: **${format(stocks)}**` : null,
        ...(list.length ? ['', ...lines] : []),
        '',
        `**Net worth: ${format(netWorth(ctx.db, m, guildId, userId))}**`,
        !other && !list.length ? `-# No shares yet. See what's trading with \`${ctx.config.prefix}market\`.` : null
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
  name: 'chart', aliases: ['graph'],
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
