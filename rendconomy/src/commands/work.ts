import { GameError } from '../core/errors';
import { format } from '../core/money';
import * as sessions from '../core/sessions';
import { cooldown, discordTime, takeCooldown } from '../core/time';
import { embed } from '../discord/style';
import { load as loadMarket, quote } from '../market/market';
import { COMPANIES, JOB_RULES, RANK_PAY, clampRank, rankName, shiftPay } from '../work/jobs';
import { KIND, careerOf, layOff, startTask } from '../work/shift';
import { guildOf, me } from './shared';
import { takeItem } from '../shop/inventory';
import { awardHere } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, wallet } from '../core/ledger';
import { alive, getCompany } from '../companies/companies';
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
    if (m?.statuses?.[p.job] === 'bankrupt') { const out = layOff(ctx, guildId, p.job); if (out) return out; }
    if (!takeCooldown(ctx.db, 'work', subject(ctx), JOB_RULES.workCooldownMs, ctx.now)) {
      const cd = cooldown(ctx.db, 'work', subject(ctx), ctx.now);
      throw new GameError('work.cooldown', `Your next shift is available ${discordTime(cd.until)}.`);
    }
    const career = careerOf(ctx, guildId, p.job);
    if (!COMPANIES[p.job] && !alive(getCompany(ctx.db, p.job))) {
      ctx.db.run('UPDATE players SET job = NULL WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
      throw new GameError('work.closed', 'Your company has closed. Apply somewhere else.');
    }
    const style = COMPANIES[p.job] ? p.job : Object.keys(COMPANIES)[[...p.job].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 5]!;
    ctx.db.setMeta(`remind:${guildId}:${ctx.user.id}`, ctx.db.meta(`remind.on:${ctx.user.id}`) === '1' ? ctx.now + JOB_RULES.workCooldownMs : 0);
    // Strikes: when the Polygon Reserve is low, the union may walk out. Join them, or cross the line.
    if (COMPANIES[p.job] && balance(ctx.db, RESERVE) < economy.reserveStart * 0.25 && ctx.rng.chance(0.3)) {
      const s = sessions.create(ctx.db, { kind: 'strike', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { job: p.job, tier: career.rank }, ttlMs: JOB_RULES.abandonMs, now: ctx.now });
      return { content: `**Strike at ${COMPANIES[p.job]!.name}.** The Polygon Reserve is running low and the union is walking out.\n**Join the strike** for strike pay (25%), or **cross the picket line** and work (-10%, and the stock takes a hit).`,
        buttons: [[{ label: 'Join the strike', id: sessions.buttonId(s.id, 'strike'), style: 'success' }, { label: 'Cross the line', id: sessions.buttonId(s.id, 'cross'), style: 'danger' }]], session: s.id };
    }
    return startTask(ctx, { mode: 'work', ticker: p.job, style, tier: career.rank });
  }
};

export const gig: Command = {
  name: 'gig',
  aliases: ['sidehustle'],
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
    const pc = COMPANIES[t] ? null : getCompany(ctx.db, t);
    if (pc && alive(pc) && pc.owner_id === ctx.user.id) throw new GameError('apply.own', 'You run that company; you cannot also be an employee.');
    const c = COMPANIES[t] ?? (pc && alive(pc) ? { ticker: t, name: pc.name, role: 'the payroll', ranks: ['Intern', 'Employee', 'Manager', 'Executive'] as const } : undefined);
    if (!c) throw new GameError('apply.unknown', `Choose a company: ${tickers()}, or an open player company.`);
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
    if (ctx.now < free && !takeItem(ctx.db, guildId, ctx.user.id, 'resume')) {
      throw new GameError('quit.locked', `You were hired recently. You may quit ${discordTime(free)}, or sooner with a Resume from Marquez.`);
    }
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
  description: 'Your job: rank, next review, accuracy, earnings and next shift (or "remind on|off")',
  system: 'work',
  guildOnly: true,
  options: [{ name: 'remind', type: 'string', description: '"remind on" or "remind off": a DM when your next shift is ready' }],
  run(ctx, args) {
    const r = /^(?:remind\s+)?(on|off)$/i.exec(String(args.remind ?? '').trim());
    if (r) {
      ctx.db.setMeta(`remind.on:${ctx.user.id}`, r[1]!.toLowerCase() === 'on' ? '1' : '0');
      return { content: `Shift reminders are **${r[1]!.toLowerCase()}**.`, ephemeral: true };
    }
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
    const co = COMPANIES[p.job] ?? { name: getCompany(ctx.db, p.job)?.name ?? p.job, ranks: ['Intern', 'Employee', 'Manager', 'Executive'] };
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

export function onStrikeButton(ctx: Ctx, s: sessions.Session<{ job: string; tier: number }>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: 'This decision belongs to another player.' };
  if (!sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  const g = s.guild_id!;
  if (value === 'strike') {
    const m = loadMarket(ctx.db);
    const pay = payFromReserve(ctx.db, economy.reserveStart, { to: wallet(g, ctx.user.id), cents: Math.round(shiftPay(s.state.job, m ? quote(m, s.state.job)?.priceCents : undefined, s.state.tier) * 0.25), reason: 'work.strike', guildId: g, actorId: ctx.user.id, now: ctx.now });
    awardHere('solidarity');
    return { update: { content: `**Solidarity.** You hold the line with the union. Strike pay: **+${format(pay)}**.\n-# Strikes do not count toward your review.`, buttons: [] } };
  }
  awardHere('scab');
  return { update: { buttons: [] }, followUp: startTask(ctx, { mode: 'work', ticker: s.state.job, style: s.state.job, tier: s.state.tier, scab: true, intro: 'You cross the picket line.' }) };
}
