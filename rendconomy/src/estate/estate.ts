// Oh My God, 2 in 1!: the city. Each server's map is an empty 8×8 grid of land (tiles A1–H8). Players claim a
// tile and build on it: construction takes real time, buildings level up, and every building does something.
// Neighbors matter: Parks lift the rent around them, Factories drag it down, Stations bring trade within two
// tiles, Corner Shops love homes next door, and a Police Station keeps the Connector (and squatters) away.
//
// Holding a lot of the map is still hard, as in Room to Grow:
//   - property tax climbs with how many buildings you own,
//   - anyone can make a buyout bid you have to pay to refuse,
//   - neglected places get squatters, and a place that falls apart is condemned and auctioned off.
//
// Nothing ticks in the background: each building's days are worked out from timestamps whenever it's looked
// at (settle), so the bot can restart freely. A background pass settles every server now and then so
// condemnations, auctions, buyouts and freight trains finish on time even when nobody is looking.
import { addRevenue, alive, getCompany } from '../companies/companies';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, ensureEscrow, escrow, transfer, wallet } from '../core/ledger';
import { polygons, type Cents } from '../core/money';
import { DAY, HOUR } from '../core/time';
import { roll, weatherLog } from '../farming/farming';
import { addItem } from '../shop/inventory';

export type Kind = 'shack' | 'apartment' | 'shop' | 'lighthouse' | 'mansion' | 'station' | 'factory' | 'barn' | 'bank' | 'warehouse' | 'park' | 'police';
export interface KindInfo {
  id: Kind; name: string; plural: string; emoji: string; price: Cents; rent: Cents; upkeep: Cents;
  buildHours: number; maxLevel: number; perk: string; perkText: string; industrial: boolean; home: boolean;
}
const kind = (id: Kind, name: string, plural: string, emoji: string, price: number, rent: number, upkeep: number, buildHours: number, maxLevel: number, perk: string, perkText: string, flags: { industrial?: boolean; home?: boolean } = {}): KindInfo =>
  ({ id, name, plural, emoji, price: polygons(price), rent: polygons(rent), upkeep: polygons(upkeep), buildHours, maxLevel, perk, perkText, industrial: !!flags.industrial, home: !!flags.home });
export const KINDS: Record<Kind, KindInfo> = {
  shack: kind('shack', 'Shack', 'Shacks', '🛖', 2_500, 60, 15, 1, 3, 'Bait Shed', 'free bait when you fish', { home: true }),
  apartment: kind('apartment', 'Apartment', 'Apartments', '🏢', 8_000, 200, 50, 3, 3, 'Extra Unit', '+25% rent while it\'s kept above 75%', { home: true }),
  shop: kind('shop', 'Corner Shop', 'Corner Shops', '🏪', 20_000, 450, 120, 6, 3, 'Storefront', 'a company you pick earns 10% of its rent; +5% rent for each home next door; launders hot loot'),
  lighthouse: kind('lighthouse', 'Lighthouse', 'Lighthouses', '🗼', 45_000, 800, 250, 8, 3, 'Beacon', 'rarer fish on plain bait, half storm damage to all your buildings, safer smuggling. Built on the edge of the map'),
  mansion: kind('mansion', 'Mansion', 'Mansions', '🏛️', 120_000, 1_800, 700, 12, 3, 'Ballroom', 'throw a party once a day: chat pay doubles for everyone here for an hour', { home: true }),
  station: kind('station', 'Station', 'Stations', '🚉', 15_000, 150, 60, 4, 3, 'Freight Line', 'buildings within 2 tiles earn +10% rent; ship your crops and goods by freight for more', { industrial: true }),
  factory: kind('factory', 'Factory', 'Factories', '🏭', 35_000, 0, 200, 6, 3, 'Production', 'makes 24 crates of Goods a day per level. Pollutes: −15% rent and faster wear next door', { industrial: true }),
  barn: kind('barn', 'Barn', 'Barns', '🐄', 12_000, 0, 40, 4, 1, 'More Land', 'unlocks 6 more farm plots (up to 15, in 3 rows of 5)'),
  bank: kind('bank', 'Bank Branch', 'Bank Branches', '🏦', 60_000, 600, 200, 8, 3, 'Branch Manager', 'your savings earn 25% more interest per level'),
  warehouse: kind('warehouse', 'Warehouse', 'Warehouses', '📦', 18_000, 100, 60, 4, 3, 'Cold Storage', 'sell crops at the best price of the last 3 days (5 at level 2, 7 at level 3)', { industrial: true }),
  park: kind('park', 'Park', 'Parks', '🌳', 5_000, 0, 10, 1, 1, 'Green Space', 'no rent, but +15% rent for every building next to it'),
  police: kind('police', 'Police Station', 'Police Stations', '🚓', 25_000, 100, 100, 6, 1, 'Neighborhood Watch', 'the Connector can\'t set up within 1 tile, and no squatters within 1 tile')
};
export const KIND_ORDER: Kind[] = ['shack', 'apartment', 'shop', 'mansion', 'lighthouse', 'station', 'factory', 'warehouse', 'barn', 'bank', 'park', 'police'];

