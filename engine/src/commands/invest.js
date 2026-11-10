const config = require('../config');
const co = require('../companies');
const { money, have, amt, parsePolygons } = require('../format');

module.exports = {
  name: 'invest',
  description: "Add your Polygons to your company's treasury",
  usage: '<amount or all>',
  options: [{ name: 'amount', type: 'string', description: 'How much to put in, or "all"', required: true }],

  async run(ctx, args) {
    const P = config.prefix;
    const c = co.ownedBy(ctx.db, ctx.user.id);
    if (!co.alive(c)) return c ? '🏢 Your company is still waiting for approval.' : `🏢 You don't run a company. Start one with \`${P}found\`.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    const raw = String(args.amount || '').trim().toLowerCase();
    const put = raw === 'all' ? p.cash : parsePolygons(raw);
    if (put === null) return `🏢 Usage: \`${P}invest <amount>\`, for example \`${P}invest 500\`.`;
    if (put <= 0) return "🏢 You don't have anything to invest.";
    if (p.cash < put) return `🏢 You only have ${have(p.cash)}.`;

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -put);
      co.addRevenue(ctx.db, c.ticker, put);
    });
    return `🏢 You put **${amt(put)}** into **${c.name}**. Treasury: **${have(c.treasury + put)}**.`;
  }
};
