// Room to Grow: real estate. Each server has one fixed map of 15 lots, owned by the bank until someone buys
// them. There's no cap on how many one player owns ("Monopoly, baby!"), but holding a lot of it is hard:
//   - property tax climbs with how many lots you own,
//   - anyone can make a buyout bid you have to pay to refuse,
//   - neglected places get squatters, and a place that falls apart is condemned and auctioned off.
// Owning every lot of one kind (a full set) pays +50% rent, which is what makes a monopoly worth it.
//
// Like farming, nothing ticks in the background: each lot's days are worked out from timestamps whenever it's
// looked at (settle), so the bot can restart freely. A background pass settles every server now and then so
// condemnations, auctions and buyouts finish on time even when nobody is looking.
import { addRevenue, alive, getCompany } from '../companies/companies';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, ensureEscrow, escrow, transfer, wallet } from '../core/ledger';
import { polygons, type Cents } from '../core/money';
import { DAY, HOUR } from '../core/time';
import { roll, weatherLog } from '../farming/farming';

export type Kind = 'shack' | 'apartment' | 'shop' | 'lighthouse' | 'mansion';
export interface KindInfo { id: Kind; name: string; plural: string; emoji: string; price: Cents; rent: Cents; upkeep: Cents; perk: string; perkText: string }
const kind = (id: Kind, name: string, plural: string, emoji: string, price: number, rent: number, upkeep: number, perk: string, perkText: string): KindInfo =>
  ({ id, name, plural, emoji, price: polygons(price), rent: polygons(rent), upkeep: polygons(upkeep), perk, perkText });
export const KINDS: Record<Kind, KindInfo> = {
  shack: kind('shack', 'Shack', 'Shacks', '🛖', 2_500, 60, 15, 'Bait Shed', 'free bait when you fish'),
  apartment: kind('apartment', 'Apartment', 'Apartments', '🏢', 8_000, 200, 50, 'Extra Unit', '+25% rent while it\'s kept above 75%'),
  shop: kind('shop', 'Corner Shop', 'Corner Shops', '🏪', 20_000, 450, 120, 'Storefront', 'a company you pick earns 10% of its rent'),
  lighthouse: kind('lighthouse', 'Lighthouse', 'Lighthouses', '🗼', 45_000, 800, 250, 'Beacon', 'rarer fish on plain bait, and storms do half the damage to all your places'),
  mansion: kind('mansion', 'Mansion', 'Mansions', '🏛️', 120_000, 1_800, 700, 'Ballroom', 'throw a party once a day: chat pay doubles for everyone here for an hour')
};
/** The map: lots 1–15, in this order. */
export const MAP: Kind[] = ['shack', 'shack', 'shack', 'shack', 'shack', 'shack', 'apartment', 'apartment', 'apartment', 'apartment', 'shop', 'shop', 'shop', 'lighthouse', 'mansion'];
export const LOTS = MAP.length;
export const lotsOfKind = (k: Kind): number => MAP.filter((x) => x === k).length;

export const ESTATE = {
  decay: 2,              // condition points lost a day
  stormDamage: 6,        // more on a stormy day (half with a Lighthouse)
  unpaidDecay: 3,        // more when the upkeep and tax can't be paid
  sellBack: 0.8,         // the bank pays 80% of value (less for a wreck: down to 40% at 0%)
  repairPerPoint: 0.0015,// of the value, per condition point
  setBonus: 0.5,         // +50% rent on a full set
  extraUnit: 0.25, extraUnitAbove: 75,
  storefrontCut: 0.1,
  squatBelow: 40, squatChance: 0.2, squatClearAt: 75, evictDays: 3,
  bidOver: 1.25, bidHours: 24, refuseFee: 0.15, shieldDays: 7, outbid: 1.1,
  auctionHours: 24, auctionStart: 0.3, auctionStep: 1.05, auctionCondition: 50, condemnedPayout: 0.1,
  partyMs: HOUR
};
/** Daily property tax, as a share of the value of everything you own. */
export function taxRate(owned: number): number {
  if (owned <= 2) return 0;
  if (owned <= 5) return 0.005;
  if (owned <= 9) return 0.01;
  return 0.015;
}

