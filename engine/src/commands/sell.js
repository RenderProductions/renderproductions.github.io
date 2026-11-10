const config = require('../config');
const { money } = require('../format');
const econ = require('../economy');
const co = require('../companies');

// Selling shares of a player company (see src/companies.js)
async function sellPlayerCompany(ctx, m, pc, amount) {
  if (pc.status === 'dead') return `💀 ${pc.name} (${pc.ticker}) went under. Its shares are gone.`;
  if (pc.status !== 'public') return `🔒 ${pc.name} (${pc.ticker}) is private. Nobody owns its shares yet.`;
  if (m) { const closed = ctx.market.closedReason(m); if (closed) return closed; }
  const owned = co.holding(ctx.db, ctx.guildId, ctx.user.id, pc.ticker);
  const raw = String(amount || '').trim().toLowerCase();
  const n = raw === 'all' ? owned : Number(raw);
  if (raw === '' || Number.isNaN(n)) return 'The amount must be a whole number, or `all`.';
  if (n <= 0) return `The amount must be at least 1. You own ${owned} shares of ${pc.ticker}.`;
  if (!Number.isInteger(n)) return 'You can only sell whole shares.';
  const r = co.sell(ctx.db, { guildId: ctx.guildId, user: ctx.user, ticker: pc.ticker, n });
  if (r.error) return r.error;
  const cash = ctx.db.player(ctx.guildId, ctx.user).cash;
  return {
    embeds: [{
      title: `Order filled: sold ${n} ${pc.ticker}`,
      description: `Price per share: **${money(r.priceCents)}**\nTotal received: **${money(r.proceeds)}** Polygons\n` +
        `Cash now: **${money(cash)}** Polygons\nYou now own **${r.left}** shares of ${pc.ticker}.`,
      color: config.color
    }]
  };
}

module.exports = {
  name: 'sell',
  description: 'Sell shares you own',
  usage: '<ticker> <amount or all>',
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'How many shares, or "all"', required: true }
  ],

  async run(ctx, args) {
    const m = await ctx.market.get();
    const t = String(args.ticker || '').toUpperCase();
    if (!ctx.market.ids(m).includes(t)) {
      const pc = co.get(ctx.db, t);
      if (pc && pc.status !== 'rejected' && pc.status !== 'pending') return sellPlayerCompany(ctx, m, pc, args.amount);
      return `Usage: \`${config.prefix}sell <ticker> <amount or all>\`, for example \`${config.prefix}sell RRM 5\`. Tickers: ${ctx.market.tickerList(m)}.`;
    }
    if (!m) return 'The market is offline right now. Try again shortly.';

    const closed = ctx.market.closedReason(m);
    if (closed) return closed;
    const q = ctx.market.quote(m, t);
    ctx.db.player(ctx.guildId, ctx.user);
    const owned = econ.shares(ctx, m, t);
    if (q.status === 'bankrupt') {
      return `${q.statusText}\nNobody will buy shares in a bankrupt company. You're holding the bag until it's bailed out or climbs back.`;
    }
    if (q.priceCents <= 0) return `${t} is worth nothing right now. Trading is paused.`;

    const raw = String(args.amount || '').trim().toLowerCase();
    const qty = raw === 'all' ? owned : Number(raw);
    if (raw === '' || Number.isNaN(qty)) return 'The amount must be a whole number, or `all`.';
    if (qty <= 0) return `The amount must be at least 1. You own ${owned} shares of ${t}.`;
    if (!Number.isInteger(qty)) return 'You can only sell whole shares.';
    if (owned < qty) return `You only own ${owned} shares of ${t}.`;

    const proceeds = qty * q.priceCents;
    const cash = ctx.db.tx(() => {
      ctx.db.updateHolding(ctx.guildId, ctx.user.id, t, { shares: owned - qty });
      ctx.db.addCash(ctx.guildId, ctx.user.id, proceeds);
      ctx.db.logTrade(ctx.guildId, ctx.user.id, t, -qty, q.priceCents);
      return ctx.db.player(ctx.guildId, ctx.user).cash;
    });

    return {
      embeds: [{
        title: `Order filled: sold ${qty} ${t}`,
        description: `Price per share: **${money(q.priceCents)}**\nTotal received: **${money(proceeds)}** Polygons\n` +
          `Cash now: **${money(cash)}** Polygons\nYou now own **${owned - qty}** shares of ${t}.`,
        color: config.color
      }]
    };
  }
};