/** The grid: 8 columns (A–H) by 8 rows, tiles 1–64 read left to right, top to bottom. */
export const SIZE = 8;
export const TILES = SIZE * SIZE;
export const colOf = (t: number): number => (t - 1) % SIZE;
export const rowOf = (t: number): number => Math.floor((t - 1) / SIZE);
export const tileName = (t: number): string => `${String.fromCharCode(65 + colOf(t))}${rowOf(t) + 1}`;
/** "C4", "c4", "4c", "#20" or "20" → 20. */
export function parseTile(raw: unknown): number | null {
  const s = String(raw ?? '').trim().toUpperCase().replace(/^#|^(LOT|TILE)\s*/, '');
  let m = /^([A-H])\s*([1-8])$/.exec(s);
  if (m) return Number(m[2]) * SIZE - SIZE + (m[1]!.charCodeAt(0) - 64);
  m = /^([1-8])\s*([A-H])$/.exec(s);
  if (m) return Number(m[1]) * SIZE - SIZE + (m[2]!.charCodeAt(0) - 64);
  const n = Number(s);
  return s && Number.isInteger(n) && n >= 1 && n <= TILES ? n : null;
}
/** Tiles at most `r` steps away (diagonals count as one step), not counting the tile itself. */
export function around(t: number, r = 1): number[] {
  const out: number[] = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (!dx && !dy) continue;
    const x = colOf(t) + dx, y = rowOf(t) + dy;
    if (x >= 0 && x < SIZE && y >= 0 && y < SIZE) out.push(y * SIZE + x + 1);
  }
  return out;
}
export const isEdge = (t: number): boolean => colOf(t) === 0 || rowOf(t) === 0 || colOf(t) === SIZE - 1 || rowOf(t) === SIZE - 1;
export const distance = (a: number, b: number): number => Math.max(Math.abs(colOf(a) - colOf(b)), Math.abs(rowOf(a) - rowOf(b)));

