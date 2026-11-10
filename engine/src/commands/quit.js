const config = require('../config');
const jobs = require('../jobs');
const { relTime } = require('../format');
const { button, rows } = require('../buttons');

// Checks whether the player can quit. Returns an error message, or null if they can.
function blocked(ctx, p) {
  if (!p.job) return `❌ You don't have a job. Try \`${config.prefix}apply <ticker>\`.`;
  const free = p.hired_at + jobs.QUIT_LOCK_MS;
  if (Date.now() < free) {
    return `⏳ You just started at **${p.job}**. You can quit ${relTime(free)}, or buy a Resume in \`${config.prefix}shop\`.`;
  }
  return null;
}

module.exports = {
  name: 'quit',
  description: 'Leave your job (24h after hiring, resets your rank)',
  options: [],
  buttonPrefix: 'quit',

  // Asks first, since quitting throws away your rank
  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const no = blocked(ctx, p);
    if (no) return no;
    const rank = jobs.rank(p.shifts).name;
    return {
      content: `🤔 Quit **${p.job}**? You'll lose your **${rank}** rank and all ${p.shifts} shifts.`,
      components: rows([
        button('Quit my job', `quit:${ctx.user.id}:yes`, 'red'),
        button('Stay', `quit:${ctx.user.id}:no`, 'grey')
      ])
    };
  },

  async onButton(ctx, [userId, choice]) {
    if (ctx.user.id !== userId) return { reply: "That's not your job to quit." };
    if (choice !== 'yes') return { update: { content: '👍 You stayed. Back to work.', components: [] } };
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const no = blocked(ctx, p);
    if (no) return { update: { content: no, components: [] } };
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: null, shifts: 0, overtime: 0 });
    return { update: { content: `👋 You quit **${p.job}** after ${p.shifts} shifts. Your rank resets when you join a new company.`, components: [] } };
  }
};
