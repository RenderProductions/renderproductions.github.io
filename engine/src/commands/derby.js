// r!derby <horse> <amount>: the Polygon Derby. The first bet in a channel opens the betting for 45 seconds;
// anyone can join with their own bet. Then the race runs live in the message.
// Odds are rolled fresh each race. Winning bets pay their odds (bet included).
const config = require('../config');
const casino = require('../casino');
const { amt } = require('../format');

const HORSES = [
  ['🛡️', 'Modsworth', 'RRM'], ['🧀', 'Nacho Libre', 'NACH'], ['🧱', 'Brickhouse', 'BLU'],
  ['📊', 'Spreadsheet', 'BNW'], ['👾', 'Glitch', 'BSTG']
];
const RULES = { bettingMs: 45_000, frames: 8, frameMs: 1500, track: 14, edge: 0.92 };
const races = new Map(); // "guild:channel" -> race

function newRace(random) {
  const w = HORSES.map(() => 0.4 + random() * 1.6);
  const sum = w.reduce((a, b) => a + b, 0);
  const p = w.map((x) => x / sum);
  return { p, odds: p.map((x) => Math.max(1.1, Math.floor((RULES.edge / x) * 10) / 10)), bets: [], pos: HORSES.map(() => 0), state: 'betting' };
}

function findHorse(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return -1;
  if (/^[1-5]$/.test(t)) return Number(t) - 1;
  return HORSES.findIndex(([, n, tk]) => n.toLowerCase().startsWith(t) || tk.toLowerCase() === t);
}

function board(r, { line = '' } = {}) {
  const lanes = HORSES.map(([e, n], i) => {
    const pos = Math.min(RULES.track, Math.round(r.pos[i]));
    return `\`${i + 1}\` \`🏁${'·'.repeat(RULES.track - pos)}${e}${'·'.repeat(pos)}\` **${n}** · ${r.odds[i]}x`;
  }).join('\n');
  const bets = r.bets.length ? r.bets.map((b) => `**${b.name}**: ${amt(b.bet)} on ${HORSES[b.horse][1]}`).join('\n') : 'No bets yet.';
  const head = r.state === 'betting' ? `Betting closes <t:${Math.floor(r.closes / 1000)}:R>. Bet with \`${config.prefix}derby <horse> <amount>\`, like \`${config.prefix}derby glitch 100\`.`
    : r.state === 'racing' ? '**And they\'re off!**' : '**The race is over!**';
  return { embeds: [{ title: '🏇 The Polygon Derby', description: `${head}\n\n${lanes}\n\n**Bets**\n${bets}${line ? `\n\n${line}` : ''}`,
    color: r.state === 'done' ? 0x57f287 : 0xfee75c }] };
}

async function runRace(r, ctx) {
  const random = ctx.random || Math.random;
  // Pick the winner by the odds, then animate a race that ends with it in front
  let x = random(), winner = 0;
  for (let i = 0; i < r.p.length; i++) { x -= r.p[i]; if (x <= 0) { winner = i; break; } }
  r.state = 'racing';
  for (let f = 1; f <= RULES.frames; f++) {
    const goal = (RULES.track * f) / RULES.frames;
    r.pos = r.pos.map((p, i) => {
      const step = (RULES.track / RULES.frames) * (0.5 + random());
      return i === winner ? (f === RULES.frames ? RULES.track : Math.min(goal + 1, p + step)) : Math.min(f === RULES.frames ? RULES.track - 1 - random() * 3 : RULES.track - 1, p + step);
    });
    if (r.edit) await r.edit(board(r));
    await new Promise((res) => setTimeout(res, ctx.fast ? 0 : RULES.frameMs));
  }
  r.state = 'done';
  const lines = [];
  for (const b of r.bets) {
    const win = b.horse === winner ? Math.floor(b.bet * r.odds[winner]) : 0;
    casino.payout({ db: ctx.db, guildId: ctx.guildId, user: { id: b.id } }, 'derby', win);
    if (win) lines.push(`🏆 **${b.name}** wins ${amt(win)}!`);
  }
  const [e, n] = HORSES[winner];
  const line = `${e} **${n} wins!**\n${lines.join('\n') || 'Nobody backed the winner. The house thanks you.'}`;
  if (r.edit) await r.edit(board(r, { line }));
  return { winner, line };
}

module.exports = {
  name: 'derby',
  aliases: ['race', 'horses'],
  description: 'The Polygon Derby: bet on a horse, everyone in the channel can join',
  usage: '<horse> <amount>',
  options: [
    { name: 'horse', type: 'string', description: '1-5 or a name: Modsworth, Nacho Libre, Brickhouse, Spreadsheet, Glitch', required: true },
    { name: 'amount', type: 'string', description: 'Your bet', required: true }
  ],
  HORSES, RULES, races, runRace, newRace,

  async run(ctx, args) {
    const key = `${ctx.guildId}:${ctx.channelId}`;
    let r = races.get(key);
    const h = findHorse(args.horse);
    if (h < 0) return `🏇 Pick a horse: ${HORSES.map(([e, n], i) => `\`${i + 1}\` ${e} ${n}`).join(', ')}. Then \`${config.prefix}derby <horse> <amount>\`.`;
    if (r && r.state !== 'betting') return '🏇 A race is running right now. Bet on the next one when it ends!';
    if (r && r.bets.some((b) => b.id === ctx.user.id)) return "🏇 You've already got a bet on this race.";
    const t = casino.takeBet(ctx, 'derby', args.amount);
    if (!t.bet) return t.error || casino.usage('derby', 'derby <horse> <amount>');
    casino.last.delete(`${ctx.guildId}:${ctx.user.id}`); // a derby bet doesn't hold up other games

    const opening = !r;
    if (opening) {
      r = { ...newRace(ctx.random || Math.random), closes: Date.now() + RULES.bettingMs };
      races.set(key, r);
    }
    r.bets.push({ id: ctx.user.id, name: ctx.user.username, horse: h, bet: t.bet });
    if (!opening) {
      if (r.edit) r.edit(board(r));
      return `🏇 **${ctx.user.username}** bets ${amt(t.bet)} on ${HORSES[h][0]} **${HORSES[h][1]}** (${r.odds[h]}x).`;
    }
    const out = board(r);
    out.after = async (edit) => {
      r.edit = edit;
      await new Promise((res) => setTimeout(res, ctx.fast ? 0 : RULES.bettingMs));
      try { await runRace(r, ctx); } finally { races.delete(key); }
    };
    return out;
  }
};
