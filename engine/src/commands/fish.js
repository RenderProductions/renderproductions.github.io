// r!fish: cast a line (needs a Fishing Rod from Marquez). NachoBellGrande1065's idea.
//   r!fish               cast with bait (⬡ 5), or your Lure if you have one on
//   r!fish <fish>        use a fish from your bag as bait: the big ones come out
//   r!fish bag           what you've caught, and what it's worth
//   r!fish sell [all|junk|<fish>]   sell to Marquez
const config = require('../config');
const F = require('../fishing');
const A = require('../achievements');
const effects = require('../effects');
const reserve = require('../reserve');
const { amt, have, relTime } = require('../format');

const lastCast = new Map(); // guild:user -> ms

function findCatch(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  if (F.CATCH[t]) return t;
  return Object.keys(F.CATCH).find((k) => F.CATCH[k].name.toLowerCase() === t) ||
    Object.keys(F.CATCH).find((k) => F.CATCH[k].name.toLowerCase().includes(t)) || null;
}

function bagView(ctx) {
  const P = config.prefix;
  const rows = F.bag(ctx.db, ctx.guildId, ctx.user.id);
  const worth = rows.reduce((t, r) => t + r.value * r.qty, 0);
  const fx = effects.get(ctx.db, ctx.guildId, ctx.user.id);
  return {
    embeds: [{
      title: '🎣 Your catch',
      description: (rows.length ? rows.sort((a, b) => b.size - a.size).map((r) => `${r.emoji} **${r.name}** × ${r.qty} · ${F.SIZE[r.size]} · ${amt(r.value)} each`).join('\n') +
        `\n\nMarquez would pay **${amt(Math.floor(worth * reserve.factor(ctx.db)))}** for all of it.` : 'Nothing yet. Go cast a line!') +
        `\n${F.bagCount(ctx.db, ctx.guildId, ctx.user.id)} / ${F.RULES.bagMax} in your bag` + (fx.lure ? ` · 🪝 Lure: ${fx.lure} casts left` : ''),
      footer: { text: `${P}fish sell [all|junk|<fish>] · ${P}fish <small fish> uses it as bait` },
      color: 0x3ba7f2
    }]
  };
}