export const ESTATE = {
  land: polygons(1_000),  // the tile itself, on top of the building
  decay: 2,              // condition points lost a day
  stormDamage: 6,        // more on a stormy day (half with a Lighthouse)
  unpaidDecay: 3,        // more when the upkeep and tax can't be paid
  pollutionWear: 1,      // more for each Factory next door
  sellBack: 0.8,         // the bank pays 80% of what went in (less for a wreck: down to 40% at 0%)
  repairPerPoint: 0.0015,// of the value, per condition point
  levelRent: [1, 1.6, 2.4], levelUpkeep: [1, 1.5, 2], levelCost: [0, 0.75, 1.25],
  upgradeHours: 0.5,     // an upgrade takes this share of the building time
  park: 0.15, maxParks: 2, pollution: 0.15, rail: 0.1, railRange: 2, customers: 0.05, maxCustomers: 4,
  extraUnit: 0.25, extraUnitAbove: 75,
  storefrontCut: 0.1,
  squatBelow: 40, squatChance: 0.2, squatClearAt: 75, evictDays: 3,
  bidOver: 1.25, bidHours: 24, refuseFee: 0.15, shieldDays: 7, outbid: 1.1,
  auctionHours: 24, auctionStart: 0.3, auctionStep: 1.05, auctionCondition: 50, condemnedPayout: 0.1,
  partyMs: HOUR,
  goodsPerDay: 24, goodsPrice: polygons(20), freightGoods: polygons(30),
  freightBonus: 0.15, freightMs: 30 * 60_000, freightGapMs: 6 * HOUR,
  warehouseDays: [3, 5, 7], bankBonus: 0.25
};
/** Daily property tax, as a share of the value of everything you own. */
export function taxRate(owned: number): number {
  if (owned <= 3) return 0;
  if (owned <= 8) return 0.005;
  if (owned <= 16) return 0.01;
  return 0.015;
}

export interface Lot {
  guild_id: string; lot: number; kind: Kind; owner_id: string | null; status: 'owned' | 'auction'; level: number;
  condition: number; settled_at: number; built_at: number | null; build_until: number; spent: Cents; squatters: number; shield_until: number;
  storefront: string | null; auction_until: number | null; bidder_id: string | null; bid_cents: number; bid_until: number | null;
}
/** What a building is worth: everything that went into it (land, construction, upgrades). */
export const value = (l: Pick<Lot, 'spent' | 'kind'>): Cents => Math.max(l.spent, KINDS[l.kind].price);
export const building = (l: Lot, now: number): boolean => l.build_until > now;
export const upgradeCost = (l: Lot): Cents | null => (l.level >= KINDS[l.kind].maxLevel ? null : Math.ceil(KINDS[l.kind].price * ESTATE.levelCost[l.level]!));
export const buildMs = (k: Kind): number => KINDS[k].buildHours * HOUR;
export const upgradeMs = (k: Kind): number => Math.round(buildMs(k) * ESTATE.upgradeHours);
export const repairCost = (l: Lot, to = 100): Cents => Math.ceil(Math.max(0, to - l.condition) * value(l) * ESTATE.repairPerPoint);
export const sellPrice = (l: Lot): Cents => Math.floor(value(l) * ESTATE.sellBack * (0.5 + 0.5 * Math.max(0, l.condition) / 100));
export const minBid = (l: Lot): Cents => l.status === 'auction'
  ? Math.max(Math.ceil(value(l) * ESTATE.auctionStart), l.bid_cents ? Math.ceil(l.bid_cents * ESTATE.auctionStep) : 0)
  : Math.max(Math.ceil(value(l) * ESTATE.bidOver), l.bid_cents ? Math.ceil(l.bid_cents * ESTATE.outbid) : 0);
export const rentAt = (k: Kind, level: number): Cents => Math.floor(KINDS[k].rent * ESTATE.levelRent[level - 1]!);
export const upkeepAt = (k: Kind, level: number): Cents => Math.floor(KINDS[k].upkeep * ESTATE.levelUpkeep[level - 1]!);

