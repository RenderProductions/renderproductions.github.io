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
      `\`${P}slots <bet>\` · \`${P}coinflip <bet> heads|tails\` · \`${P}dice <bet> over|under <n>\` · \`${P}roulette <bet> red|black|17\``,
      `\`${P}blackjack <bet>\` · \`${P}bus <bet>\` (Ride the Bus) · \`${P}hilo <bet>\` (Higher or Lower)`,
      `\`${P}mines <bet> [bombs]\` · \`${P}rocket <bet>\` · \`${P}derby <horse> <bet>\` · \`${P}lottery\``
    ].join('\n');
    const ban = casino.bannedUntil(ctx.db, ctx.guildId, ctx.user.id);
    const streak = casino.winStreak(ctx.db, ctx.guildId, ctx.user.id);
    const heat = ban ? `\n\n🚫 **Thrown out by TODD.** You can gamble again <t:${Math.floor(ban / 1000)}:R>.`
      : streak >= 3 ? `\n\n🔥 **${streak} wins in a row.** TODD is watching. (${casino.RULES.hotStreak} and he throws you out for ${casino.RULES.banMs / 3600000} hours.)` : '';
    return { embeds: [{
      title: `🎲 ${ctx.user.username} at the Rend-Sino`,
      description: `${lines}\n\n**Overall:** ${net >= 0 ? '📈 +' : '📉 '}${amt(net)}${heat}`,
      fields: [
        { name: 'Games', value: games },
        { name: 'House rules', value: `Bets from ${amt(casino.RULES.minBet)} up to ${amt(casino.RULES.maxBet.coinflip)} (${amt(casino.RULES.maxBet.derby)} on the derby). One game at a time. Win ${casino.RULES.hotStreak} in a row and TODD throws you out for ${casino.RULES.banMs / 3600000} hours. Every bet goes into the Polygon Reserve, and winnings come out of it.` }
      ],
      color: net >= 0 ? 0x57f287 : 0xed4245
    }] };
  }
};
