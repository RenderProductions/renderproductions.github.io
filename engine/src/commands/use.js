// Uses an item from your inventory.
const config = require('../config');
const reserve = require('../reserve');
const shop = require('../shop');
const jobs = require('../jobs');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'use',
  description: 'Use an item from your inventory',
  usage: '<item>',
  options: [{ name: 'item', type: 'string', description: 'coffee, overtime, mystery, or resume', required: true }],

  async run(ctx, args) {
    const P = config.prefix;
    const id = String(args.item || '').trim().toLowerCase();
    const item = shop.ITEMS[id];
    if (!item) return `🎒 Use what? Try \`${P}use <item>\`, or check \`${P}inventory\`.`;
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
