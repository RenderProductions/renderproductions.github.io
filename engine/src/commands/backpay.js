// r!backpay: achievements now pay out. Ones you unlocked before Payday are paid here, once, in this server.
// Back pay is a one-time stimulus: it doesn't come out of the Polygon Reserve.
const config = require('../config');
const A = require('../achievements');
const { amt, have } = require('../format');

module.exports = {
  name: 'backpay',
  aliases: ['claim'],
  description: 'Claim Polygons for the achievements you unlocked before they paid out',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const b = A.backPay(ctx.db, ctx.user.id);
    if (b.claimed) return '💼 You already claimed your back pay. New achievements pay out the moment you unlock them.';
    if (!b.count) return `💼 No back pay for you. Every achievement you unlock from now on pays out right away (\`${P}achievements\`).`;
    const p = ctx.db.player(ctx.guildId, ctx.user);
    ctx.db.tx(() => {
      A.set(ctx, 'backpay_claimed', 1);
      ctx.db.addCash(ctx.guildId, ctx.user.id, b.cents);
    });
    return {
      embeds: [{
        title: '💼 Back pay claimed',
        description: `TODD found **${b.count}** achievement${b.count === 1 ? '' : 's'} you unlocked before they paid out.\n\n` +
          `You received **${amt(b.cents)}**.\nPolygons now: **${have(p.cash + b.cents)}**\n\n` +
          '-# Back pay is paid once, in the server you claim it in. New achievements pay out right away.',
        color: 0xffe600
      }]
    };
  }
};
