// Rebuilt from the shop's description (the BDFD r!settitle code wasn't in the export).
// Buying a Title in the shop gives one credit; setting the title uses it.
const config = require('../config');

const MAX_LENGTH = 32;

module.exports = {
  name: 'settitle',
  description: 'Set your custom title (buy a Title in the shop first)',
  usage: '<text>',
  options: [{ name: 'text', type: 'string', description: 'Your title, up to 32 characters', required: true }],

  async run(ctx, args) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (!p.title_credit) return `🏷️ You need to buy a **Title** first. Check \`${config.prefix}shop\`.`;

    // No formatting characters, line breaks, or mentions in titles
    const text = String(args.text || '').replace(/[*_~`|>\\\n\r]/g, '').replace(/@/g, '').replace(/\s+/g, ' ').trim();
    if (!text) return `🏷️ Usage: \`${config.prefix}settitle <text>\`, for example \`${config.prefix}settitle Nacho Baron\`.`;
    if (text.length > MAX_LENGTH) return `🏷️ That's too long. Titles can be up to ${MAX_LENGTH} characters.`;

    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { title: text, title_credit: 0 });
    return `🏷️ Your title is now *${text}*. It shows on your \`${config.prefix}balance\`.`;
  }
};
