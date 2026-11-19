// The Farmhand (Farm Handiness Update): keeps a seed shed you stock, waters everything, harvests what's ready
// into your basket and replants from the shed, the whole time you're away. Worked out from timestamps like the
// rest of the farm: when you look, and by a background pass that also sends his DMs.
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import type { Rng } from '../core/rng';
import { DAY } from '../core/time';
import { addItem, count, takeItem } from '../shop/inventory';
import {
  CROPS, CROP_ORDER, FARMING, clearPlot, cropItem, farmhandUntil, newPlot, parseCropItem, plotCount, plotsOf, rollMutation,
  saleValue, savePlot, seedItem, setFarmhand, simulate, weatherLog, type Env, type Plot
} from './farming';

export const HAND = {
  /** At most one sale DM in this long (they're added up in between). */
  saleDmGapMs: 3 * 60 * 60 * 1000
};

/** What the farmhand did since you last looked. */
export interface ShiftLog {
  from: number;
  harvested: Record<string, number>;   // crop item → how many
  replanted: number;
  crows: number;
  storms: number;
  outOf: string[];                      // crops he ran out of ('any': an empty plot, nothing to plant)
  idle: number;                         // plots left empty: nothing in the shed
  sold: number; soldN: number;          // auto-sold since you looked
  dmSold: number; dmSoldN: number;      // auto-sold since the last sale DM
  left: boolean;                        // quit: you couldn't pay
}
const emptyLog = (from: number): ShiftLog => ({ from, harvested: {}, replanted: 0, crows: 0, storms: 0, outOf: [], idle: 0, sold: 0, soldN: 0, dmSold: 0, dmSoldN: 0, left: false });

interface HandRow { hand_shed: string | null; hand_last: string | null; hand_log: string | null; hand_at: number | null; hand_sell: number; hand_dm: number; hand_out: number; hand_dm_at: number }
const handRow = (db: Db, g: string, u: string): HandRow | undefined =>
  db.get<HandRow>('SELECT hand_shed, hand_last, hand_log, hand_at, hand_sell, hand_dm, hand_out, hand_dm_at FROM farms WHERE guild_id = ? AND user_id = ?', g, u);
const parse = <T>(s: string | null | undefined, d: T): T => { try { return s ? (JSON.parse(s) as T) : d; } catch { return d; } };
function setCols(db: Db, g: string, u: string, cols: Partial<Record<keyof HandRow, string | number | null>>): void {
  const keys = Object.keys(cols) as (keyof HandRow)[];
  db.run(`INSERT INTO farms (guild_id, user_id, plots) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO NOTHING`, g, u, FARMING.startPlots);
  db.run(`UPDATE farms SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE guild_id = ? AND user_id = ?`, ...keys.map((k) => cols[k] ?? null), g, u);
}

export const hasHand = (db: Db, g: string, u: string, now: number): boolean => (farmhandUntil(db, g, u) ?? 0) > now;

// ---------------------------------------------------------------- the seed shed
export const shedOf = (db: Db, g: string, u: string): Record<string, number> => {
  const s = parse<Record<string, number>>(handRow(db, g, u)?.hand_shed, {});
  for (const k of Object.keys(s)) if (!CROPS[k] || !(s[k]! > 0)) delete s[k];
  return s;
};
const saveShed = (db: Db, g: string, u: string, s: Record<string, number>) => setCols(db, g, u, { hand_shed: JSON.stringify(s) });
export const shedTotal = (s: Record<string, number>): number => Object.values(s).reduce((a, b) => a + b, 0);

/** Moves seeds from your inventory into his shed. Returns how many moved. */
export function giveSeeds(db: Db, g: string, u: string, crop: string, n: number | 'all'): number {
  const have = count(db, g, u, seedItem(crop));
  const k = n === 'all' ? have : Math.min(n, have);
  if (k <= 0 || !takeItem(db, g, u, seedItem(crop), k)) return 0;
  const s = shedOf(db, g, u);
  s[crop] = (s[crop] ?? 0) + k;
  saveShed(db, g, u, s);
  setCols(db, g, u, { hand_out: 0 });
  return k;
}
/** Moves seeds back from his shed to your inventory. */
export function takeSeeds(db: Db, g: string, u: string, crop: string, n: number | 'all'): number {
  const s = shedOf(db, g, u);
  const k = n === 'all' ? s[crop] ?? 0 : Math.min(n, s[crop] ?? 0);
  if (k <= 0) return 0;
  s[crop] = s[crop]! - k;
  saveShed(db, g, u, s);
  addItem(db, g, u, seedItem(crop), k);
  return k;
}
/** Everything in the shed back to the inventory (he's leaving). */
export function emptyShed(db: Db, g: string, u: string): number {
  let n = 0;
  for (const [c, q] of Object.entries(shedOf(db, g, u))) { addItem(db, g, u, seedItem(c), q); n += q; }
  saveShed(db, g, u, {});
  return n;
}

