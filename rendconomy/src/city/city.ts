// Under New Management (NachoBellGrande1065's idea): every server elects a mayor each week. Nominations Monday to
// Thursday, voting Friday to Sunday, results Sunday 9 PM Eastern; the winner serves until the next Sunday night.
// The mayor has real powers: business (block takeovers and mergers, freeze a company's trading, investigate,
// fine, bail out), taxes within ranges, public works they design, decrees, and two appointees. Limits: never
// paying themselves, no business powers in a fight they have a stake in, everything on the public record, and
// impeachment. Money goes through the city treasury (ledger account city:<guild>).
import { award } from '../achievements/achievements';
import { bidOn, cancelBid, getCompany, holding, mergerFor, treasury, treasuryId, type Company } from '../companies/companies';
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { balance, ensureAccount, transfer, wallet } from '../core/ledger';
import { addMoment } from '../core/moments';
import { format, polygons, type Cents } from '../core/money';
import { DAY, HOUR, nextReset } from '../core/time';
import { addInbox } from '../social/inbox';
import {
  activeDays, activePlayers, cityAccount, cityLog, closesAt, DEFAULT_POLICY, mayorTerm, nextWeek, phaseOf, policyOf, prevWeek, savePolicy,
  tomorrow, weekOf, type Decree, type Policy, type Term, type WorkEffect
} from './state';

export const CITY = {
  run: { activeDays: 3, accountAgeMs: 7 * DAY, maxConsecutive: 2, sloganMax: 80 },
  freeze: { perTerm: 2, ms: DAY },
  fine: { perTerm: 3, share: 0.15, max: polygons(20_000) },
  investigateMs: 7 * DAY,
  taxMax: { shop: 0.15, property: 0.03, casino: 0.15 },
  collect: { fee: [0.05, 0.2] as [number, number], graceDays: [1, 5] as [number, number] },
  impeach: { windowMs: DAY, share: 0.5, min: 5 },
  decreesPerDay: 1,
  /** Public works: the range of each effect's size, and its cost per unit (a percent, or an hour of Happy Hour)
   *  per day per active player (at least 5 players). */
  works: {
    rent: { min: 0.05, max: 0.2, rate: polygons(50), label: 'rent', unit: '%' },
    chat: { min: 0.25, max: 1, rate: polygons(20), label: 'chat pay', unit: '%' },
    shifts: { min: 0.05, max: 0.15, rate: polygons(60), label: 'shift pay', unit: '%' },
    crops: { min: 0.05, max: 0.2, rate: polygons(30), label: 'crop prices', unit: '%' },
    happyhour: { min: 1, max: 6, rate: polygons(300), label: 'Happy Hour', unit: 'h' }
  } as Record<WorkEffect, { min: number; max: number; rate: Cents; label: string; unit: '%' | 'h' }>,
  workDays: [1, 7] as [number, number],
  decrees: {
    happyhour: { ms: 2 * HOUR, label: 'Happy Hour (2 hours)' },
    noheist: { ms: DAY, label: 'No heists for 24 hours' },
    doubledaily: { ms: 0, label: 'Double dailies until midnight' },
    marketholiday: { ms: 0, label: 'Market holiday: player companies don\'t trade until midnight' },
    amnesty: { ms: 0, label: 'Amnesty: everyone\'s Heat drops by 25' }
  } as Record<Decree, { ms: number; label: string }>
};

export const ensureCity = (db: Db, g: string, now = Date.now()): string => { const id = cityAccount(g); ensureAccount(db, id, 'city', g, null, now); return id; };
export const cityBalance = (db: Db, g: string): Cents => balance(db, cityAccount(g));

// ================================================================ elections

export interface Candidate { user_id: string; slogan: string | null; at: number; votes: number }
export function candidatesOf(db: Db, g: string, week: string): Candidate[] {
  return db.all<Candidate>(`SELECT c.user_id, c.slogan, c.at, (SELECT COUNT(*) FROM votes v WHERE v.guild_id = c.guild_id AND v.week = c.week AND v.candidate_id = c.user_id) AS votes
    FROM candidates c WHERE c.guild_id = ? AND c.week = ? ORDER BY votes DESC, c.at`, g, week);
}

