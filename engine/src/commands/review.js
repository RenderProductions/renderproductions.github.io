const config = require('../config');
const co = require('../companies');
const { relTime } = require('../format');

module.exports = {
  name: 'review',
  description: 'Mods: list companies waiting for approval',
  modOnly: true,
  options: [],

  async run(ctx) {
    const P = config.prefix;
    if (!co.approvalsConfigured()) return '⚙️ Company approvals aren\'t set up yet. Add BOT_OWNER_ID or HOME_GUILD_ID to the bot\'s .env.';
    if (!co.canApprove(ctx)) return '🚫 Only Render Room mods can review companies.';
    const pending = co.list(ctx.db, ['pending']);
    if (!pending.length) return '✅ No companies waiting for approval.';
    return {
      embeds: [{
        title: '🏢 Waiting for approval',
        description: pending.map((c) => `**${c.ticker}** · ${c.name} · by ${c.owner_name || c.owner_id} · filed ${relTime(c.created_at)}`).join('\n') +
          `\n\n\`${P}approve <ticker>\` or \`${P}reject <ticker> <reason>\``,
        color: config.color
      }]
    };
  }
};
