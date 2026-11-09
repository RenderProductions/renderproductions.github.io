const config = require('../config');
const { poly, duration } = require('../format');

module.exports = {
  name: 'daily',
  description: 'Claim your free daily Polygons',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const now = Date.now();
    const readyAt = p.last_daily + config.dailyCooldownMs;
    if (now < readyAt) {
      return `You already claimed today. Come back in ${duration(readyAt - now)} (<t:${Math.floor(readyAt / 1000)}:R>).`;
    }

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, config.dailyAmount);
      ctx.db.setDaily(ctx.guildId, ctx.user.id, now);
    });

    return {
      embeds: [{
        title: 'Daily claimed',
        description: `+**${poly(config.dailyAmount)}**\nCash: ${poly(p.cash + config.dailyAmount)}`,
        color: config.color
      }]
    };
  }
};
