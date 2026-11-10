const config = require('../config');
const co = require('../companies');
const { have, amt } = require('../format');
const { button, rows } = require('../buttons');

// Checks whether the player's company can go public. Returns { c } or { error }.
function check(ctx) {
  const P = config.prefix;
  const c = co.ownedBy(ctx.db, ctx.user.id);
  if (!co.alive(c)) return { error: c ? '🏢 Your company is still waiting for approval.' : `🏢 You don't run a company. Start one with \`${P}found\`.` };
  if (c.status === 'public') return { error: `📈 **${c.name}** is already public.` };
  if (c.level < co.RULES.ipoLevel) {
    return { error: `🏢 Only a **${co.LEVELS[co.RULES.ipoLevel - 1].name}** or bigger can go public. You're a ${co.level(c).name}.` };
  }
  if (c.strikes > 0) return { error: '🏢 No exchange will list a company that is behind on upkeep.' };
  if (c.treasury < co.RULES.listingFee) {
    return { error: `🏢 Listing costs **${amt(co.RULES.listingFee)}** from the treasury, which has ${have(c.treasury)}.` };
  }
  return { c };
}

module.exports = {
  name: 'ipo',
  description: 'Take your company public so anyone can invest',
  options: [],
  buttonPrefix: 'ipo',

  // Asks first, since going public can't be undone
  async run(ctx) {
    const { c, error } = check(ctx);
    if (error) return error;
    const opening = co.fairValue({ ...c, treasury: c.treasury - co.RULES.listingFee });
    return {
      content: `🔔 Take **${c.name} (${c.ticker})** public?\n` +
        `• The listing fee is **${amt(co.RULES.listingFee)}** from the treasury.\n` +
        `• Shares open at about **${amt(Math.round(opening * 100))}**, and anyone can trade them except you.\n` +
        '• Once you\'re public, there\'s **no going back**.',
      components: rows([
        button('Go public', `ipo:${ctx.user.id}:yes`, 'green'),
        button('Not yet', `ipo:${ctx.user.id}:no`, 'grey')
      ])
    };
  },

  async onButton(ctx, [userId, choice]) {
    if (ctx.user.id !== userId) return { reply: "That's not your company." };
    if (choice !== 'yes') return { update: { content: '🏢 Staying private for now.', components: [] } };
    const { c, error } = check(ctx);
    if (error) return { update: { content: error, components: [] } };

    const price = co.ipo(ctx.db, c.ticker);
    const f = co.RULES.float;
    const P = config.prefix;
    return {
      update: {
        content: `🔔 **${c.name} (${c.ticker}) IS PUBLIC!** Opening price: **${amt(Math.round(price * 100))}**.\n` +
          `${f} shares are up for grabs, and money from those first ${f} sales goes straight into the treasury. ` +
          `Anyone can \`${P}buy ${c.ticker} <amount>\`, except you.`,
        components: []
      }
    };
  }
};