/** Why this player can't run this week, or null if they can. */
export function cannotRun(db: Db, g: string, u: string, now = Date.now()): string | null {
  const p = db.get<{ joined_at: number }>('SELECT joined_at FROM players WHERE guild_id = ? AND user_id = ?', g, u);
  if (!p) return 'You need an account here first.';
  if (now - p.joined_at < CITY.run.accountAgeMs) return `Candidates need an account at least ${CITY.run.accountAgeMs / DAY} days old here. Yours will be <t:${Math.floor((p.joined_at + CITY.run.accountAgeMs) / 1000)}:R>.`;
  const days = activeDays(db, g, u, now);
  if (days < CITY.run.activeDays) return `Candidates have to be active: you've played on ${days} of the last 7 days here, and it takes ${CITY.run.activeDays}.`;
  // at most two terms in a row: the race running now is for the term after this one
  const { week } = phaseOf(now);
  const last = [prevWeek(week), prevWeek(prevWeek(week))].map((w) => db.get<{ user_id: string }>('SELECT user_id FROM mayors WHERE guild_id = ? AND week = ?', g, w)?.user_id);
  if (last.length === CITY.run.maxConsecutive && last.every((x) => x === u)) return `You've served ${CITY.run.maxConsecutive} terms in a row. Sit this one out; you can run again next week.`;
  return null;
}

export function run(db: Db, g: string, u: string, slogan: string | null, now = Date.now()): { week: string } {
  const { week, phase } = phaseOf(now);
  if (phase !== 'nominations') throw new GameError('city.phase', `Nominations are closed: voting runs until <t:${Math.floor(closesAt(week) / 1000)}:F>. Nominations for the next race open right after.`);
  const why = cannotRun(db, g, u, now);
  if (why) throw new GameError('city.run', why);
  db.run('INSERT INTO candidates (guild_id, week, user_id, slogan, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, week, user_id) DO UPDATE SET slogan = excluded.slogan',
    g, week, u, slogan ? slogan.slice(0, CITY.run.sloganMax) : null, now);
  return { week };
}
export function withdraw(db: Db, g: string, u: string, now = Date.now()): void {
  const { week } = phaseOf(now);
  if (!db.run('DELETE FROM candidates WHERE guild_id = ? AND week = ? AND user_id = ?', g, week, u).changes) throw new GameError('city.none', 'You aren\'t running this week.');
  db.run('DELETE FROM votes WHERE guild_id = ? AND week = ? AND candidate_id = ?', g, week, u);
}

