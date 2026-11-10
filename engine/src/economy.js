// Shared money logic used by several commands.

// How many shares of a ticker a player owns, applying any bankruptcy wipe they haven't seen yet.
// When a company goes bankrupt, prices.json bumps its "wipes" count, and every holder's shares go to 0.
function shares(ctx, m, ticker, userId = ctx.user.id) {
  const h = ctx.db.holding(ctx.guildId, userId, ticker);
  const wipes = Number((m && m.wipes && m.wipes[ticker]) || 0);
  if (m && wipes > h.wipe_seen) {
    ctx.db.updateHolding(ctx.guildId, userId, ticker, { shares: 0, div_shares: 0, wipe_seen: wipes });
    return 0;
  }
  return h.shares;
}

// Cash + every share at today's price, in cents (debt not subtracted).
function worth(ctx, m, player, userId = ctx.user.id) {
  let total = player.cash;
  for (const c of m.companies) total += shares(ctx, m, c.id, userId) * Math.round(Number(m.prices[c.id]) * 100);
  return total;
}

module.exports = { shares, worth };
