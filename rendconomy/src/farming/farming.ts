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
  /** What plots 4 to 9 cost. */
  plotPrices: [1000, 1500, 2500, 3500, 5000, 7500].map(polygons),
  wiltMs: 12 * HOUR, dryRate: 0.5, fertRate: 1.5, stormChance: 0.25,
  earlyBirdMs: MINUTE,
  /** The Farmhand waters everything and harvests what's ready, for a daily wage. */
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

// ---------------------------------------------------------------- harvested crops (inventory items)
// crop_<crop> or crop_<mutation>_<crop>. Seeds are shop items: seed_<crop>.
export const cropItem = (id: string, mut: Mutation | null = null): string => (mut === 'square' ? 'crop_squarepumpkin' : mut ? `crop_${mut}_${id}` : `crop_${id}`);
export const seedItem = (id: string): string => `seed_${id}`;
export function parseCropItem(item: string): { crop: Crop; mut: Mutation | null; value: Cents; name: string; emojiKey: string; emoji: string } | null {
  if (!item.startsWith('crop_')) return null;
  const rest = item.slice(5);
  if (rest === 'squarepumpkin') { const c = CROPS.pumpkin!; return { crop: c, mut: 'square', value: c.value * MUTATIONS.square.mult, name: 'Square Pumpkin', emojiKey: 'squarepumpkin', emoji: '🟧' }; }
  const [a, b] = rest.split('_') as [string, string | undefined];
  const mut = b && (a === 'golden' || a === 'rainbow') ? a : null;
  const c = CROPS[b && mut ? b : a];
  if (!c || (b && !mut)) return null;
  return { crop: c, mut, value: c.value * (mut ? MUTATIONS[mut].mult : 1), name: mut ? `${MUTATIONS[mut].label} ${c.name}` : c.name, emojiKey: mut ? `${mut}_${c.id}` : c.id, emoji: c.emoji };
}
export const isCropItem = (item: string): boolean => parseCropItem(item) !== null;

/** Pumpkin season: every pumpkin (golden, rainbow and square too) sells for 25% more in October, Eastern time. */
export const MARKET = { octoberPumpkins: 1.25, farmersMarket: 1.1, companyCut: 0.25 };
export const isOctober = (now: number): boolean => dayKey(now).slice(5, 7) === '10';
export const saleValue = (c: { crop: Crop; value: Cents }, now: number): Cents => Math.round(c.value * (c.crop.id === 'pumpkin' && isOctober(now) ? MARKET.octoberPumpkins : 1));

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
export interface Env { sprinkler: boolean; greenhouse: boolean; scarecrow: boolean; weather: Weather[] }
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
  const wetAt = (x: number) => env.sprinkler || env.weather.some((w) => w.kind === 'rain' && w.from <= x && x < w.until);
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
export const nextPlotPrice = (owned: number): Cents | null => (owned >= FARMING.maxPlots ? null : FARMING.plotPrices[owned - FARMING.startPlots] ?? null);

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
