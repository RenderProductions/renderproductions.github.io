// r!payback @lender <amount or all>: pay down a loan from another player.
const config = require('../config');
const loans = require('../loans');
const { amt, have, parsePolygons } = require('../format');

module.exports = {
  name: 'payback',
  description: 'Pay back a loan from another player',
  usage: '@lender <amount or all>',
  options: [
    { name: 'lender', type: 'user', description: 'Who you owe', required: true },
    { name: 'amount', type: 'string', description: 'How much to pay, or "all"', required: true }
  ],

  async run(ctx, args) {
    const P = config.prefix;
    const usage = `🏦 Usage: \`${P}payback @lender <amount>\` or \`${P}payback @lender all\`. See what you owe with \`${P}loans\`.`;
    if (!args.lender) return usage;
    const loan = loans.active(ctx.db, ctx.guildId, { borrower: ctx.user.id, lender: args.lender.id })[0];
    if (!loan) return `🏦 You don't owe **${args.lender.username}** anything.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    const raw = String(args.amount || '').trim().toLowerCase();
    let want = raw === 'all' ? Math.min(p.cash, loan.owed) : parsePolygons(raw);
    if (want === null) return usage;
    want = Math.min(want, loan.owed);
    if (want <= 0) return `🏦 You don't have anything to pay with. Go \`${P}work\`.`;
    if (p.cash < want) return `🏦 You only have ${have(p.cash)}.`;

    const paid = ctx.db.tx(() => loans.pay(ctx.db, loan, want));
    const left = loan.owed - paid;
    return left <= 0
      ? `🏦 You paid **${amt(paid)}** to **${args.lender.username}**. **Loan paid off!** 🎉`
      : `🏦 You paid **${amt(paid)}** to **${args.lender.username}**. Still owed: **${amt(left)}**.`;
  }
};
