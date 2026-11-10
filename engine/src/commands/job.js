// r!job: your work status (rank, review, accuracy, earnings, cooldown, what's going on at the company).
// r!job remind on|off: a DM when your next shift is ready.
const config = require('../config');
const jobs = require('../jobs');
const co = require('../companies');
const reserve = require('../reserve');
const reminders = require('../reminders');
const { relTime, amt } = require('../format');

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

module.exports = {
  name: 'job',
  aliases: ['career'],
  description: 'Your job: rank, next review, accuracy, earnings and cooldown',
  usage: '[remind on|off]',
  options: [{ name: 'remind', type: 'string', description: '"remind on" or "remind off": a DM when your next shift is ready' }],

  async run(ctx, args) {
    const P = config.prefix;
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const opt = String(args.remind || '').trim().toLowerCase().replace(/^remind\s*/, '');
    if (opt === 'on' || opt === 'off') {
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { remind: opt === 'on' ? 1 : 0 });
      if (opt === 'off') reminders.cancel(ctx.guildId, ctx.user.id);
      else if (p.job && p.last_work + jobs.WORK_COOLDOWN_MS > Date.now()) reminders.schedule(ctx, ctx.guildId, ctx.user.id, p.last_work + jobs.WORK_COOLDOWN_MS);
      return opt === 'on' ? "⏰ Shift reminders **on**. I'll DM you when your next shift is ready." : '⏰ Shift reminders **off**.';
    }

    const past = ctx.db.careers(ctx.guildId, ctx.user.id).filter((c) => c.ticker !== p.job);
    const history = past.length ? past.slice(0, 5).map((c) => `**${c.ticker}** · ${jobs.rankName(c.ticker, c.rank)} · ${c.shifts} shifts`).join('\n') : null;

    if (!p.job) {
      const lines = [`You're between jobs. \`${P}apply <ticker>\` to get hired, or \`${P}gig\` for quick cash.`];
      const nextGig = (p.last_gig || 0) + jobs.GIG_COOLDOWN_MS;
      lines.push(Date.now() < nextGig ? `🧰 Next gig ${relTime(nextGig)}` : '🧰 A gig is ready');
      if (p.gig_earned) lines.push(`Earned from gigs: **${amt(p.gig_earned)}**`);
      return { embeds: [{ title: `💼 ${ctx.user.username}'s career`, description: lines.join('\n'), color: config.color,
        fields: history ? [{ name: 'Past jobs (ranks saved)', value: history }] : [] }] };
    }

    const c = ctx.db.career(ctx.guildId, ctx.user.id, p.job);
    const r = jobs.rank(p.job, c.rank);
    const name = jobs.COMPANIES[p.job] ? jobs.COMPANIES[p.job].name : ((co.get(ctx.db, p.job) || {}).name || p.job);
    const next = p.last_work + jobs.WORK_COOLDOWN_MS;
    const ladder = (jobs.RANK_NAMES[p.job] || jobs.RANK_NAMES.default).map((n, i) => (i === c.rank ? `**${n}**` : n)).join(' → ');
    const left = jobs.REVIEW.every - c.rev_total;

    // What's going on at the company right now
    const m = await ctx.market.get();
    const news = [];
    if (jobs.COMPANIES[p.job]) {
      if (m && m.statuses && m.statuses[p.job] === 'bankrupt') news.push('📦 The company is **bankrupt**. Your next shift is a layoff.');
      if (m && m.boost && (!m.boost.tickers.length || m.boost.tickers.includes(p.job))) news.push('🚀 **Boom!** Shifts pay double right now.');
      if (reserve.level(ctx.db) < 0.25) news.push('🪧 The Polygon Reserve is low. **Strikes** may break out.');
      if (m && m.prices) news.push(`📈 ${p.job} is at **${amt(Math.round(m.prices[p.job] * 100))}**, so shifts pay about **${amt(Math.round(jobs.BASE_PAY * Math.max(m.prices[p.job], 0.5) / jobs.COMPANIES[p.job].start * r.mult * 100))}**.`);
    }

    const fields = [
      { name: 'Rank', value: `${ladder}\nPay: **${r.mult}x**`, inline: false },
      { name: 'Next review', value: `in **${left}** shift${left === 1 ? '' : 's'} · ${c.rev_right}/${c.rev_total} right so far\n-# ${jobs.REVIEW.promote}+ of ${jobs.REVIEW.every} gets a ${c.rank < 3 ? 'promotion' : 'bonus'}, ${jobs.REVIEW.demote} or fewer a demotion`, inline: false },
      { name: 'Shifts', value: String(c.shifts), inline: true },
      { name: 'Accuracy', value: pct(c.correct, c.total), inline: true },
      { name: 'Earned here', value: amt(c.earned), inline: true },
      { name: 'Next shift', value: Date.now() < next ? relTime(next) : '**Ready now!**', inline: true },
      { name: 'Reminders', value: p.remind ? 'On' : `Off (\`${P}job remind on\`)`, inline: true }
    ];
    if (news.length) fields.push({ name: 'At the company', value: news.join('\n') });
    if (history) fields.push({ name: 'Past jobs (ranks saved)', value: history });
    return { embeds: [{ title: `💼 ${r.name} at ${name}`, color: config.color, fields }] };
  }
};
