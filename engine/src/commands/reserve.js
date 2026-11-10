// r!reserve: how full the house's Polygon Reserve is. The bot owner can also top it up.
const config = require('../config');
const reserve = require('../reserve');
const { have, amt, parsePolygons } = require('../format');

module.exports = {
  name: 'reserve',
  aliases: ['vault'],
  description: "See how many Polygons the house has left",
  usage: '',
  options: [{ name: 'fund', type: 'string', description: 'Bot owner only: add Polygons to the reserve' }],

  async run(ctx, args) {
    const raw = String(args.fund || '').trim().toLowerCase().replace(/^fund\s+/, '');
    if (raw) {
      if (!config.ownerId || ctx.user.id !== config.ownerId) return '🏦 Only the bot owner can fund the reserve. Buy stock and shop to fill it up instead!';
      const cents = parsePolygons(raw);
      if (!cents || cents <= 0) return `🏦 Usage: \`${config.prefix}reserve fund <amount>\``;
      reserve.take(ctx.db, cents);
      return `🏦 TODD wheels in **${amt(cents)}**. The Polygon Reserve now holds **${have(reserve.get(ctx.db))}**.`;
    }

    const cents = reserve.get(ctx.db);
    const l = reserve.level(ctx.db);
    const f = reserve.factor(ctx.db);
    const pct = Math.max(0, Math.round(l * 100));
    const m = await ctx.market.get();
    const mood = cents <= 0 ? '💀 **EMPTY.** The house is out of Polygons. The market is going down with it.'
      : l < 0.1 ? '🚨 **Almost empty.** One big cash-out away from a crash.'
      : l < 0.25 ? '⚠️ **Running low.** Payouts are shrinking.'
      : l < 0.5 ? '😬 **Under half.** TODD is starting to sweat.'
      : l < 1 ? '🙂 **Healthy.**' : '🤑 **Overflowing.** The house is doing great.';
    const refill = m && m.crash && m.crash.phase === 'recovery' && l < reserve.RULES.refillTo
      ? '\n🩹 The crash recovery is slowly refilling it.' : '';
    return {
      embeds: [{
        title: '🏦 The Polygon Reserve',
        description: `\`${reserve.bar(l)}\` **${pct}%**\n**${have(cents)}** of ${have(reserve.RULES.start)}\n\n${mood}${refill}\n` +
          `Payouts: **${Math.round(f * 100)}%**${f < 1 ? ' (shrunk)' : ''}`,
        fields: [
          { name: '📉 Drains it', value: 'Work, daily, dividends, slots wins, mystery prizes, TODD bailouts, and **selling stock** back to the house.' },
          { name: '📈 Fills it', value: 'Buying stock, the shop, slots losses, repaying TODD, and company upkeep and fees.' },
          { name: '💥 If it hits zero', value: 'A market crash starts. Payouts drop to as little as 10% until it recovers.' }
        ],
        footer: { text: 'One reserve, shared by every server.' },
        color: l < 0.25 ? 0xff6b6b : config.color
      }]
    };
  }
};
