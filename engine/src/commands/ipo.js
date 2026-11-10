const config = require('../config');
const co = require('../companies');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'ipo',
  description: 'Take your company public so anyone can invest',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const c = co.ownedBy(ctx.db, ctx.user.id);
    if (!co.alive(c)) return c ? '🏢 Your company is still waiting for approval.' : `🏢 You don't run a company. Start one with \`${P}found\`.`;
    if (c.status === 'public') return `📈 **${c.name}** is already public.`;
    if (c.level < co.RULES.ipoLevel) {
      return `🏢 Only a **${co.LEVELS[co.RULES.ipoLevel - 1].name}** or bigger can go public. You're a ${co.level(c).name}.`;
    }
    if (c.strikes > 0) return '🏢 No exchange will list a company that is behind on upkeep.';
    if (c.treasury < co.RULES.listingFee) {
      return `🏢 Listing costs **${amt(co.RULES.listingFee)}** from the treasury, which has ${have(c.treasury)}.`;
    }

    const price = co.ipo(ctx.db, c.ticker);
    const f = co.RULES.float;
    return `🔔 **${c.name} (${c.ticker}) IS PUBLIC!** Opening price: **${amt(Math.round(price * 100))}**.\n` +
      `${f} shares are up for grabs, and money from those first ${f} sales goes straight into the treasury. ` +
      `Anyone can \`${P}buy ${c.ticker} <amount>\`, except you.`;
  }
};
