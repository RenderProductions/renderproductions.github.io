// r!forgive @borrower: a lender wipes out what someone owes them.
const config = require('../config');
const loans = require('../loans');
const { amt } = require('../format');

module.exports = {
  name: 'forgive',
  description: 'Forgive a loan you gave someone',
  usage: '@borrower',
  options: [{ name: 'borrower', type: 'user', description: 'Who owes you', required: true }],

  async run(ctx, args) {
    if (!args.borrower) return `🏦 Usage: \`${config.prefix}forgive @player\`. See who owes you with \`${config.prefix}loans\`.`;
    const loan = loans.active(ctx.db, ctx.guildId, { lender: ctx.user.id, borrower: args.borrower.id })[0];
    if (!loan) return `🏦 **${args.borrower.username}** doesn't owe you anything.`;

    loans.forgive(ctx.db, loan);
    return {
      content: `🕊️ **${ctx.user.username}** forgave <@${args.borrower.id}>'s loan of **${amt(loan.owed)}**. It's gone. Be nice to each other.`,
      allowedMentions: { users: [args.borrower.id] } // let the borrower know
    };
  }
};
