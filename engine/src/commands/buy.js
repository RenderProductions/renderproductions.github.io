const config = require('../config');
const { money } = require('../format');
const econ = require('../economy');

module.exports = {
  name: 'buy',
  description: 'Buy shares in a company',
  usage: '<ticker> <amount>',
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'How many shares (or "max")', required: true }
  ],

  async run(ctx, args) {
    const m = await ctx.market.get();
    const t = String(args.ticker || '').toUpperCase();
    const list = ctx.market.tickerList(m);
    if (!ctx.market.ids(m).includes(t)) {
      return `Usage: \`${config.prefix}buy <ticker> <amount>\`, for example \`${config.prefix}buy RRM 5\`. Tickers: ${list}.`;
    }
    if (!m) return 'The market is offline right now. Try again shortly.';

    const raw = String(args.amount || '').trim().toLowerCase();
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const q = ctx.market.quote(m, t);

    let qty = raw === 'max' && q.priceCents > 0 ? Math.floor(p.cash / q.priceCents) : Number(raw);
    if (raw === '' || Number.isNaN(qty)) return `The amount must be a whole number, for example \`${config.prefix}buy RRM 5\`.`;
    if (qty <= 0) return 'The amount must be at least 1.';
    if (!Number.isInteger(qty)) return 'You can only buy whole shares.';

    const closed = ctx.market.closedReason(m);
    if (closed) return closed;
    if (q.status === 'bankrupt') return `${q.statusText}\nYou can't buy shares in a bankrupt company.`;
    if (q.priceCents <= 0) return `${t} is worth nothing right now. Trading is paused.`;

    const cost = qty * q.priceCents;
    if (p.cash < cost) return `Not enough Polygons. That order costs ${money(cost)} and you have ${money(p.cash)}.`;

    const held = ctx.db.tx(() => {
      const now = econ.shares(ctx, m, t) + qty;
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      ctx.db.updateHolding(ctx.guildId, ctx.user.id, t, { shares: now });
      ctx.db.logTrade(ctx.guildId, ctx.user.id, t, qty, q.priceCents);
      return now;
    });

    const warn = q.status === 'distressed'
      ? `\n⚠️ ${t} is under 3.00. If it drops below zero it goes **bankrupt** and your shares are wiped.` : '';

    return {
      embeds: [{
        title: `Order filled: bought ${qty} ${t}`,
        description: `Price per share: **${money(q.priceCents)}**\nTotal cost: **${money(cost)}** Polygons\n` +
          `Cash left: **${money(p.cash - cost)}** Polygons\nYou now own **${held}** shares of ${t}.${warn}`,
        color: config.color
      }]
    };
  }
};
