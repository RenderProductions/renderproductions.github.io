// r!work: a shift at your job. The Labor Day Update:
//   * three kinds of tasks per job, harder at higher ranks (memory tasks show, then hide)
//   * speed tips for fast right answers, team bonuses when coworkers work in the same channel
//   * a performance review every 10 shifts: promoted, kept, or demoted
//   * the market matters: layoffs at bankrupt companies, double pay in a boom, strikes when the
//     Polygon Reserve runs low, and (when the bot runs the market) every good shift nudges the stock up
// r!gig (commands/gig.js) uses the same tasks for players without a job.
const config = require('../config');
const reserve = require('../reserve');
const jobs = require('../jobs');
const co = require('../companies');
const loans = require('../loans');
const reminders = require('../reminders');
const marketEngine = require('../marketEngine');
const A = require('../achievements');
const effects = require('../effects');
const { relTime, amt, have } = require('../format');
const { button, rows, nonce } = require('../buttons');

// Tasks waiting for an answer: "guild:user" -> task state
const active = new Map();
const keyOf = (ctx) => `${ctx.guildId}:${ctx.user.id}`;
// Recent shifts per channel and company, for team bonuses: "guild:channel:job" -> Map(user -> { at, name })
const recent = new Map();
const TEAM = { windowMs: 2 * 60 * 1000, each: 0.15, max: 3 };
// tipMax: a perfect-speed answer adds up to 50% on top. kind: tests can pick the task type.
const TUNING = { tipMax: 0.5, kind: null };
const NUDGE = { good: 0.001, scab: -0.002 }; // stock push per shift (log terms)
const STRIKE = { below: 0.25, chance: 0.3, pay: 0.25 };
const SEVERANCE = 3;        // shifts' worth of pay when you're laid off

// Player companies borrow one of the five task styles, always the same one for a given ticker
function taskStyle(ticker) {
  if (jobs.COMPANIES[ticker]) return ticker;
  const styles = Object.keys(jobs.COMPANIES);
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return styles[h % styles.length];
}

// "🏦 ⬡ 17.50 went to KorbedOut for an overdue loan." (empty when nothing was taken)
// The payslip: each part of the pay on its own line, then the total, so it's clear what you earned
function payslip(head, parts, total, cash) {
  const lines = parts.filter(([, c]) => c > 0).map(([label, c, why]) => `${label}: **+${amt(c)}**${why ? ` (${why})` : ''}`);
  return `${head}\n${lines.join('\n')}${lines.length > 1 ? `\n**💰 Total: +${amt(total)}**` : ''}\n-# You have ${have(cash)} now.`;
}

function garnishNote(g) {
  if (!g.taken) return '';
  return '\n' + g.paidTo.map((p) => `🏦 ${amt(p.cents)} went to **${p.name}** for an overdue loan${p.cleared ? ' (paid off!)' : ''}.`).join('\n');
}

const isBoomed = (m, job) => !!(m && m.boost && (!m.boost.tickers || !m.boost.tickers.length || m.boost.tickers.includes(job)));

// Starts a task and waits for the answer: a typed message, or button presses.
// Returns a reply payload (with `later` for memory tasks, which hide the prompt after a few seconds).
function startTask(ctx, { job, style, rush = 0, mode = 'work', tier = 0, scab = false, market = null, intro = '' }) {
  const t = jobs.task(style, { rush: rush > 0, tier, random: ctx.random || Math.random, market, kind: TUNING.kind });
  // A Stopwatch charge: 10 extra seconds on a regular shift
  const watch = mode === 'work' && !rush && effects.take(ctx.db, ctx.guildId, ctx.user.id, 'stopwatch');
  if (watch) { t.limit += 10; intro = `${intro}⏱️ Stopwatch: **+10 seconds**.\n`; }
  const id = nonce();
  const hide = t.hideMs || 0;
  active.set(keyOf(ctx), { job, style, mode, rush, tier, scab, id, kind: t.kind, ans: t.ans, check: t.check,
    seq: !!t.seq, steps: t.steps || [], pressed: [], start: Date.now() + hide, limit: t.limit, choices: t.choices || [] });
  ctx.awaitNext((msg) => answer(ctx, msg.content), jobs.ABANDON_MS + hide);
  const comps = t.choices ? rows(t.choices.map((c, i) => button(c.label, `work:${ctx.user.id}:${id}:${i}`, c.style || 'grey', false, c.emoji)), t.perRow || 5) : [];
  const timer = `⏱️ You have **${t.limit} seconds**.${t.seq ? ' Press them in order, or type them with spaces.' : ''}`;
  if (hide) {
    return { content: `${intro}${t.q}`, components: [], later: { ms: hide, edit: { content: `${intro}${t.hidden}\n${timer}`, components: comps } } };
  }
  return { content: `${intro}${t.q}\n${timer}`, components: comps };
}

