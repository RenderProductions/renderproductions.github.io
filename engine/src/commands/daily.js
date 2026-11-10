const config = require('../config');
const loans = require('../loans');
const { money, have, amt, relTime, day, nextMidnight } = require('../format');

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

    const g = ctx.db.tx(() => {
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { daily_day: today });
      return loans.garnish(ctx.db, ctx.guildId, ctx.user.id, config.dailyAmount); // overdue loans take half
    });
    const loanLine = g.taken ? '\n' + g.paidTo.map((x) => `🏦 ${amt(x.cents)} went to **${x.name}** for an overdue loan.`).join('\n') : '';

    return {
      embeds: [{
        title: 'Daily claimed',
        description: `You received **${amt(config.dailyAmount)}**.\nPolygons now: **${have(p.cash + g.kept)}**${loanLine}`,
        color: config.color
      }]
    };
  }
};