// ---------------------------------------------------------------- settings
export const handSettings = (db: Db, g: string, u: string) => { const r = handRow(db, g, u); return { sell: r?.hand_sell === 1, dm: (r?.hand_dm ?? 1) === 1 }; };
export const setHandSell = (db: Db, g: string, u: string, on: boolean) => setCols(db, g, u, { hand_sell: on ? 1 : 0 });
export const setHandDm = (db: Db, g: string, u: string, on: boolean) => setCols(db, g, u, { hand_dm: on ? 1 : 0 });

/** Hires him: paid through a day from now, starting work now. */
export function hire(db: Db, g: string, u: string, now: number): void {
  setFarmhand(db, g, u, now + DAY);
  // no DM about an empty shed straight away: the hire message already says to stock it
  setCols(db, g, u, { hand_at: now, hand_log: null, hand_out: shedTotal(shedOf(db, g, u)) ? 0 : 1 });
}
/** Lets him go; the shed goes back to your inventory. */
export function dismiss(db: Db, g: string, u: string): number {
  setFarmhand(db, g, u, null);
  return emptyShed(db, g, u);
}

// ---------------------------------------------------------------- the shift
export function farmEnv(db: Db, g: string, u: string, hand: boolean): Env {
  return { hand, greenhouse: count(db, g, u, 'greenhouse') > 0, scarecrow: count(db, g, u, 'scarecrow') > 0, weather: weatherLog(db) };
}

/** Pays each day's wage that has come due. Can't pay: he quits at that moment. */
function payWages(db: Db, g: string, u: string, now: number): { workUntil: number; left: boolean } {
  let until = farmhandUntil(db, g, u);
  if (until === null) return { workUntil: now, left: false };
  const w = wallet(g, u);
  while (until <= now) {
    if (balance(db, w) < FARMING.farmhandWage) { setFarmhand(db, g, u, null); return { workUntil: until, left: true }; }
    transfer(db, { from: w, to: RESERVE, cents: FARMING.farmhandWage, reason: 'farm.hand', guildId: g, actorId: u, now });
    until += DAY;
  }
  setFarmhand(db, g, u, until);
  return { workUntil: now, left: false };
}

/** The seed he plants in a plot: the same crop as before if he has it, otherwise what he has most of. */
function pick(shed: Record<string, number>, last: string | undefined): string | null {
  if (last && (shed[last] ?? 0) > 0) return last;
  return CROP_ORDER.filter((c) => (shed[c] ?? 0) > 0).sort((a, b) => shed[b]! - shed[a]!)[0] ?? null;
}

/**
 * Brings his work up to `now`: wages, then every plot harvested and replanted as it would have happened, then
 * (if switched on) the new crops sold to Marquez. Adds to the log you see next time you look.
 * Returns the log and what's new for DMs.
 */
