const config = require('../config');
const shop = require('../shop');
const effects = require('../effects');

module.exports = {
  name: 'inventory',
  aliases: ['inv', 'bag'],
  description: 'Show the items you own',
  usage: '[@user]',
  options: [{ name: 'user', type: 'user', description: 'Whose inventory to show (default: yours)' }],

  async run(ctx, args) {
    const P = config.prefix;
    const target = args.user || ctx.user;

    // Easter egg: the house has infinite everything
    const botId = (ctx.client && ctx.client.user && ctx.client.user.id) || config.clientId;
    if (target.id === botId) {
      return {
        embeds: [{
          title: `🎒 ${target.username}'s inventory`,
          description: Object.values(shop.ITEMS).map((it) => `${it.emoji} **${it.name}** × ∞`).join('\n') +
            '\n\n🏷️ Title: *The House*\n*It never runs out. It never needs to.*',
          color: config.color
        }]
      };
    }
    if (target.bot) return `🤖 **${target.username}** is a bot. Bots don't carry anything.`;

    const p = ctx.db.player(ctx.guildId, target);
    const all = ctx.db.inventory(ctx.guildId, target.id);
    const items = all.filter((r) => shop.ITEMS[r.item]);
    const cols = all.filter((r) => shop.COLLECTIBLES[r.item]);

    const lines = items.map((r) => {
      const it = shop.ITEMS[r.item];
      const how = r.item === 'title' ? `\`${P}settitle <text>\`` : it.passive ? '*works on its own*' : `\`${P}use ${r.item}\``;
      return `${it.emoji} **${it.name}** × ${r.qty} · ${how}`;
    });
    const status = [];
    if (p.overtime) status.push('⏰ Overtime is queued for the next shift.');
    const fx = effects.get(ctx.db, ctx.guildId, target.id);
    if (fx.chip) status.push(`💿 Platinum Chip: ${fx.chip} game${fx.chip === 1 ? '' : 's'} left`);
    if (fx.stopwatch) status.push(`⏱️ Stopwatch: ${fx.stopwatch} shift${fx.stopwatch === 1 ? '' : 's'} left`);
    if (fx.fuel) status.push('⛽ Rocket Fuel is in the tank');
    if (fx.wrap) status.push('🎀 Your next gift is wrapped (no fee)');
    if ((fx.divBoostUntil || 0) > Date.now()) status.push(`📈 Dividend Booster until <t:${Math.floor(fx.divBoostUntil / 1000)}:t>`);
    if (cols.length) status.push('**Collectibles**\n' + cols.map((r) => `${shop.COLLECTIBLES[r.item].emoji} **${shop.COLLECTIBLES[r.item].name}**${r.qty > 1 ? ` × ${r.qty}` : ''}`).join('\n'));
    if (p.title) status.push(`🏷️ Title: *${p.title}*`);

    return {
      embeds: [{
        title: `🎒 ${target.username}'s inventory`,
        description: (lines.join('\n') || `Empty. Check \`${P}shop\`.`) + (status.length ? '\n\n' + status.join('\n') : ''),
        color: config.color
      }]
    };
  }
};
