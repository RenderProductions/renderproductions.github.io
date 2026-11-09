const config = require('../config');
const { poly, money } = require('../format');

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
    const q = ctx.market.quote(m, args.ticker);
    if (!q) return `Unknown ticker. Try one of: ${m.companies.map((c) => c.id).join(', ')}`;
    if (!q.canTrade) return q.whyNot;

    ctx.db.player(ctx.guildId, ctx.user);
    const owned = ctx.db.shares(ctx.guildId, ctx.user.id, q.id);
    if (owned <= 0) return `You don't own any ${q.id}.`;

    const raw = String(args.amount || '').toLowerCase();
    const n = raw === 'all' ? owned : Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      return `Amount has to be a whole number above 0, or "all". Example: \`${config.prefix}sell ${q.id} all\``;
    }
    if (n > owned) return `You only own ${owned} ${q.id}.`;

    const gain = n * q.priceCents;
    ctx.db.tx(() => {
      ctx.db.addShares(ctx.guildId, ctx.user.id, q.id, -n);
      ctx.db.addCash(ctx.guildId, ctx.user.id, gain);
      ctx.db.logTrade(ctx.guildId, ctx.user.id, q.id, -n, q.priceCents);
    });

    return {
      embeds: [{
        title: `Sold ${n} ${q.id}`,
        description: `${n} × ${money(q.priceCents)} = **${poly(gain)}**\nYou still own ${owned - n} ${q.id}.`,
        color: config.color
      }]
    };
  }
};
