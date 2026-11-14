// Polygons are always whole cents in code and in the database: ⬡12.34 is 1234.
// Nothing outside this file should multiply or divide by 100.
import { GameError } from './errors';

/** A whole number of cents. Never a fraction. */
export type Cents = number;

export const SYMBOL = '⬡';

export function assertCents(value: number, what = 'amount'): Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${what} must be whole cents, got ${value}`);
  return value;
}

/** ⬡1,234.56 */
export function format(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}${SYMBOL}${whole}.${frac}`;
}

/** ⬡1.2M, for tight spaces like leaderboards and charts. */
export function formatShort(cents: Cents): string {
  assertCents(cents);
  const value = cents / 100;
  const abs = Math.abs(value);
  const units: [number, string][] = [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
  for (const [size, unit] of units) {
    if (abs >= size) {
      const n = value / size;
      return `${SYMBOL}${(Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1)).replace(/\.0$/, '')}${unit}`;
    }
  }
  return format(cents);
}

/** Whole Polygons to cents, for config values: polygons(500) === 50000 */
export const polygons = (n: number): Cents => assertCents(Math.round(n * 100), 'polygons');

/** A percentage of an amount, rounded down so the bot never pays out a fraction it doesn't have. */
export const percentOf = (cents: Cents, pct: number): Cents => Math.floor((cents * pct) / 100);

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

export interface AmountOptions {
  /** What "all" means: usually the player's balance. Needed for all and % amounts. */
  all?: Cents;
  /** What "max" means, if different from "all" (e.g. a bet limit). */
  max?: Cents;
  /** Smallest allowed amount. Default ⬡0.01. */
  min?: Cents;
}

/**
 * The one amount format, everywhere: 500, 1,000, 12.50, 1.5k, 2m, 50%, all, max, half.
 * Returns cents. Throws a GameError with a message for the player if it can't be read.
 */
export function parseAmount(input: string | number | null | undefined, opts: AmountOptions = {}): Cents {
  const min = opts.min ?? 1;
  const raw = String(input ?? '').trim().toLowerCase().replace(/[,_\s]/g, '').replace(SYMBOL, '');
  if (raw === '') throw new GameError('amount.missing', 'An amount is required.');

  let cents: number;
  if (raw === 'all' || raw === 'max' || raw === 'half' || raw.endsWith('%')) {
    const base = raw === 'max' ? (opts.max ?? opts.all) : opts.all;
    if (base === undefined) throw new GameError('amount.relative', `"${raw}" cannot be used here. Enter a number.`);
    if (raw === 'half') cents = Math.floor(base / 2);
    else if (raw.endsWith('%')) {
      const pct = Number(raw.slice(0, -1));
      if (!Number.isFinite(pct) || pct <= 0 || pct > 100) throw new GameError('amount.percent', 'A percentage must be between 0 and 100.');
      cents = percentOf(base, pct);
    } else cents = base;
  } else {
    const m = /^(\d+(?:\.\d+)?|\.\d+)([kmb])?$/.exec(raw);
    if (!m) throw new GameError('amount.invalid', `"${String(input).trim()}" is not a valid amount. Examples: 500, 1.5k, 50%, all.`);
    const value = Number(m[1]) * (m[2] ? SUFFIX[m[2]]! : 1);
    cents = value * 100;
    if (Math.abs(cents - Math.round(cents)) > 1e-6) throw new GameError('amount.precision', 'Amounts can have at most two decimal places.');
    cents = Math.round(cents);
  }

  if (!Number.isSafeInteger(cents)) throw new GameError('amount.large', 'That amount is too large.');
  if (cents < min) throw new GameError('amount.small', `The amount must be at least ${format(min)}.`);
  if (opts.max !== undefined && cents > opts.max) throw new GameError('amount.over', `The amount cannot exceed ${format(opts.max)}.`, { max: opts.max });
  return cents;
}

/** Whole counts (shares, fish, seeds): 5, 1k, all, max, half. Same rules, no decimals. */
export function parseCount(input: string | number | null | undefined, opts: { all?: number; max?: number; min?: number } = {}): number {
  const raw = String(input ?? '').trim().toLowerCase().replace(/[,_\s]/g, '');
  if (raw === '') throw new GameError('count.missing', 'A number is required.');
  let n: number;
  if (raw === 'all' || raw === 'max' || raw === 'half') {
    const base = raw === 'max' ? (opts.max ?? opts.all) : opts.all;
    if (base === undefined) throw new GameError('count.relative', `"${raw}" cannot be used here. Enter a number.`);
    n = raw === 'half' ? Math.floor(base / 2) : base;
  } else {
    const m = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(raw);
    if (!m) throw new GameError('count.invalid', `"${String(input).trim()}" is not a valid number.`);
    n = Number(m[1]) * (m[2] ? SUFFIX[m[2]]! : 1);
    if (!Number.isInteger(n)) throw new GameError('count.whole', 'Only whole numbers are accepted.');
  }
  const min = opts.min ?? 1;
  if (!Number.isSafeInteger(n)) throw new GameError('count.large', 'That number is too large.');
  if (n < min) throw new GameError('count.small', `The number must be at least ${min}.`);
  if (opts.max !== undefined && n > opts.max) throw new GameError('count.over', `The number cannot exceed ${opts.max}.`, { max: opts.max });
  return n;
}
