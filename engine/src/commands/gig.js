// r!gig: quick freelance work for players without a job. Low pay, no ranks, every 10 minutes.
const config = require('../config');
const jobs = require('../jobs');
const work = require('./work');
const { relTime } = require('../format');

const GIGS = {
  RRM: '🛡️ **Gig:** a server owner needs a moderator for one message.',
  NACH: '🧀 **Gig:** a food truck is short a cook.',
  BLU: '🏗️ **Gig:** a neighbor needs a hand with a shed.',
  BNW: '📊 **Gig:** a small shop needs its books checked.',
  BSTG: '🎮 **Gig:** an indie studio needs a playtester.'
};

module.exports = {
  name: 'gig',
  aliases: ['freelance', 'sidehustle', 'hustle'],
  description: 'No job? Do a quick freelance task (every 10 minutes)',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.job) return `💼 You already have a job at **${p.job}**. Gigs are for the unemployed; use \`${P}work\`.`;
    const cur = work.active.get(`${ctx.guildId}:${ctx.user.id}`);
    if (cur && Date.now() - cur.start <= jobs.ABANDON_MS) return "⏱️ You're in the middle of something! Answer it first.";
    const next = (p.last_gig || 0) + jobs.GIG_COOLDOWN_MS;
    if (Date.now() < next) return `😴 No gigs right now. Check back ${relTime(next)}.`;

    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { last_gig: Date.now() });
    const styles = Object.keys(jobs.COMPANIES);
    const style = styles[Math.floor((ctx.random || Math.random)() * styles.length)];
    return work.startTask(ctx, { job: style, style, mode: 'gig', tier: 0, market: await ctx.market.get(), intro: GIGS[style] + '\n' });
  }
};
