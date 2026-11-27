// Collectibles with a value, and a museum in every server.
//  - Collector value: each collectible's price, worked out once a day from how many copies exist across every
//    server. Rarer than the average collectible: worth more (up to 5x Marquez's price); more common: less
//    (down to half). It counts toward net worth. Collectibles are never loan collateral.
//  - Mr. Glaz buys collectibles at night for 125% of collector value: one a night, only ones you've held for
//    7 days, with Heat. What he buys is gone for good.
//  - The museum: donate a collectible (gone for good) for 75% of its collector value and a plaque. Each kind on
//    display gives the server +0.5% chat and shift pay; finished wings give bigger bonuses.
import { award, has } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import { polygons, type Cents } from '../core/money';
import { DAY, dayKey } from '../core/time';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ROTATION, type Item } from '../shop/items';
import { takeItem } from '../shop/inventory';

export const MUSEUM = {
  minMult: 0.5, maxMult: 5, minAverage: 5,
  donorShare: 0.75, glazShare: 1.25, glazHoldMs: 7 * DAY, glazHeat: 15,
  perExhibit: 0.005,
  /** A collectible with no price (the Star Topper, only behind the last advent door) is valued from this. */
  noPrice: polygons(2500)
};

// ---------------------------------------------------------------- which collectibles exist so far

/** How many of RendConomy's birthdays have started (its numbered Candles exist up to this one). */
let birthdaysSoFar: (now: number) => number = () => 0;
export const setBirthdaysSoFar = (fn: (now: number) => number): void => { birthdaysSoFar = fn; };

/** Every collectible that can exist by now: the weekly specials, the holiday ones, the Party Hat (once there's
 *  been a party) and the Candles up to the latest birthday. */
export function released(now = Date.now()): Item[] {
  const n = birthdaysSoFar(now);
  return Object.values(COLLECTIBLES).filter((c) => {
    const m = /^col_candle(\d+)$/.exec(c.id);
    if (m) return Number(m[1]) <= n;
    if (c.id === 'col_partyhat') return n >= 1 || partyHatOut(now);
    return true;
  });
}
let partyHatOut: (now: number) => boolean = () => false;
export const setPartyHatOut = (fn: (now: number) => boolean): void => { partyHatOut = fn; };

// ---------------------------------------------------------------- collector value

export const copiesOf = (db: Db, id: string): number =>
  (db.get<{ n: number }>('SELECT COALESCE(SUM(qty), 0) AS n FROM inventory WHERE item = ?', id)!.n) +
  (db.get<{ n: number }>('SELECT COALESCE(SUM(qty), 0) AS n FROM store_shelf WHERE item = ?', id)!.n);
const basePrice = (c: Item): Cents => (c.price && c.price > 0 ? c.price : MUSEUM.noPrice);

export interface Price { id: string; cents: Cents; copies: number; change: number }

/** Today's collector prices, worked out once a day (and kept, for the price history). */
const cache = new WeakMap<Db, { day: string; n: number; at: number; val: Record<string, Price> }>();
export function prices(db: Db, now = Date.now()): Record<string, Price> {
  const day = dayKey(now);
  const hit = cache.get(db);
  if (hit && hit.day === day && hit.n === released(now).length && Math.abs(now - hit.at) < 60_000) return hit.val;
  const val = computePrices(db, now, day);
  cache.set(db, { day, n: released(now).length, at: now, val });
  return val;
}
function computePrices(db: Db, now: number, day: string): Record<string, Price> {
  let rows = db.all<{ item: string; cents: number; copies: number }>('SELECT item, cents, copies FROM collector_prices WHERE day = ?', day);
  const list = released(now);
  if (rows.length < list.length) {
    db.tx(() => {
      const copies = Object.fromEntries(list.map((c) => [c.id, copiesOf(db, c.id)]));
      const held = Object.values(copies).filter((n) => n > 0);
      const avg = Math.max(MUSEUM.minAverage, held.length ? held.reduce((a, b) => a + b, 0) / held.length : 0);
      for (const c of list) {
        const n = copies[c.id]!;
        const mult = n > 0 ? Math.min(MUSEUM.maxMult, Math.max(MUSEUM.minMult, Math.sqrt(avg / n))) : MUSEUM.maxMult;
        db.run('INSERT OR IGNORE INTO collector_prices (day, item, cents, copies) VALUES (?, ?, ?, ?)', day, c.id, Math.round((basePrice(c) * mult) / 100) * 100, n);
      }
    });
    rows = db.all<{ item: string; cents: number; copies: number }>('SELECT item, cents, copies FROM collector_prices WHERE day = ?', day);
  }
  const weekAgo = dayKey(now - 7 * DAY);
  const before = Object.fromEntries(db.all<{ item: string; cents: number }>(
    'SELECT item, cents FROM collector_prices p WHERE day = (SELECT MIN(day) FROM collector_prices q WHERE q.item = p.item AND q.day >= ?)', weekAgo).map((r) => [r.item, r.cents]));
  return Object.fromEntries(rows.map((r) => [r.item, { id: r.item, cents: r.cents, copies: r.copies, change: before[r.item] ? (r.cents - before[r.item]!) / before[r.item]! : 0 }]));
}
export const valueOf = (db: Db, id: string, now = Date.now()): Cents => prices(db, now)[id]?.cents ?? basePrice(COLLECTIBLES[id] ?? ({ price: MUSEUM.noPrice } as Item));

