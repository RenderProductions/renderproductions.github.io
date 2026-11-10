const config = require('../config');
const jobs = require('../jobs');
const co = require('../companies');
const { relTime } = require('../format');

// Tasks waiting for an answer: "guild:user" -> { job, ans, start, rush }
const active = new Map();
const keyOf = (ctx) => `${ctx.guildId}:${ctx.user.id}`;

// Player companies borrow one of the five task styles, always the same one for a given ticker
function taskStyle(ticker) {
  const styles = Object.keys(jobs.COMPANIES);
  let h = 0;
  for (const ch of ticker) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return styles[h % styles.length];
}

// Starts a task and waits for the player's answer in the channel.
function startTask(ctx, job, rush) {
  const t = jobs.task(jobs.COMPANIES[job] ? job : taskStyle(job), rush > 0, ctx.random);
  active.set(keyOf(ctx), { job, ans: t.ans, start: Date.now(), rush });
  ctx.awaitNext((msg) => answer(ctx, msg), jobs.ABANDON_MS);
  return t.q;
}

// Grades the answer, pays, and maybe starts a rush round.
async function answer(ctx, msg) {
  const key = keyOf(ctx);
  const st = active.get(key);
  if (!st) return null;
  active.delete(key);

  const elapsed = (Date.now() - st.start) / 1000;
  const limit = st.rush > 0 ? 15 : 20;
  const result = elapsed > limit ? 'slow' : String(msg.content).trim().toLowerCase() === st.ans ? 'pass' : 'wrong';

  const p = ctx.db.player(ctx.guildId, ctx.user);
  const r = jobs.rank(p.shifts);
  const c = jobs.COMPANIES[st.job];
  let pay;
  if (c) {
    // Pay follows the live stock price (falls back to the starting price)
    const m = await ctx.market.get();
    let price = m && m.prices ? Number(m.prices[st.job]) : NaN;
    if (!Number.isFinite(price)) price = c.start;
    // BSTG swings wildly, so its pay uses a price capped between 10 and 200 (0.2x to 4x pay)
    if (st.job === 'BSTG') price = Math.max(Math.min(price, 200), 10);
    pay = jobs.BASE_PAY * price / c.start * r.mult;
  } else {
    // Player company: pay grows with its level
    const pc = co.get(ctx.db, st.job);
    if (!co.alive(pc)) return `💀 ${st.job} went under while you were working. You're out of a job.`;
    pay = jobs.BASE_PAY * co.level(pc).payMult * r.mult;
  }
  let ot = '';
  const update = {};
  if (st.rush > 0) {
    pay = result === 'pass' ? pay * 0.6 : 0; // rush round: bonus only if you got it right
  } else {
    if (result !== 'pass') pay *= 0.4;
    if (p.overtime) { pay *= 2; update.overtime = 0; ot = ' (overtime x2!)'; }
  }
  pay = Math.round(pay);

  let out;
  if (st.rush === 0) {
    update.shifts = p.shifts + 1;
    if (result === 'pass') out = `✅ Nice work, ${r.name}! **+${pay} Polygons**${ot}`;
    else if (result === 'slow') out = `🐢 Too slow! You still clocked in for **+${pay} Polygons**${ot}`;
    else out = `❌ Not quite, it was \`${st.ans}\`. You still get **+${pay} Polygons**${ot}`;
    if (jobs.PROMOTIONS[update.shifts]) out += '\n' + jobs.PROMOTIONS[update.shifts];
  } else {
    out = result === 'pass' ? `⚡ **RUSH CLEARED!** Bonus **+${pay} Polygons**` : '💨 The rush got away from you. No bonus this time.';
  }

  ctx.db.tx(() => {
    ctx.db.addCash(ctx.guildId, ctx.user.id, pay * 100);
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, update);
    if (!c) co.addRevenue(ctx.db, st.job, Math.round(pay * 100 * co.RULES.revenueShare)); // shifts earn the company money
  });

  // 1 in 5: another task comes in. Only after a pass, max 5 in a row.
  const random = ctx.random || Math.random;
  if (result === 'pass' && st.rush < 5 && random() < 0.2) {
    const next = st.rush + 1;
    const q = startTask(ctx, st.job, next);
    out += `\n\n⚡ **RUSH ORDER #${next}!** It's not over yet!\n${q}\n⏱️ **15 seconds.** Bonus pay if you nail it.`;
  }
  return out;
}

module.exports = {
  name: 'work',
  description: 'Start a shift at your job (every 15 minutes)',
  options: [],
  active,

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (!p.job) return `❌ You need a job first. Try \`${config.prefix}apply <ticker>\`.`;
    if (!jobs.COMPANIES[p.job] && !co.alive(co.get(ctx.db, p.job))) {
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { job: null, shifts: 0 });
      return `💀 **${p.job}** went under. You're out of a job. Try \`${config.prefix}apply <ticker>\`.`;
    }

    const cur = active.get(keyOf(ctx));
    if (cur && Date.now() - cur.start <= jobs.ABANDON_MS) return "⏱️ You're mid-shift! Answer your current task first.";
    active.delete(keyOf(ctx));

    const next = p.last_work + jobs.WORK_COOLDOWN_MS;
    if (Date.now() < next) return `😴 Shift's over. Next shift ${relTime(next)}.`;

    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { last_work: Date.now() });
    return `${startTask(ctx, p.job, 0)}\n⏱️ You have **20 seconds**.`;
  }
};
