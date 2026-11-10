const config = require('../config');
const shop = require('../shop');

module.exports = {
  name: 'inventory',
  aliases: ['inv', 'bag'],
  description: 'Show the items you own',
  usage: '[@user]',
  options: [{ name: 'user', type: 'user', description: 'Whose inventory to show (default: yours)' }],

  async run(ctx, args) {
    const P = config.prefix;
    const target = args.user || ctx.user;
    const p = ctx.db.player(ctx.guildId, target);
    const items = ctx.db.inventory(ctx.guildId, target.id).filter((r) => shop.ITEMS[r.item]);

    const lines = items.map((r) => {
      const it = shop.ITEMS[r.item];
      const how = r.item === 'title' ? `${P}settitle <text>` : `${P}use ${r.item}`;
      return `${it.emoji} **${it.name}** × ${r.qty} · \`${how}\``;
    });
    const status = [];
    if (p.overtime) status.push('⏰ Overtime is queued for the next shift.');
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