/** A player's collectibles in a server, with what each is worth. */
export function collectionOf(db: Db, g: string, u: string, now = Date.now()): { id: string; qty: number; each: Cents; change: number }[] {
  const p = prices(db, now);
  return db.all<{ item: string; qty: number }>("SELECT item, qty FROM inventory WHERE guild_id = ? AND user_id = ? AND qty > 0 AND item LIKE 'col_%'", g, u)
    .filter((r) => COLLECTIBLES[r.item])
    .map((r) => ({ id: r.item, qty: r.qty, each: p[r.item]?.cents ?? basePrice(COLLECTIBLES[r.item]!), change: p[r.item]?.change ?? 0 }))
    .sort((a, b) => b.each * b.qty - a.each * a.qty);
}
export const collectionValue = (db: Db, g: string, u: string, now = Date.now()): Cents =>
  collectionOf(db, g, u, now).reduce((s, c) => s + c.each * c.qty, 0);

/** Price history for the site's board: day by day, per collectible. */
export function history(db: Db, days = 30, now = Date.now()): Record<string, [string, number][]> {
  prices(db, now);
  const out: Record<string, [string, number][]> = {};
  for (const r of db.all<{ day: string; item: string; cents: number }>('SELECT day, item, cents FROM collector_prices WHERE day >= ? ORDER BY day', dayKey(now - days * DAY))) (out[r.item] ??= []).push([r.day, r.cents]);
  return out;
}

// ---------------------------------------------------------------- how long you've held one (for Mr. Glaz)

export const heldSince = (db: Db, g: string, u: string, item: string): number | null =>
  db.get<{ since: number }>('SELECT since FROM collectible_since WHERE guild_id = ? AND user_id = ? AND item = ?', g, u, item)?.since ?? null;

/** Mr. Glaz buys a collectible: 125% of its value, one a night, held 7 days or more. It's gone for good. */
export function sellToGlaz(db: Db, g: string, u: string, item: string, night: string, now = Date.now()): Cents {
  const since = heldSince(db, g, u, item);
  if (since === null || now - since < MUSEUM.glazHoldMs) throw new MuseumError('glaz.fresh', since === null ? 'nothing' : String(since + MUSEUM.glazHoldMs));
  if (db.meta(`ug.pawn:${g}:${u}:${night}`)) throw new MuseumError('glaz.tonight', '');
  const each = valueOf(db, item, now);
  if (!takeItem(db, g, u, item)) throw new MuseumError('glaz.none', '');
  db.setMeta(`ug.pawn:${g}:${u}:${night}`, String(now));
  return payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents: Math.round(each * MUSEUM.glazShare), reason: 'ug.collectible', guildId: g, actorId: u, now, note: { item } });
}

export class MuseumError extends Error { constructor(readonly why: string, readonly detail: string) { super(why); } }

// ---------------------------------------------------------------- the museum

export interface Wing { id: string; name: string; emoji: string; perk: string; items: (now: number) => string[] }
export const WINGS: Wing[] = [
  { id: 'founders', name: 'Founders\' Wing', emoji: '🗃️', perk: '+5% property rent', items: () => [...ROTATION] },
  { id: 'winter', name: 'Winter Wing', emoji: '❄️', perk: 'advent doors pay double Polygons', items: () => Object.keys(HOLIDAY_COLLECTIBLES) },
  { id: 'birthday', name: 'Birthday Wing', emoji: '🎂', perk: 'the birthday cake needs 20% fewer pieces', items: (now) => released(now).filter((c) => c.id === 'col_partyhat' || c.id.startsWith('col_candle')).map((c) => c.id) },
  { id: 'full', name: 'The Full Collection', emoji: '🏛️', perk: '+2% on every achievement reward', items: (now) => released(now).map((c) => c.id) }
];

