import { GameError } from '../core/errors';
import { format } from '../core/money';
import * as sessions from '../core/sessions';
import { cooldown, discordTime, takeCooldown } from '../core/time';
import { embed } from '../discord/style';
import { load as loadMarket, quote } from '../market/market';
import { COMPANIES, JOB_RULES, RANK_PAY, clampRank, rankName, shiftPay } from '../work/jobs';
import { KIND, careerOf, layOff, startTask } from '../work/shift';
import { guildOf, me } from './shared';
import type { Command, Ctx, SessionReply } from './types';

const tickers = () => Object.keys(COMPANIES).join(', ');
const subject = (ctx: Ctx) => `${ctx.guildId}:${ctx.user.id}`;

function midTask(ctx: Ctx): void {
  if (sessions.active(ctx.db, KIND, ctx.guildId, ctx.user.id, ctx.now)) {
    throw new GameError('work.busy', 'A task is already in progress. Answer it first.');
  }
}

export const work: Command = {
  name: 'work',
  description: 'Work a shift at your job (every 15 minutes)',
  system: 'work',
  guildOnly: true,
  run(ctx) {
    const { player, guildId } = me(ctx);
    const p = player;
    if (!p.job) throw new GameError('work.nojob', `You do not have a job. Apply with \`${ctx.config.prefix}apply <ticker>\` (${tickers()}), or take a \`${ctx.config.prefix}gig\`.`);
    midTask(ctx);
    const m = loadMarket(ctx.db);
    if (m?.statuses?.[p.job] === 'bankrupt') return layOff(ctx, guildId, p.job);
    if (!takeCooldown(ctx.db, 'work', subject(ctx), JOB_RULES.workCooldownMs, ctx.now)) {
      const cd = cooldown(ctx.db, 'work', subject(ctx), ctx.now);
      throw new GameError('work.cooldown', `Your next shift is available ${discordTime(cd.until)}.`);
    }
    const career = careerOf(ctx, guildId, p.job);
    return startTask(ctx, { mode: 'work', ticker: p.job, style: p.job, tier: career.rank });
  }
};

export const gig: Command = {
  name: 'gig',
  description: 'A quick paid task, no job needed (every 10 minutes)',
  system: 'work',
  guildOnly: true,
  run(ctx) {
    me(ctx);
    midTask(ctx);
    if (!takeCooldown(ctx.db, 'gig', subject(ctx), JOB_RULES.gigCooldownMs, ctx.now)) {
      const cd = cooldown(ctx.db, 'gig', subject(ctx), ctx.now);
      throw new GameError('gig.cooldown', `Your next gig is available ${discordTime(cd.until)}.`);
    }
    return startTask(ctx, { mode: 'gig', ticker: null, style: ctx.rng.pick(Object.keys(COMPANIES)), tier: 0, intro: '**Gig.**' });
  }
};

export const apply: Command = {
  name: 'apply',
  description: 'Apply for a job at a company',
  system: 'work',
  guildOnly: true,
  options: [{ name: 'ticker', type: 'string', description: 'Company to work for, e.g. NACH', required: true }],
  run(ctx, args) {
    const { player, guildId } = me(ctx);
    const p = player;
    const t = String(args.ticker ?? '').trim().toUpperCase();
    const c = COMPANIES[t];
    if (!c) throw new GameError('apply.unknown', `Choose a company: ${tickers()}.`);
    if (p.job === t) throw new GameError('apply.same', `You already work at ${c.name}.`);
    if (p.job) throw new GameError('apply.employed', `You already work at ${COMPANIES[p.job]?.name ?? p.job}. Use \`${ctx.config.prefix}quit\` first.`);
    const m = loadMarket(ctx.db);
    if (m?.statuses?.[t] === 'bankrupt') throw new GameError('apply.bankrupt', `${c.name} is bankrupt and is not hiring.`);
    const crash = m?.crash as { phase?: string } | null | undefined;
    if (crash && (crash.phase === 'crash' || crash.phase === 'tremor')) throw new GameError('apply.freeze', 'Hiring is frozen while the market crashes. Gigs remain available.');
    ctx.db.run('UPDATE players SET job = ?, hired_at = ? WHERE guild_id = ? AND user_id = ?', t, ctx.now, guildId, ctx.user.id);
    const career = careerOf(ctx, guildId, t);
    const rank = rankName(t, career.rank);
    return {
      embeds: [embed('work', career.shifts ? `Rehired: ${c.name}` : `Hired: ${c.name}`, [
        career.shifts ? `You return as **${rank}**, with ${career.shifts} shifts on record.` : `You start as **${rank}** on ${c.role}.`,
        `Work a shift with \`${ctx.config.prefix}work\`. Pay follows the ${t} share price.`,
        `A performance review every ${JOB_RULES.review.every} shifts decides promotions.`
      ])]
    };
  }
};

