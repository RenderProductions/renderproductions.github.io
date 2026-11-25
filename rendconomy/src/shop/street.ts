// Main Street: when Marquez's delivery truck comes, what things cost today (demand, the daily deal, Black
// Friday every Friday, your loyalty card), wishlists, and the truck's announcement in chat.
import type { Db } from '../core/db';
import { DAY, MINUTE, dayKey, easternAt, previousDay, nextDay } from '../core/time';
import type { Cents } from '../core/money';
import { ITEMS, SHELVES, type Item, type Shelf } from './items';

export const STREET = {
  /** The truck comes at these Eastern hours and fills every shelf. */
  deliveries: [8, 14, 20],
  /** Each item's price drifts with demand, between these. */
  factor: { min: 0.8, max: 1.3, up: 0.05, down: 0.05, drift: 0.02, slowBelow: 0.25 },
  dailyDeal: 0.3,
  friday: { featured: 0.4, rest: 0.15 },
  /** Marquez's shelves, in the order Black Friday features them (one a week). Barnaby's tackle isn't one. */
  fridayShelves: ['work', 'market', 'casino', 'fun', 'garden', 'style', 'chess'] as Shelf[],
  /** Never discounted and never moved by demand. */
  fixed: ['title', 'mystery'],
  wishMax: 5,
  /** Good Friends hear about wishlist restocks first; everyone else (and the channel) this much later. */
  headStartMs: 10 * MINUTE,
  /** An announcement nobody was around for is dropped after this long. */
  truckStaleMs: 3 * 60 * MINUTE,
  /** Items with this much stock or less are "rare": the back room keeps as many again for Family. */
  rareAt: 2
};

/** Tests switch moving prices off (demand, sales, loyalty) so old price checks stay exact. */
export const TUNING = { prices: true };

export interface Level { id: string; name: string; spent: Cents; off: number; perk: string; emoji: string }
export const LOYALTY: Level[] = [
  { id: 'stranger', name: 'Stranger', spent: 0, off: 0, perk: '', emoji: '🪪' },
  { id: 'familiar', name: 'Familiar Face', spent: 500_000, off: 0.02, perk: '2% off everything', emoji: '🙂' },
  { id: 'regular', name: 'Regular', spent: 2_500_000, off: 0.04, perk: 'see next week\'s collectible a day early', emoji: '☕' },
  { id: 'friend', name: 'Good Friend', spent: 10_000_000, off: 0.06, perk: `hear about your wishlist ${STREET.headStartMs / MINUTE} minutes before everyone else`, emoji: '🤝' },
  { id: 'family', name: 'Family', spent: 50_000_000, off: 0.08, perk: 'the back room: extra stock of the rare items', emoji: '🏠' }
];

// ---------------------------------------------------------------- the truck's schedule

/** The latest delivery at or before `now`. */
export function lastDelivery(now: number): number {
  const today = dayKey(now);
  const slots = [previousDay(today), today].flatMap((k) => STREET.deliveries.map((h) => easternAt(k, h)));
  return Math.max(...slots.filter((t) => t <= now));
}
/** The next delivery after `now`. */
export function nextDelivery(now: number): number {
  const today = dayKey(now);
  const slots = [today, nextDay(today)].flatMap((k) => STREET.deliveries.map((h) => easternAt(k, h)));
  return Math.min(...slots.filter((t) => t > now));
}

// ---------------------------------------------------------------- sales

const weekday = (now: number): number => new Date(`${dayKey(now)}T12:00:00Z`).getUTCDay();
export const isFriday = (now: number): boolean => weekday(now) === 5;
const dayNumber = (now: number): number => Math.floor(Date.parse(`${dayKey(now)}T12:00:00Z`) / DAY);
/** This Friday's featured shelf (it changes every week). */
export const featuredShelf = (now: number): Shelf => STREET.fridayShelves[Math.floor(dayNumber(now) / 7) % STREET.fridayShelves.length]!;

/** Everything that can be on sale: Marquez's regular stock with a fixed price. */
export const regular = (it: Item | undefined): it is Item =>
  !!it && ITEMS[it.id] === it && it.ready !== false && it.price !== null && it.stock > 0 && it.shelf !== 'holiday' && !STREET.fixed.includes(it.id);