export interface Exhibit { item: string; donor_id: string; donor: string | null; at: number; copies: number }
/** A server's museum: one exhibit per kind of collectible (the first donor's plaque), and how many were given. */
export function exhibits(db: Db, g: string): Exhibit[] {
  return db.all<Exhibit>(`SELECT d.item, d.user_id AS donor_id, p.name AS donor, d.at, (SELECT COUNT(*) FROM museum_donations x WHERE x.guild_id = d.guild_id AND x.item = d.item) AS copies
    FROM museum_donations d LEFT JOIN players p ON p.guild_id = d.guild_id AND p.user_id = d.user_id
    WHERE d.guild_id = ? AND d.id = (SELECT MIN(id) FROM museum_donations y WHERE y.guild_id = d.guild_id AND y.item = d.item) ORDER BY d.at`, g);
}
const shown = (db: Db, g: string): Set<string> =>
  new Set(db.all<{ item: string }>('SELECT DISTINCT item FROM museum_donations WHERE guild_id = ?', g).map((r) => r.item));
/** The finished wings in a server. */
export function wingsDone(db: Db, g: string, now = Date.now()): Wing[] {
  const have = shown(db, g);
  return WINGS.filter((w) => { const ids = w.items(now); return ids.length > 0 && ids.every((id) => have.has(id)); });
}
const wingOn = (db: Db, g: string, id: string, now = Date.now()): boolean => wingsDone(db, g, now).some((w) => w.id === id);

/** The bonuses, read by the systems they change. */
export const museumPay = (db: Db, g: string): number => 1 + MUSEUM.perExhibit * shown(db, g).size;
export const museumRent = (db: Db, g: string, now = Date.now()): number => (wingOn(db, g, 'founders', now) ? 0.05 : 0);
export const museumAdvent = (db: Db, g: string, now = Date.now()): number => (wingOn(db, g, 'winter', now) ? 2 : 1);
export const museumCake = (db: Db, g: string, now = Date.now()): number => (wingOn(db, g, 'birthday', now) ? 0.8 : 1);
export const museumAwards = (db: Db, g: string, now = Date.now()): number => (wingOn(db, g, 'full', now) ? 1.02 : 1);

/**
 * Donates a collectible: it leaves the inventory for good, the Reserve pays 75% of its collector value, and the
 * donor's name goes on the plaque if it's the first of its kind here. Returns what happened.
 */
export function donate(db: Db, g: string, u: string, item: string, now = Date.now()): { paid: Cents; first: boolean; wings: Wing[]; curator: boolean } {
  return db.tx(() => {
    const before = wingsDone(db, g, now).map((w) => w.id);
    const first = !shown(db, g).has(item);
    const each = valueOf(db, item, now);
    if (!takeItem(db, g, u, item)) throw new MuseumError('museum.none', '');
      db.run('INSERT INTO museum_donations (guild_id, user_id, item, at) VALUES (?, ?, ?, ?)', g, u, item, now);
    const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents: Math.round(each * MUSEUM.donorShare), reason: 'museum.donation', guildId: g, actorId: u, now, note: { item } });
    award(db, g, u, 'museum_donor', now);
    const mine = new Set(db.all<{ item: string }>('SELECT DISTINCT item FROM museum_donations WHERE user_id = ?', u).map((r) => r.item));
    const curator = released(now).every((c) => mine.has(c.id));
    if (curator && !has(db, u, 'the_curator')) award(db, g, u, 'the_curator', now);
    return { paid, first, wings: wingsDone(db, g, now).filter((w) => !before.includes(w.id)), curator };
  });
}

/** For the live feed: today's collector prices, and every server's museum. */
export function museumSnapshot(db: Db, now = Date.now()): { prices: { id: string; name: string; emoji: string; cents: number; copies: number; change: number }[]; museums: Record<string, { exhibits: { item: string; donor: string | null }[]; wings: string[] }> } {
  const p = prices(db, now);
  const museums: Record<string, { exhibits: { item: string; donor: string | null }[]; wings: string[] }> = {};
  for (const r of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM museum_donations')) {
    museums[r.guild_id] = { exhibits: exhibits(db, r.guild_id).map((e) => ({ item: e.item, donor: e.donor })), wings: wingsDone(db, r.guild_id, now).map((w) => w.id) };
  }
  return {
    prices: Object.values(p).map((x) => ({ id: x.id, name: COLLECTIBLES[x.id]?.name ?? x.id, emoji: COLLECTIBLES[x.id]?.emoji ?? '🗃️', cents: x.cents, copies: x.copies, change: Math.round(x.change * 1000) / 1000 }))
      .sort((a, b) => b.cents - a.cents),
    museums
  };
}
