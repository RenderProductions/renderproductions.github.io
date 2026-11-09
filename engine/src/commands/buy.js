const config = require('../config');
const { poly, money } = require('../format');

module.exports = {
  name: 'buy',
  description: 'Buy shares in a company',
  usage: '<ticker> <amount or max>',
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'How many shares, or "max"', required: true }
  ],

  async run(ctx, args) {
    const m = await ctx.market.get();
    const q = ctx.market.quote(m, args.ticker);
    if (!q) return `Unknown ticker. Try one of: ${m.companies.map((c) => c.id).join(', ')}`;
    if (!q.canTrade) return q.whyNot;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    const raw = String(args.amount || '').toLowerCase();
    const n = raw === 'max' ? Math.floor(p.cash / q.priceCents) : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return raw === 'max' ? `You can't afford a single share of ${q.id} (${money(q.priceCents)} each).`
        : `Amount has to be a whole number above 0, or "max". Example: \`${config.prefix}buy ${q.id} 5\``;
    }

    const cost = n * q.priceCents;
    if (cost > p.cash) {
      return `That costs ${poly(cost)}, but you only have ${poly(p.cash)}.`;
    }

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      ctx.db.addShares(ctx.guildId, ctx.user.id, q.id, n);
      ctx.db.logTrade(ctx.guildId, ctx.user.id, q.id, n, q.priceCents);
    });

    return {
      embeds: [{
        title: `Bought ${n} ${q.id}`,
        description: `${n} × ${money(q.priceCents)} = **${poly(cost)}**\nCash left: ${poly(p.cash - cost)}`,
        color: config.color
      }]
    };
  }
};
