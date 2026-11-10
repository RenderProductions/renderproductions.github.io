// r!loan @lender <amount> <interest>: ask another player for a loan. They answer with buttons.
const { ButtonStyle, ComponentType } = require('discord.js');
const config = require('../config');
const A = require('../achievements');
const receipts = require('../receipts');
const loans = require('../loans');
const { amt, have, parsePolygons } = require('../format');

const P = config.prefix;
const days = Math.round(loans.RULES.termMs / loans.RULES.dayMs);

// How much a loan would be at its deadline if nothing is paid early
const atDeadline = (amount, rate) => Math.round(amount * Math.pow(1 + rate / 100, days));

function requestCard(r, note) {
  return {
    title: '🏦 Loan request',
    description: `**${r.borrower.username}** wants to borrow **${amt(r.amount)}** from **${r.lender.username}** at **${r.rate}% a day**.\n\n` +
      `Interest grows daily for ${days} days. If nothing's paid early, that's **${amt(atDeadline(r.amount, r.rate))}** at the deadline. ` +
      'After that, half of everything the borrower earns goes to the lender until it\'s paid.' + (note ? `\n\n${note}` : ''),
    color: config.color
  };
}

module.exports = {
  name: 'loan',
  description: 'Ask another player for a loan with daily interest',
  usage: '@lender <amount> <interest % a day>',
  options: [
    { name: 'lender', type: 'user', description: 'Who to borrow from', required: true },
    { name: 'amount', type: 'string', description: 'How many Polygons', required: true },
    { name: 'interest', type: 'string', description: `Interest per day, 0 to ${loans.RULES.maxRate}%`, required: true }
  ],
  buttonPrefix: 'loan',

  async run(ctx, args) {
    const usage = `🏦 Usage: \`${P}loan @lender <amount> <interest>\`, for example \`${P}loan @KorbedOut 1000 4\` (4% a day).`;
    const lender = args.lender;
    if (!lender) return usage;
    if (lender.id === ctx.user.id) return "🏦 You can't borrow from yourself.";
    if (lender.bot) return "🏦 Bots don't lend. Try TODD (`r!bailout`), if you dare.";

    const amount = parsePolygons(args.amount);
    const rate = Number(String(args.interest || '').replace('%', ''));
    if (amount === null || amount <= 0) return usage;
    if (!Number.isFinite(rate) || rate < 0) return usage;
    if (rate > loans.RULES.maxRate) return `🏦 Interest can be at most **${loans.RULES.maxRate}%** a day.`;

    const me = ctx.db.player(ctx.guildId, ctx.user);
    if (me.debt > 0) return `🖥️ Borrowing from SOMEONE ELSE?! You owe ME **${amt(me.debt)}** first! (\`${P}repay\`)`;
    const existing = loans.between(ctx.db, ctx.guildId, ctx.user.id, lender.id);
    if (existing) return `🏦 There's already a loan between you and **${lender.username}**. Pay it off first (\`${P}loans\`).`;

    const req = { guildId: ctx.guildId, borrower: { id: ctx.user.id, username: ctx.user.username }, lender: { id: lender.id, username: lender.username }, amount, rate };
    const id = loans.addRequest(req);
    return {
      content: `<@${lender.id}>, you have a loan request.`,
      embeds: [requestCard(req, `Only ${lender.username} can answer. This request expires in 10 minutes.`)],
      components: [{
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, style: ButtonStyle.Success, label: `Lend ${amt(amount)}`, custom_id: `loan:accept:${id}` },
          { type: ComponentType.Button, style: ButtonStyle.Secondary, label: 'Decline', custom_id: `loan:decline:${id}` }
        ]
      }],
      allowedMentions: { users: [lender.id] } // ping only the lender
    };
  },

  // Someone pressed Accept or Decline. Returns { update } to edit the request, or { reply } to answer only them.
  async onButton(ctx, [action, id]) {
    const req = loans.requests.get(id);
    if (!req) return { update: { content: '', embeds: [{ title: '🏦 Loan request', description: 'This request expired or was already answered.', color: config.colorTodd }], components: [] } };
    if (ctx.user.id !== req.lender.id) return { reply: `Only ${req.lender.username} can answer this request.` };
    if (Date.now() > req.expires) {
      loans.takeRequest(id);
      return { update: { content: '', embeds: [requestCard(req, '⌛ This request expired.')], components: [] } };
    }

    if (action === 'decline') {
      loans.takeRequest(id);
      return { update: { content: '', embeds: [requestCard(req, `❌ **${req.lender.username}** declined.`)], components: [] } };
    }

    // Accept: check everything again, since time has passed
    const lenderP = ctx.db.player(req.guildId, ctx.user);
    if (lenderP.cash < req.amount) return { reply: `You only have ${have(lenderP.cash)}. You need ${amt(req.amount)} to lend this.` };
    const borrowerP = ctx.db.player(req.guildId, req.borrower);
    if (borrowerP.debt > 0) { loans.takeRequest(id); return { update: { content: '', embeds: [requestCard(req, '🖥️ The borrower owes TODD now, so this loan is off.')], components: [] } }; }
    if (loans.between(ctx.db, req.guildId, req.borrower.id, req.lender.id)) {
      loans.takeRequest(id);
      return { update: { content: '', embeds: [requestCard(req, 'There\'s already a loan between these two.')], components: [] } };
    }

    loans.takeRequest(id);
    loans.create(ctx.db, { guildId: req.guildId, lender: req.lender, borrower: req.borrower, amount: req.amount, rate: req.rate });
    if (req.rate >= loans.RULES.maxRate) A.award(ctx, 'loan_shark', req.lender.id);
    const terms = [['Amount', amt(req.amount)], ['Interest', `${req.rate}% a day`], ['Due', `<t:${Math.floor((Date.now() + loans.RULES.termMs) / 1000)}:R>`]];
    receipts.send(ctx, { title: `Loan received from ${req.lender.username}`, userId: req.borrower.id, username: req.borrower.username, lines: terms });
    receipts.send(ctx, { title: `Loan given to ${req.borrower.username}`, lines: terms });
    const due = Math.floor((Date.now() + loans.RULES.termMs) / 1000);
    return {
      update: {
        content: '',
        embeds: [requestCard(req, `✅ **Deal.** ${req.borrower.username} got **${amt(req.amount)}**. Due <t:${due}:R>. Pay it back with \`${P}payback @${req.lender.username} <amount>\`.`)],
        components: []
      }
    };
  }
};
