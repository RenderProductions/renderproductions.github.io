// Sets your custom title, using up a Title from your inventory.
const config = require('../config');

const MAX_LENGTH = 32;

module.exports = {
  name: 'settitle',
  description: 'Set your custom title (uses a Title from your inventory)',
  usage: '<text>',
  options: [{ name: 'text', type: 'string', description: 'Your title, up to 32 characters', required: true }],

  async run(ctx, args) {
    ctx.db.player(ctx.guildId, ctx.user);
    if (ctx.db.itemCount(ctx.guildId, ctx.user.id, 'title') <= 0) {
      return `🏷️ You need a **Title** in your inventory first. Check \`${config.prefix}shop\`.`;
    }

    // No formatting characters, line breaks, or mentions in titles
    const text = String(args.text || '').replace(/[*_~`|>\\\n\r]/g, '').replace(/@/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return `🏷️ Usage: \`${config.prefix}settitle <text>\`, for example \`${config.prefix}settitle Nacho Baron\`.`;
    if (text.length > MAX_LENGTH) return `🏷️ That's too long. Titles can be up to ${MAX_LENGTH} characters.`;

    ctx.db.tx(() => {
      ctx.db.addItem(ctx.guildId, ctx.user.id, 'title', -1);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { title: text });
    });
    return `🏷️ Your title is now *${text}*. It shows on your \`${config.prefix}balance\`.`;
  }
};
