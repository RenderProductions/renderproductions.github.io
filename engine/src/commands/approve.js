const config = require('../config');
const co = require('../companies');

module.exports = {
  name: 'approve',
  description: 'Mods: approve a new company',
  usage: '<ticker>',
  modOnly: true,
  options: [{ name: 'ticker', type: 'string', description: 'The company to approve', required: true }],

  async run(ctx, args) {
    if (!co.approvalsConfigured()) return '⚙️ Company approvals aren\'t set up yet. Add BOT_OWNER_ID or HOME_GUILD_ID to the bot\'s .env.';
    if (!co.canApprove(ctx)) return '🚫 Only Render Room mods can approve companies.';
    const c = co.get(ctx.db, args.ticker);
    if (!c || c.status !== 'pending') return `No company called ${String(args.ticker || '').toUpperCase()} is waiting for approval. Try \`${config.prefix}review\`.`;

    co.approve(ctx.db, c.ticker);
    if (ctx.client) {
      ctx.client.users.fetch(c.owner_id)
        .then((u) => u.send(`🎉 **${c.name}** (${c.ticker}) was approved! It's open for business. See it with \`${config.prefix}company\`.`))
        .catch(() => {});
    }
    return `✅ Approved **${c.name}** (${c.ticker}). It's now a private Startup.`;
  }
};
