// NPC workers (players asked for them): a player company can hire staff who earn for its treasury every day, even
// when nobody's playing. Not so evil: each worker has a name and a mood. Pay well and they work harder; underpay
// them and their mood drops, they strike, and at rock bottom they quit (and everyone hears why).
import { award } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, transfer } from '../core/ledger';
import { addMoment } from '../core/moments';
import { format, polygons, type Cents } from '../core/money';
import { DAY } from '../core/time';
import { addInbox } from '../social/inbox';
import { levelOf, treasury, treasuryId, type Company } from './companies';

export const WORKERS = {
  /** How many a company can have, by level (Startup … Conglomerate). */
  cap: [2, 4, 6, 8, 8],
  hireFee: polygons(250),
  /** The going rate: pay this and moods hold steady-ish. Owners set anything from min to max. */
  rate: polygons(60), minWage: polygons(20), maxWage: polygons(300),
  /** A day's work, before the company's level and the worker's mood (mood 50 = ×1, 100 = ×1.5, 0 = ×0.5). */
  revenue: polygons(120),
  strikeBelow: 30, strikeChance: 0.5,
  startMood: 70
};

export interface Worker { id: number; ticker: string; name: string; wage: number; mood: number; hired_at: number; paid_at: number; strike_until: number; job: string }

const FIRST = ['Dot', 'Gus', 'Marla', 'Theo', 'Pip', 'Rosa', 'Lou', 'Ivy', 'Benny', 'Wren', 'Otis', 'Juno', 'Hank', 'Nell', 'Sal', 'Mabel', 'Cal', 'Fern', 'Rudy', 'Tess', 'Abe', 'Lola', 'Moe', 'Kit'];
const LAST = ['Pickett', 'Morrow', 'Vance', 'Quill', 'Bramble', 'Hollis', 'Tanaka', 'Okafor', 'Reyes', 'Lindqvist', 'Dunmore', 'Castellano', 'Petrov', 'Nakamura', 'Whitlock', 'Abernathy'];

export const staffOf = (db: Db, ticker: string): Worker[] => db.all<Worker>('SELECT * FROM workers WHERE ticker = ? ORDER BY id', ticker);
export const capOf = (c: Company): number => WORKERS.cap[Math.min(c.level, WORKERS.cap.length) - 1] ?? 0;
export const moodWord = (m: number): string => m >= 85 ? 'thrilled' : m >= 65 ? 'happy' : m >= 45 ? 'okay' : m >= WORKERS.strikeBelow ? 'grumbling' : m > 0 ? 'furious' : 'gone';
export const moodEmoji = (m: number): string => m >= 85 ? '😄' : m >= 65 ? '🙂' : m >= 45 ? '😐' : m >= WORKERS.strikeBelow ? '😒' : '😠';
/** How a day's wage moves mood. */
export function moodChange(wage: Cents): number {
  const r = wage / WORKERS.rate;
  return r >= 1.5 ? 8 : r >= 1 ? 3 : r >= 0.75 ? -5 : -12;
}
/** What a worker earns the company in a day (before the Reserve's shrink). */
export const dayRevenue = (c: Company, mood: number): Cents => Math.round(WORKERS.revenue * levelOf(c).payMult * (0.5 + mood / 100));

export function hire(db: Db, c: Company, rnd: () => number, now = Date.now()): Worker {
  if (c.status !== 'private' && c.status !== 'public') throw new GameError('co.workers', 'Only an open company can hire.');
  const staff = staffOf(db, c.ticker);
  if (staff.length >= capOf(c)) throw new GameError('co.workers', `A ${levelOf(c).name} has room for ${capOf(c)} workers. Upgrade for more.`);
  if (treasury(db, c) < WORKERS.hireFee + WORKERS.rate) throw new GameError('funds.short', `Hiring costs ${format(WORKERS.hireFee)} from the treasury, and you'll want a day's wage in there too. The treasury has ${format(treasury(db, c))}.`);
  const taken = new Set(staff.map((w) => w.name));
  let name = '';
  for (let i = 0; i < 20 && (!name || taken.has(name)); i++) name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
  return db.tx(() => {
    transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: WORKERS.hireFee, reason: 'company.hire', now, note: { ticker: c.ticker } });
    const id = db.run('INSERT INTO workers (ticker, name, wage, mood, hired_at, paid_at) VALUES (?, ?, ?, ?, ?, ?)', c.ticker, name, WORKERS.rate, WORKERS.startMood, now, now).lastInsertRowid;
    if (staffOf(db, c.ticker).length >= 8) award(db, c.owner_guild, c.owner_id, 'full_staff', now);
    award(db, c.owner_guild, c.owner_id, 'first_hire', now);
    return db.get<Worker>('SELECT * FROM workers WHERE id = ?', id)!;
  });
}

