// r!coinflip <amount> [heads|tails]: 50/50, pays 1.95x.
const casino = require('../casino');
const { amt, have } = require('../format');

const PAYS = 1.95;

module.exports = {
  name: 'coinflip',
  aliases: ['cf', 'flip'],
  description: 'Flip a coin: call it right for 1.95x',
  usage: '<amount> [heads|tails]',
  options: [
    { name: 'amount', type: 'string', description: 'Your bet', required: true },
    { name: 'side', type: 'string', description: 'heads or tails (default heads)' }
  ],

  async run(ctx, args) {
    const side = String(args.side || 'heads').trim().toLowerCase()[0] === 't' ? 'tails' : 'heads';
    const t = casino.takeBet(ctx, 'coinflip', args.amount);
    if (!t.bet) return t.error || casino.usage('coinflip', 'coinflip <amount> heads|tails');
    const flip = (ctx.random || Math.random)() < 0.5 ? 'heads' : 'tails';
    const won = flip === side;
    const cash = casino.payout(ctx, 'coinflip', won ? t.bet * PAYS : 0);
    return { embeds: [{
      title: '🪙 Coinflip',
      description: `You called **${side}**. It's... **${flip}!** ${flip === 'heads' ? '🙂' : '🦅'}\n\n` +
        (won ? `**You win ${amt(Math.round(t.bet * PAYS))}!**` : `You lose ${amt(t.bet)}.`) + `\nPolygons: ${have(cash)}`,
      color: won ? 0x57f287 : 0xed4245
    }] };
  }
};
