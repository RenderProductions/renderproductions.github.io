// Farming: "Plants? In THIS Economy??!". Farms are per server, like balances.
//
// A crop grows in two stages (sprouting, then growing) and needs watering once in each. Dry crops grow at
// half speed, and a crop that spends 12 hours thirsty in all wilts (so only the slow crops can). Nothing ticks in the background: a plot's state is
// worked out from timestamps whenever someone looks at it (simulate), so the bot can restart freely.
// Crows may come once while a crop grows (a Scarecrow chases them off). Rain and storms are world events:
// rain waters every crop while it lasts, and a storm can flatten crops outside a Greenhouse. Each storm is
// rolled once per plot, from the plot's own seed, so looking twice never changes the outcome.
import type { Db } from '../core/db';
import { polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { HOUR, MINUTE, dayKey } from '../core/time';

export const FARMING = {
  startPlots: 3, maxPlots: 9,
  /** A Barn unlocks 6 more (15 in all, shown as 3 rows of 5: the farm never has more than 3 rows). */
  barnPlots: 6, rows: 3,
  /** What plots 4 to 15 cost (10 to 15 need a Barn). */
  plotPrices: [1000, 1500, 2500, 3500, 5000, 7500, 10_000, 12_500, 15_000, 20_000, 25_000, 30_000].map(polygons),
  wiltMs: 12 * HOUR, dryRate: 0.5, fertRate: 1.5, stormChance: 0.25,
  earlyBirdMs: MINUTE,
  /** The Farmhand waters everything, harvests what's ready and replants from his seed shed, for a daily wage. */
  farmhandWage: polygons(150)
};

export interface Crop { id: string; emoji: string; name: string; plural: string; growMs: number; harvests: number; value: Cents; seedPrice: number; seedStock: number; crowChance: number }
const crop = (id: string, emoji: string, name: string, plural: string, growMs: number, harvests: number, value: number, seedPrice: number, seedStock: number, crowChance: number): Crop =>
  ({ id, emoji, name, plural, growMs, harvests, value: polygons(value), seedPrice, seedStock, crowChance });
export const CROPS: Record<string, Crop> = {
  carrot: crop('carrot', '🥕', 'Carrot', 'Carrots', 30 * MINUTE, 1, 22, 10, 40, 0.08),
  corn: crop('corn', '🌽', 'Corn', 'Corn', 2 * HOUR, 1, 70, 25, 30, 0.15),
  tomato: crop('tomato', '🍅', 'Tomato', 'Tomatoes', 4 * HOUR, 3, 35, 40, 20, 0.15),   // regrows twice, in half the time
  pumpkin: crop('pumpkin', '🎃', 'Pumpkin', 'Pumpkins', 12 * HOUR, 1, 220, 60, 15, 0.2),
  polyfruit: crop('polyfruit', '✨', 'Polygon Fruit', 'Polygon Fruit', 24 * HOUR, 1, 1000, 400, 2, 0.25)
};
export const CROP_ORDER = Object.keys(CROPS);

export type Mutation = 'golden' | 'rainbow' | 'square';
export const MUTATIONS: Record<Mutation, { label: string; emoji: string; mult: number; chance: number }> = {
  golden: { label: 'Golden', emoji: '✨', mult: 5, chance: 0.04 },
  rainbow: { label: 'Rainbow', emoji: '🌈', mult: 12, chance: 0.01 },
  square: { label: 'Square', emoji: '🟧', mult: 5, chance: 0.02 }       // pumpkins only
};

// ---------------------------------------------------------------- quality (Make Gambling Fun Again)
// Every harvest is graded. The grade sets the range its price is rolled from when it's sold: Poor 70–85% of
// the base value, Fine 85–115%, Prime 115–130%. Fertilized crops come out Prime more often.
export type Grade = 'poor' | 'fine' | 'prime';
export const GRADES: Record<Grade, { label: string; emoji: string; band: [number, number]; chance: number; fertChance: number }> = {
  poor: { label: 'Poor', emoji: '🥀', band: [0.7, 0.85], chance: 0.25, fertChance: 0.15 },
  fine: { label: 'Fine', emoji: '', band: [0.85, 1.15], chance: 0.55, fertChance: 0.5 },
  prime: { label: 'Prime', emoji: '🥇', band: [1.15, 1.3], chance: 0.2, fertChance: 0.35 }
};
export const gradeMid = (g: Grade): number => (GRADES[g].band[0] + GRADES[g].band[1]) / 2;
export function rollGrade(rng: Rng, fert = false): Grade {
  const r = rng.next();
  const poor = fert ? GRADES.poor.fertChance : GRADES.poor.chance, prime = fert ? GRADES.prime.fertChance : GRADES.prime.chance;
  return r < poor ? 'poor' : r < poor + prime ? 'prime' : 'fine';
}

// ---------------------------------------------------------------- harvested crops (inventory items)
// crop_<crop>, crop_<mutation>_<crop> or crop_squarepumpkin, with poor_ or prime_ in front for those grades
// (no prefix = Fine, so every crop harvested before grades existed is Fine). Seeds are shop items: seed_<crop>.
export const cropItem = (id: string, mut: Mutation | null = null, grade: Grade = 'fine'): string =>
  `crop_${grade === 'fine' ? '' : `${grade}_`}${mut === 'square' ? 'squarepumpkin' : mut ? `${mut}_${id}` : id}`;
export const seedItem = (id: string): string => `seed_${id}`;
export interface CropItem { crop: Crop; mut: Mutation | null; grade: Grade; base: Cents; value: Cents; name: string; emojiKey: string; emoji: string }
export function parseCropItem(item: string): CropItem | null {
  if (!item.startsWith('crop_')) return null;
  let rest = item.slice(5), grade: Grade = 'fine';
  const g = /^(poor|prime)_/.exec(rest);
  if (g) { grade = g[1] as Grade; rest = rest.slice(g[0].length); }
  const graded = (name: string) => (grade === 'fine' ? name : `${GRADES[grade].label} ${name}`);
  if (rest === 'squarepumpkin') { const c = CROPS.pumpkin!; const base = c.value * MUTATIONS.square.mult; return { crop: c, mut: 'square', grade, base, value: Math.round(base * gradeMid(grade)), name: graded('Square Pumpkin'), emojiKey: 'squarepumpkin', emoji: '🟧' }; }
  const [a, b, x] = rest.split('_') as [string, string | undefined, string | undefined];
  if (x !== undefined) return null;
  const mut = b && (a === 'golden' || a === 'rainbow') ? a : null;
  const c = CROPS[b && mut ? b : a];
  if (!c || (b && !mut)) return null;
  const base = c.value * (mut ? MUTATIONS[mut].mult : 1);
  return { crop: c, mut, grade, base, value: Math.round(base * gradeMid(grade)), name: graded(mut ? `${MUTATIONS[mut].label} ${c.name}` : c.name), emojiKey: mut ? `${mut}_${c.id}` : c.id, emoji: c.emoji };
}
export const isCropItem = (item: string): boolean => parseCropItem(item) !== null;

/** Pumpkin season: every pumpkin (golden, rainbow and square too) sells for 25% more in October, Eastern time. */
export const MARKET = { octoberPumpkins: 1.25, farmersMarket: 1.1, companyCut: 0.25 };
export const isOctober = (now: number): boolean => dayKey(now).slice(5, 7) === '10';
/** Each crop's price moves every day (Eastern), 80% to 120% of normal, the same for everyone. */
export const PRICE_SWING: [number, number] = [0.8, 1.2];
const daySeed = (s: string): number => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const cropPrice = (cropId: string, now: number): number => PRICE_SWING[0] + (PRICE_SWING[1] - PRICE_SWING[0]) * roll(daySeed(`price:${cropId}:${dayKey(now)}`), 0);
/** The best of today's price and the last few days' (a Warehouse's Cold Storage: `days` > 1). */
export function bestPrice(cropId: string, now: number, days = 1): number {
  let best = 0;
  for (let i = 0; i < Math.max(1, days); i++) best = Math.max(best, cropPrice(cropId, now - i * 24 * HOUR));
  return best;
}
const october = (c: { crop: Crop }, now: number) => (c.crop.id === 'pumpkin' && isOctober(now) ? MARKET.octoberPumpkins : 1);
/** What a crop is expected to sell for right now (its grade's middle, today's price, pumpkin season). */
export const saleValue = (c: { crop: Crop; value: Cents }, now: number, days = 1): Cents => Math.round(c.value * bestPrice(c.crop.id, now, days) * october(c, now));
/** Sells `qty` of one crop: each one's price is rolled within its grade's range. Returns the total. */
export function rollSale(c: CropItem, qty: number, now: number, rng: Rng, days = 1): { total: Cents; best: number } {
  const [lo, hi] = GRADES[c.grade].band, p = bestPrice(c.crop.id, now, days) * october(c, now);
  let total = 0, best = 0;
  for (let i = 0; i < qty; i++) { const m = (lo + (hi - lo) * rng.next()) * p; best = Math.max(best, m); total += Math.round(c.base * m); }
  return { total, best };
}

/** Rolls what a harvest comes out as. */
export function rollMutation(cropId: string, rng: Rng): Mutation | null {
  const r = rng.next();
  if (r < MUTATIONS.rainbow.chance) return 'rainbow';
  if (r < MUTATIONS.rainbow.chance + MUTATIONS.golden.chance) return 'golden';
  if (cropId === 'pumpkin' && r < MUTATIONS.rainbow.chance + MUTATIONS.golden.chance + MUTATIONS.square.chance) return 'square';
  return null;
}

// ---------------------------------------------------------------- weather (from world events)
export interface Weather { kind: 'rain' | 'storm'; from: number; until: number }
export function weatherLog(db: Db): Weather[] { try { return JSON.parse(db.meta('farm.weather') ?? '[]') as Weather[]; } catch { return []; } }
export function addWeather(db: Db, kind: Weather['kind'], from: number, until: number): void {
  db.setMeta('farm.weather', JSON.stringify([...weatherLog(db), { kind, from, until }].slice(-40)));
}

// ---------------------------------------------------------------- plots
export interface Plot {
  guild_id: string; user_id: string; slot: number; crop: string;
  planted_at: number; updated_at: number; progress: number; watered: number; stage_since: number;
  harvests_left: number; wilted: number; crow_at: number | null; fert: number; dry_ms: number;
  ready_at: number | null; storm_seen: number; reminded: number; seed: number;
}
export interface Env { /** a Farmhand keeps everything watered */ hand: boolean; greenhouse: boolean; scarecrow: boolean; weather: Weather[] }
export type FarmEvent = { kind: 'ready' | 'wilted' | 'crow_ate' | 'crow_scared' | 'storm'; slot: number; crop: string; at: number };

export type Stage = 'sprout' | 'growing' | 'ready' | 'wilted';
export function stageOf(p: Plot): Stage {
  if (p.wilted) return 'wilted';
  if (p.ready_at !== null) return 'ready';
  return p.progress < CROPS[p.crop]!.growMs / 2 ? 'sprout' : 'growing';
}

/** 0 to 1, the same for the same seed and salt: a storm's roll for one plot. */
export function roll(seed: number, salt: number): number {
  let h = (seed ^ Math.floor(salt / 1000)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Brings a plot up to `now`. Returns the new state (gone: the crop was lost) and what happened on the way.
 * Pure: the caller decides whether to save it.
 */
export function simulate(plot: Plot, env: Env, now: number): { plot: Plot; gone: boolean; events: FarmEvent[] } {
  const q: Plot = { ...plot };
  const events: FarmEvent[] = [];
  const ev = (kind: FarmEvent['kind'], at: number) => events.push({ kind, slot: q.slot, crop: q.crop, at });
  const T = CROPS[q.crop]!.growMs, half = T / 2;
  const wetAt = (x: number) => env.hand || env.weather.some((w) => w.kind === 'rain' && w.from <= x && x < w.until);
  let t = q.updated_at;
  if (q.wilted || q.ready_at !== null || t >= now) { q.updated_at = Math.max(t, now); return { plot: q, gone: false, events }; }
  for (let guard = 0; t < now && guard < 2000; guard++) {
    if (!q.watered && wetAt(t)) q.watered = 1;
    const storm = env.weather.find((w) => w.kind === 'storm' && w.from <= t && t < w.until && w.from > q.storm_seen);
    if (storm) {
      q.storm_seen = storm.from;
      if (!env.greenhouse && roll(q.seed, storm.from) < FARMING.stormChance) { ev('storm', Math.max(t, storm.from)); return { plot: q, gone: true, events }; }
    }
    const rate = (q.watered ? 1 : FARMING.dryRate) * (q.fert ? FARMING.fertRate : 1);
    const target = q.progress < half ? half : T;
    const cands = [now, t + (target - q.progress) / rate];
    if (!q.watered) cands.push(t + (FARMING.wiltMs - q.dry_ms));
    for (const w of env.weather) { if (w.from > t) cands.push(w.from); if (w.until > t) cands.push(w.until); }
    if (q.crow_at !== null && q.crow_at > t) cands.push(q.crow_at);
    const te = Math.max(t, Math.min(...cands));
    const wasSprout = q.progress < half;
    q.progress = Math.min(T, q.progress + (te - t) * rate);
    if (Math.abs(q.progress - target) < 1) q.progress = target;
    if (!q.watered) q.dry_ms += te - t;
    t = te;
    if (q.crow_at !== null && q.crow_at <= t) {
      const at = q.crow_at; q.crow_at = null;
      if (env.scarecrow) ev('crow_scared', at); else { ev('crow_ate', at); return { plot: q, gone: true, events }; }
    }
    if (q.progress >= T) { q.ready_at = t; ev('ready', t); break; }
    if (wasSprout && q.progress >= half) { q.watered = wetAt(t) ? 1 : 0; q.stage_since = t; }
    if (q.dry_ms >= FARMING.wiltMs) { q.wilted = 1; ev('wilted', t); break; }
  }
  q.updated_at = Math.max(q.updated_at, now);
  return { plot: q, gone: false, events };
}

/** When a plot will be ready if it's kept watered from now on (null: ready, wilted, or it needs water first). */
export function readyEstimate(p: Plot, now: number): number | null {
  if (p.wilted || p.ready_at !== null) return null;
  const rate = p.fert ? FARMING.fertRate : 1;
  return now + Math.ceil((CROPS[p.crop]!.growMs - p.progress) / rate);
}

/** A new plot row. Crows (maybe) come at some point while it grows. */
export function newPlot(guildId: string, userId: string, slot: number, cropId: string, now: number, rng: Rng, wet: boolean): Plot {
  const c = CROPS[cropId]!;
  return {
    guild_id: guildId, user_id: userId, slot, crop: cropId, planted_at: now, updated_at: now, progress: 0, watered: wet ? 1 : 0, stage_since: now,
    harvests_left: c.harvests, wilted: 0, crow_at: rng.chance(c.crowChance) ? now + Math.floor(c.growMs * (0.2 + 0.7 * rng.next())) : null,
    fert: 0, dry_ms: 0, ready_at: null, storm_seen: now, reminded: 0, seed: rng.int(1, 2_000_000_000)
  };
}

// ---------------------------------------------------------------- storage
export function plotsOf(db: Db, guildId: string, userId: string): Plot[] {
  return db.all<Plot>('SELECT * FROM farm_plots WHERE guild_id = ? AND user_id = ? ORDER BY slot', guildId, userId);
}
export function savePlot(db: Db, p: Plot): void {
  db.run(`INSERT INTO farm_plots (guild_id, user_id, slot, crop, planted_at, updated_at, progress, watered, stage_since, harvests_left, wilted, crow_at, fert, dry_ms, ready_at, storm_seen, reminded, seed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, slot) DO UPDATE SET crop = excluded.crop, planted_at = excluded.planted_at, updated_at = excluded.updated_at, progress = excluded.progress,
      watered = excluded.watered, stage_since = excluded.stage_since, harvests_left = excluded.harvests_left, wilted = excluded.wilted, crow_at = excluded.crow_at,
      fert = excluded.fert, dry_ms = excluded.dry_ms, ready_at = excluded.ready_at, storm_seen = excluded.storm_seen, reminded = excluded.reminded, seed = excluded.seed`,
  p.guild_id, p.user_id, p.slot, p.crop, p.planted_at, p.updated_at, p.progress, p.watered, p.stage_since, p.harvests_left, p.wilted, p.crow_at, p.fert, p.dry_ms, p.ready_at, p.storm_seen, p.reminded, p.seed);
}
export const clearPlot = (db: Db, guildId: string, userId: string, slot: number): void => { db.run('DELETE FROM farm_plots WHERE guild_id = ? AND user_id = ? AND slot = ?', guildId, userId, slot); };

export function plotCount(db: Db, guildId: string, userId: string): number {
  return db.get<{ plots: number }>('SELECT plots FROM farms WHERE guild_id = ? AND user_id = ?', guildId, userId)?.plots ?? FARMING.startPlots;
}
export function setPlotCount(db: Db, guildId: string, userId: string, n: number): void {
  db.run('INSERT INTO farms (guild_id, user_id, plots) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET plots = excluded.plots', guildId, userId, n);
}
export function setRemind(db: Db, guildId: string, userId: string, on: boolean): void {
  db.run(`INSERT INTO farms (guild_id, user_id, plots, remind) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET remind = excluded.remind`, guildId, userId, FARMING.startPlots, on ? 1 : 0);
}
export const farmhandUntil = (db: Db, guildId: string, userId: string): number | null => db.get<{ farmhand_until: number | null }>('SELECT farmhand_until FROM farms WHERE guild_id = ? AND user_id = ?', guildId, userId)?.farmhand_until ?? null;
export function setFarmhand(db: Db, guildId: string, userId: string, until: number | null): void {
  db.run(`INSERT INTO farms (guild_id, user_id, plots, farmhand_until) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET farmhand_until = excluded.farmhand_until`, guildId, userId, FARMING.startPlots, until);
}
export const remindOn = (db: Db, guildId: string, userId: string): boolean => (db.get<{ remind: number }>('SELECT remind FROM farms WHERE guild_id = ? AND user_id = ?', guildId, userId)?.remind ?? 0) === 1;
/** What the next plot costs, or null at the most. */
export const maxPlots = (barn: boolean): number => FARMING.maxPlots + (barn ? FARMING.barnPlots : 0);
export const nextPlotPrice = (owned: number, barn = false): Cents | null => (owned >= maxPlots(barn) ? null : FARMING.plotPrices[owned - FARMING.startPlots] ?? null);
/** The farm's layout: always 3 rows, 3 columns (5 once there's room for more than 9 plots). */
export const farmColumns = (room: number): number => Math.max(3, Math.ceil(room / FARMING.rows));

/**
 * Brings every plot of a farm up to now and saves it. Lost crops are cleared. Returns the plots left and
 * what happened since anyone last looked.
 */
export function resolveFarm(db: Db, guildId: string, userId: string, env: Env, now: number): { plots: Plot[]; events: FarmEvent[] } {
  const out: Plot[] = [], events: FarmEvent[] = [];
  for (const p of plotsOf(db, guildId, userId)) {
    const r = simulate(p, env, now);
    events.push(...r.events);
    if (r.gone) clearPlot(db, guildId, userId, p.slot);
    else { savePlot(db, r.plot); out.push(r.plot); }
  }
  return { plots: out, events };
}