export function findWorker(db: Db, ticker: string, text: string): Worker {
  const t = text.trim().toLowerCase();
  const w = staffOf(db, ticker).find((x) => x.name.toLowerCase() === t || x.name.toLowerCase().split(' ')[0] === t || String(x.id) === t);
  if (!w) throw new GameError('co.worker', `There's no worker called "${text}". \`company staff\` lists them.`);
  return w;
}
export function fire(db: Db, c: Company, w: Worker): void { db.run('DELETE FROM workers WHERE id = ? AND ticker = ?', w.id, c.ticker); }
export function setWage(db: Db, w: Worker, wage: Cents): void {
  if (wage < WORKERS.minWage || wage > WORKERS.maxWage) throw new GameError('co.wage', `Wages run ${format(WORKERS.minWage)} to ${format(WORKERS.maxWage)} a day (the going rate is ${format(WORKERS.rate)}).`);
  db.run('UPDATE workers SET wage = ? WHERE id = ?', wage, w.id);
}

export interface WorkNews { quit: string[]; struck: string[]; earned: Cents; paid: Cents }
/** Settles each whole day since the staff were last paid: wages out, revenue in, moods, strikes, quitting. */
export function settleWorkers(db: Db, c: Company, rnd: () => number, now = Date.now()): WorkNews {
  const news: WorkNews = { quit: [], struck: [], earned: 0, paid: 0 };
  for (const w of staffOf(db, c.ticker)) {
    let { mood, paid_at: at, strike_until: strike } = w;
    let gone = false;
    for (let guard = 0; at + DAY <= now && guard < 14; guard++) {
      const day = at + DAY;
      const can = treasury(db, c) >= w.wage;
      if (can) { transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: w.wage, reason: 'company.wages', now: day, note: { ticker: c.ticker, worker: w.name } }); news.paid += w.wage; }
      mood = Math.max(0, Math.min(100, mood + (can ? moodChange(w.wage) : -20)));
      if (mood <= 0) { gone = true; break; }
      if (strike < day && mood < WORKERS.strikeBelow && rnd() < WORKERS.strikeChance) { strike = day + DAY; news.struck.push(w.name); }
      if (strike < day && can) {
        const earned = payFromReserve(db, economy.reserveStart, { to: treasuryId(c.ticker), cents: dayRevenue(c, mood), reason: 'company.staff', now: day, note: { ticker: c.ticker, worker: w.name } });
        news.earned += earned;
      }
      at = day;
    }
    if (gone) {
      db.run('DELETE FROM workers WHERE id = ?', w.id);
      news.quit.push(w.name);
      addInbox(db, c.owner_id, c.owner_guild, `${w.name} quit`, `${w.name} walked out of ${c.name}. "${['I have bills, you know.', 'Find someone else to underpay.', 'I\'m going to work for a REAL company.', 'Tell TODD I said bye.'][Math.floor(rnd() * 4)]}"`, now);
      addMoment(`📦 A worker just quit ${c.name} over pay`, now);
      continue;
    }
    db.run('UPDATE workers SET mood = ?, paid_at = ?, strike_until = ? WHERE id = ?', mood, at, strike, w.id);
  }
  return news;
}

export const payroll = (db: Db, ticker: string): Cents => staffOf(db, ticker).reduce((s, w) => s + w.wage, 0);
