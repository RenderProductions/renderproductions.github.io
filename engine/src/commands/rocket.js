// r!rocket <amount>: the multiplier climbs live until the rocket crashes at a random point.
// Hit Cash Out before it does. About 4% of launches blow up on the pad.
const casino = require('../casino');
const { amt, have } = require('../format');
const { button, rows } = require('../buttons');

const RULES = { edge: 0.96, cap: 50, growth: 0.06, frameMs: 1500 }; // multiplier = e^(growth * seconds)
const at = (s, now = Date.now()) => Math.exp(RULES.growth * Math.max(0, now - s.t0) / 1000);

// Where it crashes: P(it reaches x) = edge / x
const crashPoint = (random) => Math.min(RULES.cap, Math.max(1, RULES.edge / Math.max(1e-9, random())));

function view(ctx, s, now = Date.now()) {
  const m = s.result ? s.result.mult : Math.min(at(s, now), s.crashAt);
  const trail = '·'.repeat(Math.min(14, Math.floor(Math.log2(Math.max(1, m)) * 4)));
  let desc, color = 0x5865f2, comps = [];
  if (!s.result) {
    desc = `\`🌍${trail}🚀\`\n# ${casino.mult(m)}\nBet: ${amt(s.bet)} · Cash out now for **${amt(Math.floor(s.bet * m))}**`;
    comps = rows([button(`Cash out ${amt(Math.floor(s.bet * m))}`, `rocket:${ctx.user.id}:${s.id}:cash`, 'green')]);
  } else if (s.result.won) {
    desc = `\`🌍${trail}🚀\`\n# ${casino.mult(s.result.mult)}\n💰 **You bailed out in time!** You win **${amt(s.result.win)}**.\n-# It would have crashed at ${casino.mult(s.crashAt)}.\nPolygons: ${have(s.result.cash)}`;
    color = 0x57f287;
  } else {
    desc = `\`🌍${trail}💥\`\n# ${casino.mult(s.crashAt)}\n**The rocket crashed!** You lose ${amt(s.bet)}.\nPolygons: ${have(s.result.cash)}`;
    color = 0xed4245;
  }
  return { embeds: [{ title: '🚀 Rocket', description: desc, color }], components: comps };
}

function settle(ctx, s, now = Date.now()) {
  if (s.result) return s.result;
  const m = at(s, now);
  casino.end(ctx);
  if (m >= s.crashAt) s.result = { won: false, mult: s.crashAt, cash: casino.payout(ctx, 'rocket', 0) };
  else {
    const mult = Math.floor(m * 100) / 100;
    const win = Math.floor(s.bet * mult);
    s.result = { won: true, mult, win, cash: casino.payout(ctx, 'rocket', win) };
    if (mult >= 10) require('../achievements').award(ctx, 'moon_shot');
  }
  return s.result;
}

module.exports = {
  name: 'rocket',
  aliases: ['crashgame'],
  description: 'Rocket: cash out before it crashes',
  usage: '<amount>',
  options: [{ name: 'amount', type: 'string', description: 'Your bet', required: true }],
  buttonPrefix: 'rocket',
  RULES,
  crashPoint,
  settle,

  async run(ctx, args) {
    const t = casino.takeBet(ctx, 'rocket', args.amount);
    if (!t.bet) return t.error || casino.usage('rocket', 'rocket <amount>');
    const s = casino.start(ctx, 'rocket', { bet: t.bet, t0: Date.now() + 2000, crashAt: crashPoint(ctx.random || Math.random) });
    const out = view(ctx, s, s.t0);
    out.embeds[0].description = '`🌍🚀` Launching in 2...\n' + out.embeds[0].description;
    // The live countdown: edits the message every 1.5s until it crashes or you cash out
    out.after = async (edit) => {
      await new Promise((r) => setTimeout(r, 2000));
      for (;;) {
        if (s.result) return edit(view(ctx, s));               // cashed out: make sure the final view sticks
        if (at(s) >= s.crashAt) { settle(ctx, s); return edit(view(ctx, s)); }
        await edit(view(ctx, s));
        await new Promise((r) => setTimeout(r, RULES.frameMs));
      }
    };
    return out;
  },

  async onButton(ctx, [userId, id]) {
    if (ctx.user.id !== userId) return { reply: 'Not your rocket. Launch your own with `r!rocket <amount>`.' };
    const s = casino.sessions.get(`${ctx.guildId}:${ctx.user.id}`);
    if (!s || s.game !== 'rocket' || s.id !== id) return { update: { components: [] } };
    if (Date.now() < s.t0) return { reply: "It hasn't even launched yet!" };
    settle(ctx, s);
    return { update: view(ctx, s) };
  }
};
