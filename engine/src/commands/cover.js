// r!cover <ticker|all>: close a short (buy back the borrowed shares)
const config = require('../config');
const S = require('../shorts');
const A = require('../achievements');
const receipts = require('../receipts');
const reserve = require('../reserve');
const { amt, have } = require('../format');

module.exports = {
  name: 'cover',
  aliases: ['closeshort'],
  description: 'Close a short position',
  usage: '<ticker|all>',
  options: [{ name: 'ticker', type: 'string', description: 'Which short to close, or all', required: true }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const m = await ctx.market.get();
    if (!m) return 'The market is offline right now. Try again shortly.';
    const closed = ctx.market.closedReason(m);
    if (closed) return closed;
    const t = String(args.ticker || '').toUpperCase();
    const mine = S.list(ctx.db, ctx.guildId, ctx.user.id);
    const which = t === 'ALL' ? mine : mine.filter((s) => s.ticker === t);
    if (!which.length) return mine.length ? `🐻 You don't have a short on ${t || 'that'}. Yours: ${mine.map((s) => s.ticker).join(', ')}.` : `🐻 You have no shorts open. Open one with \`${P}short <ticker> <shares>\`.`;
    const lines = [];
    for (const s of which) {
      const r = S.cover(ctx.db, s, S.settlePrice(s, ctx.market.quote(m, s.ticker)));
      if (r.pnl >= 1000_00) A.award(ctx, 'big_short');
      lines.push(`**${s.ticker}**: covered ${s.shares} at ${amt(r.price)} (shorted at ${amt(s.entry)}) · ${r.pnl >= 0 ? `profit **+${amt(r.pnl)}**` : `loss **${amt(r.pnl)}**`} · back to you: ${amt(r.back)}`);
      receipts.send(ctx, { title: `Covered ${s.shares} ${s.ticker}`, lines: [['Shorted at', amt(s.entry)], ['Covered at', amt(r.price)], [r.pnl >= 0 ? 'Profit' : 'Loss', amt(Math.abs(r.pnl))], ['Back to you', amt(r.back)]] });
    }
    return `🐻 ${lines.join('\n')}\n-# You have ${have(ctx.db.player(ctx.guildId, ctx.user).cash)} now.${reserve.note(ctx.db)}`;
  }
};
