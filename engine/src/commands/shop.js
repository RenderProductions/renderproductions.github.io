const config = require('../config');
const shop = require('../shop');
const { money, relTime } = require('../format');

module.exports = {
  name: 'shop',
  description: 'Show shop items, stock, and the next restock',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const since = shop.restock(ctx.db, Date.now(), ctx.random);
    const items = Object.entries(shop.ITEMS).map(([id, it]) =>
      `${it.emoji} **${it.name}**: ${money(shop.price(ctx.db, id))} | Stock: ${ctx.db.stock(id)}\n${it.desc}`);

    return {
      embeds: [{
        title: '🛒 Rend-Conomy Shop',
        description: `You have **${money(p.cash)} Polygons**. One of each item per player per restock.\n\n` +
          `${items.join('\n\n')}\n\nRestocks ${relTime(since + shop.RESTOCK_MS)}. ` +
          `Buy with \`${config.prefix}purchase <item>\`, then \`${config.prefix}use <item>\` whenever you like.`,
        color: config.color
      }]
    };
  }
};
