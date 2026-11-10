// TODD's Floppy Disk: one random effect. TODD won't say what's on it.
const config = require('./config');
const reserve = require('./reserve');
const effects = require('./effects');
const { amt } = require('./format');

const JOKE_TITLES = ['Certified Floppy User', 'Read-Only Member', 'Insert Disk 2', '1.44 MB of Talent', 'Corrupted File'];

function run(ctx, random = Math.random) {
  const P = config.prefix;
  const g = ctx.guildId, u = ctx.user.id;
  const p = ctx.db.player(g, ctx.user);
  const r = random();
  if (r < 0.2) return '💾 *whirr... click... click...* **FILE CORRUPTED.** Nothing happens. TODD shrugs.';
  if (r < 0.35) { ctx.db.updatePlayer(g, u, { last_work: 0 }); return `💾 The disk installs **TURBO_WORK.EXE**. Your work cooldown is reset! Go \`${P}work\`.`; }
  if (r < 0.5) { effects.add(ctx.db, g, u, 'dailyDouble', 1); return `💾 The disk installs **DAILY_X2.BAT**. Your next \`${P}daily\` pays double.`; }
  if (r < 0.65) {
    const take = Math.min(500_00, Math.floor(p.cash * 0.1));
    if (take > 0) { ctx.db.addCash(g, u, -take); reserve.take(ctx.db, take); }
    return `💾 The disk installs **TODD_LOAN.SYS**. TODD "borrows" **${amt(take)}**. "I'll give it back," he says. He won't.`;
  }
  if (r < 0.75) { const found = reserve.pay(ctx.db, (50 + Math.floor(random() * 201)) * 100); ctx.db.addCash(g, u, found); return `💾 The disk was taped to an envelope. Inside: **${amt(found)}**!`; }
  if (r < 0.85) {
    const t = JOKE_TITLES[Math.floor(random() * JOKE_TITLES.length)];
    if (p.title) return `💾 The disk tries to rename you to *${t}*, but your title is too strong. Nothing happens.`;
    ctx.db.updatePlayer(g, u, { title: t });
    return `💾 The disk installs **NAME.TXT**. Your title is now *${t}*. (A Title from the shop will fix that.)`;
  }
  if (r < 0.95) { effects.add(ctx.db, g, u, 'chip', 1); return '💾 The disk had a **Platinum Chip** taped to the back. Your next Rend-Sino game pays 4% more.'; }
  return '💾 The disk plays a tinny little song. It\'s actually kind of nice. TODD is crying. Nothing else happens.';
}

module.exports = { run, JOKE_TITLES };
