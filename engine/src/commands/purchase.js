// Buys an item into your inventory. Use it later with r!use.
const config = require('../config');
const reserve = require('../reserve');
const receipts = require('../receipts');
const shop = require('../shop');
const { money, have, amt, relTime } = require('../format');

module.exports = {
  name: 'purchase',
  aliases: ['buyitem'],
  description: 'Buy a shop item into your inventory',
  usage: '<item>',
  options: [{ name: 'item', type: 'string', description: 'The item, like coffee, rocket fuel, or the collectible of the week', required: true }],

  async run(ctx, args) {
    const id = shop.find(args.item);
    const item = id && shop.any(id);
    if (!item) return `🛒 Which item? See \`${config.prefix}shop\`, then \`${config.prefix}purchase <item>\`.`;

    const hourly = shop.restock(ctx.db, Date.now(), ctx.random);
    const col = shop.isCollectible(id);
    const say = (kind) => `\n-# ${shop.marquez(kind, ctx.random || Math.random)}`;
    if (col && shop.collectibleOfWeek() !== id) return `🗃️ Marquez doesn't have **${item.name}** this week. Check \`${config.prefix}shop\` for this week's collectible.${say('notThisWeek')}`;
    // Collectibles are one per player per week; everything else one per restock
    const since = col ? Math.floor(Date.now() / shop.WEEK_MS) * shop.WEEK_MS : hourly;
    const next = col ? relTime(since + shop.WEEK_MS) : relTime(hourly + shop.RESTOCK_MS);
    const cost = shop.price(ctx.db, id);
    const p = ctx.db.player(ctx.guildId, ctx.user);

    if (ctx.db.stock(id) <= 0) return `${item.emoji} **${item.name}** is sold out. Restocks ${next}.${say('soldOut')}`;
    if (ctx.db.boughtThisRestock(ctx.guildId, ctx.user.id, id, since)) {
      return `${item.emoji} You already bought a **${item.name}** this restock. Restocks ${next}.${say('once')}`;
    }
    if (p.cash < cost) return `Not enough Polygons. **${item.name}** costs ${amt(cost)} and you have ${have(p.cash)}.${say('broke')}`;

    const owned = ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      reserve.take(ctx.db, cost);
      ctx.db.setStock(id, ctx.db.stock(id) - 1);
      ctx.db.recordBuy(ctx.guildId, ctx.user.id, id, since);
      ctx.db.addItem(ctx.guildId, ctx.user.id, id, 1);
      return ctx.db.itemCount(ctx.guildId, ctx.user.id, id);
    });

    receipts.send(ctx, { title: `Bought a ${item.name}`, lines: [
      ['Item', `${item.emoji} ${item.name}`], ['Price', amt(cost)], ['Polygons left', have(p.cash - cost)], ['In your inventory', owned]] });
    const how = id === 'title' ? `Use it with \`${config.prefix}settitle <text>\`.` : col ? 'It\'s on your profile now. Marquez won\'t restock this one for a while.'
      : item.passive ? 'It works on its own while it\'s in your inventory.' : `Use it with \`${config.prefix}use ${id}\`.`;
    return `${item.emoji} Bought ${col ? '' : 'a '}**${item.name}** for ${amt(cost)}. You have ${owned} in your inventory. ${how}${say('thanks')}`;
  }
};
