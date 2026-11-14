// A shift (or a gig): hand out a task, wait for the answer (buttons or typing), grade it, pay.
// The task waits in a stored session, so a restart mid-task doesn't break its buttons, and exactly
// one answer is ever graded (sessions.end only succeeds once).
import type { Button, Ctx, ReplyObject, SessionReply } from '../commands/types';
import { economy } from '../config';
import { payFromReserve, payoutFactor } from '../core/economy';
import { emit } from '../core/events';
import { balance, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { load as loadMarket, nudge, quote } from '../market/market';
import { COMPANIES, JOB_RULES, RANK_PAY, clampRank, rankName, shiftPay, type Career } from './jobs';
import { isRight, makeTask, type Task } from './tasks';
import { takeItem, useEffect } from '../shop/inventory';
import { CO, addRevenue, getCompany, levelOf } from '../companies/companies';

export const KIND = 'work';

export interface WorkState {
  mode: 'work' | 'gig';
  ticker: string | null;
  style: string;
  rush: number;
  tier: number;
  task: Task;
  /** When the clock started (after any hidden-prompt delay). */
  startedAt: number;
  pressed: string[];
}

/** Forces a task kind (tests only). */
export const TUNING: { kind?: string } = {};

// Coworkers who worked recently in each channel, for team bonuses. In memory on purpose: losing it on a
// restart costs at most one team bonus.
const recent = new Map<string, Map<string, { at: number; name: string }>>();

export function careerOf(ctx: Ctx, guildId: string, ticker: string): Career {
  return ctx.db.get<Career>('SELECT rank, shifts, correct, rev_total, rev_right, earned FROM careers WHERE guild_id = ? AND user_id = ? AND ticker = ?', guildId, ctx.user.id, ticker)
    ?? { rank: 0, shifts: 0, correct: 0, rev_total: 0, rev_right: 0, earned: 0 };
}

function saveCareer(ctx: Ctx, guildId: string, ticker: string, c: Career): void {
  ctx.db.run(
    `INSERT INTO careers (guild_id, user_id, ticker, rank, shifts, correct, rev_total, rev_right, earned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(guild_id, user_id, ticker) DO UPDATE SET rank = excluded.rank, shifts = excluded.shifts, correct = excluded.correct,
       rev_total = excluded.rev_total, rev_right = excluded.rev_right, earned = excluded.earned`,
    guildId, ctx.user.id, ticker, c.rank, c.shifts, c.correct, c.rev_total, c.rev_right, c.earned
  );
}

function buttonsFor(sessionId: string, task: Task): Button[][] {
  if (!task.choices?.length) return [];
  const per = task.perRow ?? 5;
  const rows: Button[][] = [];
  task.choices.forEach((c, i) => {
    if (i % per === 0) rows.push([]);
    rows[rows.length - 1]!.push({ label: c.label, id: sessions.buttonId(sessionId, c.value), style: c.style ?? 'secondary', emoji: c.emoji });
  });
  return rows.slice(0, 5);
}

/** Hands out a task and stores it. Returns the message to send (with its buttons). */
export function startTask(ctx: Ctx, o: { mode: 'work' | 'gig'; ticker: string | null; style: string; rush?: number; tier?: number; intro?: string }): ReplyObject {
  const rush = o.rush ?? 0;
  const m = loadMarket(ctx.db);
  const c = m?.companies.find((x) => x.id === o.ticker && x.history?.length > 13);
  const priceHistory = c ? { ticker: c.id, hourAgo: c.history[c.history.length - 13]!, now: c.history[c.history.length - 1]! } : undefined;
  const task = makeTask(o.style, ctx.rng, { rush: rush > 0, tier: o.tier ?? 0, priceHistory, kind: TUNING.kind });
  // A Stopwatch charge: 10 extra seconds on a regular shift
  let intro = o.intro ? o.intro + '\n' : '';
  if (o.mode === 'work' && rush === 0 && ctx.guildId && useEffect(ctx.db, ctx.guildId, ctx.user.id, 'stopwatch')) {
    task.limitSec += 10;
    intro += '-# Stopwatch: 10 extra seconds.\n';
  }
  const hide = task.hideMs ?? 0;
  const state: WorkState = { mode: o.mode, ticker: o.ticker, style: o.style, rush, tier: o.tier ?? 0, task, startedAt: ctx.now + hide, pressed: [] };
  const s = sessions.create(ctx.db, { kind: KIND, guildId: ctx.guildId, channelId: ctx.channelId, userId: ctx.user.id, state, ttlMs: JOB_RULES.abandonMs + hide, now: ctx.now });
  const timer = `-# Time limit: ${task.limitSec} seconds.${task.steps ? ' Press them in order, or type them separated by spaces.' : ' Press a button or type the answer.'}`;
  const buttons = buttonsFor(s.id, task);
  if (hide) return { content: `${intro}${task.prompt}`, buttons: [], session: s.id, later: { ms: hide, edit: { content: `${intro}${task.hidden}\n${timer}`, buttons } } };
  return { content: `${intro}${task.prompt}\n${timer}`, buttons, session: s.id };
}

type Result = 'pass' | 'wrong' | 'slow';

/** Grades an answer to a stored task and pays. Returns null if it was already graded. */
export function grade(ctx: Ctx, s: sessions.Session<WorkState>, answer: string): ReplyObject | null {
  if (!sessions.end(ctx.db, s.id)) return null;
  const st = s.state;
  const elapsed = Math.max(0, (ctx.now - st.startedAt) / 1000);
  const result: Result = elapsed > st.task.limitSec ? 'slow' : isRight(st.task, answer) ? 'pass' : 'wrong';
  const speed = result === 'pass' ? JOB_RULES.tipMax * Math.max(0, 1 - elapsed / st.task.limitSec) : 0;
  const guildId = s.guild_id!;
  const w = wallet(guildId, ctx.user.id);
  const verdict = result === 'pass' ? `Correct, in ${elapsed.toFixed(1)} seconds.`
    : result === 'slow' ? 'Time expired.'
    : `Incorrect. The answer was \`${st.task.shown}\`.`;
  const factor = payoutFactor(ctx.db, economy.reserveStart);
  const shortfall = factor < 1 ? `\n-# The Polygon Reserve is low. Payouts are reduced to ${Math.round(factor * 100)}%.` : '';

  // ---------------- gigs ----------------
  if (st.mode === 'gig') {
    const pay = Math.round(JOB_RULES.basePay * JOB_RULES.gigShare * (result === 'pass' ? 1 : JOB_RULES.missShare));
    const tip = Math.round(pay * speed);
    const paid = payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: pay + tip, reason: 'work.gig', guildId, actorId: ctx.user.id, now: ctx.now });
    emit('work.gig', { guildId, userId: ctx.user.id, result, cents: paid });
    return { content: slip('**Gig complete.** ' + verdict, [['Gig pay', pay], ['Speed bonus', tip]], paid, balance(ctx.db, w)) + shortfall +
      `\n-# For steady pay, apply for a job with \`${ctx.config.prefix}apply <ticker>\`.` };
  }

  // ---------------- shifts ----------------
  const ticker = st.ticker!;
  const m = loadMarket(ctx.db);
  const q = m ? quote(m, ticker) : null;
  const career = careerOf(ctx, guildId, ticker);
  const pc = COMPANIES[ticker] ? null : getCompany(ctx.db, ticker);
  let pay = pc ? Math.round(JOB_RULES.basePay * RANK_PAY[clampRank(career.rank)] * levelOf(pc).payMult) : shiftPay(ticker, q?.priceCents, career.rank);
  const extras: string[] = [];
  let tip = 0, team = 0;

  if (st.rush > 0) {
    pay = result === 'pass' ? Math.round(pay * JOB_RULES.rushShare) : 0;
  } else {
    if (result !== 'pass') pay = Math.round(pay * JOB_RULES.missShare);
    if (useEffect(ctx.db, guildId, ctx.user.id, 'overtime')) { pay *= 2; extras.push('Overtime: pay doubled'); }
    const boost = m?.boost as { tickers?: string[] } | null | undefined;
    if (boost && (!boost.tickers?.length || boost.tickers.includes(ticker))) { pay *= 2; extras.push('Market boom: pay doubled'); }
    tip = Math.round(pay * speed);
    const key = `${guildId}:${s.channel_id}:${ticker}`;
    const crew = recent.get(key) ?? new Map<string, { at: number; name: string }>();
    for (const [u, x] of crew) if (ctx.now - x.at > JOB_RULES.team.windowMs) crew.delete(u);
    const mates = [...crew.entries()].filter(([u]) => u !== ctx.user.id).slice(0, JOB_RULES.team.max);
    if (mates.length) {
      team = Math.round(pay * JOB_RULES.team.each * mates.length);
      extras.push(`Team shift with ${mates.map(([, x]) => x.name).join(', ')}: +${Math.round(JOB_RULES.team.each * mates.length * 100)}%`);
    }
    crew.set(ctx.user.id, { at: ctx.now, name: ctx.user.name });
    recent.set(key, crew);
  }

  let review = '';
  let reviewBonus = 0;
  const reply = ctx.db.tx(() => {
    const raw = pay + tip + team;
    const paid = raw > 0 ? payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: raw, reason: st.rush ? 'work.rush' : 'work.shift', guildId, actorId: ctx.user.id, now: ctx.now, note: { ticker, result } }) : 0;
    const next: Career = { ...career, earned: career.earned + paid };
    if (st.rush === 0) {
      next.shifts++; next.rev_total++;
      if (result === 'pass') { next.correct++; next.rev_right++; }
      if (next.rev_total >= JOB_RULES.review.every) {
        const score = next.rev_right;
        next.rev_total = 0; next.rev_right = 0;
        let outcome: 'promoted' | 'bonus' | 'kept' | 'demoted' = 'kept';
        if (score >= JOB_RULES.review.promote && career.rank < 3) {
          next.rank = career.rank + 1; outcome = 'promoted';
          review = `**Performance review: ${score}/10.** Promoted to ${rankName(ticker, next.rank)}. Pay multiplier: ${RANK_PAY[clampRank(next.rank)]}×. Tasks will be more demanding.`;
        } else if (score >= JOB_RULES.review.promote) {
          reviewBonus = payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: Math.round(JOB_RULES.basePay * RANK_PAY[3] * JOB_RULES.review.topBonusShifts), reason: 'work.review', guildId, actorId: ctx.user.id, now: ctx.now });
          next.earned += reviewBonus; outcome = 'bonus';
          review = `**Performance review: ${score}/10.** Outstanding. A bonus of ${format(reviewBonus)} has been paid.`;
        } else if (score <= JOB_RULES.review.demote && career.rank > 0 && takeItem(ctx.db, guildId, ctx.user.id, 'reference')) {
          review = `**Performance review: ${score}/10.** A demotion was due, but your Reference Letter prevented it. You remain ${rankName(ticker, career.rank)}.`;
        } else if (score <= JOB_RULES.review.demote && career.rank > 0) {
          next.rank = career.rank - 1; outcome = 'demoted';
          review = `**Performance review: ${score}/10.** Demoted to ${rankName(ticker, next.rank)}. Pay multiplier: ${RANK_PAY[clampRank(next.rank)]}×.`;
        } else {
          review = `**Performance review: ${score}/10.** No change in rank. ${JOB_RULES.review.promote}/10 is required for ${career.rank < 3 ? 'a promotion' : 'a bonus'}.`;
        }
        emit('work.review', { guildId, userId: ctx.user.id, ticker, score, outcome, rank: next.rank });
      }
    }
    saveCareer(ctx, guildId, ticker, next);
    if (result === 'pass' && st.rush === 0 && !pc) nudge(ctx.db, ticker, JOB_RULES.stockNudge);
    if (pc && paid > 0) addRevenue(ctx.db, ticker, Math.round(paid * CO.revenueShare), ctx.now); // employees earn for their company
    emit('work.shift', { guildId, userId: ctx.user.id, ticker, result, cents: paid, rush: st.rush, team: team > 0 });

    const cash = balance(ctx.db, w);
    let content: string;
    if (st.rush > 0) {
      content = result === 'pass'
        ? `**Rush order cleared.** ${verdict} Bonus: **+${format(paid)}**\n-# Balance: ${format(cash)}`
        : `**Rush order missed.** ${verdict} No bonus is paid.`;
    } else {
      content = slip(`**Shift complete.** ${verdict}`, [['Shift pay', pay], ['Speed bonus', tip], ['Team bonus', team], ['Review bonus', reviewBonus]], paid + reviewBonus, cash);
      if (extras.length) content += `\n-# ${extras.join(' · ')}`;
    }
    if (review) content += `\n\n${review}`;
    return content + shortfall;
  });

  // After a correct answer, sometimes another task comes in right away
  if (result === 'pass' && st.rush < JOB_RULES.maxRush && ctx.rng.chance(JOB_RULES.rushChance)) {
    const n = st.rush + 1;
    const nextTask = startTask(ctx, { mode: 'work', ticker, style: st.style, rush: n, tier: st.tier,
      intro: `**Rush order #${n}.** Another task has arrived. Bonus pay applies if it is completed correctly.` });
    return { ...nextTask, content: `${reply}\n\n${nextTask.content}`, later: nextTask.later && { ...nextTask.later, edit: { ...nextTask.later.edit, content: `${reply}\n\n${nextTask.later.edit.content}` } } };
  }
  return { content: reply };
}

