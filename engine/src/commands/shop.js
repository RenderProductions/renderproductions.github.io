const config = require('../config');
const shop = require('../shop');
const { money, relTime } = require('../format');

module.exports = {
  name: 'shop',
  description: 'Show shop items, stock, and the next restock',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const since = shop.restock(ctx.db);
    const items = Object.values(shop.ITEMS).map((it, i) => {
      const id = Object.keys(shop.ITEMS)[i];
      return `${it.emoji} **${it.name}**: ${money(it.price)} | Stock: ${ctx.db.stock(id)}\n${it.desc}`;
    });

    return {
      embeds: [{
        title: '🛒 Rend-Conomy Shop',
        description: `You have **${money(p.cash)} Polygons**. One of each item per player per restock.\n\n` +
          `${items.join('\n\n')}\n\nRestocks ${relTime(since + shop.RESTOCK_MS)}. Buy with \`${config.prefix}purchase <item>\`.`,
        color: config.color
      }]
    };
  }
};
