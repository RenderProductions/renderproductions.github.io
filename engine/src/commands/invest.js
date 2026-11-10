const config = require('../config');
const co = require('../companies');
const { money, parsePolygons } = require('../format');

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
    const amt = raw === 'all' ? p.cash : parsePolygons(raw);
    if (amt === null) return `🏢 Usage: \`${P}invest <amount>\`, for example \`${P}invest 500\`.`;
    if (amt <= 0) return "🏢 You don't have anything to invest.";
    if (p.cash < amt) return `🏢 You only have ${money(p.cash)} Polygons.`;

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -amt);
      co.addRevenue(ctx.db, c.ticker, amt);
    });
    return `🏢 You put **${money(amt)} Polygons** into **${c.name}**. Treasury: **${money(c.treasury + amt)}**.`;
  }
};
