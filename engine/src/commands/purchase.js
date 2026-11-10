// Buys an item into your inventory. Use it later with r!use.
const config = require('../config');
const receipts = require('../receipts');
const shop = require('../shop');
const { money, have, amt, relTime } = require('../format');

module.exports = {
  name: 'purchase',
  aliases: ['buyitem'],
  description: 'Buy a shop item into your inventory',
  usage: '<item>',
  options: [{ name: 'item', type: 'string', description: 'coffee, overtime, mystery, resume, or title', required: true }],

  async run(ctx, args) {
    const id = String(args.item || '').trim().toLowerCase();
    const item = shop.ITEMS[id];
    if (!item) return `🛒 Which item? Try \`${config.prefix}purchase <item>\`: ${Object.keys(shop.ITEMS).join(', ')}.`;

    const since = shop.restock(ctx.db, Date.now(), ctx.random);
    const next = relTime(since + shop.RESTOCK_MS);
    const cost = shop.price(ctx.db, id);
    const p = ctx.db.player(ctx.guildId, ctx.user);

    if (ctx.db.stock(id) <= 0) return `${item.emoji} **${item.name}** is sold out. Restocks ${next}.`;
    if (ctx.db.boughtThisRestock(ctx.guildId, ctx.user.id, id, since)) {
      return `${item.emoji} You already bought a **${item.name}** this restock. Restocks ${next}.`;
    }
    if (p.cash < cost) return `Not enough Polygons. **${item.name}** costs ${amt(cost)} and you have ${have(p.cash)}.`;

    const owned = ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      ctx.db.setStock(id, ctx.db.stock(id) - 1);
      ctx.db.recordBuy(ctx.guildId, ctx.user.id, id, since);
      ctx.db.addItem(ctx.guildId, ctx.user.id, id, 1);
      return ctx.db.itemCount(ctx.guildId, ctx.user.id, id);
    });

    receipts.send(ctx, { title: `Bought a ${item.name}`, lines: [
      ['Item', `${item.emoji} ${item.name}`], ['Price', amt(cost)], ['Polygons left', have(p.cash - cost)], ['In your inventory', owned]] });
    const how = id === 'title' ? `\`${config.prefix}settitle <text>\`` : `\`${config.prefix}use ${id}\``;
    return `${item.emoji} Bought a **${item.name}** for ${amt(cost)}. You have ${owned} in your inventory. Use it with ${how}.`;
  }
};