export interface Lot {
  guild_id: string; lot: number; kind: Kind; owner_id: string | null; status: 'bank' | 'owned' | 'auction';
  condition: number; settled_at: number; bought_at: number | null; squatters: number; shield_until: number;
  storefront: string | null; auction_until: number | null; bidder_id: string | null; bid_cents: number; bid_until: number | null;
}
export const value = (k: Kind): Cents => KINDS[k].price;
export const repairCost = (l: Lot, to = 100): Cents => Math.ceil(Math.max(0, to - l.condition) * value(l.kind) * ESTATE.repairPerPoint);
export const sellPrice = (l: Lot): Cents => Math.floor(value(l.kind) * ESTATE.sellBack * (0.5 + 0.5 * Math.max(0, l.condition) / 100));
export const minBid = (l: Lot): Cents => l.status === 'auction'
  ? Math.max(Math.ceil(value(l.kind) * ESTATE.auctionStart), l.bid_cents ? Math.ceil(l.bid_cents * ESTATE.auctionStep) : 0)
  : Math.max(Math.ceil(value(l.kind) * ESTATE.bidOver), l.bid_cents ? Math.ceil(l.bid_cents * ESTATE.outbid) : 0);

// ---------------------------------------------------------------- reading and saving
/** The server's 15 lots, made the first time anyone looks. */
export function lotsOf(db: Db, guildId: string, now = Date.now()): Lot[] {
  let rows = db.all<Lot>('SELECT * FROM estates WHERE guild_id = ? ORDER BY lot', guildId);
  if (rows.length < LOTS) {
    db.tx(() => { MAP.forEach((k, i) => db.run('INSERT OR IGNORE INTO estates (guild_id, lot, kind, settled_at) VALUES (?, ?, ?, ?)', guildId, i + 1, k, now)); });
    rows = db.all<Lot>('SELECT * FROM estates WHERE guild_id = ? ORDER BY lot', guildId);
  }
  return rows;
}
export function saveLot(db: Db, l: Lot): void {
  db.run(`UPDATE estates SET owner_id = ?, status = ?, condition = ?, settled_at = ?, bought_at = ?, squatters = ?, shield_until = ?, storefront = ?,
    auction_until = ?, bidder_id = ?, bid_cents = ?, bid_until = ? WHERE guild_id = ? AND lot = ?`,
    l.owner_id, l.status, l.condition, l.settled_at, l.bought_at, l.squatters, l.shield_until, l.storefront,
    l.auction_until, l.bidder_id, l.bid_cents, l.bid_until, l.guild_id, l.lot);
}
export const ownedBy = (lots: Lot[], userId: string): Lot[] => lots.filter((l) => l.status === 'owned' && l.owner_id === userId);
/** Does this player own every lot of this kind? */
export const fullSet = (lots: Lot[], userId: string, k: Kind): boolean => lots.filter((l) => l.kind === k).every((l) => l.status === 'owned' && l.owner_id === userId);
export const setsOf = (lots: Lot[], userId: string): Kind[] => (Object.keys(KINDS) as Kind[]).filter((k) => fullSet(lots, userId, k));
/** Owns at least one of this kind that isn't overrun by squatters (for the perks). */
export function hasPerk(db: Db, guildId: string, userId: string, k: Kind): boolean {
  return !!db.get("SELECT 1 FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned' AND kind = ? AND squatters = 0 LIMIT 1", guildId, userId, k);
}

/** What one day of a lot earns before the squatters and the set bonus: rent scales with condition. */
export function dayRent(l: Lot, set: boolean): Cents {
  if (l.squatters) return 0;
  let r = KINDS[l.kind].rent * Math.max(0, l.condition) / 100;
  if (set) r *= 1 + ESTATE.setBonus;
  if (l.kind === 'apartment' && l.condition >= ESTATE.extraUnitAbove) r *= 1 + ESTATE.extraUnit;
  return Math.floor(r);
}

