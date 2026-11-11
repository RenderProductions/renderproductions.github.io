// r!roulette <amount> <bet>: a European wheel (0 to 36). NachoBellGrande1065's idea.
//   red / black, odd / even, low (1-18) / high (19-36)   pays 2x
//   1st / 2nd / 3rd (dozens: 1-12, 13-24, 25-36)          pays 3x
//   a single number, 0 to 36                              pays 36x
// The green 0 is the house edge (about 2.7%): it loses every bet except a straight bet on 0.
const casino = require('../casino');
const { amt, have } = require('../format');

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const dot = (n) => ({ green: '🟢', red: '🔴', black: '⚫' })[colorOf(n)];

// Reads what they're betting on. Returns { label, pays, wins(n) } or null.
function parseBet(raw) {
  const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d{1,2}$/.test(t) && Number(t) <= 36) { const k = Number(t); return { label: `${dot(k)} ${k}`, pays: 36, wins: (n) => n === k, straight: true }; }
  const simple = {
    red: ['🔴 Red', (n) => colorOf(n) === 'red'], black: ['⚫ Black', (n) => colorOf(n) === 'black'],
    odd: ['Odd', (n) => n > 0 && n % 2 === 1], even: ['Even', (n) => n > 0 && n % 2 === 0],
    low: ['Low (1-18)', (n) => n >= 1 && n <= 18], high: ['High (19-36)', (n) => n >= 19]
  };
  const alias = { r: 'red', b: 'black', reds: 'red', blacks: 'black', '1-18': 'low', '19-36': 'high', small: 'low', big: 'high' };
  const k = alias[t] || t;
  if (simple[k]) return { label: simple[k][0], pays: 2, wins: simple[k][1] };
  const dozen = { '1st': 1, first: 1, '1-12': 1, d1: 1, '2nd': 2, second: 2, '13-24': 2, d2: 2, '3rd': 3, third: 3, '25-36': 3, d3: 3 }[t];
  if (dozen) return { label: `${['1st', '2nd', '3rd'][dozen - 1]} dozen (${dozen * 12 - 11}-${dozen * 12})`, pays: 3, wins: (n) => n >= dozen * 12 - 11 && n <= dozen * 12 };
  return null;
}

const HOW = 'Bets: `red` `black` `odd` `even` `low` `high` pay **2x** · `1st` `2nd` `3rd` (dozens) pay **3x** · a number `0`-`36` pays **36x**';

module.exports = {
  name: 'roulette',
  aliases: ['wheel', 'rl'],
  description: 'Roulette: red or black, odd or even, a dozen, or one lucky number',
  usage: '<amount> <bet>',
  options: [
    { name: 'amount', type: 'string', description: 'Your bet', required: true },
    { name: 'bet', type: 'string', description: 'red, black, odd, even, low, high, 1st, 2nd, 3rd, or a number 0-36', required: true }
  ],
  parseBet,
  colorOf,

  async run(ctx, args) {
    const on = parseBet(args.bet);
    if (!on) return `${casino.usage('roulette', 'roulette <amount> <bet>')}, like \`roulette 100 red\` or \`roulette 50 17\`\n${HOW}`;
    const t = casino.takeBet(ctx, 'roulette', args.amount);
    if (!t.bet) return t.error || `${casino.usage('roulette', 'roulette <amount> <bet>')}\n${HOW}`;
    const n = Math.floor((ctx.random || Math.random)() * 37);
    const won = on.wins(n);
    const win = won ? t.bet * on.pays : 0;
    const cash = casino.payout(ctx, 'roulette', win);
    const A = require('../achievements');
    if (won && on.straight) A.award(ctx, 'straight_up');
    // Hold the announcements (achievements, TODD) for the result, so they don't spoil the spin
    const notes = ctx.notes ? ctx.notes.splice(0) : [];
    const result = {
      embeds: [{
        title: '🎡 Roulette',
        description: `You bet **${amt(t.bet)}** on **${on.label}**.\n\nThe ball lands on... **${dot(n)} ${n}**!\n\n` +
          (won ? `💰 **You win ${amt(Math.round(win))}!**` : `You lose ${amt(t.bet)}.`) + `\nPolygons: ${have(cash)}` +
          (notes.length ? `\n\n${notes.join('\n')}` : ''),
        footer: { text: HOW.replace(/[`*]/g, '') },
        color: won ? 0x57f287 : n === 0 ? 0x2ecc71 : 0xed4245
      }]
    };
    const spin = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
    const i = spin.indexOf(n);
    const strip = [-2, -1, 0, 1, 2].map((d) => dot(spin[(i + d + 37 * 2) % 37])).join('');
    const out = {
      embeds: [{ title: '🎡 Roulette', description: `You bet **${amt(t.bet)}** on **${on.label}**.\n\nThe wheel spins... ${strip}`, color: 0x99aab5 }],
      after: async (edit) => { await new Promise((r) => setTimeout(r, 2000)); await edit(result); },
      _final: result // what the spin ends on (tests read it; never sent to Discord)
    };
    return out;
  }
};
