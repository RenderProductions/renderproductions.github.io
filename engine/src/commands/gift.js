// r!gift @player <amount> [note]: send Polygons to another player in this server.
// A 5% fee goes to the Polygon Reserve. No gifting while you owe TODD or have an overdue loan (so it can't
// be used to dodge garnishing), and at most ⬡ 5,000 sent per day.
const config = require('../config');
const A = require('../achievements');
const reserve = require('../reserve');
const receipts = require('../receipts');
const loans = require('../loans');
const { amt, have, parsePolygons, day } = require('../format');

const RULES = { fee: 0.05, min: 1_00, perDay: 5000_00 };

module.exports = {
  name: 'gift',
  aliases: ['send', 'tip'],
  description: 'Send Polygons to another player (5% fee)',
  usage: '@player <amount> [note]',
  options: [
    { name: 'player', type: 'user', description: 'Who gets it', required: true },
    { name: 'amount', type: 'string', description: 'How much they receive', required: true },
    { name: 'note', type: 'string', description: 'A message to go with it' }
  ],
  RULES,

  async run(ctx, args) {
    const P = config.prefix;
    const usage = `🎁 Usage: \`${P}gift @player <amount> [note]\`, like \`${P}gift @KorbedOut 100 thanks for the loan!\``;
    const to = args.player;
    if (!to) return usage;
    if (to.id === ctx.user.id) return "🎁 You can't gift yourself. Nice try.";
    if (to.bot) { A.award(ctx, 'tip_the_house'); return "🎁 The house doesn't take tips. It takes everything else, though."; }
    const cents = parsePolygons(args.amount);
    if (cents === null) return usage;
    if (cents < RULES.min) return `🎁 The smallest gift is ${amt(RULES.min)}.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt > 0) return `🖥️ Giving away MY Polygons? Pay me back first. You owe **${amt(p.debt)}**. (\`${P}repay\`)`;
    if (loans.overdue && loans.active(ctx.db, ctx.guildId, { borrower: ctx.user.id }).some((l) => loans.overdue(l))) {
      return `🏦 You have an overdue loan. Pay it back first (\`${P}loans\`).`;
    }
    const today = day(Date.now());
    const sentKey = `gift_sent:${ctx.guildId}:${ctx.user.id}:${today}`;
    const sent = Number(ctx.db.meta(sentKey)) || 0;
    if (sent + cents > RULES.perDay) return `🎁 You can send up to ${amt(RULES.perDay)} a day. You have ${amt(Math.max(0, RULES.perDay - sent))} left today.`;
    const fee = Math.max(1, Math.round(cents * RULES.fee));
    if (p.cash < cents + fee) return `🎁 Gifting ${amt(cents)} costs ${amt(cents + fee)} with the ${RULES.fee * 100}% fee. You have ${have(p.cash)}.`;

    const note = String(args.note || '').trim().slice(0, 200);
    ctx.db.tx(() => {
      ctx.db.player(ctx.guildId, to);
      ctx.db.addCash(ctx.guildId, ctx.user.id, -(cents + fee));
      ctx.db.addCash(ctx.guildId, to.id, cents);
      reserve.take(ctx.db, fee);
      ctx.db.setMeta(sentKey, sent + cents);
    });
    if (A.bump(ctx, 'gifted', cents) >= 1000_00) A.award(ctx, 'generous');
    receipts.send(ctx, { title: `Gift to ${to.username}`, lines: [['Sent', amt(cents)], ['Fee', amt(fee)], ['Polygons left', have(p.cash - cents - fee)], ...(note ? [['Note', note]] : [])] });
    receipts.send(ctx, { title: `Gift from ${ctx.user.username}`, userId: to.id, username: to.username, lines: [['Received', amt(cents)], ...(note ? [['Note', note]] : [])] });
    return {
      content: `🎁 <@${to.id}>, **${ctx.user.username}** sent you **${amt(cents)}**!${note ? `\n> ${note.replace(/\n/g, ' ')}` : ''}\n-# Fee: ${amt(fee)} to the Polygon Reserve`,
      allowedMentions: { users: [to.id] }
    };
  }
};