const DEALABLE = (): Item[] => Object.values(ITEMS).filter((i) => regular(i) && i.id !== 'rushorder');
/** Today's daily deal: the same item in every server. */
export function dailyDeal(now: number): string {
  const list = DEALABLE();
  let h = 2166136261;
  for (const c of dayKey(now)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return list[(h >>> 0) % list.length]!.id;
}

export interface Sale { off: number; why: 'deal' | 'friday' | 'featured' }
export function saleOn(it: Item | undefined, now: number): Sale | null {
  if (!regular(it)) return null;
  const sales: Sale[] = [];
  if (dailyDeal(now) === it.id) sales.push({ off: STREET.dailyDeal, why: 'deal' });
  if (isFriday(now)) sales.push(it.shelf === featuredShelf(now) ? { off: STREET.friday.featured, why: 'featured' } : { off: STREET.friday.rest, why: 'friday' });
  return sales.sort((a, b) => b.off - a.off)[0] ?? null;
}
export const saleLabel = (s: Sale, now: number): string =>
  (s.why === 'deal' ? 'daily deal' : s.why === 'featured' ? `Black Friday: ${SHELVES[featuredShelf(now)].label} shelf` : 'Black Friday');

// ---------------------------------------------------------------- loyalty

export const spentWith = (db: Db, g: string, u: string): Cents =>
  db.get<{ spent: number }>('SELECT spent FROM shop_loyalty WHERE guild_id = ? AND user_id = ?', g, u)?.spent ?? 0;
export const levelFor = (spent: Cents): Level => [...LOYALTY].reverse().find((l) => spent >= l.spent)!;
export const levelOf = (db: Db, g: string, u: string): Level => levelFor(spentWith(db, g, u));
export const levelIndex = (l: Level): number => LOYALTY.indexOf(l);
export const nextLevel = (l: Level): Level | null => LOYALTY[levelIndex(l) + 1] ?? null;
/** Adds to what a player has spent at Marquez's; returns the new level if this crossed one. */
export function addSpent(db: Db, g: string, u: string, cents: Cents): Level | null {
  const before = levelOf(db, g, u);
  db.run('INSERT INTO shop_loyalty (guild_id, user_id, spent) VALUES (?, ?, ?) ON CONFLICT (guild_id, user_id) DO UPDATE SET spent = spent + excluded.spent', g, u, cents);
  const after = levelOf(db, g, u);
  return after !== before ? after : null;
}

// ---------------------------------------------------------------- wishlists

export const wishlist = (db: Db, g: string, u: string): string[] =>
  db.all<{ item: string }>('SELECT item FROM shop_wish WHERE guild_id = ? AND user_id = ? ORDER BY at', g, u).map((r) => r.item);
export const onWishlist = (db: Db, g: string, u: string, id: string): boolean => !!db.get('SELECT 1 FROM shop_wish WHERE guild_id = ? AND user_id = ? AND item = ?', g, u, id);
export const unwish = (db: Db, g: string, u: string, id: string): void => { db.run('DELETE FROM shop_wish WHERE guild_id = ? AND user_id = ? AND item = ?', g, u, id); };
/** Adds an item; returns false if the list is full. */
export function wish(db: Db, g: string, u: string, id: string, now: number): boolean {
  if (onWishlist(db, g, u, id)) return true;
  if (wishlist(db, g, u).length >= STREET.wishMax) return false;
  db.run('INSERT INTO shop_wish (guild_id, user_id, item, at) VALUES (?, ?, ?, ?)', g, u, id, now);
  return true;
}

export interface WishNotice { userId: string; items: string[] }
/** Who to tell about a delivery's restocks, in two waves: Good Friends (and up) right away, everyone else after
 *  the head start. Each wave goes out once per delivery. */
export function wishNotices(db: Db, g: string, now: number): WishNotice[] {
  const slot = Number(db.meta(`shop.delivered:${g}`) ?? 0);
  if (!slot || now - slot > STREET.truckStaleMs) return [];
  const out: WishNotice[] = [];
  const friend = levelIndex(LOYALTY.find((l) => l.id === 'friend')!);
  const waves: [string, boolean][] = [[`shop.wish1:${g}`, true], [`shop.wish2:${g}`, now >= slot + STREET.headStartMs]];
  for (const [key, due] of waves) {
    if (!due || Number(db.meta(key) ?? 0) >= slot) continue;
    db.setMeta(key, slot);
    const early = key.startsWith('shop.wish1');
    const by = new Map<string, string[]>();
    for (const r of db.all<{ user_id: string; item: string }>('SELECT w.user_id, w.item FROM shop_wish w JOIN shop_stock s ON s.guild_id = w.guild_id AND s.item = w.item WHERE w.guild_id = ? AND s.stock > 0', g)) {
      if ((levelIndex(levelOf(db, g, r.user_id)) >= friend) !== early) continue;
      by.set(r.user_id, [...(by.get(r.user_id) ?? []), r.item]);
    }
    for (const [userId, items] of by) out.push({ userId, items });
  }
  return out;
}

// ---------------------------------------------------------------- the truck in chat

/** If a delivery is waiting to be announced (after the Good Friends' head start), takes it. */
export function truckDue(db: Db, g: string, now: number): number | null {
  const at = Number(db.meta(`shop.truck:${g}`) ?? 0);
  if (!at || now < at + STREET.headStartMs) return null;
  db.setMeta(`shop.truck:${g}`, 0);
  return now - at > STREET.truckStaleMs ? null : at;
}
