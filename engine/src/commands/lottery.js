// r!lottery: the pot and your tickets. r!lottery buy <tickets>: ⬡ 50 each, up to 20 per draw.
const config = require('../config');
const lotto = require('../lottery');
const { amt } = require('../format');

module.exports = {
  name: 'lottery',
  aliases: ['lotto'],
  description: 'The weekly lottery: see the pot, or buy tickets',
  usage: '[buy <tickets>]',
  options: [{ name: 'buy', type: 'string', description: 'How many tickets to buy (⬡ 50 each, up to 20 per draw)' }],

  async run(ctx, args) {
    const P = config.prefix;
    const raw = String(args.buy || '').trim().toLowerCase().replace(/^buy\s*/, '');
    if (raw) {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) return `🎟️ Usage: \`${P}lottery buy <tickets>\`, like \`${P}lottery buy 3\`.`;
      const r = lotto.buy(ctx, n);
      if (r.error) return r.error;
      return `🎟️ You bought **${n}** ticket${n === 1 ? '' : 's'} for ${amt(r.cost)}. You hold **${r.owned}** for Sunday's draw. Pot: **${amt(lotto.pot(ctx.db, ctx.guildId))}**.`;
    }
    const draw = lotto.nextDraw();
    const s = lotto.sold(ctx.db, ctx.guildId, draw);
    const mine = lotto.tickets(ctx.db, ctx.guildId, draw, ctx.user.id);
    return { embeds: [{
      title: '🎟️ The Lottery',
      description: `# ${amt(lotto.pot(ctx.db, ctx.guildId))}\nDrawn <t:${Math.floor(lotto.drawTime(draw) / 1000)}:R> (Sunday, 8 PM Eastern)\n\n` +
        `Tickets sold: **${s.n}** to **${s.players}** player${s.players === 1 ? '' : 's'}\nYour tickets: **${mine}**${s.n ? ` (a ${Math.round((mine / s.n) * 100)}% chance)` : ''}\n\n` +
        `Buy with \`${P}lottery buy <tickets>\`: ${amt(lotto.RULES.price)} each, up to ${lotto.RULES.maxTickets} per draw. 90% goes into the pot.`,
      color: config.color
    }] };
  }
};
