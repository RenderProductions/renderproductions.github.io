// Shared money logic used by several commands.

// How many shares of a ticker a player owns, applying any bankruptcy wipe they haven't seen yet.
// When a company goes bankrupt, prices.json bumps its "wipes" count, and every holder's shares go to 0.
function shares(ctx, m, ticker, userId = ctx.user.id) {
  const h = ctx.db.holding(ctx.guildId, userId, ticker);
  const wipes = Number((m && m.wipes && m.wipes[ticker]) || 0);
  if (m && wipes > h.wipe_seen) {
    // An Insurance Policy in the inventory saves the shares (once)
    if (h.shares > 0 && require('./effects').usePassive(ctx.db, ctx.guildId, userId, 'insurance')) {
      ctx.db.updateHolding(ctx.guildId, userId, ticker, { wipe_seen: wipes });
      if (ctx.notes && ctx.user && ctx.user.id === userId) ctx.notes.push(`🛡️ **Insurance paid out!** ${ticker} went bankrupt, but your Insurance Policy saved your **${h.shares}** shares.`);
      return h.shares;
    }
    ctx.db.updateHolding(ctx.guildId, userId, ticker, { shares: 0, div_shares: 0, wipe_seen: wipes });
    ctx.db.clearLots(ctx.guildId, userId, ticker);
    if (h.shares > 0) require('./achievements').award(ctx, 'wiped_out', userId);
    return 0;
  }
  return h.shares;
}

// Cash + every share at today's price, in cents (debt not subtracted).
function worth(ctx, m, player, userId = ctx.user.id) {
  let total = player.cash;
  for (const c of m.companies) total += shares(ctx, m, c.id, userId) * Math.round(Number(m.prices[c.id]) * 100);
  // Shares a broker is holding for them count too (src/trading.js)
  return total + playerCompanyValue(ctx, userId).total + require('./trading').value(ctx.db, ctx.guildId, userId, m);
}

// Value of a player's shares in player companies: { total cents, rows: [{ ticker, name, shares, value }] }
function playerCompanyValue(ctx, userId = ctx.user.id) {
  const co = require('./companies');
  const rows = co.holdingsOf(ctx.db, ctx.guildId, userId).map((h) => {
    const c = co.get(ctx.db, h.ticker);
    const value = c && c.status === 'public' ? h.shares * Math.round(c.price * 100) : 0;
    return { ticker: h.ticker, name: c ? c.name : h.ticker, shares: h.shares, value };
  });
  return { total: rows.reduce((a, r) => a + r.value, 0), rows };
}

module.exports = { shares, worth, playerCompanyValue };