// ---------------------------------------------------------------- reading and saving
/** Every building on a server's map (empty tiles have no row). */
export function lotsOf(db: Db, guildId: string, _now = Date.now()): Lot[] {
  return db.all<Lot>('SELECT * FROM estates WHERE guild_id = ? ORDER BY lot', guildId);
}
export const lotAt = (lots: Lot[], t: number): Lot | undefined => lots.find((l) => l.lot === t);
export function saveLot(db: Db, l: Lot): void {
  db.run(`INSERT INTO estates (guild_id, lot, kind, owner_id, status, level, condition, settled_at, built_at, build_until, spent, squatters, shield_until, storefront, auction_until, bidder_id, bid_cents, bid_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, lot) DO UPDATE SET kind = excluded.kind, owner_id = excluded.owner_id, status = excluded.status, level = excluded.level, condition = excluded.condition,
      settled_at = excluded.settled_at, built_at = excluded.built_at, build_until = excluded.build_until, spent = excluded.spent, squatters = excluded.squatters,
      shield_until = excluded.shield_until, storefront = excluded.storefront, auction_until = excluded.auction_until, bidder_id = excluded.bidder_id, bid_cents = excluded.bid_cents, bid_until = excluded.bid_until`,
    l.guild_id, l.lot, l.kind, l.owner_id, l.status, l.level, l.condition, l.settled_at, l.built_at, l.build_until, l.spent, l.squatters, l.shield_until, l.storefront,
    l.auction_until, l.bidder_id, l.bid_cents, l.bid_until);
}
export const clearLot = (db: Db, guildId: string, t: number): void => { db.run('DELETE FROM estates WHERE guild_id = ? AND lot = ?', guildId, t); };
/** A new building, just started. */
export function newLot(guildId: string, t: number, k: Kind, owner: string, now: number, spent: Cents): Lot {
  const until = now + buildMs(k);
  return { guild_id: guildId, lot: t, kind: k, owner_id: owner, status: 'owned', level: 1, condition: 100, settled_at: until, built_at: now, build_until: until, spent,
    squatters: 0, shield_until: 0, storefront: null, auction_until: null, bidder_id: null, bid_cents: 0, bid_until: null };
}
export const ownedBy = (lots: Lot[], userId: string): Lot[] => lots.filter((l) => l.status === 'owned' && l.owner_id === userId);
/** Owns a finished one of this kind that isn't overrun by squatters (for the perks). Returns its best level, or 0. */
export function perkLevel(db: Db, guildId: string, userId: string, k: Kind, now = Date.now()): number {
  return db.get<{ n: number | null }>("SELECT MAX(level) AS n FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned' AND kind = ? AND squatters = 0 AND build_until <= ?", guildId, userId, k, now)?.n ?? 0;
}
export const hasPerk = (db: Db, guildId: string, userId: string, k: Kind, now = Date.now()): boolean => perkLevel(db, guildId, userId, k, now) > 0;
/** A Barn (finished, any condition) unlocks the extra farm plots for good while you own it. */
export const hasBarn = (db: Db, guildId: string, userId: string, now = Date.now()): boolean =>
  !!db.get("SELECT 1 FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned' AND kind = 'barn' AND build_until <= ? LIMIT 1", guildId, userId, now);

// ---------------------------------------------------------------- neighbors
export interface Effects { mult: number; parks: number; factories: number; rail: boolean; customers: number; watched: boolean; notes: string[] }
/** What the tiles around a building do to it. */
export function effects(lots: Lot[], l: Pick<Lot, 'lot' | 'kind'>, now: number): Effects {
  const done = (x: Lot) => x.status === 'owned' && x.build_until <= now && x.lot !== l.lot;
  const near = around(l.lot, 1).map((t) => lotAt(lots, t)).filter((x): x is Lot => !!x && done(x));
  const k = KINDS[l.kind];
  const parks = Math.min(ESTATE.maxParks, near.filter((x) => x.kind === 'park').length);
  const factories = k.industrial ? 0 : near.filter((x) => x.kind === 'factory').length;
  const rail = l.kind !== 'station' && lots.some((x) => done(x) && x.kind === 'station' && distance(x.lot, l.lot) <= ESTATE.railRange);
  const customers = l.kind === 'shop' ? Math.min(ESTATE.maxCustomers, near.filter((x) => KINDS[x.kind].home).length) : 0;
  const watched = near.some((x) => x.kind === 'police');
  const notes: string[] = [];
  let mult = 1;
  if (parks) { mult += parks * ESTATE.park; notes.push(`🌳 +${Math.round(parks * ESTATE.park * 100)}% park`); }
  if (factories) { mult -= factories * ESTATE.pollution; notes.push(`🏭 −${Math.round(factories * ESTATE.pollution * 100)}% pollution`); }
  if (rail) { mult += ESTATE.rail; notes.push(`🚉 +${ESTATE.rail * 100}% rail`); }
  if (customers) { mult += customers * ESTATE.customers; notes.push(`🏘️ +${Math.round(customers * ESTATE.customers * 100)}% customers`); }
  if (watched) notes.push('🚓 watched');
  return { mult: Math.max(0.25, mult), parks, factories, rail, customers, watched, notes };
}

