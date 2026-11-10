// r!mines <amount> [bombs]: Minesweeper. A 4x4 field with hidden bombs (3 by default, 1 to 12).
// Every safe tile raises your multiplier. Cash out any time; hit a bomb and you lose the bet.
const casino = require('../casino');
const { amt, have } = require('../format');
const { button, rows } = require('../buttons');
const { ComponentType } = require('discord.js');

const SIZE = 16;
const EDGE = 0.96;
const multFor = (bombs, safe) => {
  let m = EDGE;
  for (let i = 0; i < safe; i++) m *= (SIZE - i) / (SIZE - bombs - i);
  return safe ? m : 1;
};

function view(ctx, s, { line = '', done = false, cash = null } = {}) {
  const tiles = Array.from({ length: SIZE }, (_, i) => {
    const open = s.open.has(i);
    const bomb = s.bombs.has(i);
    const b = button(done && bomb ? '💣' : open ? '💎' : '‎', `mines:${ctx.user.id}:${s.id}:${i}`, open ? 'green' : done && bomb ? 'red' : 'grey', done || open);
    if (!open && !(done && bomb)) b.label = '?';
    return b;
  });
  const comps = rows(tiles, 4);
  if (!done) comps.push({ type: ComponentType.ActionRow, components: [button(s.open.size ? `Cash out ${amt(s.bet * multFor(s.count, s.open.size))}` : 'Pick a tile', `mines:${ctx.user.id}:${s.id}:cash`, 'green', !s.open.size)] });
  const next = multFor(s.count, s.open.size + 1);
  return { embeds: [{
    title: '💣 Minesweeper',
    description: `Bombs: **${s.count}** · Safe tiles found: **${s.open.size}**\nMultiplier: **${casino.mult(multFor(s.count, s.open.size))}**` +
      (done ? '' : ` · next tile: **${casino.mult(next)}**`) + `\nBet: ${amt(s.bet)}` + (line ? `\n\n${line}` : '') + (cash !== null ? `\nPolygons: ${have(cash)}` : ''),
    color: done ? (/win/.test(line) ? 0x57f287 : 0xed4245) : 0x5865f2
  }], components: comps };
}

module.exports = {
  name: 'mines',
  aliases: ['minesweeper', 'ms'],
  description: 'Minesweeper: dodge the bombs, cash out before you hit one',
  usage: '<amount> [bombs 1-12]',
  options: [
    { name: 'amount', type: 'string', description: 'Your bet', required: true },
    { name: 'bombs', type: 'string', description: 'How many bombs, 1 to 12 (default 3). More bombs, bigger payouts' }
  ],
  buttonPrefix: 'mines',

  async run(ctx, args) {
    const count = args.bombs === undefined ? 3 : Number(args.bombs);
    if (!Number.isInteger(count) || count < 1 || count > 12) return '💣 Pick 1 to 12 bombs.';
    const t = casino.takeBet(ctx, 'mines', args.amount);
    if (!t.bet) return t.error || casino.usage('mines', 'mines <amount> [bombs 1-12]');
    const random = ctx.random || Math.random;
    const bombs = new Set();
    while (bombs.size < count) bombs.add(Math.floor(random() * SIZE));
    const s = casino.start(ctx, 'mines', { bet: t.bet, count, bombs, open: new Set() });
    return view(ctx, s);
  },

  async onButton(ctx, [userId, id, pick]) {
    if (ctx.user.id !== userId) return { reply: 'Not your minefield. Start your own with `r!mines <amount>`.' };
    const s = casino.get(ctx, 'mines', id);
    if (!s) return { update: { components: [] } };
    if (pick === 'cash') {
      if (!s.open.size) return null;
      casino.end(ctx);
      const win = s.bet * multFor(s.count, s.open.size);
      const cash = casino.payout(ctx, 'mines', win);
      return { update: view(ctx, s, { done: true, line: `💰 Cashed out: you win ${amt(Math.round(win))}!`, cash }) };
    }
    const i = Number(pick);
    if (s.open.has(i)) return null;
    if (s.bombs.has(i)) {
      casino.end(ctx);
      const cash = casino.payout(ctx, 'mines', 0);
      return { update: view(ctx, s, { done: true, line: `💥 **BOOM!** You lose ${amt(s.bet)}.`, cash }) };
    }
    s.open.add(i);
    if (s.open.size === SIZE - s.count) {
      casino.end(ctx);
      const win = s.bet * multFor(s.count, s.open.size);
      const cash = casino.payout(ctx, 'mines', win);
      return { update: view(ctx, s, { done: true, line: `🏆 **Field cleared!** You win ${amt(Math.round(win))}!`, cash }) };
    }
    return { update: view(ctx, s) };
  },
  multFor
};
