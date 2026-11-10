// r!gambling: your casino record, game by game. Plus the house rules.
const config = require('../config');
const casino = require('../casino');
const { amt } = require('../format');

module.exports = {
  name: 'gambling',
  aliases: ['casino', 'gamblestats'],
  description: 'Your casino record and the list of games',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const rows = casino.stats(ctx.db, ctx.guildId, ctx.user.id);
    const net = rows.reduce((s, r) => s + r.paid - r.wagered, 0);
    const lines = rows.length ? rows.map((r) => {
      const n = r.paid - r.wagered;
      return `${casino.NAMES[r.game] || r.game}: ${r.played} played · ${n >= 0 ? '📈 +' : '📉 '}${amt(n)} · best ${amt(r.biggest)}`;
    }).join('\n') : 'No bets yet. Pick a game below!';
    const games = [
      `\`${P}slots <bet>\` · \`${P}coinflip <bet> heads|tails\` · \`${P}dice <bet> over|under <n>\``,
      `\`${P}blackjack <bet>\` · \`${P}bus <bet>\` (Ride the Bus) · \`${P}hilo <bet>\` (Higher or Lower)`,
      `\`${P}mines <bet> [bombs]\` · \`${P}rocket <bet>\` · \`${P}derby <horse> <bet>\` · \`${P}lottery\``
    ].join('\n');
    return { embeds: [{
      title: `🎲 ${ctx.user.username} at the Rend-Sino`,
      description: `${lines}\n\n**Overall:** ${net >= 0 ? '📈 +' : '📉 '}${amt(net)}`,
      fields: [
        { name: 'Games', value: games },
        { name: 'House rules', value: `Bets from ${amt(casino.RULES.minBet)} up to ${amt(casino.RULES.maxBet.coinflip)} (${amt(casino.RULES.maxBet.derby)} on the derby). One game at a time. Every bet goes into the Polygon Reserve, and winnings come out of it.` }
      ],
      color: net >= 0 ? 0x57f287 : 0xed4245
    }] };
  }
};
