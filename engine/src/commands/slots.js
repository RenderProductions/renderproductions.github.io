const config = require('../config');
const { money, have, amt, parsePolygons } = require('../format');
const { button, rows } = require('../buttons');

const COOLDOWN_MS = 10_000;
const SYMBOLS = ['🍒', '🍋', '🔔', '🔺', '💎'];
const TRIPLE = { '💎': 25, '🔺': 10, '🔔': 8, '🍋': 5, '🍒': 3 };
const lastSpin = new Map(); // user id -> ms

module.exports = {
  name: 'slots',
  description: 'Spin the Rend-Sino slot machine',
  usage: '<amount>',
  options: [{ name: 'amount', type: 'string', description: 'Bet, ⬡ 10 to ⬡ 1,000', required: true }],
  lastSpin,

  async run(ctx, args) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt > 0) {
      return `🖥️ GAMBLING?!? With MY money?! NOT a CHANCE. You owe me **${amt(p.debt)}**. (\`${config.prefix}repay\`)`;
    }
    const wait = (lastSpin.get(ctx.user.id) || 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) return `Easy. The machine needs ${Math.ceil(wait / 1000)}s to cool down.`;

    const bet = parsePolygons(args.amount);
    if (bet === null) return `Usage: \`${config.prefix}slots AMOUNT\`, for example \`${config.prefix}slots 50\` or \`${config.prefix}slots 12.50\``;
    if (bet < 10_00) return `The minimum bet is ${amt(10_00)}.`;
    if (bet > 1000_00) return `The maximum bet is ${amt(1000_00)}.`;
    if (p.cash < bet) return `You only have ${have(p.cash)}.`;

    lastSpin.set(ctx.user.id, Date.now());
    const random = ctx.random || Math.random;
    const spin = () => SYMBOLS[Math.floor(random() * SYMBOLS.length)];
    const [x, y, z] = [spin(), spin(), spin()];

    let win = 0;
    if (x === y && y === z) win = bet * TRIPLE[x];
    else if (x === y || y === z || x === z) win = bet; // any pair returns your bet

    const bal = p.cash - bet + win;
    ctx.db.addCash(ctx.guildId, ctx.user.id, win - bet);

    return {
      embeds: [{
        title: '🎰 Rend-Sino!',
        description: `**{ ${x} | ${y} | ${z} }**\n\nBet: ${amt(bet)} · Won: ${amt(win)}\nPolygons: ${have(bal)}`,
        footer: { text: '3 of a kind: 🍒3x 🍋5x 🔔8x 🔺10x 💎25x · any pair returns your bet' },
        color: config.color
      }],
      components: rows([button(`Spin again (${amt(bet)})`, `slots:${ctx.user.id}:${bet}`, 'primary')])
    };
  },

  // "Spin again" re-spins in the same message with the same bet
  buttonPrefix: 'slots',
  async onButton(ctx, [userId, bet]) {
    if (ctx.user.id !== userId) return { reply: 'Get your own machine: `r!slots <amount>`.' };
    const out = await module.exports.run(ctx, { amount: (Number(bet) / 100).toFixed(2) });
    if (typeof out === 'string') return { reply: out }; // cooldown, not enough Polygons, TODD...
    return { update: out };
  }
};