// Grades the answer and pays. Returns the reply.
async function answer(ctx, text) {
  const key = keyOf(ctx);
  const st = active.get(key);
  if (!st) return null;
  active.delete(key);

  const txt = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const elapsed = (Date.now() - st.start) / 1000;
  const right = st.check ? st.check(txt) : txt === st.ans;
  const result = elapsed > st.limit ? 'slow' : right ? 'pass' : 'wrong';
  const speed = result === 'pass' && elapsed >= 0 ? TUNING.tipMax * Math.max(0, 1 - elapsed / st.limit) : 0;
  const shown = st.check && st.kind === 'percent' ? `about ${st.ans}%` : `\`${st.ans}\``;
  const p = ctx.db.player(ctx.guildId, ctx.user);

  // ---------------- gigs ----------------
  if (st.mode === 'gig') {
    let pay = jobs.BASE_PAY * jobs.GIG_PAY * (result === 'pass' ? 1 : 0.4);
    const tip = pay * speed;
    const shrink = reserve.factor(ctx.db);
    const total = Math.round((pay + tip) * 100 * shrink);
    const g = ctx.db.tx(() => {
      reserve.spend(ctx.db, total);
      const split = loans.garnish(ctx.db, ctx.guildId, ctx.user.id, total);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { gig_earned: (p.gig_earned || 0) + total });
      return split;
    });
    const head = result === 'pass' ? '🧰 Gig done!'
      : result === 'slow' ? '🐢 Too slow, but the client paid something.'
      : `❌ Not quite, it was ${shown}. The client paid a little anyway.`;
    const tipC = tip > 0 ? Math.round(tip * 100 * shrink) : 0;
    let out = payslip(head, [['💵 Gig pay', total - tipC], ['⚡ Speed tip', tipC, `${Math.max(0, elapsed).toFixed(1)}s`]], total, ctx.db.player(ctx.guildId, ctx.user).cash);
    out += garnishNote(g);
    if (shrink < 1) out += reserve.note(ctx.db);
    if (A.bump(ctx, 'gigs') >= 25) A.award(ctx, 'gig_economy');
    return out + `\n-# Want steady pay? \`${config.prefix}apply <ticker>\` for a real job.`;
  }

  // ---------------- shifts ----------------
  const career = ctx.db.career(ctx.guildId, ctx.user.id, st.job);
  const r = jobs.rank(st.job, career.rank);
  const c = jobs.COMPANIES[st.job];
  const m = await ctx.market.get();
  let pay;
  if (c) {
    // Pay follows the live stock price (falls back to the starting price)
    let price = m && m.prices ? Number(m.prices[st.job]) : NaN;
    if (!Number.isFinite(price)) price = c.start;
    // BSTG swings wildly, so its pay uses a price capped between 10 and 200 (0.2x to 4x pay)
    if (st.job === 'BSTG') price = Math.max(Math.min(price, 200), 10);
    // A near-dead stock still pays a little
    pay = jobs.BASE_PAY * Math.max(price, 0.5) / c.start * r.mult;
  } else {
    const pc = co.get(ctx.db, st.job);
    if (!co.alive(pc)) return `💀 ${st.job} went under while you were working. You're out of a job.`;
    pay = jobs.BASE_PAY * co.level(pc).payMult * r.mult;
  }

  const extras = [];
  const update = {};
  let tip = 0, team = 0;
  if (st.rush > 0) {
    pay = result === 'pass' ? pay * 0.6 : 0; // rush round: bonus only if you got it right
  } else {
    if (result !== 'pass') pay *= 0.4;
    if (p.overtime) { pay *= 2; update.overtime = 0; extras.push('☕ Overtime x2'); }
    if (c && isBoomed(m, st.job)) { pay *= 2; extras.push('🚀 Boom overtime x2'); }
    if (st.scab) { pay *= 0.9; extras.push('🪧 Crossed the picket line (-10%)'); }
    tip = pay * speed;
    // Coworkers who just worked a shift in this channel
    const tk = `${ctx.guildId}:${ctx.channelId}:${st.job}`;
    const crew = recent.get(tk) || new Map();
    const mates = [...crew.entries()].filter(([u, x]) => u !== ctx.user.id && Date.now() - x.at < TEAM.windowMs).slice(0, TEAM.max);
    if (mates.length) { team = pay * TEAM.each * mates.length; if (A.bump(ctx, 'team_shifts') >= 10) A.award(ctx, 'team_player'); }
    crew.set(ctx.user.id, { at: Date.now(), name: ctx.user.username });
    for (const [u, x] of crew) if (Date.now() - x.at > TEAM.windowMs) crew.delete(u);
    recent.set(tk, crew);
    if (mates.length) extras.push(`👥 Team shift with ${mates.map(([, x]) => `**${x.name}**`).join(', ')}: **+${Math.round(TEAM.each * mates.length * 100)}%**`);
  }
  // Pay comes out of the Polygon Reserve, and shrinks when it's running low
  const shrink = reserve.factor(ctx.db);
  const cents = (x) => Math.round(x * 100 * shrink);
  const total = cents(pay) + cents(tip) + cents(team);

  let out;
  const cu = {};
  let review = '';
  if (st.rush === 0) {
    cu.shifts = career.shifts + 1;
    cu.total = career.total + 1;
    cu.correct = career.correct + (result === 'pass' ? 1 : 0);
    cu.rev_total = career.rev_total + 1;
    cu.rev_right = career.rev_right + (result === 'pass' ? 1 : 0);
    update.shifts = cu.shifts;
    A.award(ctx, 'first_paycheck');
    if (result === 'pass') out = `✅ Nice work, ${r.name}!`;
    else if (result === 'slow') out = '🐢 Too slow! You still clocked in, for less.';
    else out = `❌ Not quite, it was ${shown}. You still get paid, just less.`;
    if (extras.length) out += `\n-# ${extras.join(' · ')}`;

    // Performance review every 10 shifts
    if (cu.rev_total >= jobs.REVIEW.every) {
      const score = cu.rev_right;
      if (score >= jobs.REVIEW.every) A.award(ctx, 'perfect_review');
      cu.rev_total = 0; cu.rev_right = 0;
      if (score >= jobs.REVIEW.promote && career.rank < 3) {
        cu.rank = career.rank + 1;
        A.award(ctx, 'promoted');
        if (cu.rank === 3) A.award(ctx, 'top_of_the_ladder');
        review = `\n\n📋 **Performance review: ${score}/10.** 🎉 **Promoted to ${jobs.rankName(st.job, cu.rank)}!** Pay is now ${jobs.MULTS[cu.rank]}x, and your tasks get tougher.`;
      } else if (score >= jobs.REVIEW.promote) {
        const bonus = reserve.pay(ctx.db, Math.round(jobs.BASE_PAY * r.mult * jobs.REVIEW.topBonus * 100));
        review = `\n\n📋 **Performance review: ${score}/10.** ⭐ Outstanding, ${r.name}! Here's a **${amt(bonus)}** bonus.`;
        cu._bonus = bonus;
      } else if (score <= jobs.REVIEW.demote && career.rank > 0 && effects.usePassive(ctx.db, ctx.guildId, ctx.user.id, 'reference')) {
        review = `\n\n📋 **Performance review: ${score}/10.** ✉️ It was going to be a demotion, but your **Reference Letter** saved you. You're still a ${r.name}.`;
      } else if (score <= jobs.REVIEW.demote && career.rank > 0) {
        cu.rank = career.rank - 1;
        review = `\n\n📋 **Performance review: ${score}/10.** 📉 Sloppy work. **Demoted to ${jobs.rankName(st.job, cu.rank)}.** Pay is now ${jobs.MULTS[cu.rank]}x.`;
      } else if (score <= jobs.REVIEW.demote) {
        review = `\n\n📋 **Performance review: ${score}/10.** ⚠️ Not great. You're still a ${r.name}, so there's nowhere to go but up.`;
      } else {
        review = `\n\n📋 **Performance review: ${score}/10.** Meets expectations. Get ${jobs.REVIEW.promote}/10 next time for a ${career.rank < 3 ? 'promotion' : 'bonus'}.`;
      }
    }
  } else {
    out = result === 'pass' ? `⚡ **RUSH CLEARED!** Bonus **+${amt(total)}**` : '💨 The rush got away from you. No bonus this time.';
    if (result === 'pass' && st.rush >= 5) A.award(ctx, 'rush_hour');
  }

  const bonus = cu._bonus || 0;
  delete cu._bonus;
  cu.earned = career.earned + total + bonus;
  const slipParts = [['💵 Shift pay', cents(pay)], ['⚡ Speed tip', cents(tip), `${Math.max(0, elapsed).toFixed(1)}s`], ['👥 Team bonus', cents(team)], ['⭐ Review bonus', bonus]];
  const g = ctx.db.tx(() => {
    const split = loans.garnish(ctx.db, ctx.guildId, ctx.user.id, total + bonus); // overdue loans take half
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, update);
    ctx.db.updateCareer(ctx.guildId, ctx.user.id, st.job, cu);
    const revenue = c ? 0 : Math.round(total * co.RULES.revenueShare);
    if (revenue) co.addRevenue(ctx.db, st.job, revenue); // shifts earn the company money
    reserve.spend(ctx.db, total + revenue);
    return split;
  });
  if (st.rush === 0 && c && ctx.db.careers(ctx.guildId, ctx.user.id).filter((x) => jobs.COMPANIES[x.ticker] && x.shifts > 0).length >= Object.keys(jobs.COMPANIES).length) A.award(ctx, 'jack_of_all_trades');
  // Good work makes the company a little more valuable; strikebreaking makes it a little less
  if (c && st.rush === 0) {
    if (st.scab) marketEngine.nudge(ctx.db, st.job, NUDGE.scab);
    else if (result === 'pass') marketEngine.nudge(ctx.db, st.job, NUDGE.good);
  }
  if (st.rush === 0) out = payslip(out, slipParts, total + bonus, ctx.db.player(ctx.guildId, ctx.user).cash);
  else if (result === 'pass') out += `\n-# You have ${have(ctx.db.player(ctx.guildId, ctx.user).cash)} now.`;
  out += review + garnishNote(g);
  if (shrink < 1) out += reserve.note(ctx.db);

  // 1 in 5: another task comes in. Only after a pass, max 5 in a row.
  const random = ctx.random || Math.random;
  if (result === 'pass' && st.rush < 5 && random() < 0.2) {
    const next = st.rush + 1;
    const t = startTask(ctx, { job: st.job, style: st.style, rush: next, tier: st.tier, market: m,
      intro: `⚡ **RUSH ORDER #${next}!** It's not over yet! Bonus pay if you nail it.\n` });
    return { ...t, content: `${out}\n\n${t.content}` };
  }
  return out;
}

