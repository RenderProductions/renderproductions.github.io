// Rebuilt from the shop's item descriptions (the BDFD r!purchase code wasn't in the export).
const config = require('../config');
const shop = require('../shop');
const { money, relTime } = require('../format');

module.exports = {
  name: 'purchase',
  description: 'Buy an item from the shop',
  usage: '<item>',
  options: [{ name: 'item', type: 'string', description: 'coffee, overtime, mystery, resume, or title', required: true }],

  async run(ctx, args) {
    const id = String(args.item || '').trim().toLowerCase();
    const item = shop.ITEMS[id];
    const names = Object.keys(shop.ITEMS).join(', ');
    if (!item) return `🛒 Which item? Try \`${config.prefix}purchase <item>\`: ${names}.`;

    const since = shop.restock(ctx.db);
    const next = relTime(since + shop.RESTOCK_MS);
    const p = ctx.db.player(ctx.guildId, ctx.user);

    if (ctx.db.stock(id) <= 0) return `${item.emoji} **${item.name}** is sold out. Restocks ${next}.`;
    if (ctx.db.boughtThisRestock(ctx.guildId, ctx.user.id, id, since)) {
      return `${item.emoji} You already bought a **${item.name}** this restock. Restocks ${next}.`;
    }
    if (p.cash < item.price) return `Not enough Polygons. **${item.name}** costs ${money(item.price)} and you have ${money(p.cash)}.`;

    // Item-specific checks, so nobody wastes Polygons
    if (id === 'overtime' && p.overtime) return '⏰ You already have Overtime queued for your next shift.';
    if (id === 'resume' && !p.job) return `📄 You don't have a job to quit. Try \`${config.prefix}apply <ticker>\`.`;
    if (id === 'title' && p.title_credit) return `🏷️ You already have a Title waiting. Set it with \`${config.prefix}settitle <text>\`.`;

    const random = ctx.random || Math.random;
    const result = ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -item.price);
      ctx.db.setStock(id, ctx.db.stock(id) - 1);
      ctx.db.recordBuy(ctx.guildId, ctx.user.id, id, since);

      if (id === 'coffee') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { last_work: 0 });
        return `☕ Fresh coffee! Your work cooldown is reset. Go \`${config.prefix}work\`.`;
      }
      if (id === 'overtime') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { overtime: 1 });
        return '⏰ Overtime approved! Your next shift pays double.';
      }
      if (id === 'resume') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { hired_at: 0 });
        return `📄 Resume polished. You can \`${config.prefix}quit\` right away.`;
      }
      if (id === 'title') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { title_credit: 1 });
        return `🏷️ Title bought! Set it with \`${config.prefix}settitle <text>\`.`;
      }
      // Mystery: 5% jackpot, 25% Overtime pass (or Polygons if you already have one), else 40-160 Polygons
      const roll = random();
      if (roll < 0.05) {
        ctx.db.addCash(ctx.guildId, ctx.user.id, 750_00);
        return '🎁 ✨ **JACKPOT!** The box had **750.00 Polygons** in it!';
      }
      if (roll < 0.30 && !p.overtime) {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { overtime: 1 });
        return '🎁 An **Overtime pass**! Your next shift pays double.';
      }
      const prize = (40 + Math.floor(random() * 121)) * 100;
      ctx.db.addCash(ctx.guildId, ctx.user.id, prize);
      return `🎁 The box had **${money(prize)} Polygons** in it.`;
    });

    return `${result}\nPaid ${money(item.price)} Polygons.`;
  }
};
