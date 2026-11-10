const config = require('../config');
const co = require('../companies');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'upgrade',
  description: 'Level up your company (paid from its treasury)',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const c = co.ownedBy(ctx.db, ctx.user.id);
    if (!co.alive(c)) return c ? '🏢 Your company is still waiting for approval.' : `🏢 You don't run a company. Start one with \`${P}found\`.`;
    const next = co.nextLevel(c);
    if (!next) return `🏢 **${c.name}** is already a ${co.level(c).name}. That's the top.`;
    if (c.strikes > 0) return "🏢 You can't expand while you're behind on upkeep.";
    if (c.treasury < next.cost) {
      return `🏢 Becoming a **${next.name}** costs **${amt(next.cost)}** from the treasury, which has ${have(c.treasury)}. Try \`${P}invest\`.`;
    }

    co.update(ctx.db, c.ticker, { level: c.level + 1, treasury: c.treasury - next.cost });
    const extra = c.level + 1 === co.RULES.ipoLevel && c.status === 'private'
      ? `\nYou can go public now with \`${P}ipo\`.` : '';
    return `🎉 **${c.name}** is now a **${next.name}**! Upkeep is ${amt(next.upkeep)} a day and employees earn ${next.payMult}x.${extra}`;
  }
};