// The shift-start checks shared by r!work. Returns a reply, or null to go ahead.
async function events(ctx, p, m) {
  const P = config.prefix;
  const c = jobs.COMPANIES[p.job];
  if (!c) return null;
  // Layoffs: a bankrupt company can't pay its staff
  if (m && m.statuses && m.statuses[p.job] === 'bankrupt') {
    if (effects.usePassive(ctx.db, ctx.guildId, ctx.user.id, 'hardhat')) {
      ctx.notes.push(`🪖 **${c.name} is bankrupt and laying people off**, but your Hard Hat kept you on the crew. Pay is rough until it recovers.`);
      return null;
    }
    const career = ctx.db.career(ctx.guildId, ctx.user.id, p.job);
    const sev = ctx.db.tx(() => {
      const s = reserve.pay(ctx.db, Math.round(jobs.BASE_PAY * jobs.rank(p.job, career.rank).mult * SEVERANCE * 100));
      ctx.db.addCash(ctx.guildId, ctx.user.id, s);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: null, shifts: 0, overtime: 0 });
      return s;
    });
    reminders.cancel(ctx.guildId, ctx.user.id);
    A.award(ctx, 'pink_slip');
    return `📦 **Laid off.** ${c.name} is bankrupt and can't make payroll. Here's **${amt(sev)}** in severance.\n` +
      `Your rank there is saved if it ever comes back. Until then, try \`${P}gig\` or \`${P}apply\` somewhere else.`;
  }
  return null;
}

