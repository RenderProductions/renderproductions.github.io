// r!hilo <amount>: Higher or Lower. Guess the next card; every right guess grows your multiplier.
// A tie is a free redraw. Cash out whenever you like, or lose it all on a wrong guess.
const casino = require('../casino');
const { amt, have } = require('../format');
const { button, rows } = require('../buttons');

const EDGE = 0.96;
const MAX = 100; // multiplier cap

// What a right guess multiplies by, from what's left in the deck
function odds(s) {
  const cur = s.card.r;
  const hi = s.deck.filter((c) => c.r > cur).length, lo = s.deck.filter((c) => c.r < cur).length;
  return { higher: hi ? EDGE * (hi + lo) / hi : 0, lower: lo ? EDGE * (hi + lo) / lo : 0 };
}

function view(ctx, s, { line = '', done = false, cash = null } = {}) {
  const o = odds(s);
  const comps = done ? [] : rows([
    button(`Higher (${casino.mult(o.higher)})`, `hilo:${ctx.user.id}:${s.id}:higher`, 'blue', !o.higher),
    button(`Lower (${casino.mult(o.lower)})`, `hilo:${ctx.user.id}:${s.id}:lower`, 'blue', !o.lower),
    ...(s.streak ? [button(`Cash out ${amt(s.bet * s.mult)}`, `hilo:${ctx.user.id}:${s.id}:cash`, 'green')] : [])
  ]);
  return { embeds: [{
    title: '🔼 Higher or Lower',
    description: `## ${casino.card(s.card)}\nStreak: **${s.streak}** · Multiplier: **${casino.mult(s.mult)}** · Worth: **${amt(s.bet * s.mult)}**` +
      (line ? `\n\n${line}` : '') + (cash !== null ? `\nPolygons: ${have(cash)}` : ''),
    footer: { text: 'Ties are a free redraw · Aces are high' },
    color: done ? (/win|Cashed/.test(line) ? 0x57f287 : 0xed4245) : 0x5865f2
  }], components: comps };
}

module.exports = {
  name: 'hilo',
  aliases: ['higherlower', 'hl'],
  description: 'Higher or Lower: build a streak, cash out before you miss',
  usage: '<amount>',
  options: [{ name: 'amount', type: 'string', description: 'Your bet', required: true }],
  buttonPrefix: 'hilo',

  async run(ctx, args) {
    const t = casino.takeBet(ctx, 'hilo', args.amount);
    if (!t.bet) return t.error || casino.usage('hilo', 'hilo <amount>');
    const d = casino.deck(ctx.random);
    const s = casino.start(ctx, 'hilo', { bet: t.bet, deck: d, card: d.pop(), streak: 0, mult: 1 });
    return view(ctx, s);
  },

  async onButton(ctx, [userId, id, guess]) {
    if (ctx.user.id !== userId) return { reply: 'Not your cards. Start your own with `r!hilo <amount>`.' };
    const s = casino.get(ctx, 'hilo', id);
    if (!s) return { update: { components: [] } };
    if (guess === 'cash') {
      if (!s.streak) return null;
      casino.end(ctx);
      const win = s.bet * s.mult;
      const cash = casino.payout(ctx, 'hilo', win);
      return { update: view(ctx, s, { done: true, line: `💰 **Cashed out** at ${casino.mult(s.mult)}: you win ${amt(Math.round(win))}!`, cash }) };
    }
    const o = odds(s);
    if (!o[guess]) return null;
    const prev = s.card;
    let next = s.deck.pop();
    while (next && next.r === prev.r) next = s.deck.pop(); // ties: free redraw
    if (!next) { s.deck = casino.deck(ctx.random); next = s.deck.pop(); }
    s.card = next;
    const ok = guess === 'higher' ? next.r > prev.r : next.r < prev.r;
    if (!ok) {
      casino.end(ctx);
      const cash = casino.payout(ctx, 'hilo', 0);
      return { update: view(ctx, s, { done: true, line: `❌ ${casino.card(prev)} → ${casino.card(next)}. Wrong call! You lose ${amt(s.bet)}.`, cash }) };
    }
    s.streak++;
    s.mult = Math.min(MAX, s.mult * o[guess]);
    if (s.mult >= MAX || s.deck.length < 3) {
      casino.end(ctx);
      const win = s.bet * s.mult;
      const cash = casino.payout(ctx, 'hilo', win);
      return { update: view(ctx, s, { done: true, line: `🏆 **Maxed out!** You win ${amt(Math.round(win))}!`, cash }) };
    }
    return { update: view(ctx, s, { line: `✅ ${casino.card(prev)} → ${casino.card(next)}. Keep going?` }) };
  },
  odds
};
