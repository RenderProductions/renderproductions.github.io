// r!dice <amount> over|under <number>: roll 1-100. The riskier the call, the bigger the payout.
const casino = require('../casino');
const { amt, have } = require('../format');

const EDGE = 0.96; // pays 96% of the fair odds

module.exports = {
  name: 'dice',
  aliases: ['roll'],
  description: 'Roll 1-100: bet it lands over or under your number',
  usage: '<amount> over|under <number>',
  options: [
    { name: 'amount', type: 'string', description: 'Your bet', required: true },
    { name: 'call', type: 'string', description: 'over or under, then a number from 5 to 95. Example: over 70', required: true }
  ],

  async run(ctx, args) {
    const m = String(args.call || '').trim().toLowerCase().match(/^(over|under|o|u)\s*(\d+)$/);
    const help = casino.usage('dice', 'dice <amount> over|under <5-95>') + `, like \`dice 100 over 70\` (pays ${(EDGE / 0.3).toFixed(2)}x)`;
    if (!m) return help;
    const over = m[1][0] === 'o';
    const n = Number(m[2]);
    if (n < 5 || n > 95) return '🎲 Pick a number from 5 to 95.';
    // over n wins on n+1..100; under n wins on 1..n-1
    const chance = over ? (100 - n) / 100 : (n - 1) / 100;
    const pays = Math.floor((EDGE / chance) * 100) / 100;
    const t = casino.takeBet(ctx, 'dice', args.amount);
    if (!t.bet) return t.error || help;
    const roll = 1 + Math.floor((ctx.random || Math.random)() * 100);
    const won = over ? roll > n : roll < n;
    const cash = casino.payout(ctx, 'dice', won ? t.bet * pays : 0);
    return { embeds: [{
      title: '🎲 Dice',
      description: `You bet **${over ? 'over' : 'under'} ${n}** (${Math.round(chance * 100)}% chance, pays **${pays}x**).\nYou rolled... **${roll}!**\n\n` +
        (won ? `**You win ${amt(Math.round(t.bet * pays))}!**` : `You lose ${amt(t.bet)}.`) + `\nPolygons: ${have(cash)}`,
      color: won ? 0x57f287 : 0xed4245
    }] };
  }
};
