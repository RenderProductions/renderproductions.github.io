// Jobs at the five house companies: ranks, pay, reviews. Tasks are in tasks.ts, shifts in shift.ts.
import { polygons, type Cents } from '../core/money';
import { MINUTE, HOUR } from '../core/time';
import { startingPrices } from '../market/market';

export const JOB_RULES = {
  workCooldownMs: 15 * MINUTE,
  gigCooldownMs: 10 * MINUTE,
  quitLockMs: 24 * HOUR,
  /** An unanswered task is dropped after this (plus any time the prompt is hidden). */
  abandonMs: MINUTE,
  basePay: polygons(35),
  /** Gigs pay this share of an Intern shift. */
  gigShare: 0.4,
  /** A wrong or slow answer still pays this share. */
  missShare: 0.4,
  /** A perfect-speed answer adds up to this much on top. */
  tipMax: 0.5,
  /** After a correct answer, the chance another task comes in (a rush), up to maxRush in a row. */
  rushChance: 0.2,
  maxRush: 5,
  /** A rush task pays this share of a shift, and only if it's right. */
  rushShare: 0.6,
  /** Shifts' worth of pay when a bankrupt company lays you off. */
  severanceShifts: 3,
  /** Performance review every `every` shifts: promote at `promote` right, demote at `demote` or fewer. */
  review: { every: 10, promote: 8, demote: 4, topBonusShifts: 5 },
  /** A good shift nudges the company's stock up (log terms). */
  stockNudge: 0.001,
  /** Coworkers working in the same channel within 2 minutes add 15% each, up to 3. */
  team: { windowMs: 2 * MINUTE, each: 0.15, max: 3 },
  /** Seconds to answer. */
  limits: { task: 20, rush: 15, memory: 15 }
} as const;

export const RANK_PAY = [1, 1.25, 1.5, 2] as const;

export interface Company { ticker: string; name: string; role: string; ranks: readonly [string, string, string, string]; payPriceCap?: [number, number] }

export const COMPANIES: Record<string, Company> = {
  RRM: { ticker: 'RRM', name: 'Render Room', role: 'moderation duty', ranks: ['Trial Mod', 'Moderator', 'Senior Mod', 'Admin'] },
  NACH: { ticker: 'NACH', name: 'De Nacho', role: 'the nacho line', ranks: ['Dishwasher', 'Line Cook', 'Sous Chef', 'Head Chef'] },
  BLU: { ticker: 'BLU', name: "Builder's League United", role: 'the build crew', ranks: ['Apprentice', 'Builder', 'Foreman', 'Architect'] },
  BNW: { ticker: 'BNW', name: 'Business Numbers Working', role: 'number crunching', ranks: ['Intern', 'Analyst', 'Accountant', 'CFO'] },
  // BSTG swings wildly, so its pay uses a price kept between 0.2x and 4x its starting price
  BSTG: { ticker: 'BSTG', name: 'Bastardly Glory', role: 'playtesting', ranks: ['Playtester', 'Bug Hunter', 'QA Lead', 'Game Director'], payPriceCap: [0.2, 4] }
};

export const clampRank = (r: number): 0 | 1 | 2 | 3 => Math.max(0, Math.min(3, Math.floor(r))) as 0 | 1 | 2 | 3;
export const rankName = (ticker: string, r: number): string => COMPANIES[ticker]?.ranks[clampRank(r)] ?? ['Intern', 'Employee', 'Manager', 'Executive'][clampRank(r)]!;

/**
 * A full shift's pay before bonuses: base pay, scaled by how the company's stock is doing against
 * its starting price, times the rank multiplier. A near-dead stock still pays a little.
 */
export function shiftPay(ticker: string, priceCents: Cents | undefined, rank: number): Cents {
  const start = startingPrices()[ticker];
  if (!start) return Math.round(JOB_RULES.basePay * RANK_PAY[clampRank(rank)]);
  let price = priceCents ?? start;
  const cap = COMPANIES[ticker]?.payPriceCap;
  if (cap) price = Math.min(Math.max(price, start * cap[0]), start * cap[1]);
  price = Math.max(price, 50); // ⬡0.50 floor
  return Math.round((JOB_RULES.basePay * price) / start * RANK_PAY[clampRank(rank)]);
}

export interface Career { rank: number; shifts: number; correct: number; rev_total: number; rev_right: number; earned: number }
