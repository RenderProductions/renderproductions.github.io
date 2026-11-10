const config = require('../config');
const { money, have, amt } = require('../format');
const econ = require('../economy');

// Each company's dividend total (prices.json "dividends") only ever goes up. A player earns
// (total now - total at their last claim) x shares they held at their last claim, so shares
// bought since then start earning from this claim on. Fractions of a cent carry over.
module.exports = {
  name: 'dividends',
  aliases: ['div', 'divs'],
  description: 'Collect what your shares have earned',
  options: [],

  async run(ctx) {
    const m = await ctx.market.get();
    if (!m || !m.dividends || typeof m.dividends[m.companies[0].id] !== 'number') {
      return "⚠️ Couldn't reach the market data. Try again in a minute.";
    }

    const lines = [];
    const pay = ctx.db.tx(() => {
      const p = ctx.db.player(ctx.guildId, ctx.user);
      let total = p.div_carry;
      for (const c of m.companies) {
        const t = c.id;
        const now = Number(m.dividends[t]) || 0;
        const held = econ.shares(ctx, m, t);
        const h = ctx.db.holding(ctx.guildId, ctx.user.id, t);
        const elig = Math.min(h.div_shares, held);
        const earn = Math.max(0, (now - h.div_index) * elig);
        total += earn;
        ctx.db.updateHolding(ctx.guildId, ctx.user.id, t, { div_index: now, div_shares: held });
        lines.push(`**${t}** · ${elig} earning shares · +${earn.toFixed(2)}\n${(m.divText && m.divText[t]) || ''}`);
      }
      // Pay to the cent, keep anything smaller for next time
      const cents = Math.floor(total * 100 + 1e-9);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { div_carry: Math.round((total - cents / 100) * 10000) / 10000 });
      ctx.db.addCash(ctx.guildId, ctx.user.id, cents);
      return cents;
    });

    return {
      embeds: [{
        title: '💰 Dividends',
        description: `You collected **${amt(pay)}**.\n\n${lines.join('\n\n')}\n\n` +
          'Shares you bought since your last claim start earning now. Unclaimed dividends keep building, so claim whenever you like.',
        color: config.color
      }]
    };
  }
};