module.exports = {
  name: 'fish',
  aliases: ['fishing', 'cast'],
  description: 'Go fishing (needs a Fishing Rod): sell what you catch to Marquez',
  usage: '[<fish to use as bait> | bag | sell [all|junk|<fish>]]',
  options: [{ name: 'action', type: 'string', description: 'Blank to cast, a fish to use as bait, bag, or sell [all|junk|<fish>]' }],
  lastCast,

  async run(ctx, args = {}) {
    const P = config.prefix;
    const words = String(args.action || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const first = words[0] || '';

    if (['bag', 'catch', 'inv', 'inventory'].includes(first)) return bagView(ctx);
    if (first === 'sell') {
      const rest = words.slice(1).join(' ');
      const which = !rest || rest === 'all' ? 'all' : rest === 'junk' ? 'junk' : findCatch(rest);
      if (!which) return `🎣 You don't have that. See your catch with \`${P}fish bag\`.`;
      const r = F.sell(ctx.db, ctx.guildId, ctx.user.id, which);
      if (!r.count) return `🎣 Nothing to sell${which === 'all' ? '' : ' there'}. Go catch something!`;
      return `🧺 Marquez looks over your catch. "Fresh enough." He pays **${amt(r.cents)}** for ${r.count} thing${r.count === 1 ? '' : 's'}.\n-# You have ${have(ctx.db.player(ctx.guildId, ctx.user).cash)} now.${reserve.note(ctx.db)}`;
    }

    // ---- a cast ----
    if (ctx.db.itemCount(ctx.guildId, ctx.user.id, 'rod') <= 0) return `🎣 You need a **Fishing Rod**. Marquez sells them: \`${P}shop fishing\`.`;
    const key = `${ctx.guildId}:${ctx.user.id}`;
    const frenzy = require('../worldEvents').fishFrenzy(ctx.db);
    const wait = (lastCast.get(key) || 0) + (frenzy ? 90_000 : F.RULES.cooldownMs) - Date.now();
    if (wait > 0) return `🎣 The fish need a minute to forget about you. Cast again ${relTime(Date.now() + wait)}.`;
    if (F.bagCount(ctx.db, ctx.guildId, ctx.user.id) >= F.RULES.bagMax) return `🎣 Your bag is full (${F.RULES.bagMax}). Sell some with \`${P}fish sell\`.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    let using = 'bait', baitFish = null, line;
    if (first) {
      baitFish = findCatch(words.join(' '));
      if (!baitFish) return `🎣 Use what as bait? Try \`${P}fish\` to cast with bait, or \`${P}fish minnow\` to use a fish from your bag.`;
      if (F.CATCH[baitFish].size === 0) return `🎣 Nothing bites on a ${F.CATCH[baitFish].name}. Try a fish.`;
      if (ctx.db.itemCount(ctx.guildId, ctx.user.id, F.item(baitFish)) <= 0) return `🎣 You don't have a ${F.CATCH[baitFish].name} to use as bait.`;
      using = baitFish;
    } else if (effects.get(ctx.db, ctx.guildId, ctx.user.id).lure > 0) using = 'lure';
    else if (p.cash < F.RULES.bait) return `🎣 Bait costs ${amt(F.RULES.bait)}. You have ${have(p.cash)}.`;

    lastCast.set(key, Date.now());
    const res = F.cast(using === 'bait' && frenzy ? 'lure' : using, ctx.random || Math.random); // a Fish Frenzy makes plain bait work like a lure
    ctx.db.tx(() => {
      if (using === 'bait') { ctx.db.addCash(ctx.guildId, ctx.user.id, -F.RULES.bait); reserve.take(ctx.db, F.RULES.bait); line = `🪱 Bait: −${amt(F.RULES.bait)}`; }
      else if (using === 'lure') { effects.take(ctx.db, ctx.guildId, ctx.user.id, 'lure'); }
      else { ctx.db.addItem(ctx.guildId, ctx.user.id, F.item(baitFish), -1); line = `${F.CATCH[baitFish].emoji} You hooked a ${F.CATCH[baitFish].name} as bait.`; }
    });

    let text, color = 0x3ba7f2;
    if (res.kind === 'nothing') text = pickLine(ctx, ['Nothing bites. The lake is quiet.', 'You wait... and wait. Nothing.', 'A fish nibbles, then swims off laughing at you.']);
    else if (res.kind === 'snag') {
      text = '🪢 **Your line snagged on something!** You yank it free, but the bait is gone.';
      if (using === 'lure' && effects.take(ctx.db, ctx.guildId, ctx.user.id, 'lure')) text += ' Your lure took a beating too (one extra cast lost).';
      color = 0xed4245;
    } else if (res.kind === 'wallet') {
      const got = reserve.pay(ctx.db, res.cents);
      ctx.db.addCash(ctx.guildId, ctx.user.id, got);
      text = `👛 **You reeled in a soggy wallet!** There's **${amt(got)}** inside. Finders keepers.`;
      color = 0xf0b232;
    } else {
      const c = F.CATCH[res.id];
      ctx.db.addItem(ctx.guildId, ctx.user.id, F.item(res.id), 1);
      if (res.kind === 'junk') text = `${c.emoji} You pulled up a **${c.name}**. Marquez might give you ${amt(c.value)} for it.`;
      else {
        const big = ['', '', ' Nice one!', ' **What a monster!**', ' ✨ **LEGENDARY!** The whole lake goes quiet.'][c.size];
        text = `${c.emoji} **You caught a ${c.name}!** ${F.SIZE[c.size]}, worth ${amt(c.value)}.${big}`;
        color = c.size >= 3 ? 0xf0b232 : 0x57f287;
        A.award(ctx, 'first_catch');
        if (A.bump(ctx, 'fish_caught') >= 200) A.award(ctx, 'fish_in_the_sea');
        if (baitFish && c.size > F.CATCH[baitFish].size) A.award(ctx, 'bigger_fish');
      }
    }
    const fx = effects.get(ctx.db, ctx.guildId, ctx.user.id);
    const notes = ctx.notes ? ctx.notes.splice(0) : [];
    const result = {
      embeds: [{
        title: '🎣 Fishing',
        description: `${text}\n\n` + [line, using === 'lure' ? `🪝 Lure: ${fx.lure || 0} cast${fx.lure === 1 ? '' : 's'} left` : null].filter(Boolean).join('\n') +
          `\n-# Bag: ${F.bagCount(ctx.db, ctx.guildId, ctx.user.id)} / ${F.RULES.bagMax} · \`${P}fish bag\` · \`${P}fish sell\`` + (notes.length ? `\n\n${notes.join('\n')}` : ''),
        color
      }]
    };
    return {
      embeds: [{ title: '🎣 Fishing', description: baitFish ? `You hook the ${F.CATCH[baitFish].name} and cast it out... 🌊` : 'You cast your line... 🌊', color: 0x99aab5 }],
      after: async (edit) => { await new Promise((r) => setTimeout(r, 2500)); await edit(result); },
      _final: result
    };
  }
};

function pickLine(ctx, lines) { return '🌊 ' + lines[Math.floor((ctx.random || Math.random)() * lines.length)]; }