/** What one day of a building earns: rent scales with level, condition and the neighbors. */
export function dayRent(l: Lot, fx: Effects, landmark = 0): Cents {
  if (l.squatters) return 0;
  let r = rentAt(l.kind, l.level) * Math.max(0, l.condition) / 100;
  r *= fx.mult + landmark;
  if (l.kind === 'apartment' && l.condition >= ESTATE.extraUnitAbove) r *= 1 + ESTATE.extraUnit;
  return Math.floor(r + 1e-6);   // (1 + 0.15 − 0.15 isn't exactly 1 in floating point)
}
export const goodsPerDay = (l: Lot): number => (l.kind === 'factory' && !l.squatters ? Math.floor(ESTATE.goodsPerDay * l.level * Math.max(0, l.condition) / 100) : 0);

// ---------------------------------------------------------------- settling
export type EstateNews =
  | { kind: 'paid'; userId: string; lot: number; days: number; rent: Cents; charges: Cents; short: boolean; goods: number }
  | { kind: 'built'; userId: string; lot: number; what: Kind; level: number; at: number }
  | { kind: 'squatters'; userId: string; lot: number; at: number }
  | { kind: 'condemned'; userId: string; lot: number; at: number; payout: Cents; what: Kind }
  | { kind: 'auction_won'; userId: string; lot: number; cents: Cents }
  | { kind: 'auction_unsold'; lot: number }
  | { kind: 'bought_out'; userId: string; buyerId: string; lot: number; cents: Cents }
  | { kind: 'freight'; userId: string; cents: Cents; robbed: Cents; crops: number; goods: number };

/** Server-wide rent from finished landmarks (the TODD Statue's +5%). Set by landmarks.ts. */
let landmarkRent: (db: Db, guildId: string) => number = () => 0;
export const setLandmarkRent = (fn: (db: Db, guildId: string) => number): void => { landmarkRent = fn; };

/**
 * Brings every building in a server up to `now`: construction finishing, whole days of rent, upkeep, tax, wear
 * and goods for owned buildings; buyouts, auctions and freight trains whose time is up. Returns what happened,
 * for whoever should hear about it.
 */
export function settle(db: Db, guildId: string, now: number): EstateNews[] {
  const news: EstateNews[] = [];
  db.tx(() => {
    const lots = lotsOf(db, guildId, now);
    const storms = weatherLog(db).filter((w) => w.kind === 'storm');
    const bonus = landmarkRent(db, guildId);
    // No Questions Asked: nights the Connector squatted in an owned place (its rent is halved that day)
    let hosts: { lot: number; from: number; until: number }[] = [];
    try { hosts = JSON.parse(db.meta(`ug.hosts:${guildId}`) ?? '[]'); } catch { /* none */ }
    const owners = new Map<string, { n: number; beacon: boolean }>();
    for (const l of lots) if (l.status === 'owned' && l.owner_id && !owners.has(l.owner_id)) {
      const mine = ownedBy(lots, l.owner_id);
      owners.set(l.owner_id, { n: mine.length, beacon: mine.some((x) => x.kind === 'lighthouse' && !x.squatters && x.build_until <= now) });
    }
    for (const l of lots) {
      // construction that finished since anyone looked
      if (l.status === 'owned' && l.built_at !== null && l.build_until <= now) {
        news.push({ kind: 'built', userId: l.owner_id!, lot: l.lot, what: l.kind, level: l.level, at: l.build_until });
        l.built_at = null;
      }
      // a buyout nobody answered goes through
      if (l.status === 'owned' && l.bidder_id && l.bid_until !== null && l.bid_until <= now) {
        settleLot(db, lots, l, owners, storms, l.bid_until, news, hosts, bonus);
        if (l.status === 'owned') buyout(db, l, l.bid_until, news);
      }
      if (l.status === 'owned') settleLot(db, lots, l, owners, storms, now, news, hosts, bonus);
      if (l.status === 'auction' && l.auction_until !== null && l.auction_until <= now) { if (endAuction(db, l, news)) { clearLot(db, guildId, l.lot); continue; } }
      saveLot(db, l);
    }
    settleFreight(db, guildId, now, news);
  });
  return news;
}

