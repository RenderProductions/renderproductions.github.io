const config = require('../config');
const jobs = require('../jobs');
const co = require('../companies');

// A living player company can hire too
function playerCompany(ctx, t) {
  const pc = co.get(ctx.db, t);
  return co.alive(pc) ? { name: pc.name, role: 'the team', player: true } : null;
}

module.exports = {
  name: 'apply',
  description: 'Join a company as an Intern',
  usage: '<ticker>',
  options: [{ name: 'ticker', type: 'string', description: 'Company to work for, e.g. NACH', required: true }],

  async run(ctx, args) {
    const t = String(args.ticker || '').toUpperCase();
    const c = jobs.COMPANIES[t] || playerCompany(ctx, t);
    if (!c) return `❌ Pick a company: \`${config.prefix}apply RRM\`, \`NACH\`, \`BLU\`, \`BNW\` or \`BSTG\`, or a player company from \`${config.prefix}exchange\`.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.job) return `❌ You already work at **${p.job}**. Use \`${config.prefix}quit\` first.`;

    // Hiring freezes: nobody is hiring while the market crashes, and a bankrupt company can't hire at all
    const m = await ctx.market.get();
    if (m && m.crash && (m.crash.phase === 'crash' || m.crash.phase === 'tremor')) {
      return `🧊 **Hiring freeze.** Nobody's hiring while the market crashes. Try a \`${config.prefix}gig\` until the recovery starts.`;
    }
    if (!c.player && m && m.statuses && m.statuses[t] === 'bankrupt') {
      return `📦 **${c.name}** is bankrupt and isn't hiring. Try another company, or a \`${config.prefix}gig\`.`;
    }

    const career = ctx.db.career(ctx.guildId, ctx.user.id, t);
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: t, shifts: career.shifts, hired_at: Date.now() });
    const rank = jobs.rankName(t, career.rank);
    const payNote = c.player ? `Pay grows as ${t} levels up, and every shift earns the company money too.`
      : `Pay follows the ${t} stock price, so root for it.`;
    const hello = career.shifts
      ? `💼 Welcome back to **${c.name}**! You're still a **${rank}**, with ${career.shifts} shifts on record.\n`
      : `💼 Welcome to **${c.name}**! You start as a **${rank}** on ${c.role}.\n`;
    return hello + `Use \`${config.prefix}work\` to clock in. ${payNote} A performance review every ${jobs.REVIEW.every} shifts decides promotions.`;
  }
};
