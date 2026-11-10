const config = require('../config');
const { money } = require('../format');

module.exports = {
  name: 'market',
  description: 'Show current prices',
  options: [],

  async run(ctx) {
    const m = await ctx.market.get();
    if (!m) return 'The market is offline right now. Try again in a minute.';

    const top = [m.market && m.market.text, m.crashText].filter(Boolean).join('\n');
    return {
      embeds: [{
        title: 'Rend-Conomy Market',
        description: `${top}\nPrices are fictional and update every few minutes. Change is over the last 24 hours.`,
        color: config.color,
        fields: [
          ...m.companies.map((c) => {
            const q = ctx.market.quote(m, c.id);
            return { name: `${q.name} (${q.id})`, value: `**${money(q.priceCents)}**  (${q.change}%)\n${q.spark || ' '}` };
          }),
          { name: 'View in detail at:', value: `${config.siteUrl}/rend-conomy` }
        ]
      }]
    };
  }
};