function settleLot(db: Db, lots: Lot[], l: Lot, owners: Map<string, { n: number; beacon: boolean }>, storms: { from: number; until: number }[], now: number, news: EstateNews[], hosts: { lot: number; from: number; until: number }[], bonus: number): void {
  const owner = l.owner_id!;
  const o = owners.get(owner) ?? { n: 1, beacon: false };
  const w = wallet(l.guild_id, owner);
  let days = 0, rent = 0, charges = 0, short = false, goods = 0;
  for (let guard = 0; l.settled_at + DAY <= now && guard < 400; guard++) {
    const from = l.settled_at, to = from + DAY;
    const fx = effects(lots, l, to);
    // the day's rent, at the condition it started with
    let r = dayRent(l, fx, bonus);
    if (hosts.some((h) => h.lot === l.lot && h.from < to && h.until > from)) r = Math.floor(r / 2);   // the Connector squatted here
    if (r > 0) {
      const paid = payFromReserve(db, economy.reserveStart, { to: w, cents: r, reason: 'estate.rent', guildId: l.guild_id, actorId: owner, now: to, note: { lot: l.lot } });
      rent += paid;
      if (l.kind === 'shop' && l.storefront && paid > 0) {
        const cut = Math.floor(paid * ESTATE.storefrontCut);
        const c = getCompany(db, l.storefront);
        if (cut > 0 && c && alive(c)) addRevenue(db, c.ticker, cut, to);
      }
    }
    // a Factory's day of work goes into the owner's inventory as crates of Goods
    const made = goodsPerDay(l);
    if (made > 0) { addItem(db, l.guild_id, owner, 'goods', made); goods += made; }
    // upkeep and tax
    const due = upkeepAt(l.kind, l.level) + Math.floor(value(l) * taxRate(o.n));
    const can = Math.min(due, Math.max(0, balance(db, w)));
    if (can > 0) transfer(db, { from: w, to: RESERVE, cents: can, reason: 'estate.upkeep', guildId: l.guild_id, actorId: owner, now: to, note: { lot: l.lot } });
    charges += can;
    // wear
    let wear = ESTATE.decay + fx.factories * ESTATE.pollutionWear;
    if (storms.some((s) => s.from < to && s.until > from)) wear += o.beacon ? ESTATE.stormDamage / 2 : ESTATE.stormDamage;
    if (can < due) { wear += ESTATE.unpaidDecay; short = true; }
    l.condition = Math.max(0, l.condition - wear);
    l.settled_at = to;
    days++;
    // squatters move into neglected places (not under a Police Station's nose)
    if (!l.squatters && !fx.watched && l.kind !== 'police' && l.condition < ESTATE.squatBelow && roll(lotSeed(l), to) < ESTATE.squatChance) {
      l.squatters = 1;
      news.push({ kind: 'squatters', userId: owner, lot: l.lot, at: to });
    }
    if (l.condition <= 0) { condemn(db, l, to, news); break; }
  }
  if (days) news.push({ kind: 'paid', userId: owner, lot: l.lot, days, rent, charges, short, goods });
}

