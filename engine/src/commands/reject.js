const config = require('../config');
const co = require('../companies');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'reject',
  description: 'Mods: reject a new company (refunds the founder)',
  usage: '<ticker> [reason]',
  modOnly: true,
  options: [
    { name: 'ticker', type: 'string', description: 'The company to reject', required: true },
    { name: 'reason', type: 'string', description: 'Why (sent to the founder)' }
  ],

  async run(ctx, args) {
    if (!co.approvalsConfigured()) return '⚙️ Company approvals aren\'t set up yet. Add BOT_OWNER_ID or HOME_GUILD_ID to the bot\'s .env.';
    if (!co.canApprove(ctx)) return '🚫 Only Render Room mods can reject companies.';
    const c = co.get(ctx.db, args.ticker);
    if (!c || c.status !== 'pending') return `No company called ${String(args.ticker || '').toUpperCase()} is waiting for approval. Try \`${config.prefix}review\`.`;

    const reason = String(args.reason || '').trim().slice(0, 200);
    co.reject(ctx.db, c.ticker, reason);
    if (ctx.client) {
      ctx.client.users.fetch(c.owner_id)
        .then((u) => u.send(`🏢 **${c.name}** (${c.ticker}) wasn't approved${reason ? `: ${reason}` : '.'} ` +
          `Your ${amt(co.LEVELS[0].cost)} was refunded. You can try again with a different name.`))
        .catch(() => {});
    }
    return `❌ Rejected **${c.name}** (${c.ticker}). The founder got their ${amt(co.LEVELS[0].cost)} back.`;
  }
};
