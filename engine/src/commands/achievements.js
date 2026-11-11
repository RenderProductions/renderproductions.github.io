// r!achievements [@player]: every achievement, by category, with what's unlocked and how rare each one is.
const config = require('../config');
const A = require('../achievements');
const { button, rows } = require('../buttons');

const CATS = Object.keys(A.CATEGORIES);

function view(ctx, who, cat) {
  const mine = new Map(A.unlocked(ctx.db, who.id).map((r) => [r.id, r]));
  const rar = A.rarity(ctx.db);
  const total = A.LIST.length;
  const line = (a) => {
    const got = mine.get(a.id);
    const r = A.RARITY[a.rarity];
    if (a.secret && !got) return `🔒 **???** · ${r.emoji} ${r.label}\n-# A secret. ${rar.pct(a.id)}% of players have found it.`;
    return `${got ? '✅' : '🔒'} **${a.name}** · ${r.emoji} ${r.label} · ${rar.pct(a.id)}%\n-# ${a.desc}${got ? ` · <t:${Math.floor(got.unlocked_at / 1000)}:d>` : ''}`;
  };
  const head = `**${mine.size} / ${total}** unlocked`;
  let embed;
  if (!cat) {
    embed = {
      title: `🏆 ${who.username}'s achievements`,
      description: `${head}\n\n` + CATS.map((c) => {
        const list = A.LIST.filter((a) => a.cat === c);
        const n = list.filter((a) => mine.has(a.id)).length;
        return `${A.CATEGORIES[c].emoji} **${A.CATEGORIES[c].label}** · ${n}/${list.length}`;
      }).join('\n') +
        (mine.size ? `\n\n**Latest:** ${[...mine.keys()].slice(-3).reverse().map((id) => `${A.RARITY[A.BY_ID[id].rarity].emoji} ${A.BY_ID[id].name}`).join(' · ')}` : '') +
        (who.id === ctx.user.id && A.backPay(ctx.db, who.id).cents ? `\n\n💼 **You have ${require('../format').amt(A.backPay(ctx.db, who.id).cents)} in back pay waiting.** Claim it with \`${config.prefix}backpay\`.` : '') +
        `\n\n-# Achievements follow you to every server and pay out once when you unlock them: ` +
        Object.values(A.RARITY).map((r) => `${r.emoji} ${require('../format').amt(r.pay)}`).join(' · ') + '. Legendary ones also come with a free Title.',
      color: 0xffe600
    };
  } else {
    embed = {
      title: `${A.CATEGORIES[cat].emoji} ${A.CATEGORIES[cat].label} · ${who.username}`,
      description: A.LIST.filter((a) => a.cat === cat).map(line).join('\n'),
      footer: { text: `${mine.size} / ${total} unlocked overall · % = share of players who have it` },
      color: 0xffe600
    };
  }
  const btns = [button('Overview', `ach:${ctx.user.id}:${who.id}:all`, 'green', !cat, '🏆'),
    ...CATS.map((c) => button(A.CATEGORIES[c].label, `ach:${ctx.user.id}:${who.id}:${c}`, c === cat ? 'blue' : 'grey', c === cat, A.CATEGORIES[c].emoji))];
  return { embeds: [embed], components: rows(btns, 4) };
}

module.exports = {
  name: 'achievements',
  aliases: ['ach', 'badges'],
  description: 'Your achievements (or another player\'s)',
  usage: '[@player]',
  options: [{ name: 'player', type: 'user', description: 'Whose achievements to see' }],
  buttonPrefix: 'ach',

  async run(ctx, args) {
    return view(ctx, args.player || ctx.user, null);
  },

  async onButton(ctx, [viewer, whoId, cat]) {
    let who = { id: whoId, username: 'Player' };
    try { if (ctx.client && ctx.client.users) who = await ctx.client.users.fetch(whoId); } catch (e) { /* keep the placeholder */ }
    if (who.id === ctx.user.id) who = ctx.user;
    const out = view({ ...ctx, user: ctx.user.id === viewer ? ctx.user : ctx.user }, who, cat === 'all' ? null : cat);
    if (ctx.user.id !== viewer) return { reply: out };
    return { update: out };
  }
};
