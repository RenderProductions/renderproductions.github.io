// r!loans: what you owe other players and what they owe you.
const config = require('../config');
const loans = require('../loans');
const { amt, relTime } = require('../format');

module.exports = {
  name: 'loans',
  description: "See the loans you owe and the ones you've given",
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const now = Date.now();
    const owe = loans.active(ctx.db, ctx.guildId, { borrower: ctx.user.id }, now);
    const lent = loans.active(ctx.db, ctx.guildId, { lender: ctx.user.id }, now);
    if (!owe.length && !lent.length) {
      return `🏦 No loans. Ask someone for one with \`${P}loan @player <amount> <interest>\`.`;
    }

    const when = (l) => (loans.overdue(l, now) ? '⚠️ **Overdue**, half your earnings go to them' : `due ${relTime(l.due_at)}`);
    const whenLent = (l) => (loans.overdue(l, now) ? '⚠️ **Overdue**, you get half their earnings' : `due ${relTime(l.due_at)}`);
    const fields = [];
    if (owe.length) {
      fields.push({
        name: 'You owe',
        value: owe.map((l) => `**${l.lender_name || 'someone'}**: ${amt(l.owed)} at ${l.rate}% a day · ${when(l)}`).join('\n') +
          `\nPay with \`${P}payback @player <amount>\`.`
      });
    }
    if (lent.length) {
      fields.push({
        name: 'Owed to you',
        value: lent.map((l) => `**${l.borrower_name || 'someone'}**: ${amt(l.owed)} at ${l.rate}% a day · ${whenLent(l)}`).join('\n')
      });
    }
    return { embeds: [{ title: '🏦 Your loans', fields, color: config.color }] };
  }
};