export const quit: Command = {
  name: 'quit',
  description: 'Leave your job (24 hours after being hired; your rank is kept)',
  system: 'work',
  guildOnly: true,
  run(ctx) {
    const { player, guildId } = me(ctx);
    const p = player;
    if (!p.job) throw new GameError('quit.nojob', 'You do not have a job.');
    const free = (p.hired_at ?? 0) + JOB_RULES.quitLockMs;
    if (ctx.now < free) throw new GameError('quit.locked', `You were hired recently. You may quit ${discordTime(free)}.`);
    const career = careerOf(ctx, guildId, p.job);
    const s = sessions.create(ctx.db, { kind: 'quit', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { job: p.job }, ttlMs: 2 * 60_000, now: ctx.now });
    return {
      content: `Confirm resignation from **${COMPANIES[p.job]?.name ?? p.job}**? You are **${rankName(p.job, career.rank)}** with ${career.shifts} shifts. Your rank is kept if you return.`,
      buttons: [[
        { label: 'Resign', id: sessions.buttonId(s.id, 'yes'), style: 'danger' },
        { label: 'Stay', id: sessions.buttonId(s.id, 'no'), style: 'secondary' }
      ]],
      session: s.id
    };
  }
};

export function onQuitButton(ctx: Ctx, s: sessions.Session<{ job: string }>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: 'This decision belongs to another player.' };
  if (!sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  if (value !== 'yes') return { update: { content: 'Resignation cancelled.', buttons: [] } };
  ctx.db.run('UPDATE players SET job = NULL, quit_at = ? WHERE guild_id = ? AND user_id = ? AND job = ?', ctx.now, s.guild_id, ctx.user.id, s.state.job);
  return { update: { content: `You have resigned from **${COMPANIES[s.state.job]?.name ?? s.state.job}**. Your rank there is kept.`, buttons: [] } };
}

export const job: Command = {
  name: 'job',
  aliases: ['career'],
  description: 'Your job: rank, next review, accuracy, earnings and next shift',
  system: 'work',
  guildOnly: true,
  run(ctx) {
    const { player } = me(ctx);
    const guildId = guildOf(ctx);
    const p = player;
    const past = ctx.db.all<{ ticker: string; rank: number; shifts: number }>(
      'SELECT ticker, rank, shifts FROM careers WHERE guild_id = ? AND user_id = ? AND shifts > 0 ORDER BY shifts DESC', guildId, ctx.user.id
    ).filter((c) => c.ticker !== p.job);
    const pastLines = past.length ? ['', '**Previous positions** (ranks kept)', ...past.map((c) => `${c.ticker} · ${rankName(c.ticker, c.rank)} · ${c.shifts} shifts`)] : [];

    if (!p.job) {
      const g = cooldown(ctx.db, 'gig', `${guildId}:${ctx.user.id}`, ctx.now);
      return { embeds: [embed('work', `Career: ${ctx.user.name}`, [
        `No current job. Apply with \`${ctx.config.prefix}apply <ticker>\` (${tickers()}).`,
        g.ready ? 'A gig is available.' : `Next gig: ${discordTime(g.until)}`,
        ...pastLines
      ])] };
    }
    const c = careerOf(ctx, guildId, p.job);
    const co = COMPANIES[p.job]!;
    const m = loadMarket(ctx.db);
    const q = m ? quote(m, p.job) : null;
    const ladder = co.ranks.map((n, i) => (i === c.rank ? `**${n}**` : n)).join(' → ');
    const w = cooldown(ctx.db, 'work', `${guildId}:${ctx.user.id}`, ctx.now);
    return { embeds: [embed('work', `Career: ${ctx.user.name}`, [
      `**${co.name}** (${p.job})`,
      ladder,
      `Pay multiplier: ${RANK_PAY[clampRank(c.rank)]}×. A correct shift currently pays about ${format(shiftPay(p.job, q?.priceCents, c.rank))}.`,
      `Next review in ${JOB_RULES.review.every - c.rev_total} ${JOB_RULES.review.every - c.rev_total === 1 ? 'shift' : 'shifts'} (${c.rev_right}/${c.rev_total} correct so far).`,
      `Shifts: ${c.shifts} · Accuracy: ${c.shifts ? Math.round((c.correct / c.shifts) * 100) : 0}% · Earned: ${format(c.earned)}`,
      w.ready ? 'Your next shift is available now.' : `Next shift: ${discordTime(w.until)}`,
      m?.statuses?.[p.job] === 'bankrupt' ? '**The company is bankrupt.** Your next shift will be a layoff.' : null,
      ...pastLines
    ])] };
  }
};
