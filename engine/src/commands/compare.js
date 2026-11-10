const config = require('../config');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'compare',
  description: 'Compare two companies side by side',
  usage: '<ticker> <ticker>',
  options: [
    { name: 'first', type: 'string', description: 'First ticker, e.g. RRM', required: true },
    { name: 'second', type: 'string', description: 'Second ticker, e.g. BLU', required: true }
  ],

  async run(ctx, args) {
    const a = String(args.first || '').toUpperCase();
    const b = String(args.second || '').toUpperCase();
    if (!b) return `Usage: ${config.prefix}compare TICKER TICKER, for example ${config.prefix}compare RRM BLU`;
    const m = await ctx.market.get();
    if (!m) return 'The market is offline right now. Try again in a minute.';
    const list = ctx.market.tickerList(m).replace(/, (\w+)$/, ' or $1');
    const qa = ctx.market.quote(m, a);
    const qb = ctx.market.quote(m, b);
    if (!qa) return `No company called ${a}. Try ${list}.`;
    if (!qb) return `No company called ${b}. Try ${list}.`;

    const field = (q) => ({ name: `${q.name} (${q.id})`, value: `**${amt(q.priceCents)}** · ${q.change}%\n${q.spark || ' '}` });
    return {
      embeds: [{
        title: `${a} vs ${b}`,
        fields: [field(qa), field(qb)],
        footer: { text: 'Fictional prices · 24-hour change' },
        color: config.color
      }]
    };
  }
};
