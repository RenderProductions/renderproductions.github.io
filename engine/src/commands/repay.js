const config = require('../config');
const reserve = require('../reserve');
const { money, have, amt, parsePolygons } = require('../format');

module.exports = {
  name: 'repay',
  description: 'Pay TODD back',
  usage: '<amount or all>',
  options: [{ name: 'amount', type: 'string', description: 'How much to pay, or "all"', required: true }],

  async run(ctx, args) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt <= 0) return `🖥️ You don't OWE me anything?! ...Do you WANT to? (\`${config.prefix}bailout\`)`;

    const arg = String(args.amount || '').trim().toLowerCase();
    let paid;
    if (arg === 'all') {
      paid = Math.min(p.cash, p.debt); // pay as much as you can, up to the whole debt
    } else {
      paid = parsePolygons(arg);
      if (paid === null) {
        return `🖥️ HOW MUCH?! Try \`${config.prefix}repay 100\` or \`${config.prefix}repay all\`. You owe **${amt(p.debt)}**.`;
      }
      paid = Math.min(paid, p.debt);
    }
    if (paid <= 0) return `🖥️ You have NOTHING to give me?! Go \`${config.prefix}work\`!!`;
    if (p.cash < paid) return `🖥️ You only HAVE **${have(p.cash)}**! NICE try?!`;

    const left = p.debt - paid;
    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -paid);
      reserve.take(ctx.db, paid);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { debt: left });
    });

    if (left <= 0) {
      return {
        embeds: [{
          title: '🖥️ DEBT CLEARED',
          description: `You paid **${amt(paid)}**. ALL PAID?!?\n\nTODD will MISS you. Come BACK when you're BROKE again!!`,
          color: config.colorGood
        }]
      };
    }
    return {
      embeds: [{
        title: '🖥️ PAYMENT RECEIVED',
        description: `You paid **${amt(paid)}**. THANK you?!\n\nStill owed: **${amt(left)}**.\nTODD is PATIENT. TODD is SO patient.`,
        color: config.colorTodd
      }]
    };
  }
};
