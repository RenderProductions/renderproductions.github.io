// r!short: bet a company's stock will fall.
//   r!short                   your short positions
//   r!short <ticker> <qty>    open (or add to) a short
//   r!cover <ticker|all>      close it (see commands/cover.js)
const config = require('../config');
const S = require('../shorts');
const A = require('../achievements');
const reserve = require('../reserve');
const { amt, have } = require('../format');

function view(ctx, m) {
  const P = config.prefix;
  const rows = S.list(ctx.db, ctx.guildId, ctx.user.id);
  const lines = rows.map((s) => {
    const q = m ? ctx.market.quote(m, s.ticker) : null;
    const price = S.settlePrice(s, q);
    const p = S.pnl(s, price);
    const callAt = s.entry + Math.floor(s.margin * S.RULES.call / s.shares);
    return `**${s.ticker}** · ${s.shares} shares shorted at ${amt(s.entry)} · now ${amt(price)}\n` +
      `${p >= 0 ? '📉 Up' : '📈 Down'} **${amt(Math.abs(p))}** · margin ${amt(s.margin)} · margin call at ${amt(callAt)}`;
  });
  return {
    embeds: [{
      title: '🐻 Your shorts',
      description: (lines.length ? lines.join('\n\n') : "No shorts open. A short pays off when a stock falls.") +
        `\n\n**How it works:** \`${P}short <ticker> <shares>\` sells borrowed shares at today's price. You set aside half their value as margin, plus a 1% fee. ` +
        `\`${P}cover <ticker>\` buys them back: if the price dropped, you keep the difference. If it climbs too far, TODD covers it for you (a margin call). Up to ${S.RULES.maxShares} shares per company.`,
      color: 0x8c6239
    }]
  };
}

module.exports = {
  name: 'short',
  aliases: ['shorts', 'shortsell'],
  description: "Short a stock: profit when it falls (r!cover to close)",
  usage: '[<ticker> <shares>]',
  options: [
    { name: 'ticker', type: 'string', description: 'One of the five main companies' },
    { name: 'shares', type: 'string', description: `How many shares (up to ${S.RULES.maxShares})` }
  ],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const m = await ctx.market.get();
    if (!args.ticker) return view(ctx, m);
    if (!m) return 'The market is offline right now. Try again shortly.';
    const t = String(args.ticker).toUpperCase();
    const q = ctx.market.quote(m, t);
    if (!q) return `🐻 You can short the five main companies: ${ctx.market.tickerList(m)}.`;
    const closed = ctx.market.closedReason(m);
    if (closed) return closed;
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt > 0) return `🖥️ Betting against MY market while you owe me **${amt(p.debt)}**? No. (\`${P}repay\`)`;
    const qty = Number(String(args.shares || '').replace(/,/g, ''));
    if (!Number.isInteger(qty) || qty < 1) return `🐻 Usage: \`${P}short <ticker> <shares>\`, like \`${P}short BNW 10\`.`;
    const r = S.open(ctx.db, ctx.guildId, ctx.user.id, q, qty);
    if (r.error === 'price') return `🐻 ${t} can't be shorted right now.`;
    if (r.error === 'max') return `🐻 You can short up to ${S.RULES.maxShares} shares of each company. Room left in ${t}: **${Math.max(0, r.room)}**.`;
    if (r.error === 'cash') return `🐻 Shorting ${qty} ${t} needs **${amt(r.need)}** (half its value as margin, plus a 1% fee). You have ${have(r.have)}.`;
    A.award(ctx, 'bear');
    const s = r.short;
    return `🐻 **Shorted ${qty} ${t} at ${amt(q.priceCents)}.** You're betting it falls.\n` +
      `Margin set aside: **${amt(r.margin)}** · fee ${amt(r.fee)}\n` +
      `-# Position: ${s.shares} shares at ${amt(s.entry)}. Margin call if it climbs to ${amt(s.entry + Math.floor(s.margin * S.RULES.call / s.shares))}. Close it with \`${P}cover ${t}\`.${reserve.note(ctx.db)}`;
  }
};
