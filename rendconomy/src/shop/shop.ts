// Buying from Marquez: stock (shared by every server) restocks every hour, the Mystery price is rolled
// each restock, and one collectible is on sale each week, one per customer.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { HOUR, DAY } from '../core/time';
import { addItem, count } from './inventory';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ITEMS, ROTATION, anyItem, isCollectible, type Item } from './items';
import { isHoliday, season } from '../holidays/holidays';

export const SHOP_RULES = { restockMs: HOUR, weekMs: 7 * DAY, mystery: [75, 100] as const };

const week = (now: number) => Math.floor(now / SHOP_RULES.weekMs);
export const collectibleOfWeek = (now = Date.now()): string => ROTATION[week(now) % ROTATION.length]!;

/** Restocks if an hour has passed (and rolls a new Mystery price); the collectible restocks weekly. */
export function restock(db: Db, rng: Rng, now = Date.now()): number {
  return db.tx(() => {
    const wk = String(week(now));
    if (db.meta('shop.week') !== wk) {
      for (const id of ROTATION) setStock(db, id, id === collectibleOfWeek(now) ? COLLECTIBLES[id]!.stock : 0);
      db.setMeta('shop.week', wk);
    }
    const last = Number(db.meta('shop.restocked') ?? 0);
    if (now < last + SHOP_RULES.restockMs) return last;
    for (const it of Object.values(ITEMS)) setStock(db, it.id, it.stock);
    for (const it of Object.values(HOLIDAY_COLLECTIBLES)) setStock(db, it.id, isHoliday(now) ? it.stock : 0);
    db.setMeta('shop.mystery', polygons(rng.int(SHOP_RULES.mystery[0], SHOP_RULES.mystery[1])));
    db.setMeta('shop.restocked', now);
    return now;
  });
}

const setStock = (db: Db, id: string, n: number) => db.run('INSERT INTO shop_stock (item, stock) VALUES (?, ?) ON CONFLICT(item) DO UPDATE SET stock = excluded.stock', id, n);
export const stockOf = (db: Db, id: string): number => db.get<{ stock: number }>('SELECT stock FROM shop_stock WHERE item = ?', id)?.stock ?? 0;

export function priceOf(db: Db, id: string): Cents {
  const it = anyItem(id);
  if (!it) throw new Error(`Unknown item ${id}`);
  return it.price ?? (Number(db.meta('shop.mystery')) || polygons(SHOP_RULES.mystery[0]));
}

export type BuyFail = 'unknown' | 'unavailable' | 'soldOut' | 'broke' | 'once' | 'notThisWeek';
export class ShopError extends GameError { constructor(readonly why: BuyFail, message: string) { super(`shop.${why}`, message); } }

/** Buys `qty` of an item. Throws a ShopError (with Marquez's reason) if it can't. */
export function buy(db: Db, rng: Rng, guildId: string, userId: string, id: string, qty: number, now = Date.now()): { item: Item; qty: number; cost: Cents; cash: Cents } {
  restock(db, rng, now);
  const it = anyItem(id);
  if (!it) throw new ShopError('unknown', 'Marquez does not stock that.');
  if (!it.ready) throw new ShopError('unavailable', `${it.name} is not on sale yet.`);
  return db.tx(() => {
    if (it.shelf === 'holiday') {
      if (!isHoliday(now)) throw new ShopError('unavailable', `${it.name} is holiday stock. It's back in December.`);
      if (!it.stock) throw new ShopError('unavailable', `${it.name} isn't for sale. It's behind the last door of the advent calendar.`);
    }
    if (HOLIDAY_COLLECTIBLES[id]) {
      if (qty !== 1) throw new ShopError('once', 'Collectibles are one per customer.');
      const period = `holiday-${season(now)}`;
      if (db.get('SELECT 1 FROM shop_buys WHERE guild_id = ? AND user_id = ? AND item = ? AND period = ?', guildId, userId, id, period)) throw new ShopError('once', `You already have this year's ${it.name}.`);
      db.run('INSERT INTO shop_buys (guild_id, user_id, item, period) VALUES (?, ?, ?, ?)', guildId, userId, id, period);
    } else if (isCollectible(id)) {
      if (id !== collectibleOfWeek(now)) throw new ShopError('notThisWeek', `${it.name} is not on the special shelf this week.`);
      if (qty !== 1) throw new ShopError('once', 'Collectibles are one per customer.');
      const period = String(week(now));
      if (db.get('SELECT 1 FROM shop_buys WHERE guild_id = ? AND user_id = ? AND item = ? AND period = ?', guildId, userId, id, period)) throw new ShopError('once', 'You already bought this week\'s collectible.');
      db.run('INSERT INTO shop_buys (guild_id, user_id, item, period) VALUES (?, ?, ?, ?)', guildId, userId, id, period);
    }
    if (it.unlock) {
      if (qty !== 1) throw new ShopError('once', `${it.name} is one per customer.`);
      if (count(db, guildId, userId, id) > 0) throw new ShopError('once', `You already have ${it.name}. It's yours for good.`);
    }
    const left = stockOf(db, id);
    if (left < qty) throw new ShopError('soldOut', left ? `Only ${left} ${it.name} left in stock.` : `${it.name} is sold out. Stock returns ${'within the hour'}.`);
    const cost = priceOf(db, id) * qty;
    const w = wallet(guildId, userId);
    if (balance(db, w) < cost) throw new ShopError('broke', `${qty} × ${it.name} costs ${format(cost)}. The balance is ${format(balance(db, w))}.`);
    transfer(db, { from: w, to: RESERVE, cents: cost, reason: 'shop', guildId, actorId: userId, now, note: { item: id, qty } });
    db.run('UPDATE shop_stock SET stock = stock - ? WHERE item = ?', qty, id);
    addItem(db, guildId, userId, id, qty);
    emit('shop.bought', { guildId, userId, item: id, qty, cents: cost });
    return { item: it, qty, cost, cash: balance(db, w) };
  });
}
