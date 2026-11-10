const config = require('../config');
const shop = require('../shop');
const { money, have, amt, relTime } = require('../format');
const { button, rows } = require('../buttons');

module.exports = {
  name: 'shop',
  description: 'Show shop items, stock, and the next restock',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const since = shop.restock(ctx.db, Date.now(), ctx.random);
    const items = Object.entries(shop.ITEMS).map(([id, it]) =>
      `${it.emoji} **${it.name}**: ${amt(shop.price(ctx.db, id))} | Stock: ${ctx.db.stock(id)}\n${it.desc}`);

    return {
      embeds: [{
        title: '🛒 Rend-Conomy Shop',
        description: `You have **${have(p.cash)}**. One of each item per player per restock.\n\n` +
          `${items.join('\n\n')}\n\nRestocks ${relTime(since + shop.RESTOCK_MS)}. ` +
          `Buy with \`${config.prefix}purchase <item>\`, then \`${config.prefix}use <item>\` whenever you like.`,
        color: config.color
      }],
      components: rows(Object.entries(shop.ITEMS).map(([id, it]) => button(`${it.emoji} ${it.name}`, `shop:buy:${id}`, 'grey')))
    };
  },

  // Anyone can press a Buy button; it buys for whoever pressed it, and only they see the receipt
  buttonPrefix: 'shop',
  async onButton(ctx, [action, item]) {
    if (action !== 'buy') return null;
    const out = await require('./purchase').run(ctx, { item });
    return { reply: out };
  }
};
