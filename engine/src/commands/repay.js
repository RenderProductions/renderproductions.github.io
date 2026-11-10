const config = require('../config');
const { money, parsePolygons } = require('../format');

module.exports = {
  name: 'repay',
  description: 'Pay TODD back',
  usage: '<amount or all>',
  options: [{ name: 'amount', type: 'string', description: 'How much to pay, or "all"', required: true }],

  async run(ctx, args) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt <= 0) return `🖥️ You don't OWE me anything?! ...Do you WANT to? (\`${config.prefix}bailout\`)`;

    const arg = String(args.amount || '').trim().toLowerCase();
    let amt;
    if (arg === 'all') {
      amt = Math.min(p.cash, p.debt); // pay as much as you can, up to the whole debt
    } else {
      amt = parsePolygons(arg);
      if (amt === null) {
        return `🖥️ HOW MUCH?! Try \`${config.prefix}repay 100\` or \`${config.prefix}repay all\`. You owe **${money(p.debt)}**.`;
      }
      amt = Math.min(amt, p.debt);
    }
    if (amt <= 0) return `🖥️ You have NOTHING to give me?! Go \`${config.prefix}work\`!!`;
    if (p.cash < amt) return `🖥️ You only HAVE **${money(p.cash)} Polygons**! NICE try?!`;

    const left = p.debt - amt;
    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -amt);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { debt: left });
    });

    if (left <= 0) {
      return {
        embeds: [{
          title: '🖥️ DEBT CLEARED',
          description: `You paid **${money(amt)} Polygons**. ALL PAID?!?\n\nTODD will MISS you. Come BACK when you're BROKE again!!`,
          color: config.colorGood
        }]
      };
    }
    return {
      embeds: [{
        title: '🖥️ PAYMENT RECEIVED',
        description: `You paid **${money(amt)} Polygons**. THANK you?!\n\nStill owed: **${money(left)} Polygons**.\nTODD is PATIENT. TODD is SO patient.`,
        color: config.colorTodd
      }]
    };
  }
};
