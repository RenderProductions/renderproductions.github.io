// r!blackjack <amount>: against TODD. Hit, Stand, or Double on your first move. Blackjack pays 2.5x,
// a win pays 2x, a tie gives your bet back. TODD stands on 17.
const casino = require('../casino');
const { amt, have } = require('../format');
const { button, rows } = require('../buttons');

const value = (hand) => {
  let v = 0, aces = 0;
  for (const c of hand) { if (c.r === 14) { aces++; v += 11; } else v += Math.min(c.r, 10); }
  while (v > 21 && aces) { v -= 10; aces--; }
  return v;
};
const show = (hand) => hand.map(casino.card).join(' ');
const natural = (hand) => hand.length === 2 && value(hand) === 21;

function view(ctx, s, { done = false, line = '', cash = null } = {}) {
  const dealer = done ? `${show(s.dealer)} (**${value(s.dealer)}**)` : `${casino.card(s.dealer[0])} \`??\``;
  const comps = done ? [] : rows([
    button('Hit', `bj:${ctx.user.id}:${s.id}:hit`, 'blue'),
    button('Stand', `bj:${ctx.user.id}:${s.id}:stand`, 'grey'),
    ...(s.hand.length === 2 && !s.doubled ? [button(`Double (${amt(s.bet)})`, `bj:${ctx.user.id}:${s.id}:double`, 'green')] : [])
  ]);
  return { embeds: [{
    title: '🃏 Blackjack vs TODD',
    description: `**TODD:** ${dealer}\n**You:** ${show(s.hand)} (**${value(s.hand)}**)\n\nBet: ${amt(s.bet * (s.doubled ? 2 : 1))}` +
      (line ? `\n\n${line}` : '') + (cash !== null ? `\nPolygons: ${have(cash)}` : ''),
    color: !done ? 0x5865f2 : /win|BLACKJACK/.test(line) ? 0x57f287 : /Push/.test(line) ? 0xfee75c : 0xed4245
  }], components: comps };
}

// TODD plays out, then the hand is settled
function finish(ctx, s) {
  casino.end(ctx);
  const total = s.bet * (s.doubled ? 2 : 1);
  const me = value(s.hand);
  let win = 0, line;
  if (me > 21) line = `💥 Bust! You lose ${amt(total)}.`;
  else {
    while (value(s.dealer) < 17) s.dealer.push(s.deck.pop());
    const d = value(s.dealer);
    if (natural(s.hand)) require('../achievements').award(ctx, 'natural');
    if (natural(s.hand) && !natural(s.dealer)) { win = s.bet * 2.5; line = `🂡 **BLACKJACK!** You win ${amt(win)}!`; }
    else if (natural(s.dealer) && !natural(s.hand)) line = `🖥️ TODD has blackjack. "Heh." You lose ${amt(total)}.`;
    else if (d > 21) { win = total * 2; line = `🖥️ TODD busts! You win ${amt(win)}!`; }
    else if (me > d) { win = total * 2; line = `You win ${amt(win)}!`; }
    else if (me === d) { win = total; line = `🤝 Push. You get your ${amt(total)} back.`; }
    else line = `🖥️ TODD wins with ${d}. You lose ${amt(total)}.`;
  }
  const cash = casino.payout(ctx, 'blackjack', win);
  return view(ctx, s, { done: true, line, cash });
}

module.exports = {
  name: 'blackjack',
  aliases: ['bj', '21'],
  description: 'Play blackjack against TODD',
  usage: '<amount>',
  options: [{ name: 'amount', type: 'string', description: 'Your bet', required: true }],
  buttonPrefix: 'bj',

  async run(ctx, args) {
    const t = casino.takeBet(ctx, 'blackjack', args.amount);
    if (!t.bet) return t.error || casino.usage('blackjack', 'blackjack <amount>');
    const d = casino.deck(ctx.random);
    const s = casino.start(ctx, 'blackjack', { bet: t.bet, deck: d, hand: [d.pop(), d.pop()], dealer: [d.pop(), d.pop()], doubled: false });
    if (natural(s.hand) || natural(s.dealer)) return finish(ctx, s);
    return view(ctx, s);
  },

  async onButton(ctx, [userId, id, action]) {
    if (ctx.user.id !== userId) return { reply: `This isn't your table. Sit down with \`r!blackjack <amount>\`.` };
    const s = casino.get(ctx, 'blackjack', id);
    if (!s) return { update: { components: [] } };
    if (action === 'double') {
      const p = ctx.db.player(ctx.guildId, ctx.user);
      if (s.hand.length !== 2 || s.doubled) return null;
      if (p.cash < s.bet) return { reply: `You need ${amt(s.bet)} to double.` };
      ctx.db.tx(() => {
        ctx.db.addCash(ctx.guildId, ctx.user.id, -s.bet);
        require('../reserve').take(ctx.db, s.bet);
        casino.stat(ctx.db, ctx.guildId, ctx.user.id, 'blackjack', { wagered: s.bet });
      });
      s.doubled = true;
      s.hand.push(s.deck.pop());
      return { update: finish(ctx, s) };
    }
    if (action === 'hit') {
      s.hand.push(s.deck.pop());
      if (value(s.hand) >= 21) return { update: finish(ctx, s) };
      return { update: view(ctx, s) };
    }
    return { update: finish(ctx, s) };
  },
  value
};
