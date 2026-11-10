// r!profile [@player]: a player's card. Title, rarest achievements, net worth, job, casino best, and more.
// r!profile private / public: hide from (or show on) the site's profile pages.
const config = require('../config');
const A = require('../achievements');
const economy = require('../economy');
const loans = require('../loans');
const jobs = require('../jobs');
const { have, amt } = require('../format');

const isPrivate = (db, id) => db.meta(`private:${id}`) === '1';

module.exports = {
  name: 'profile',
  aliases: ['me', 'card'],
  description: "A player's profile card",
  usage: '[@player | private | public]',
  options: [
    { name: 'player', type: 'user', description: 'Whose profile to see' },
    { name: 'visibility', type: 'string', description: '"private" hides you from the site, "public" shows you' }
  ],
  isPrivate,

  async run(ctx, args) {
    const P = config.prefix;
    const raw = ctx.message ? String(ctx.message.content).trim().split(/\s+/)[1] || '' : '';
    const opt = String(args.visibility || raw).toLowerCase();
    if (opt === 'private' || opt === 'public') {
      ctx.db.setMeta(`private:${ctx.user.id}`, opt === 'private' ? '1' : '0');
      return opt === 'private'
        ? `🔒 Your profile is **private**. It won't be on the site, and it's hidden next time the site updates. \`${P}profile public\` to undo.`
        : `🌐 Your profile is **public** on the site. \`${P}profile private\` to hide it.`;
    }
    const who = args.player || ctx.user;
    if (who.bot) return '🏷️ The house has no profile. The house *is* the profile.';
    const p = ctx.db.player(ctx.guildId, who);
    const m = await ctx.market.get();
    const c = { db: ctx.db, guildId: ctx.guildId, user: who };
    const worth = (m ? economy.worth(c, m, p, who.id) : p.cash) - p.debt - loans.totalOwed(ctx.db, ctx.guildId, who.id) + loans.totalLent(ctx.db, ctx.guildId, who.id);
    const got = A.unlocked(ctx.db, who.id).map((r) => A.BY_ID[r.id]);
    const best = got.slice().sort((a, b) => A.RARITY[b.rarity].order - A.RARITY[a.rarity].order).slice(0, 5);
    const career = p.job ? ctx.db.career(ctx.guildId, who.id, p.job) : null;
    const shifts = ctx.db.careers(ctx.guildId, who.id).reduce((s, r) => s + r.total, 0);
    const casinoBest = (ctx.db.raw.prepare('SELECT MAX(biggest) AS b FROM gambling WHERE guild_id = ? AND user_id = ?').get(ctx.guildId, who.id) || {}).b || 0;
    const collectibles = ctx.db.inventory(ctx.guildId, who.id).filter((r) => r.item && r.item.startsWith('col_') && r.qty > 0).length;
    const avatar = typeof who.displayAvatarURL === 'function' ? who.displayAvatarURL({ size: 128 }) : null;
    return { embeds: [{
      author: { name: `${who.username}${isPrivate(ctx.db, who.id) ? ' · 🔒 private' : ''}`, ...(avatar ? { icon_url: avatar } : {}) },
      title: p.title ? `🏷️ ${p.title}` : `${who.username}'s profile`,
      thumbnail: avatar ? { url: avatar } : undefined,
      description: best.length ? best.map((a) => `${A.RARITY[a.rarity].emoji} **${a.name}**`).join(' · ') : '-# No achievements yet.',
      fields: [
        { name: '💎 Net worth', value: have(worth), inline: true },
        { name: '💼 Job', value: p.job ? `${jobs.rankName(p.job, career.rank)} at **${p.job}**` : 'Between jobs', inline: true },
        { name: '🏆 Achievements', value: `${got.length} / ${A.LIST.length}`, inline: true },
        { name: '🛠️ Shifts worked', value: String(shifts), inline: true },
        { name: '🎰 Best casino hit', value: casinoBest ? amt(casinoBest) : '—', inline: true },
        { name: '🗃️ Collectibles', value: String(collectibles), inline: true }
      ],
      footer: { text: `${P}achievements${who.id === ctx.user.id ? '' : ' @' + who.username} for the full list · Profiles are on the site too` },
      color: 0xffe600
    }] };
  }
};