export function runShift(db: Db, g: string, u: string, now: number, rng: Rng): { log: ShiftLog | null; newlyOut: boolean; left: boolean } {
  const row = handRow(db, g, u);
  if (farmhandUntil(db, g, u) === null) return { log: row?.hand_log ? parse<ShiftLog | null>(row.hand_log, null) : null, newlyOut: false, left: false };
  const from = Math.min(row?.hand_at ?? now, now);
  const pay = payWages(db, g, u, now);
  const until = Math.max(from, pay.workUntil);
  const log = parse<ShiftLog>(row?.hand_log, emptyLog(from));
  const shed = shedOf(db, g, u);
  const last = parse<Record<string, string>>(row?.hand_last, {});
  const env = farmEnv(db, g, u, true);
  const owned = plotCount(db, g, u);
  const plots = new Map(plotsOf(db, g, u).map((p) => [p.slot, p] as const));
  const fresh: Record<string, number> = {};
  const outOf = new Set<string>();
  let idle = 0;

  for (let slot = 0; slot < owned; slot++) {
    let p: Plot | undefined = plots.get(slot);
    let t = from;
    for (let guard = 0; guard < 1000; guard++) {
      if (!p) {
        const c = pick(shed, last[String(slot)]);
        if (!c) { outOf.add(last[String(slot)] ?? 'any'); idle++; break; }
        if (c !== last[String(slot)] && last[String(slot)]) outOf.add(last[String(slot)]!);
        shed[c] = shed[c]! - 1;
        p = newPlot(g, u, slot, c, t, rng, true);
        last[String(slot)] = c;
        log.replanted++;
        continue;
      }
      if (p.updated_at > until) break;
      const r = simulate(p, env, until);
      if (r.gone) {
        const lost = r.events.find((e) => e.kind === 'crow_ate' || e.kind === 'storm');
        if (lost?.kind === 'storm') log.storms++; else log.crows++;
        last[String(slot)] = p.crop;
        t = lost?.at ?? until;
        p = undefined;
        continue;
      }
      p = r.plot;
      if (p.wilted) { last[String(slot)] = p.crop; t = until; p = undefined; continue; }
      if (p.ready_at === null) break;
      // harvest it the moment it's ready
      const at = p.ready_at, c = CROPS[p.crop]!;
      const item = cropItem(p.crop, rollMutation(p.crop, rng));
      addItem(db, g, u, item);
      log.harvested[item] = (log.harvested[item] ?? 0) + 1;
      fresh[item] = (fresh[item] ?? 0) + 1;
      if (p.harvests_left > 1) { p = { ...p, harvests_left: p.harvests_left - 1, progress: c.growMs / 2, ready_at: null, watered: 1, stage_since: at, updated_at: at, crow_at: null, fert: 0, reminded: 0 }; continue; }
      last[String(slot)] = p.crop;
      t = at;
      p = undefined;
    }
    if (p) savePlot(db, p); else clearPlot(db, g, u, slot);
  }

  // auto-sell what he just picked
  if (row?.hand_sell === 1 && Object.keys(fresh).length) {
    let cents = 0, n = 0;
    for (const [item, q] of Object.entries(fresh)) {
      const c = parseCropItem(item)!;
      const k = Math.min(q, count(db, g, u, item));
      if (k > 0 && takeItem(db, g, u, item, k)) { cents += saleValue(c, now) * k; n += k; }
    }
    if (cents > 0) {
      const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents, reason: 'farm.sell', guildId: g, actorId: u, now, note: { by: 'farmhand' } });
      db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = value + excluded.value', u, 'farm_earned', paid);
      log.sold += paid; log.soldN += n; log.dmSold += paid; log.dmSoldN += n;
    }
  }

  log.outOf = [...outOf];
  log.idle = idle;
  if (pay.left) { log.left = true; emptyShed(db, g, u); } else saveShed(db, g, u, shed);
  const newlyOut = idle > 0 && (row?.hand_out ?? 0) === 0;
  setCols(db, g, u, { hand_at: until, hand_last: JSON.stringify(last), hand_log: JSON.stringify(log), hand_out: idle ? 1 : 0 });
  return { log, newlyOut, left: pay.left };
}

/** Takes the log (you've now seen it). */
export function takeLog(db: Db, g: string, u: string): ShiftLog | null {
  const log = parse<ShiftLog | null>(handRow(db, g, u)?.hand_log, null);
  if (log) setCols(db, g, u, { hand_log: log.left ? null : JSON.stringify(emptyLog(Date.now())) });
  return log;
}
/** For the background DMs: a sale summary is due (and marks it sent). */
export function saleDmDue(db: Db, g: string, u: string, now: number): { cents: number; n: number } | null {
  const row = handRow(db, g, u);
  const log = parse<ShiftLog | null>(row?.hand_log, null);
  if (!log || !log.dmSold || now - (row?.hand_dm_at ?? 0) < HAND.saleDmGapMs) return null;
  const out = { cents: log.dmSold, n: log.dmSoldN };
  setCols(db, g, u, { hand_log: JSON.stringify({ ...log, dmSold: 0, dmSoldN: 0 }), hand_dm_at: now });
  return out;
}
export const quietLog = (log: ShiftLog | null): boolean => !log || (!Object.keys(log.harvested).length && !log.replanted && !log.crows && !log.storms && !log.outOf.length && !log.sold && !log.left);