const lotSeed = (l: Lot): number => {
  let h = 2166136261;
  for (const ch of `${l.guild_id}:${l.lot}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

function condemn(db: Db, l: Lot, at: number, news: EstateNews[]): void {
  const owner = l.owner_id!;
  const payout = payFromReserve(db, economy.reserveStart, { to: wallet(l.guild_id, owner), cents: Math.floor(value(l) * ESTATE.condemnedPayout), reason: 'estate.condemned', guildId: l.guild_id, actorId: owner, now: at });
  refundBid(db, l, at);
  Object.assign(l, { owner_id: null, status: 'auction', condition: 0, squatters: 0, storefront: null, shield_until: 0, auction_until: at + ESTATE.auctionHours * HOUR, built_at: null });
  news.push({ kind: 'condemned', userId: owner, lot: l.lot, at, payout, what: l.kind });
}

/** Ends an auction. Returns true when nobody bid: the wreck is torn down and the tile is empty again. */
function endAuction(db: Db, l: Lot, news: EstateNews[]): boolean {
  const at = l.auction_until!;
  if (l.bidder_id) {
    const winner = l.bidder_id, cents = l.bid_cents;
    transfer(db, { from: escrow(l.guild_id, winner), to: RESERVE, cents, reason: 'estate.auction', guildId: l.guild_id, actorId: winner, now: at, note: { lot: l.lot } });
    Object.assign(l, { owner_id: winner, status: 'owned', condition: ESTATE.auctionCondition, settled_at: at, auction_until: null, bidder_id: null, bid_cents: 0, bid_until: null });
    news.push({ kind: 'auction_won', userId: winner, lot: l.lot, cents });
    return false;
  }
  news.push({ kind: 'auction_unsold', lot: l.lot });
  return true;
}

/** The bid goes through: the bidder's escrowed Polygons go to the owner, and the building to the bidder. */
export function buyout(db: Db, l: Lot, at: number, news: EstateNews[]): void {
  const seller = l.owner_id!, buyer = l.bidder_id!, cents = l.bid_cents;
  transfer(db, { from: escrow(l.guild_id, buyer), to: wallet(l.guild_id, seller), cents, reason: 'estate.buyout', guildId: l.guild_id, actorId: buyer, now: at, note: { lot: l.lot } });
  Object.assign(l, { owner_id: buyer, settled_at: Math.max(at, l.build_until), storefront: null, bidder_id: null, bid_cents: 0, bid_until: null, shield_until: 0 });
  news.push({ kind: 'bought_out', userId: seller, buyerId: buyer, lot: l.lot, cents });
}

/** Gives the current bidder their Polygons back and clears the bid. */
export function refundBid(db: Db, l: Lot, now: number): void {
  if (l.bidder_id && l.bid_cents > 0) {
    const from = escrow(l.guild_id, l.bidder_id);
    const cents = Math.min(l.bid_cents, balance(db, from));
    if (cents > 0) transfer(db, { from, to: wallet(l.guild_id, l.bidder_id), cents, reason: 'estate.refund', guildId: l.guild_id, now, note: { lot: l.lot } });
  }
  Object.assign(l, { bidder_id: null, bid_cents: 0, bid_until: null });
}

/** Moves a bid into escrow (after the old bidder, if any, is refunded). */
export function placeBid(db: Db, l: Lot, userId: string, cents: Cents, until: number, now: number): void {
  refundBid(db, l, now);
  ensureEscrow(db, l.guild_id, userId, now);
  transfer(db, { from: wallet(l.guild_id, userId), to: escrow(l.guild_id, userId), cents, reason: 'estate.bid', guildId: l.guild_id, actorId: userId, now, note: { lot: l.lot } });
  Object.assign(l, { bidder_id: userId, bid_cents: cents, bid_until: until });
}

// ---------------------------------------------------------------- freight
// A Station owner ships their whole crop basket and their Goods by train. It arrives half an hour later and
// pays more than Marquez does. While it's on the rails, a heist crew can rob it.
export interface Freight { id: number; guild_id: string; user_id: string; cents: Cents; robbed: Cents; crops: number; goods: number; left_at: number; arrives_at: number; done: number }
export const trainsOf = (db: Db, guildId: string, now: number): Freight[] =>
  db.all<Freight>('SELECT * FROM freight WHERE guild_id = ? AND done = 0 AND arrives_at > ? ORDER BY arrives_at', guildId, now);
export const lastShipment = (db: Db, guildId: string, userId: string): number =>
  db.get<{ t: number | null }>('SELECT MAX(left_at) AS t FROM freight WHERE guild_id = ? AND user_id = ?', guildId, userId)?.t ?? 0;
export function ship(db: Db, guildId: string, userId: string, cents: Cents, crops: number, goods: number, now: number): Freight {
  const id = db.run('INSERT INTO freight (guild_id, user_id, cents, robbed, crops, goods, left_at, arrives_at, done) VALUES (?, ?, ?, 0, ?, ?, ?, ?, 0)',
    guildId, userId, cents, crops, goods, now, now + ESTATE.freightMs).lastInsertRowid;
  return db.get<Freight>('SELECT * FROM freight WHERE id = ?', id)!;
}
/** A train robbery takes up to half of what's on the train. Returns how much was taken. */
export function robTrain(db: Db, f: Freight, want: Cents): Cents {
  const take = Math.max(0, Math.min(want, Math.floor(f.cents / 2) - f.robbed));
  if (take > 0) db.run('UPDATE freight SET robbed = robbed + ? WHERE id = ?', take, f.id);
  return take;
}
function settleFreight(db: Db, guildId: string, now: number, news: EstateNews[]): void {
  for (const f of db.all<Freight>('SELECT * FROM freight WHERE guild_id = ? AND done = 0 AND arrives_at <= ?', guildId, now)) {
    const owed = Math.max(0, f.cents - f.robbed);
    const paid = owed > 0 ? payFromReserve(db, economy.reserveStart, { to: wallet(guildId, f.user_id), cents: owed, reason: 'estate.freight', guildId, actorId: f.user_id, now: f.arrives_at }) : 0;
    db.run('UPDATE freight SET done = 1 WHERE id = ?', f.id);
    news.push({ kind: 'freight', userId: f.user_id, cents: paid, robbed: f.robbed, crops: f.crops, goods: f.goods });
  }
  db.run('DELETE FROM freight WHERE done = 1 AND arrives_at < ?', now - 7 * DAY);
}

// ---------------------------------------------------------------- the Ballroom
export function partyUntil(db: Db, guildId: string): number { return Number(db.meta(`estate.party:${guildId}`) ?? 0); }
export function startParty(db: Db, guildId: string, now: number): number {
  const until = now + ESTATE.partyMs;
  db.setMeta(`estate.party:${guildId}`, String(until));
  return until;
}

/** Everything a player's buildings are worth (counted in net worth). */
export function propertyWorth(db: Db, guildId: string, userId: string): Cents {
  return db.all<{ kind: Kind; spent: number }>("SELECT kind, spent FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned'", guildId, userId).reduce((s, r) => s + value(r), 0);
}

/** When a player is erased: their buildings are torn down and their bids are dropped (their escrow is already gone). */
export function releasePlayer(db: Db, guildId: string, userId: string): void {
  db.run("DELETE FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned'", guildId, userId);
  db.run('UPDATE estates SET bidder_id = NULL, bid_cents = 0, bid_until = NULL WHERE guild_id = ? AND bidder_id = ?', guildId, userId);
  db.run('DELETE FROM freight WHERE guild_id = ? AND user_id = ?', guildId, userId);
}
