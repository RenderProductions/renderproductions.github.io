const config = require('../config');
const receipts = require('../receipts');
const co = require('../companies');
const { money, have, amt, relTime, parsePolygons } = require('../format');

module.exports = {
  name: 'salary',
  description: "Pay yourself from your public company's treasury",
  usage: '<amount or max>',
  options: [{ name: 'amount', type: 'string', description: 'How much to take, or "max" (up to 10% a day)', required: true }],

  async run(ctx, args) {
    const P = config.prefix;
    const c = co.ownedBy(ctx.db, ctx.user.id);
    if (!co.alive(c)) return c ? '🏢 Your company is still waiting for approval.' : `🏢 You don't run a company. Start one with \`${P}found\`.`;
    if (c.status !== 'public') return `🏢 Only public companies pay their owner. Grow it and \`${P}ipo\` first.`;
    if (c.owner_guild !== ctx.guildId) return "🏢 Your salary is paid in the server where you founded the company. Use the command there.";
    const ready = c.last_salary + co.RULES.dayMs;
    if (Date.now() < ready) return `🏢 Payday was recent. Next salary ${relTime(ready)}.`;

    const max = Math.floor(c.treasury * co.RULES.salaryMaxPct);
    const raw = String(args.amount || '').trim().toLowerCase();
    const pay = raw === 'max' ? max : parsePolygons(raw);
    if (pay === null) return `🏢 Usage: \`${P}salary <amount>\` or \`${P}salary max\`. You can take up to **${amt(max)}** today.`;
    if (pay <= 0) return "🏢 The treasury can't pay you anything right now.";
    if (pay > max) return `🏢 You can take up to **${amt(max)}** today (10% of the treasury).`;

    ctx.db.player(ctx.guildId, ctx.user);
    co.salary(ctx.db, c.ticker, pay);
    receipts.send(ctx, { title: `Salary from ${c.name}`, lines: [['Paid to you', amt(pay)], ['Treasury left', have(c.treasury - pay)], ['Polygons now', have(ctx.db.player(ctx.guildId, ctx.user).cash)]] });
    return `💼 You paid yourself **${amt(pay)}** from **${c.name}**. Investors noticed, and the stock dipped.`;
  }
};
