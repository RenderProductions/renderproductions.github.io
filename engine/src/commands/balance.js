const config = require('../config');
const { money } = require('../format');
const econ = require('../economy');

module.exports = {
  name: 'balance',
  aliases: ['bal', 'portfolio', 'pf'],
  description: 'Show cash, shares, debt, and net worth',
  usage: '[@user]',
  options: [
    { name: 'user', type: 'user', description: 'Whose portfolio to show (default: yours)' }
  ],

  async run(ctx, args) {
    const target = args.user || ctx.user;
    const m = await ctx.market.get();
    if (!m) return 'The market is offline right now. Try again in a minute.';

    const p = ctx.db.player(ctx.guildId, target);
    let stocks = 0;
    const fields = m.companies.map((c) => {
      const q = ctx.market.quote(m, c.id);
      const owned = econ.shares(ctx, m, c.id, target.id);
      const value = owned * q.priceCents;
      stocks += value;
      return { name: `${q.name} (${q.id})`, value: `${owned} shares, worth ${money(value)}` };
    });

    const pcv = econ.playerCompanyValue(ctx, target.id);
    stocks += pcv.total;
    for (const r of pcv.rows) fields.push({ name: `🏢 ${r.name} (${r.ticker})`, value: `${r.shares} shares, worth ${money(r.value)}` });

    const titleLine = p.title ? `🏷️ *${p.title}*\n` : '';
    const debtLine = p.debt > 0 ? `\n🖥️ Owed to TODD: **${money(p.debt)}** Polygons` : '';

    return {
      embeds: [{
        title: `${target.username}'s portfolio`,
        description: `${titleLine}Cash: **${money(p.cash)}** Polygons\nStocks: **${money(stocks)}** Polygons${debtLine}\n` +
          `Net worth: **${money(p.cash + stocks - p.debt)}** Polygons`,
        fields,
        footer: { text: 'Prices as of' },
        timestamp: m.updated,
        color: config.color
      }]
    };
  }
};
