const config = require('../config');
const jobs = require('../jobs');
const { relTime } = require('../format');

module.exports = {
  name: 'quit',
  description: 'Leave your job (24h after hiring, resets your rank)',
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (!p.job) return `❌ You don't have a job. Try \`${config.prefix}apply <ticker>\`.`;
    const free = p.hired_at + jobs.QUIT_LOCK_MS;
    if (Date.now() < free) {
      return `⏳ You just started at **${p.job}**. You can quit ${relTime(free)}, or buy a Resume in \`${config.prefix}shop\`.`;
    }

    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: null, shifts: 0, overtime: 0 });
    return `👋 You quit **${p.job}** after ${p.shifts} shifts. Your rank resets when you join a new company.`;
  }
};