/** The payslip: each part on its own line, then the total. */
function slip(head: string, parts: [string, Cents][], total: Cents, cash: Cents): string {
  const lines = parts.filter(([, c]) => c > 0).map(([label, c]) => `${label}: +${format(c)}`);
  return `${head}\n${lines.join('\n')}${lines.length > 1 || lines.length === 0 ? `\n**Total: +${format(total)}**` : ''}\n-# Balance: ${format(cash)}`;
}

// ---------------------------------------------------------------- answers

/** A button press on a task. */
export function onButton(ctx: Ctx, s: sessions.Session<WorkState>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `This task belongs to another player. Start your own with \`${ctx.config.prefix}work\`.` };
  const st = s.state;
  if (st.task.steps) {
    st.pressed.push(value);
    const soFar = st.pressed.every((v, i) => v === st.task.steps![i]);
    if (soFar && st.pressed.length < st.task.steps.length) {
      sessions.save(ctx.db, s.id, st);
      return {};
    }
    const out = grade(ctx, s, st.pressed.join(' '));
    return out ? { update: { buttons: [] }, followUp: out } : { update: { buttons: [] } };
  }
  const out = grade(ctx, s, value);
  return out ? { update: { buttons: [] }, followUp: out } : { update: { buttons: [] } };
}