// ---------------------------------------------------------------- settling
export type EstateNews =
  | { kind: 'paid'; userId: string; lot: number; days: number; rent: Cents; charges: Cents; short: boolean }
  | { kind: 'squatters'; userId: string; lot: number; at: number }
  | { kind: 'condemned'; userId: string; lot: number; at: number; payout: Cents }
  | { kind: 'auction_won'; userId: string; lot: number; cents: Cents }
  | { kind: 'auction_unsold'; lot: number }
  | { kind: 'bought_out'; userId: string; buyerId: string; lot: number; cents: Cents };

/**
 * Brings every lot in a server up to `now`: whole days of rent, upkeep, tax and wear for owned lots; buyouts and
 * auctions whose time is up. Returns what happened, for whoever should hear about it.
 */
export function settle(db: Db, guildId: string, now: number): EstateNews[] {
  const news: EstateNews[] = [];
  db.tx(() => {
    const lots = lotsOf(db, guildId, now);
    const weather = weatherLog(db).filter((w) => w.kind === 'storm');
    const owners = new Map<string, { n: number; sets: Set<Kind>; beacon: boolean }>();
    for (const l of lots) if (l.status === 'owned' && l.owner_id && !owners.has(l.owner_id)) {
      const mine = ownedBy(lots, l.owner_id);
      owners.set(l.owner_id, { n: mine.length, sets: new Set(setsOf(lots, l.owner_id)), beacon: mine.some((x) => x.kind === 'lighthouse' && !x.squatters) });
    }
    for (const l of lots) {
      // a buyout nobody answered goes through
      if (l.status === 'owned' && l.bidder_id && l.bid_until !== null && l.bid_until <= now) {
        settleLot(db, l, owners, weather, l.bid_until, news);
        if (l.status === 'owned') buyout(db, l, l.bid_until, news);
      }
      if (l.status === 'owned') settleLot(db, l, owners, weather, now, news);
      if (l.status === 'auction' && l.auction_until !== null && l.auction_until <= now) endAuction(db, l, news);
      saveLot(db, l);
    }
  });
  return news;
}

function settleLot(db: Db, l: Lot, owners: Map<string, { n: number; sets: Set<Kind>; beacon: boolean }>, storms: { from: number; until: number }[], now: number, news: EstateNews[]): void {
  const owner = l.owner_id!;
  const o = owners.get(owner) ?? { n: 1, sets: new Set<Kind>(), beacon: false };
  const w = wallet(l.guild_id, owner);
  let days = 0, rent = 0, charges = 0, short = false;
  for (let guard = 0; l.settled_at + DAY <= now && guard < 400; guard++) {
    const from = l.settled_at, to = from + DAY;
    // the day's rent, at the condition it started with
    const r = dayRent(l, o.sets.has(l.kind));
    if (r > 0) {
      const paid = payFromReserve(db, economy.reserveStart, { to: w, cents: r, reason: 'estate.rent', guildId: l.guild_id, actorId: owner, now: to, note: { lot: l.lot } });
      rent += paid;
      if (l.kind === 'shop' && l.storefront && paid > 0) {
        const cut = Math.floor(paid * ESTATE.storefrontCut);
        const c = getCompany(db, l.storefront);
        if (cut > 0 && c && alive(c)) addRevenue(db, c.ticker, cut, to);
      }
    }
    // upkeep and tax
    const due = KINDS[l.kind].upkeep + Math.floor(value(l.kind) * taxRate(o.n));
    const can = Math.min(due, Math.max(0, balance(db, w)));
    if (can > 0) transfer(db, { from: w, to: RESERVE, cents: can, reason: 'estate.upkeep', guildId: l.guild_id, actorId: owner, now: to, note: { lot: l.lot } });
    charges += can;
    // wear
    let wear = ESTATE.decay;
    if (storms.some((s) => s.from < to && s.until > from)) wear += o.beacon ? ESTATE.stormDamage / 2 : ESTATE.stormDamage;
    if (can < due) { wear += ESTATE.unpaidDecay; short = true; }
    l.condition = Math.max(0, l.condition - wear);
    l.settled_at = to;
    days++;
    // squatters move into neglected places
    if (!l.squatters && l.condition < ESTATE.squatBelow && roll(lotSeed(l), to) < ESTATE.squatChance) {
      l.squatters = 1;
      news.push({ kind: 'squatters', userId: owner, lot: l.lot, at: to });
    }
    if (l.condition <= 0) { condemn(db, l, to, news); break; }
  }
  if (days) news.push({ kind: 'paid', userId: owner, lot: l.lot, days, rent, charges, short });
}

