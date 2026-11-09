const config = require('../config');
const { poly, money, pct } = require('../format');

module.exports = {
  name: 'portfolio',
  description: 'Show your cash, shares, and net worth',
  aliases: ['bal', 'balance', 'pf'],
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const held = ctx.db.holdings(ctx.guildId, ctx.user.id);

    let m = null;
    try { m = await ctx.market.get(); } catch (e) { /* show cash even if prices are down */ }

    let stockValue = 0;
    const lines = held.map((h) => {
      const q = m && ctx.market.quote(m, h.ticker);
      if (!q) return `\`${h.ticker}\` × ${h.shares} · price unavailable`;
      const value = h.shares * q.priceCents;
      stockValue += value;
      return `\`${q.id}\` × ${h.shares} · ${money(value)} (${pct(q.change)})`;
    });

    return {
      embeds: [{
        title: `${ctx.user.username}'s portfolio`,
        color: config.color,
        fields: [
          { name: 'Cash', value: poly(p.cash), inline: true },
          { name: 'Stocks', value: poly(stockValue), inline: true },
          { name: 'Net worth', value: poly(p.cash + stockValue), inline: true },
          { name: 'Holdings', value: lines.join('\n') || 'No shares yet. Try `' + config.prefix + 'market`.' }
        ]
      }]
    };
  }
};
