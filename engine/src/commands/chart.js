const config = require('../config');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'chart',
  description: 'Show a price chart for a company',
  usage: '<ticker>',
  options: [{ name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true }],

  async run(ctx, args) {
    const m = await ctx.market.get();
    const t = String(args.ticker || '').toUpperCase();
    const list = ctx.market.tickerList(m).replace(/, (\w+)$/, ' or $1');
    if (!t) return `Usage: ${config.prefix}chart TICKER. Try ${list}.`;
    if (!m) return 'The market is offline right now. Try again in a minute.';
    const q = ctx.market.quote(m, t);
    if (!q || !q.chart) return `No company called ${t}. Try ${list}.`;

    return {
      embeds: [{
        title: `${q.name} (${t})`,
        description: `**${amt(q.priceCents)}** · ${q.change}%\n${q.spark}`,
        image: { url: q.chart },
        footer: { text: 'Fictional prices · updates every few minutes' },
        color: config.color
      }]
    };
  }
};