/** Anyone with an account votes, once; they can change it until voting closes. */
export function vote(db: Db, g: string, voter: string, candidate: string, now = Date.now()): { week: string; changed: boolean } {
  const { week, phase } = phaseOf(now);
  if (phase !== 'voting') throw new GameError('city.phase', `Voting opens <t:${Math.floor((closesAt(week) - 2 * DAY - 21 * HOUR) / 1000)}:F> (Friday) and closes Sunday at 9 PM Eastern.`);
  if (!db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', g, voter)) throw new GameError('player.none', 'You need an account here to vote. Claim your daily first.');
  if (!db.get('SELECT 1 FROM candidates WHERE guild_id = ? AND week = ? AND user_id = ?', g, week, candidate)) throw new GameError('city.notrunning', 'That player isn\'t on the ballot. See who is with `mayor race`.');
  const changed = !!db.get('SELECT 1 FROM votes WHERE guild_id = ? AND week = ? AND voter_id = ?', g, week, voter);
  db.run('INSERT INTO votes (guild_id, week, voter_id, candidate_id, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, week, voter_id) DO UPDATE SET candidate_id = excluded.candidate_id, at = excluded.at', g, week, voter, candidate, now);
  return { week, changed };
}

export interface Result { guildId: string; week: string; winner: string | null; votes: number; total: number; candidates: Candidate[] }
/** Counts any election that has closed and hasn't been counted. Returns the results, for announcing. */
export function countElections(db: Db, g: string, now = Date.now()): Result[] {
  const out: Result[] = [];
  let w = weekOf(now);
  if (now < closesAt(w)) w = prevWeek(w);
  for (const week of [prevWeek(w), w]) {
    if (now < closesAt(week) || db.meta(`city.counted:${g}:${week}`)) continue;
    db.tx(() => {
      db.setMeta(`city.counted:${g}:${week}`, '1');
      const cs = candidatesOf(db, g, week);
      const total = cs.reduce((s, c) => s + c.votes, 0);
      const win = cs.length && cs[0]!.votes > 0 ? cs[0]! : cs.length === 1 ? cs[0]! : null;
      if (win) {
        db.run('INSERT OR REPLACE INTO mayors (guild_id, week, user_id, votes, total, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)', g, week, win.user_id, win.votes, total, closesAt(week), closesAt(nextWeek(week)));
        award(db, g, win.user_id, 'elected', now);
        if (total >= 3 && win.votes / total >= 0.7) award(db, g, win.user_id, 'landslide', now);
        const streak = [week, prevWeek(week), prevWeek(prevWeek(week))].filter((x) => db.get<{ user_id: string }>('SELECT user_id FROM mayors WHERE guild_id = ? AND week = ?', g, x)?.user_id === win.user_id).length;
        if (streak >= 2) award(db, g, win.user_id, 're_elected', now);
        addMoment('🏛️ A server just elected a new mayor', now);
      }
      for (const c of cs) addInbox(db, c.user_id, g, 'Election results', win?.user_id === c.user_id ? `You won! You're mayor until <t:${Math.floor(closesAt(nextWeek(week)) / 1000)}:F> with ${c.votes} of ${total} votes. See your powers with \`mayor help\`.` : `<@${win?.user_id}> won the election with ${win?.votes} of ${total} votes. You got ${c.votes}.`, now);
      cityLog(db, g, null, 'election', win ? `<@${win.user_id}> won with ${win.votes} of ${total} votes` : 'Nobody ran. The seat is empty this week.', 0, now);
      out.push({ guildId: g, week, winner: win?.user_id ?? null, votes: win?.votes ?? 0, total, candidates: cs });
    });
  }
  return out;
}

/** The mayor in office (counting any election that just closed first). */
export function mayor(db: Db, g: string, now = Date.now()): Term | null {
  countElections(db, g, now);
  return mayorTerm(db, g, now);
}

// ================================================================ impeachment

export function impeachState(db: Db, g: string, now = Date.now()): { open: boolean; until: number; yes: number; need: number } | null {
  const t = mayorTerm(db, g, now);
  if (!t) return null;
  const until = Number(db.meta(`city.impeach:${g}:${t.week}`) ?? 0);
  const yes = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM impeach_votes WHERE guild_id = ? AND week = ?', g, t.week)!.n;
  return { open: until > now, until, yes, need: Math.max(CITY.impeach.min, Math.floor(t.total * CITY.impeach.share) + 1) };
}
/** Opens the 24-hour vote, or adds a yes. Removes the mayor if it passes. */
export function impeach(db: Db, g: string, voter: string, now = Date.now()): { yes: number; need: number; removed: boolean; opened: boolean } {
  const t = mayor(db, g, now);
  if (!t) throw new GameError('city.nomayor', 'There\'s no mayor to impeach right now.');
  if (!db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', g, voter)) throw new GameError('player.none', 'You need an account here to vote.');
  const st = impeachState(db, g, now)!;
  let opened = false;
  if (!st.open) {
    if (st.until && st.until <= now) throw new GameError('city.impeach', 'This mayor already survived an impeachment vote this term.');
    db.setMeta(`city.impeach:${g}:${t.week}`, String(now + CITY.impeach.windowMs));
    opened = true;
    cityLog(db, g, voter, 'impeach', `<@${voter}> called a vote to impeach <@${t.user_id}>`, 0, now);
  }
  if (!db.run('INSERT OR IGNORE INTO impeach_votes (guild_id, week, voter_id) VALUES (?, ?, ?)', g, t.week, voter).changes) throw new GameError('city.voted', 'You already voted to impeach.');
  const after = impeachState(db, g, now)!;
  if (after.yes >= after.need) {
    db.run('UPDATE mayors SET impeached_at = ? WHERE guild_id = ? AND week = ?', now, g, t.week);
    award(db, g, t.user_id, 'impeached', now);
    addInbox(db, t.user_id, g, 'Impeached', `The server voted you out (${after.yes} votes). Your taxes and decrees end now, and the seat is empty until the next election.`, now);
    cityLog(db, g, null, 'impeached', `<@${t.user_id}> was impeached with ${after.yes} votes`, 0, now);
    addMoment('🏛️ A mayor was just impeached', now);
    return { yes: after.yes, need: after.need, removed: true, opened };
  }
  return { yes: after.yes, need: after.need, removed: false, opened };
}

// ================================================================ who may do what

export type Power = 'business' | 'freeze' | 'investigate' | 'fine' | 'bailout' | 'tax' | 'build' | 'decree' | 'appoint' | 'collect';
/** Throws unless this player may use this power now. Returns the term. */
export function authorize(db: Db, g: string, u: string, power: Power, now = Date.now()): { term: Term; policy: Policy; role: 'mayor' | 'treasurer' | 'chief' } {
  const term = mayor(db, g, now);
  if (!term) throw new GameError('city.nomayor', 'There\'s no mayor this week, so City Hall is closed.');
  const policy = policyOf(db, g, now);
  if (term.user_id === u) return { term, policy, role: 'mayor' };
  if (policy.treasurer === u && (power === 'build' || power === 'bailout')) return { term, policy, role: 'treasurer' };
  if (policy.chief === u && (power === 'investigate' || power === 'freeze')) return { term, policy, role: 'chief' };
  throw new GameError('city.notmayor', policy.treasurer === u || policy.chief === u ? 'Your appointment doesn\'t cover that. Ask the mayor.' : 'Only the mayor can do that.');
}

/** Conflict of interest: owns, holds shares in, or is bidding on the company (or the one it's merging with). */
export function stakeIn(db: Db, g: string, u: string, c: Company): boolean {
  const tickers = [c.ticker, mergerFor(db, c.ticker)].filter(Boolean) as string[];
  for (const t of tickers) {
    const x = getCompany(db, t);
    if (!x) continue;
    if (x.owner_id === u || holding(db, g, u, t) > 0 || bidOn(db, t)?.bidder_id === u) return true;
  }
  return false;
}
const noStake = (db: Db, g: string, u: string, c: Company): void => {
  if (stakeIn(db, g, u, c)) throw new GameError('city.conflict', `Conflict of interest: you own, hold shares in, or are bidding on ${c.ticker} (or the company it's merging with). Someone without a stake has to handle it.`);
};
const used = (db: Db, g: string, action: string, since: number): number =>
  db.get<{ n: number }>('SELECT COUNT(*) AS n FROM city_log WHERE guild_id = ? AND action = ? AND at >= ?', g, action, since)!.n;
const needReason = (reason: string): string => {
  const r = reason.trim();
  if (r.length < 3) throw new GameError('city.reason', 'Give a reason: everything City Hall does is on the public record.');
  return r.slice(0, 200);
};
const live = (db: Db, ticker: string): Company => {
  const c = getCompany(db, ticker.toUpperCase());
  if (!c || (c.status !== 'private' && c.status !== 'public')) throw new GameError('co.unknown', `There's no open player company called ${ticker.toUpperCase()}.`);
  return c;
};

// ================================================================ business powers

/** Calls off a takeover bid (refunded) or a merger proposal on a company. */
export function block(db: Db, g: string, u: string, ticker: string, reason: string, now = Date.now()): string {
  authorize(db, g, u, 'business', now);
  const c = live(db, ticker);
  noStake(db, g, u, c);
  const why = needReason(reason);
  const bid = bidOn(db, c.ticker);
  const merger = mergerFor(db, c.ticker);
  if (!bid && !merger) throw new GameError('city.block', `Nothing to block: no takeover bid or merger is open on ${c.ticker}.`);
  if (bid) {
    cancelBid(db, c.ticker, now);
    addInbox(db, bid.bidder_id, bid.bidder_guild, 'Takeover blocked', `The mayor blocked your takeover bid on ${c.ticker}. Your premium of ${format(bid.premium)} is back. Reason: ${why}`, now);
  }
  if (merger) db.setMeta(`merger:${c.ticker}`, 'null');
  addInbox(db, c.owner_id, c.owner_guild, 'City Hall stepped in', `The mayor blocked ${bid ? 'the takeover bid' : 'the merger'} on ${c.name}. Reason: ${why}`, now);
  award(db, g, u, 'trustbuster', now);
  cityLog(db, g, u, 'block', `Blocked ${bid ? 'a takeover bid' : 'a merger'} on ${c.ticker}: ${why}`, 0, now);
  return bid ? 'takeover' : 'merger';
}

export function freeze(db: Db, g: string, u: string, ticker: string, reason: string, now = Date.now()): number {
  const { term } = authorize(db, g, u, 'freeze', now);
  const c = live(db, ticker);
  if (c.status !== 'public') throw new GameError('city.freeze', `${c.ticker} isn't publicly traded, so there's nothing to freeze.`);
  noStake(db, g, u, c);
  const why = needReason(reason);
  if (used(db, g, 'freeze', term.starts_at) >= CITY.freeze.perTerm) throw new GameError('city.limit', `City Hall has used its ${CITY.freeze.perTerm} freezes this term.`);
  const until = now + CITY.freeze.ms;
  db.setMeta(`city.freeze:${c.ticker}`, String(until));
  addInbox(db, c.owner_id, c.owner_guild, 'Trading frozen', `The mayor froze trading in ${c.ticker} until <t:${Math.floor(until / 1000)}:F>. Reason: ${why}`, now);
  cityLog(db, g, u, 'freeze', `Froze trading in ${c.ticker} for 24 hours: ${why}`, 0, now);
  return until;
}

export function investigate(db: Db, g: string, u: string, target: string, reason: string, now = Date.now()): number {
  authorize(db, g, u, 'investigate', now);
  if (target === u) throw new GameError('city.self', 'You can\'t investigate yourself.');
  const why = needReason(reason);
  const until = now + CITY.investigateMs;
  db.setMeta(`city.investigate:${g}:${target}`, String(until));
  addInbox(db, target, g, 'Under investigation', `City Hall opened an antitrust investigation. Your trades in player companies are public until <t:${Math.floor(until / 1000)}:F>. Reason: ${why}`, now);
  cityLog(db, g, u, 'investigate', `Opened an investigation into <@${target}> for 7 days: ${why}`, 0, now);
  return until;
}

/** Fines a company (from its treasury) or a player (from their wallet), into the city treasury. */
export function fine(db: Db, g: string, u: string, target: { ticker?: string; userId?: string }, cents: Cents, reason: string, now = Date.now()): { cents: Cents; who: string } {
  const { term } = authorize(db, g, u, 'fine', now);
  const why = needReason(reason);
  if (used(db, g, 'fine', term.starts_at) >= CITY.fine.perTerm) throw new GameError('city.limit', `City Hall has used its ${CITY.fine.perTerm} fines this term.`);
  const city = ensureCity(db, g, now);
  return db.tx(() => {
    if (target.ticker) {
      const c = live(db, target.ticker);
      noStake(db, g, u, c);
      const cap = Math.min(CITY.fine.max, Math.floor(treasury(db, c) * CITY.fine.share));
      if (cents > cap) throw new GameError('city.fine', `The most you can fine ${c.ticker} is ${format(cap)} (${CITY.fine.share * 100}% of its treasury, at most ${format(CITY.fine.max)}).`);
      transfer(db, { from: treasuryId(c.ticker), to: city, cents, reason: 'city.fine', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
      addInbox(db, c.owner_id, c.owner_guild, 'City fine', `City Hall fined ${c.name} ${format(cents)}, from its treasury. Reason: ${why}`, now);
      cityLog(db, g, u, 'fine', `Fined ${c.ticker} ${format(cents)}: ${why}`, cents, now);
      return { cents, who: c.ticker };
    }
    const v = target.userId!;
    if (v === u) throw new GameError('city.self', 'You can\'t fine yourself.');
    const cap = Math.min(CITY.fine.max, Math.floor(balance(db, wallet(g, v)) * CITY.fine.share));
    if (cents > cap) throw new GameError('city.fine', `The most you can fine them is ${format(cap)} (${CITY.fine.share * 100}% of their wallet, at most ${format(CITY.fine.max)}).`);
    transfer(db, { from: wallet(g, v), to: city, cents, reason: 'city.fine', guildId: g, actorId: u, now });
    addInbox(db, v, g, 'City fine', `City Hall fined you ${format(cents)}. Reason: ${why}`, now);
    cityLog(db, g, u, 'fine', `Fined <@${v}> ${format(cents)}: ${why}`, cents, now);
    return { cents, who: `<@${v}>` };
  });
}

/** A grant from the city treasury to a company's treasury (to save one that's being crashed). */
export function bailout(db: Db, g: string, u: string, ticker: string, cents: Cents, reason: string, now = Date.now()): Company {
  authorize(db, g, u, 'bailout', now);
  const c = live(db, ticker);
  noStake(db, g, u, c);
  const why = needReason(reason);
  const city = ensureCity(db, g, now);
  if (balance(db, city) < cents) throw new GameError('city.broke', `The city treasury has ${format(balance(db, city))}.`);
  transfer(db, { from: city, to: treasuryId(c.ticker), cents, reason: 'city.bailout', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
  addInbox(db, c.owner_id, c.owner_guild, 'City bailout', `City Hall put ${format(cents)} into ${c.name}'s treasury. Reason: ${why}`, now);
  cityLog(db, g, u, 'bailout', `Granted ${format(cents)} to ${c.ticker}: ${why}`, cents, now);
  return c;
}

// ================================================================ taxes and Collect Call

export function setTax(db: Db, g: string, u: string, key: 'shop' | 'property' | 'casino', rate: number, now = Date.now()): { rate: number; from: number } {
  const { term, policy } = authorize(db, g, u, 'tax', now);
  const max = CITY.taxMax[key];
  if (!(rate >= 0 && rate <= max + 1e-9)) throw new GameError('city.tax', `The ${key} tax can be 0 to ${max * 100}%.`);
  const from = tomorrow(now);
  const p: Policy = { ...policy, pending: [...policy.pending.filter((c) => c.key !== key), { key, rate, from }] };
  savePolicy(db, g, term.week, p);
  cityLog(db, g, u, 'tax', `Set the ${key} tax to ${+(rate * 100).toFixed(2)}%, from midnight`, 0, now);
  return { rate, from };
}
export function setCollect(db: Db, g: string, u: string, fee: number | null, graceDays: number | null, now = Date.now()): Policy {
  const { term, policy } = authorize(db, g, u, 'collect', now);
  const [fl, fh] = CITY.collect.fee, [gl, gh] = CITY.collect.graceDays;
  if (fee !== null && !(fee >= fl - 1e-9 && fee <= fh + 1e-9)) throw new GameError('city.collect', `The collection fee can be ${fl * 100} to ${fh * 100}%.`);
  if (graceDays !== null && !(Number.isInteger(graceDays) && graceDays >= gl && graceDays <= gh)) throw new GameError('city.collect', `The grace period can be ${gl} to ${gh} days.`);
  const p: Policy = { ...policy, collectFee: fee ?? policy.collectFee, graceDays: graceDays ?? policy.graceDays };
  savePolicy(db, g, term.week, p);
  cityLog(db, g, u, 'collect', `Collections: a ${+(p.collectFee * 100).toFixed(2)}% fee, ${p.graceDays} days' grace`, 0, now);
  return p;
}

// ================================================================ public works

export const workCost = (db: Db, g: string, effect: WorkEffect, size: number, days: number, now = Date.now()): Cents => {
  const w = CITY.works[effect];
  const units = w.unit === 'h' ? size : Math.round(size * 100);
  return w.rate * units * (w.unit === 'h' ? 1 : days) * Math.max(5, activePlayers(db, g, now));
};
export function build(db: Db, g: string, u: string, effect: WorkEffect, size: number, days: number, name: string, now = Date.now()): { cost: Cents; ends: number } {
  authorize(db, g, u, 'build', now);
  const w = CITY.works[effect];
  if (!w) throw new GameError('city.work', `Pick one: ${Object.keys(CITY.works).join(', ')}.`);
  if (!(size >= w.min - 1e-9 && size <= w.max + 1e-9)) throw new GameError('city.work', w.unit === 'h' ? `Happy Hour can run ${w.min} to ${w.max} hours.` : `A ${w.label} work can be +${w.min * 100}% to +${w.max * 100}%.`);
  if (w.unit === '%' && !(Number.isInteger(days) && days >= CITY.workDays[0] && days <= CITY.workDays[1])) throw new GameError('city.work', `Public works run ${CITY.workDays[0]} to ${CITY.workDays[1]} days.`);
  const clean = name.replace(/[*_`~|<>@#]/g, '').trim().slice(0, 40);
  if (clean.length < 3) throw new GameError('city.work', 'Give it a name (3 to 40 characters).');
  if (db.get('SELECT 1 FROM city_works WHERE guild_id = ? AND effect = ? AND ends_at > ?', g, effect, now)) throw new GameError('city.work', `There's already a ${w.label} work running. One at a time per effect.`);
  const cost = workCost(db, g, effect, size, days, now);
  const city = ensureCity(db, g, now);
  if (balance(db, city) < cost) throw new GameError('city.broke', `That costs ${format(cost)}. The city treasury has ${format(balance(db, city))}.`);
  const ends = now + (w.unit === 'h' ? size * HOUR : days * DAY);
  return db.tx(() => {
    transfer(db, { from: city, to: 'reserve', cents: cost, reason: 'city.works', guildId: g, actorId: u, now, note: { effect } });
    db.run('INSERT INTO city_works (guild_id, effect, name, size, starts_at, ends_at, cost) VALUES (?, ?, ?, ?, ?, ?, ?)', g, effect, clean, effect === 'happyhour' ? 1 : size, now, ends, cost);
    award(db, g, u, 'public_works', now);
    cityLog(db, g, u, 'build', `Funded "${clean}": ${w.unit === 'h' ? `${size}h of Happy Hour` : `+${Math.round(size * 100)}% ${w.label} for ${days} day${days === 1 ? '' : 's'}`}`, cost, now);
    addMoment(`🏗️ A city just funded ${clean}`, now);
    return { cost, ends };
  });
}

// ================================================================ decrees and appointments

export function decree(db: Db, g: string, u: string, effect: Decree | null, text: string, now = Date.now()): { until: number } {
  authorize(db, g, u, 'decree', now);
  const words = text.replace(/[`@]/g, '').trim().slice(0, 300);
  if (!effect && words.length < 3) throw new GameError('city.decree', 'Write the decree, or pick an effect.');
  let until = 0;
  if (effect) {
    const d = CITY.decrees[effect];
    if (!d) throw new GameError('city.decree', `Effects: ${Object.keys(CITY.decrees).join(', ')}.`);
    if (used(db, g, 'decree.effect', now - DAY) >= CITY.decreesPerDay) throw new GameError('city.limit', 'One decree with an effect a day.');
    until = effect === 'doubledaily' || effect === 'marketholiday' ? nextReset(now) : now + d.ms;
    if (effect === 'amnesty') db.run('UPDATE underground SET heat = MAX(0, heat - 25) WHERE guild_id = ?', g);
    else db.setMeta(`city.decree:${g}:${effect}`, String(until));
    cityLog(db, g, u, 'decree.effect', `${d.label}${words ? `: "${words}"` : ''}`, 0, now);
  } else cityLog(db, g, u, 'decree', `"${words}"`, 0, now);
  return { until };
}

export function appoint(db: Db, g: string, u: string, role: 'treasurer' | 'chief', who: string | null, now = Date.now()): Policy {
  const { term, policy } = authorize(db, g, u, 'appoint', now);
  if (who === u) throw new GameError('city.self', 'You already have every power. Appoint someone else.');
  const p: Policy = { ...policy, [role === 'treasurer' ? 'treasurer' : 'chief']: who };
  savePolicy(db, g, term.week, p);
  cityLog(db, g, u, 'appoint', who ? `Appointed <@${who}> as ${role === 'treasurer' ? 'Treasurer' : 'Police Chief'}` : `Removed the ${role === 'treasurer' ? 'Treasurer' : 'Police Chief'}`, 0, now);
  if (who) addInbox(db, who, g, 'Appointed', `The mayor appointed you ${role === 'treasurer' ? 'Treasurer (you can fund public works and bailouts)' : 'Police Chief (you can investigate and freeze)'}. See \`mayor help\`.`, now);
  return p;
}

export const recentLog = (db: Db, g: string, n = 10) =>
  db.all<{ at: number; actor_id: string | null; action: string; detail: string; cents: number }>('SELECT at, actor_id, action, detail, cents FROM city_log WHERE guild_id = ? ORDER BY at DESC, id DESC LIMIT ?', g, n);

export { DEFAULT_POLICY };