/** A typed answer in the task's channel. */
export function onText(ctx: Ctx, s: sessions.Session<WorkState>, text: string): ReplyObject | null {
  return grade(ctx, s, text);
}

// ---------------------------------------------------------------- layoffs

/** A bankrupt company lays its staff off with severance. Returns the message. */
export function layOff(ctx: Ctx, guildId: string, ticker: string): string | null {
  if (takeItem(ctx.db, guildId, ctx.user.id, 'hardhat')) {
    ctx.notes.push(`${COMPANIES[ticker]?.name ?? ticker} is bankrupt and laying staff off. Your Hard Hat kept you on the payroll.`);
    return null;
  }
  const career = careerOf(ctx, guildId, ticker);
  const cents = Math.round(JOB_RULES.basePay * RANK_PAY[clampRank(career.rank)] * JOB_RULES.severanceShifts);
  const paid = ctx.db.tx(() => {
    ctx.db.run('UPDATE players SET job = NULL WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
    const p = payFromReserve(ctx.db, economy.reserveStart, { to: wallet(guildId, ctx.user.id), cents, reason: 'work.severance', guildId, actorId: ctx.user.id, now: ctx.now });
    emit('work.laidoff', { guildId, userId: ctx.user.id, ticker, cents: p });
    return p;
  });
  return `**Laid off.** ${COMPANIES[ticker]?.name ?? ticker} is bankrupt and cannot make payroll. Severance of ${format(paid)} has been paid.\n` +
    `Your rank is kept if you return. Until then, use \`${ctx.config.prefix}gig\` or apply elsewhere.`;
}

