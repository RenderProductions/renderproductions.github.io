// Moderators only (Manage Messages permission). Removes someone's custom title.
// Rebuilt from the site's command list (the BDFD code wasn't in the export).
const config = require('../config');

module.exports = {
  name: 'cleartitle',
  description: "Moderators only: remove someone's custom title",
  usage: '@user',
  modOnly: true,
  options: [{ name: 'user', type: 'user', description: 'Whose title to remove', required: true }],

  async run(ctx, args) {
    if (!ctx.isMod) return '🚫 Only moderators can clear titles.';
    const target = args.user;
    if (!target) return `Usage: \`${config.prefix}cleartitle @user\``;

    const p = ctx.db.player(ctx.guildId, target);
    if (!p.title) return `${target.username} doesn't have a title.`;
    ctx.db.updatePlayer(ctx.guildId, target.id, { title: null });
    return `🏷️ Removed **${target.username}**'s title.`;
  }
};
