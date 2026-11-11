// r!profile [@player]: a player's card. Title, rarest achievements, net worth, job, casino best, and more.
// r!profile private / public: hide from (or show on) the site's profile pages.
const config = require('../config');
const A = require('../achievements');
const economy = require('../economy');
const loans = require('../loans');
const jobs = require('../jobs');
const { have, amt } = require('../format');
const styles = require('../styles');
const shop = require('../shop');

const isPrivate = (db, id) => db.meta(`private:${id}`) === '1';

function customizeView(ctx) {
  const P = config.prefix;
  const id = ctx.user.id;
  const kit = styles.hasKit(ctx.db, id);
  const legend = styles.legendary(ctx.db, id);
  const s = styles.get(ctx.db, id);
  const paints = Object.entries(styles.PAINTS).map(([k, p]) => `${p.emoji} **${p.label}** ${styles.ownsPaint(ctx.db, id, k) ? '✅' : `· ${amt(p.price)} from Marquez`}`).join('\n');
  return { embeds: [{
    title: '🎨 Customize your profile',
    description: (kit ? '✅ Customizer unlocked.' : `🔒 You need a **Profile Customizer Kit** (${amt(shop.ITEMS.kit.price)}) from Marquez first: \`${P}shop profile\`.`) +
      `\nRight now: ${s.theme ? `theme **${s.theme}**` : s.color ? `color **${s.color}**` : 'the default look'}${s.banner ? `, ${s.banner} banner` : ''}${s.frame && s.frame !== 'none' ? `, ${s.frame} frame` : ''}${s.pin ? `, ${shop.COLLECTIBLES[s.pin] ? shop.COLLECTIBLES[s.pin].name : s.pin} pinned` : ''}`,
    fields: [
      { name: 'Free with the kit', value: `\`${P}profile color #ff4fd8\` any color\n\`${P}profile theme <name>\`: ${Object.keys(styles.PRESETS).join(', ')}\n\`${P}profile banner <name>\`: gradient, scanlines, honeycomb, grid, stars` },
      { name: 'Profile Paint (themes to buy)', value: paints + `\nBuy from \`${P}shop profile\`, \`${P}use <paint>\`, then \`${P}profile theme <name>\`` },
      { name: 'Legendary extras', value: legend ? `✅ \`${P}profile banner crown\` and \`${P}profile frame glow\`` : '🔒 Unlock any legendary achievement for the crown banner and a glowing frame' },
      { name: 'Also', value: `\`${P}profile pin <collectible>\` shows one off · \`${P}profile reset\` goes back to default` }
    ],
    color: styles.color(ctx.db, id, 0xffe600)
  }] };
}

module.exports = {
  name: 'profile',
  aliases: ['me', 'card'],
  description: "A player's profile card",
  usage: '[@player | private | public]',
  options: [
    { name: 'player', type: 'user', description: 'Whose profile to see' },
    { name: 'visibility', type: 'string', description: '"private" hides you from the site, "public" shows you' },
    { name: 'customize', type: 'string', description: 'Like "color #ff4fd8", "theme market", "banner stars", "frame glow", "pin golden nacho", or "reset"' }
  ],
  isPrivate,

  async run(ctx, args) {
    const P = config.prefix;
    // Prefix: everything after "r!profile". Slash: the customize option (or text that landed in the player slot)
    const typed = typeof args.player === 'string' ? [args.player, args.visibility, args.customize] : [args.customize];
    const words = ctx.message ? String(ctx.message.content).trim().split(/\s+/).slice(1) : typed.filter(Boolean).join(' ').trim().split(/\s+/).filter(Boolean);
    if (typeof args.player === 'string') args.player = null;
    const raw = words[0] || '';
    const opt = String(raw || args.visibility || '').toLowerCase();
    // Customizing: r!profile customize | color #hex | theme <name> | banner <name> | frame <name> | pin <collectible> | reset
    if (['customize', 'customise', 'style'].includes(opt)) return customizeView(ctx);
    if (['color', 'colour', 'theme', 'banner', 'frame', 'pin', 'reset'].includes(opt)) {
      const what = opt === 'colour' ? 'color' : opt;
      const value = words.slice(1).join(' ');
      let r = styles.set(ctx.db, ctx.user.id, what, value);
      if (r.pin) {
        const id = shop.find(r.pin);
        if (!id || !shop.COLLECTIBLES[id] || ctx.db.itemCount(ctx.guildId, ctx.user.id, id) <= 0) r = { error: "You can only pin a collectible you own (in this server). See `r!inventory`." };
        else { const s = styles.get(ctx.db, ctx.user.id); s.pin = id; styles.save(ctx.db, ctx.user.id, s); r = { ok: `${shop.COLLECTIBLES[id].emoji} **${shop.COLLECTIBLES[id].name}** is pinned to your profile.` }; }
      }
      if (r.error === null) return customizeView(ctx);
      return r.error ? `🎨 ${r.error}` : `🎨 ${r.ok}\n-# The site shows it within a few minutes.`;
    }
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
      url: isPrivate(ctx.db, who.id) ? undefined : `${config.siteUrl}/profile/?id=${who.id}`, // the title links to their page on the site
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
      footer: { text: `${P}achievements${who.id === ctx.user.id ? '' : ' @' + who.username} for the full list · Click the title for their page on the site` },
      color: styles.color(ctx.db, who.id, 0xffe600)
    }] };
  }
};
