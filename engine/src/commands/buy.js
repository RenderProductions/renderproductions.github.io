const config = require('../config');
const receipts = require('../receipts');
const { money, have, amt } = require('../format');
const econ = require('../economy');
const co = require('../companies');

// Buying shares of a player company (see src/companies.js)
async function buyPlayerCompany(ctx, m, pc, amount) {
  if (pc.status === 'dead') return `💀 ${pc.name} (${pc.ticker}) went under. Its shares are gone.`;
  if (pc.status !== 'public') return `🔒 ${pc.name} (${pc.ticker}) is private. It has to \`${config.prefix}ipo\` before anyone can buy in.`;
  if (m) { const closed = ctx.market.closedReason(m); if (closed) return closed; }
  const raw = String(amount || '').trim().toLowerCase();
  const n = Number(raw);
  if (raw === '' || Number.isNaN(n)) return `The amount must be a whole number, for example \`${config.prefix}buy ${pc.ticker} 5\`.`;
  if (n <= 0) return 'The amount must be at least 1.';
  if (!Number.isInteger(n)) return 'You can only buy whole shares.';
  const r = co.buy(ctx.db, { guildId: ctx.guildId, user: ctx.user, ticker: pc.ticker, n });
  if (r.error) return r.error;
  const cash = ctx.db.player(ctx.guildId, ctx.user).cash;
  receipts.send(ctx, { title: `Bought ${n} ${pc.ticker}`, lines: [
    ['Company', `${pc.name} (${pc.ticker})`], ['Shares', n], ['Price per share', amt(r.priceCents)],
    ['Total cost', amt(r.cost)], ['Polygons left', have(cash)], ['You now own', `${r.held} ${pc.ticker}`]] });
  return {
    embeds: [{
      title: `Order filled: bought ${n} ${pc.ticker}`,
      description: `Price per share: **${amt(r.priceCents)}**\nTotal cost: **${amt(r.cost)}**\n` +
        `Polygons left: **${have(cash)}**\nYou now own **${r.held}** shares of ${pc.ticker}.` +
        (r.raised ? `\n🏢 ${amt(r.raised)} of that went into ${pc.name}'s treasury (IPO shares).` : ''),
      color: config.color
    }]
  };
}

module.exports = {
  name: 'buy',
  description: 'Buy shares in a company',
  usage: '<ticker> <amount>',
  options: [
    { name: 'ticker', type: 'string', description: 'Company ticker, e.g. RRM', required: true },
    { name: 'amount', type: 'string', description: 'How many shares (or "max")', required: true }
  ],

  async run(ctx, args) {
    const m = await ctx.market.get();
    const t = String(args.ticker || '').toUpperCase();
    const list = ctx.market.tickerList(m);
    if (!ctx.market.ids(m).includes(t)) {
      const pc = co.get(ctx.db, t);
      if (pc && pc.status !== 'rejected' && pc.status !== 'pending') return buyPlayerCompany(ctx, m, pc, args.amount);
      return `Usage: \`${config.prefix}buy <ticker> <amount>\`, for example \`${config.prefix}buy RRM 5\`. Tickers: ${list}.`;
    }
    if (!m) return 'The market is offline right now. Try again shortly.';

    const raw = String(args.amount || '').trim().toLowerCase();
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const q = ctx.market.quote(m, t);

    let qty = raw === 'max' && q.priceCents > 0 ? Math.floor(p.cash / q.priceCents) : Number(raw);
    if (raw === '' || Number.isNaN(qty)) return `The amount must be a whole number, for example \`${config.prefix}buy RRM 5\`.`;
    if (qty <= 0) return 'The amount must be at least 1.';
    if (!Number.isInteger(qty)) return 'You can only buy whole shares.';

    const closed = ctx.market.closedReason(m);
    if (closed) return closed;
    if (q.status === 'bankrupt') return `${q.statusText}\nYou can't buy shares in a bankrupt company.`;
    if (q.priceCents <= 0) return `${t} is worth nothing right now. Trading is paused.`;

    const cost = qty * q.priceCents;
    if (p.cash < cost) return `Not enough Polygons. That order costs ${amt(cost)} and you have ${have(p.cash)}.`;

    const held = ctx.db.tx(() => {
      const now = econ.shares(ctx, m, t) + qty;
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      ctx.db.updateHolding(ctx.guildId, ctx.user.id, t, { shares: now });
      ctx.db.logTrade(ctx.guildId, ctx.user.id, t, qty, q.priceCents);
      return now;
    });

    receipts.send(ctx, { title: `Bought ${qty} ${t}`, lines: [
      ['Company', `${q.name} (${t})`], ['Shares', qty], ['Price per share', amt(q.priceCents)],
      ['Total cost', amt(cost)], ['Polygons left', have(p.cash - cost)], ['You now own', `${held} ${t}`]] });

    const warn = q.status === 'distressed'
      ? `\n⚠️ ${t} is under 3.00. If it drops below zero it goes **bankrupt** and your shares are wiped.` : '';

    return {
      embeds: [{
        title: `Order filled: bought ${qty} ${t}`,
        description: `Price per share: **${amt(q.priceCents)}**\nTotal cost: **${amt(cost)}**\n` +
          `Polygons left: **${have(p.cash - cost)}**\nYou now own **${held}** shares of ${t}.${warn}`,
        color: config.color
      }]
    };
  }
};