module.exports = {
  name: 'work',
  description: 'Start a shift at your job (every 15 minutes)',
  options: [],
  active,
  recent,
  TUNING,
  STRIKE,
  answer,
  startTask,
  taskStyle,

  async run(ctx) {
    const P = config.prefix;
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (!p.job) return `❌ You need a job first. Try \`${P}apply <ticker>\`, or pick up a quick \`${P}gig\`.`;
    if (!jobs.COMPANIES[p.job] && !co.alive(co.get(ctx.db, p.job))) {
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: null, shifts: 0 });
      return `💀 **${p.job}** went under. You're out of a job. Try \`${P}apply <ticker>\`.`;
    }

    const cur = active.get(keyOf(ctx));
    if (cur && Date.now() - cur.start <= jobs.ABANDON_MS) return "⏱️ You're mid-shift! Answer your current task first.";
    active.delete(keyOf(ctx));

    const next = p.last_work + jobs.WORK_COOLDOWN_MS;
    if (Date.now() < next) return `😴 Shift's over. Next shift ${relTime(next)}.`;

    const m = await ctx.market.get();
    const ev = await events(ctx, p, m);
    if (ev) return ev;

    const now = Date.now();
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { last_work: now });
    if (p.remind) reminders.schedule(ctx, ctx.guildId, ctx.user.id, now + jobs.WORK_COOLDOWN_MS);
    const career = ctx.db.career(ctx.guildId, ctx.user.id, p.job);
    const random = ctx.random || Math.random;

    // Strikes: when the Polygon Reserve is low, the union walks out. Join them, or cross the line.
    if (jobs.COMPANIES[p.job] && reserve.level(ctx.db) < STRIKE.below && random() < STRIKE.chance) {
      const id = nonce();
      active.set(keyOf(ctx), { job: p.job, style: p.job, mode: 'strike', id, start: Date.now(), tier: career.rank, market: m });
      return {
        content: `🪧 **STRIKE at ${jobs.COMPANIES[p.job].name}!** The Polygon Reserve is running dry and the union is walking out.\n` +
          `**Join the strike** for strike pay (${STRIKE.pay * 100}%), or **cross the picket line** and work (-10%, and the stock takes a hit).`,
        components: rows([button('Join the strike', `work:${ctx.user.id}:${id}:strike`, 'green'), button('Cross the line', `work:${ctx.user.id}:${id}:cross`, 'red')])
      };
    }
    return startTask(ctx, { job: p.job, style: taskStyle(p.job), tier: career.rank, market: m });
  },

  // A task button was pressed: "work:<user>:<task id>:<choice>"
  buttonPrefix: 'work',
  async onButton(ctx, [userId, id, i]) {
    if (ctx.user.id !== userId) return { reply: `This isn't your shift. Get your own with \`${config.prefix}work\`.` };
    const st = active.get(keyOf(ctx));
    if (!st || st.id !== id) return { update: { components: [] } }; // an old task: just clear its buttons

    if (st.mode === 'strike') {
      active.delete(keyOf(ctx));
      if (i === 'cross') {
        A.award(ctx, 'scab');
        const t = startTask(ctx, { job: st.job, style: st.job, tier: st.tier, scab: true, market: st.market, intro: '🪧 You cross the picket line. Boos all around.\n' });
        return { update: t };
      }
      const career = ctx.db.career(ctx.guildId, ctx.user.id, st.job);
      const c = jobs.COMPANIES[st.job];
      const price = st.market && st.market.prices ? Number(st.market.prices[st.job]) : c.start;
      const pay = ctx.db.tx(() => {
        const s = reserve.pay(ctx.db, Math.round(jobs.BASE_PAY * Math.max(price || c.start, 0.5) / c.start * jobs.rank(st.job, career.rank).mult * STRIKE.pay * 100));
        ctx.db.addCash(ctx.guildId, ctx.user.id, s);
        ctx.db.updateCareer(ctx.guildId, ctx.user.id, st.job, { earned: career.earned + s });
        return s;
      });
      A.award(ctx, 'solidarity');
      return { update: { content: `🪧 **Solidarity!** You hold the line with the union. Strike pay: **+${amt(pay)}**.\n-# Strikes don't count toward your review.`, components: [] } };
    }

    const choice = st.choices[Number(i)];
    if (!choice) return null;
    if (st.seq) {
      // Several presses in order; grade when the combo is complete
      st.pressed.push(choice.value);
      const soFar = st.pressed.every((v, k) => v === st.steps[k]);
      if (soFar && st.pressed.length < st.steps.length) return null; // so far so good, keep going
      ctx.cancelAwait();
      const result = await answer(ctx, st.pressed.join(' '));
      return { update: { components: [] }, followUp: result };
    }
    ctx.cancelAwait();
    const result = await answer(ctx, choice.value);
    return { update: { components: [] }, followUp: result };
  }
};