const lotSeed = (l: Lot): number => {
  let h = 2166136261;
  for (const ch of `${l.guild_id}:${l.lot}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};

function condemn(db: Db, l: Lot, at: number, news: EstateNews[]): void {
  const owner = l.owner_id!;
  const payout = payFromReserve(db, economy.reserveStart, { to: wallet(l.guild_id, owner), cents: Math.floor(value(l.kind) * ESTATE.condemnedPayout), reason: 'estate.condemned', guildId: l.guild_id, actorId: owner, now: at });
  refundBid(db, l, at);
  Object.assign(l, { owner_id: null, status: 'auction', condition: 0, squatters: 0, storefront: null, shield_until: 0, auction_until: at + ESTATE.auctionHours * HOUR, bought_at: null });
  news.push({ kind: 'condemned', userId: owner, lot: l.lot, at, payout });
}

function endAuction(db: Db, l: Lot, news: EstateNews[]): void {
  const at = l.auction_until!;
  if (l.bidder_id) {
    const winner = l.bidder_id, cents = l.bid_cents;
    transfer(db, { from: escrow(l.guild_id, winner), to: RESERVE, cents, reason: 'estate.auction', guildId: l.guild_id, actorId: winner, now: at, note: { lot: l.lot } });
    Object.assign(l, { owner_id: winner, status: 'owned', condition: ESTATE.auctionCondition, settled_at: at, bought_at: at, auction_until: null, bidder_id: null, bid_cents: 0, bid_until: null });
    news.push({ kind: 'auction_won', userId: winner, lot: l.lot, cents });
  } else {
    Object.assign(l, { status: 'bank', condition: 100, settled_at: at, auction_until: null });
    news.push({ kind: 'auction_unsold', lot: l.lot });
  }
}

/** The bid goes through: the bidder's escrowed Polygons go to the owner, and the lot to the bidder. */
export function buyout(db: Db, l: Lot, at: number, news: EstateNews[]): void {
  const seller = l.owner_id!, buyer = l.bidder_id!, cents = l.bid_cents;
  transfer(db, { from: escrow(l.guild_id, buyer), to: wallet(l.guild_id, seller), cents, reason: 'estate.buyout', guildId: l.guild_id, actorId: buyer, now: at, note: { lot: l.lot } });
  Object.assign(l, { owner_id: buyer, settled_at: at, bought_at: at, storefront: null, bidder_id: null, bid_cents: 0, bid_until: null, shield_until: 0 });
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

// ---------------------------------------------------------------- the Ballroom
export function partyUntil(db: Db, guildId: string): number { return Number(db.meta(`estate.party:${guildId}`) ?? 0); }
export function startParty(db: Db, guildId: string, now: number): number {
  const until = now + ESTATE.partyMs;
  db.setMeta(`estate.party:${guildId}`, String(until));
  return until;
}

/** Everything a player's properties are worth (counted in net worth). */
export function propertyWorth(db: Db, guildId: string, userId: string): Cents {
  return db.all<{ kind: Kind }>("SELECT kind FROM estates WHERE guild_id = ? AND owner_id = ? AND status = 'owned'", guildId, userId).reduce((s, r) => s + value(r.kind), 0);
}

/** When a player is erased: their places go back to the bank and their bids are dropped (their escrow is already gone). */
export function releasePlayer(db: Db, guildId: string, userId: string, now = Date.now()): void {
  db.run("UPDATE estates SET owner_id = NULL, status = 'bank', condition = 100, squatters = 0, storefront = NULL, shield_until = 0, settled_at = ?, bought_at = NULL WHERE guild_id = ? AND owner_id = ?", now, guildId, userId);
  db.run('UPDATE estates SET bidder_id = NULL, bid_cents = 0, bid_until = NULL WHERE guild_id = ? AND bidder_id = ?', guildId, userId);
}
