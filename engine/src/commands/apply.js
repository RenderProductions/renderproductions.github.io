const config = require('../config');
const jobs = require('../jobs');

module.exports = {
  name: 'apply',
  description: 'Join a company as an Intern',
  usage: '<ticker>',
  options: [{ name: 'ticker', type: 'string', description: 'Company to work for, e.g. NACH', required: true }],

  async run(ctx, args) {
    const t = String(args.ticker || '').toUpperCase();
    const c = jobs.COMPANIES[t];
    if (!c) return `❌ Pick a company: \`${config.prefix}apply RRM\`, \`NACH\`, \`BLU\`, \`BNW\` or \`BSTG\`.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.job) return `❌ You already work at **${p.job}**. Use \`${config.prefix}quit\` first.`;

    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: t, shifts: 0, hired_at: Date.now() });
    return `💼 Welcome to **${c.name}**! You start as an **Intern** on ${c.role}.\n` +
      `Use \`${config.prefix}work\` to clock in. Pay follows the ${t} stock price, so root for it.`;
  }
};
