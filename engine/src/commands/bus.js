// r!bus <amount>: Ride the Bus. Four guesses in a row, cash out between any of them.
//   1. Red or black?   2. Higher or lower than card 1? (a tie loses)
//   3. Inside or outside cards 1 and 2? (matching either loses)   4. Which suit?
// Every button shows what it pays, worked out from the cards still in the deck (96% of the fair odds),
// so a long shot pays more and a sure thing pays less, and the house always keeps its edge.
const casino = require('../casino');
const { amt, have } = require('../format');
const { button, rows } = require('../buttons');

const EDGE = 0.96;
const ROUNDS = [
  null,
  { q: '**Round 1:** red or black?', opts: [['red', '🟥 Red', 'red'], ['black', '⬛ Black', 'grey']] },
  { q: '**Round 2:** higher or lower than the first card?', opts: [['higher', '⬆️ Higher', 'blue'], ['lower', '⬇️ Lower', 'blue']] },
  { q: '**Round 3:** inside or outside the first two cards?', opts: [['inside', '↔️ Inside', 'blue'], ['outside', '⬅️➡️ Outside', 'blue']] },
  { q: '**Round 4:** which suit?', opts: casino.SUITS.map(([s, i]) => [s, `${i} ${s[0].toUpperCase() + s.slice(1)}`, 'grey']) }
];

function right(round, cards, guess) {
  const c = cards[round - 1];
  if (round === 1) return c.color === guess;
  if (round === 2) return guess === 'higher' ? c.r > cards[0].r : c.r < cards[0].r;
  if (round === 3) {
    const lo = Math.min(cards[0].r, cards[1].r), hi = Math.max(cards[0].r, cards[1].r);
    return guess === 'inside' ? c.r > lo && c.r < hi : c.r < lo || c.r > hi;
  }
  return c.suit === guess;
}

// What each choice multiplies your winnings by, from the cards nobody has seen yet
function stepFor(s, guess) {
  const seen = s.cards.slice(0, s.round - 1);
  const left = casino.deck(() => 0.5).filter((c) => !seen.some((x) => x.r === c.r && x.suit === c.suit));
  const wins = left.filter((c) => right(s.round, [...seen, c], guess)).length;
  return wins ? EDGE * left.length / wins : 0;
}

function view(ctx, s, { line = '', done = false, cash = null } = {}) {
  const shown = s.cards.slice(0, s.round - 1).map(casino.card).join(' ') || '`??`';
  const r = ROUNDS[s.round];
  const comps = done ? [] : rows([
    ...r.opts.map(([v, label, style]) => { const m = stepFor(s, v); return button(m ? `${label} ${casino.mult(m)}` : label, `bus:${ctx.user.id}:${s.id}:${v}`, style, !m); }),
    ...(s.round > 1 ? [button(`Cash out ${amt(Math.floor(s.bet * s.mult))}`, `bus:${ctx.user.id}:${s.id}:cash`, 'green')] : [])
  ]);
  return { embeds: [{
    title: '🚌 Ride the Bus',
    description: `Cards: ${shown}\nBet: ${amt(s.bet)}${s.round > 1 ? ` · Worth now: **${amt(Math.floor(s.bet * s.mult))}** (${casino.mult(s.mult)})` : ''}\n\n` +
      (done ? line : `${line ? line + '\n' : ''}${r.q}`) + (cash !== null ? `\nPolygons: ${have(cash)}` : ''),
    footer: { text: 'Each button shows what it multiplies your winnings by · Long shots pay more' },
    color: done ? (/win|Cashed/.test(line) ? 0x57f287 : 0xed4245) : 0xfee75c
  }], components: comps };
}

module.exports = {
  name: 'bus',
  aliases: ['ridethebus', 'rtb'],
  description: 'Ride the Bus: four card guesses, cash out any time',
  usage: '<amount>',
  options: [{ name: 'amount', type: 'string', description: 'Your bet', required: true }],
  buttonPrefix: 'bus',

  async run(ctx, args) {
    const t = casino.takeBet(ctx, 'bus', args.amount);
    if (!t.bet) return t.error || casino.usage('bus', 'bus <amount>');
    const d = casino.deck(ctx.random);
    const s = casino.start(ctx, 'bus', { bet: t.bet, cards: [d.pop(), d.pop(), d.pop(), d.pop()], round: 1, mult: 1 });
    return view(ctx, s);
  },

  async onButton(ctx, [userId, id, guess]) {
    if (ctx.user.id !== userId) return { reply: 'This bus is full. Get your own with `r!bus <amount>`.' };
    const s = casino.get(ctx, 'bus', id);
    if (!s) return { update: { components: [] } };
    if (guess === 'cash') {
      if (s.round < 2) return null;
      casino.end(ctx);
      const win = Math.floor(s.bet * s.mult);
      const cash = casino.payout(ctx, 'bus', win);
      return { update: view(ctx, s, { done: true, line: `🚏 **Cashed out** at ${casino.mult(s.mult)}: you win ${amt(win)}!`, cash }) };
    }
    const c = s.cards[s.round - 1];
    const step = stepFor(s, guess);
    if (!step) return null;
    if (!right(s.round, s.cards, guess)) {
      casino.end(ctx);
      s.round++;
      const cash = casino.payout(ctx, 'bus', 0);
      return { update: view(ctx, s, { done: true, line: `❌ It was ${casino.card(c)}. You fell off the bus and lost ${amt(s.bet)}.`, cash }) };
    }
    s.mult *= step;
    s.round++;
    if (s.round === 5) {
      require('../achievements').award(ctx, 'bus_driver');
      casino.end(ctx);
      const win = Math.floor(s.bet * s.mult);
      const cash = casino.payout(ctx, 'bus', win);
      return { update: view(ctx, s, { done: true, line: `🎉 **${casino.card(c)}! You rode the bus all the way!** You win ${amt(win)}!`, cash }) };
    }
    return { update: view(ctx, s, { line: `✅ ${casino.card(c)}! Keep riding, or cash out.` }) };
  },
  right,
  stepFor
};
