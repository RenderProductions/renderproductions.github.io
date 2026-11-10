const config = require('../config');
const { money, relTime, day, nextMidnight } = require('../format');

module.exports = {
  name: 'daily',
  description: 'Claim your free daily Polygons (resets at midnight Eastern)',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const now = Date.now();
    const today = day(now);
    if (p.daily_day === today) {
      return `You already claimed your daily. Come back ${relTime(nextMidnight(now))}.`;
    }

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, config.dailyAmount);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { daily_day: today });
    });

    return {
      embeds: [{
        title: 'Daily claimed',
        description: `You received **${money(config.dailyAmount)}** Polygons.\nCash now: **${money(p.cash + config.dailyAmount)}** Polygons.`,
        color: config.color
      }]
    };
  }
};
