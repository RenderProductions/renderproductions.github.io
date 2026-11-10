// r!boost: the bot owner's boost controls. Same as the Actions tab's "Boost the market".
//   r!boost                                         what's going on now
//   r!boost start [small|normal|big] [hours] [TICKERS...] [| your own headline]
//   r!boost stop
const config = require('../config');
const engine = require('../marketEngine');
const { TICKERS } = require('../../../.github/scripts/market/controls');

const HELP = (P) => `🚀 \`${P}boost start [small|normal|big] [hours] [tickers] | headline\` · \`${P}boost stop\`\nExample: \`${P}boost start big 3 BNW | BNW strikes gold!\``;

module.exports = {
  name: 'boost',
  description: 'Bot owner: boost the market for an event',
  usage: 'start [strength] [hours] [tickers] | headline   or   stop',
  modOnly: true,
  options: [{ name: 'action', type: 'string', description: 'start [small|normal|big] [hours] [tickers] | headline, or stop' }],

  async run(ctx, args) {
    const P = config.prefix;
    if (!config.ownerId || ctx.user.id !== config.ownerId) return '🚀 Only the bot owner can boost the market. Buy low, sell high instead!';
    const raw = String(args.action || '').trim();
    const [head, ...rest] = raw.split('|');
    const headline = rest.join('|').trim();
    const words = head.trim().split(/\s+/).filter(Boolean);
    const action = (words.shift() || '').toLowerCase();
    if (!action) {
      const m = await ctx.market.get();
      return `${(m && m.boostText) || '😴 No boost right now.'}\n${HELP(P)}`;
    }
    if (!['start', 'stop'].includes(action)) return HELP(P);
    const strength = words.map((w) => w.toLowerCase()).find((w) => ['small', 'normal', 'big'].includes(w)) || 'normal';
    const hours = words.find((w) => /^\d+(\.\d+)?$/.test(w));
    const tickers = words.map((w) => w.toUpperCase()).filter((w) => TICKERS.includes(w));
    const input = { action, strength, hours, tickers, headline };

    if (engine.enabled()) {
      const r = await engine.control(ctx.db, 'boost', input);
      if (r.error) return `🚀 ${r.error}`;
    } else {
      const r = await engine.dispatch('boost.yml', { action: action === 'start' ? 'start a boost' : 'stop the boost now',
        strength, hours: hours || '6', tickers: tickers.join(' '), headline });
      if (r.error) return `🚀 ${r.error}`;
      return `🚀 Sent to GitHub: **${action === 'start' ? 'start a boost' : 'stop the boost'}**. The market picks it up within a minute or two.`;
    }
    const m = await ctx.market.get();
    return action === 'start' ? `🚀 **Boost on!** ${(m && m.boostText) || ''}` : '🛑 **Boost stopped.**';
  }
};
