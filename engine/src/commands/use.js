// Uses an item from your inventory.
const config = require('../config');
const reserve = require('../reserve');
const shop = require('../shop');
const jobs = require('../jobs');
const { money, have, amt } = require('../format');
const effects = require('../effects');
const co = require('../companies');

module.exports = {
  name: 'use',
  description: 'Use an item from your inventory',
  usage: '<item>',
  options: [{ name: 'item', type: 'string', description: 'The item, like coffee or rocket fuel (megaphone: then your ad)', required: true }],

  async run(ctx, args) {
    const P = config.prefix;
    // The item can be more than one word ("rocket fuel"); anything after it is extra text (the megaphone ad)
    const words = String(args.item || '').trim().split(/\s+/);
    let id = null, extra = '';
    for (let n = Math.min(4, words.length); n >= 1 && !id; n--) { id = shop.find(words.slice(0, n).join(' ')); if (id) extra = words.slice(n).join(' '); }
    const item = id && shop.any(id);
    if (!item) return `🎒 Use what? Try \`${P}use <item>\`, or check \`${P}inventory\`.`;
    if (shop.isCollectible(id)) return `${item.emoji} **${item.name}** is a collectible. It doesn't do anything, it just looks great on your profile.`;
    if (item.passive) return `${item.emoji} **${item.name}** works on its own. Just keep it in your inventory.`;
    const styles = require('../styles');
    if (id === 'kit' && styles.hasKit(ctx.db, ctx.user.id)) return `🎨 You already have the Customizer unlocked. Try \`${P}profile customize\`.`;
    if (id.startsWith('paint_') && styles.ownsPaint(ctx.db, ctx.user.id, id.slice(6))) return `${item.emoji} You already own **${item.name}**. Use it with \`${P}profile theme ${id.slice(6)}\`.`;
    if (ctx.db.itemCount(ctx.guildId, ctx.user.id, id) <= 0) {
      return `${item.emoji} You don't have a **${item.name}**. Get one in \`${P}shop\`.`;
    }
    if (id === 'title') return `🏷️ Set your title with \`${P}settitle <text>\`.`;

    // Checks first, so nobody wastes an item
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const now = Date.now();
    if (id === 'coffee' && now >= p.last_work + jobs.WORK_COOLDOWN_MS) {
      return "☕ You're not on a work cooldown. Save the coffee for later.";
    }
    if (id === 'overtime' && p.overtime) return '⏰ You already have Overtime queued for your next shift.';
    if (id === 'resume') {
      if (!p.job) return `📄 You don't have a job to quit. Try \`${P}apply <ticker>\`.`;
      if (now >= p.hired_at + jobs.QUIT_LOCK_MS) return `📄 You can already \`${P}quit\`. Save the resume for later.`;
    }
    const fx = effects.get(ctx.db, ctx.guildId, ctx.user.id);
    if (id === 'booster' && (fx.divBoostUntil || 0) > now) return `📈 Your Dividend Booster is already running until <t:${Math.floor(fx.divBoostUntil / 1000)}:t>.`;
    if (id === 'fuel' && fx.fuel) return '⛽ The tank is already full. Fly a Rocket first.';
    if (id === 'wrap' && fx.wrap) return '🎀 Your next gift is already wrapped.';
    let pc = null;
    if (id === 'megaphone') {
      pc = co.ownedBy(ctx.db, ctx.user.id);
      if (!pc || !co.alive(pc) || pc.status === 'pending') return `📣 You need a running company to advertise. Start one with \`${P}found\`.`;
      if (!extra) return `📣 What's the ad? \`${P}use megaphone <your ad>\`, like \`${P}use megaphone ${pc.ticker}: now hiring!\``;
      if (!config.newsWebhook) return '📣 The market news feed is offline right now. Keep the Megaphone for later.';
    }

    const random = ctx.random || Math.random;
    const left = (n) => (n > 0 ? `\nYou have ${n} left.` : '');
    return ctx.db.tx(() => {
      ctx.db.addItem(ctx.guildId, ctx.user.id, id, -1);
      const n = ctx.db.itemCount(ctx.guildId, ctx.user.id, id);

      if (id === 'coffee') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { last_work: 0 });
        return `☕ Fresh coffee! Your work cooldown is reset. Go \`${P}work\`.${left(n)}`;
      }
      if (id === 'overtime') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { overtime: 1 });
        return `⏰ Overtime approved! Your next shift pays double.${left(n)}`;
      }
      if (id === 'resume') {
        ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { hired_at: 0 });
        return `📄 Resume polished. You can \`${P}quit\` right away.${left(n)}`;
      }
      if (id === 'kit') { require('../achievements').set(ctx, require('../styles').KIT, 1); return `🎨 **Customizer unlocked**, for good, in every server. See your options with \`${P}profile customize\`.${left(n)}`; }
      if (id.startsWith('paint_')) { require('../achievements').set(ctx, id, 1); return `${item.emoji} **${item.name}** is yours. Put it on with \`${P}profile theme ${id.slice(6)}\`.${left(n)}`; }
      if (id === 'stopwatch') { effects.add(ctx.db, ctx.guildId, ctx.user.id, 'stopwatch', 3); return `⏱️ Stopwatch wound up. Your next 3 shifts get **10 extra seconds**.${left(n)}`; }
      if (id === 'chip') { effects.add(ctx.db, ctx.guildId, ctx.user.id, 'chip', 5); return `💿 Platinum Chip in hand. Your next **5** Rend-Sino games pay 4% more.${left(n)}`; }
      if (id === 'fuel') { effects.add(ctx.db, ctx.guildId, ctx.user.id, 'fuel', 1); return `⛽ Tank's full. Your next \`${P}rocket\` flies **20% higher** before it crashes.${left(n)}`; }
      if (id === 'wrap') { effects.add(ctx.db, ctx.guildId, ctx.user.id, 'wrap', 1); return `🎀 Wrapped! Your next \`${P}gift\` has no fee.${left(n)}`; }
      if (id === 'booster') {
        effects.setTimer(ctx.db, ctx.guildId, ctx.user.id, 'divBoostUntil', now + 24 * 3600 * 1000);
        return `📈 Dividend Booster on! Dividends you collect pay **+50%** until <t:${Math.floor((now + 24 * 3600 * 1000) / 1000)}:t>. Collect with \`${P}dividends\`.${left(n)}`;
      }
      if (id === 'times') return `📰 **The Rend Times**\n> ${require('../rendTimes').tip(ctx.db, random)}${left(n)}`;
      if (id === 'megaphone') {
        const ad = extra.replace(/@/g, '@\u200b').slice(0, 200);
        const body = JSON.stringify({ username: 'Rend-Conomy Market', allowed_mentions: { parse: [] },
          embeds: [{ color: 0xf0b232, title: `📣 A word from ${pc.name} (${pc.ticker})`, description: ad, footer: { text: `Paid for by ${ctx.user.username} · Ads are sold by Marquez` } }] });
        for (const url of config.newsWebhook.split(/[\s,]+/).filter(Boolean)) fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
        return `📣 Your ad for **${pc.ticker}** is on the market news feed.${left(n)}`;
      }
      if (id === 'floppy') return require('../floppy').run(ctx, random) + left(n);
      // Mystery: 5% jackpot, 25% Overtime pass (goes to your inventory), else 40-160 Polygons
      const roll = random();
      let out;
      if (roll < 0.05) {
        const jackpot = reserve.pay(ctx.db, 750_00);
        ctx.db.addCash(ctx.guildId, ctx.user.id, jackpot);
        out = `🎁 ✨ **JACKPOT!** The box had **${amt(jackpot)}** in it!`;
      } else if (roll < 0.30) {
        ctx.db.addItem(ctx.guildId, ctx.user.id, 'overtime', 1);
        out = `🎁 An **Overtime pass**! It's in your inventory: \`${P}use overtime\`.`;
      } else {
        const prize = reserve.pay(ctx.db, (40 + Math.floor(random() * 121)) * 100);
        ctx.db.addCash(ctx.guildId, ctx.user.id, prize);
        out = `🎁 The box had **${amt(prize)}** in it.`;
      }
      return out + left(n);
    });
  }
};
