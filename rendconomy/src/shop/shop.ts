// Buying from Marquez: each server's shelves are filled by the delivery truck (Main Street), prices move with
// demand and sales, the Mystery price is rolled each delivery, and one collectible is on sale each week, one per customer.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { award } from '../achievements/achievements';
import { RESERVE, balance, transfer, wallet, ensureAccount } from '../core/ledger';
import { cityAccount, shopTax } from '../city/state';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { DAY, discordTime } from '../core/time';
import { STREET, TUNING, addSpent, lastDelivery, levelOf, nextDelivery, onWishlist, regular, saleOn, unwish, type Level, type Sale } from './street';
import { addItem, count, takeItem } from './inventory';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ITEMS, PARTY_ITEMS, ROTATION, anyItem, isCollectible, type Item } from './items';
import { nextParty, onPartyShelf, partyOf } from '../birthday/birthday';
import { isHoliday, season } from '../holidays/holidays';

export const SHOP_RULES = { weekMs: 7 * DAY, mystery: [75, 100] as const };

const week = (now: number) => Math.floor(now / SHOP_RULES.weekMs);
export const collectibleOfWeek = (now = Date.now()): string => ROTATION[week(now) % ROTATION.length]!;

interface StockRow { stock: number; back: number; factor: number; sold: number }
const rowOf = (db: Db, g: string, id: string): StockRow | undefined => db.get<StockRow>('SELECT stock, back, factor, sold FROM shop_stock WHERE guild_id = ? AND item = ?', g, id);
export const setStock = (db: Db, g: string, id: string, n: number, extra: Partial<StockRow> = {}) => {
  const r = rowOf(db, g, id);
  db.run('INSERT INTO shop_stock (guild_id, item, stock, back, factor, sold) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (guild_id, item) DO UPDATE SET stock = excluded.stock, back = excluded.back, factor = excluded.factor, sold = excluded.sold',
    g, id, n, extra.back ?? r?.back ?? 0, extra.factor ?? r?.factor ?? 1, extra.sold ?? r?.sold ?? 0);
};
export const stockOf = (db: Db, g: string, id: string): number => rowOf(db, g, id)?.stock ?? 0;
export const backOf = (db: Db, g: string, id: string): number => rowOf(db, g, id)?.back ?? 0;
export const factorOf = (db: Db, g: string, id: string): number => rowOf(db, g, id)?.factor ?? 1;
/** The back room's stock for an item: as many again for the rare ones (Family only). */
export const backStock = (it: Item): number => (regular(it) && it.stock <= STREET.rareAt ? it.stock : 0);

/** Main Street: each server has its own shelves, filled by Marquez's delivery truck (3 times a day). At each
 *  delivery, prices move with demand. Returns when the shelves were last filled and whether this call filled them. */
export function restock(db: Db, rng: Rng, g: string, now = Date.now()): { at: number; delivered: boolean } {
  return db.tx(() => {
    const wk = String(week(now));
    if (db.meta(`shop.week:${g}`) !== wk) {
      for (const id of ROTATION) setStock(db, g, id, id === collectibleOfWeek(now) ? COLLECTIBLES[id]!.stock : 0);
      db.setMeta(`shop.week:${g}`, wk);
    }
    const slot = lastDelivery(now);
    const last = Number(db.meta(`shop.delivered:${g}`) ?? 0);
    if (last >= slot) return { at: last, delivered: false };
    const first = !last;
    const F = STREET.factor;
    for (const it of Object.values(ITEMS)) {
      const r = rowOf(db, g, it.id);
      let factor = r?.factor ?? 1;
      if (r && regular(it)) {
        if (r.sold >= it.stock) factor += F.up;
        else if (r.sold < it.stock * F.slowBelow) factor -= F.down;
        else factor += Math.sign(1 - factor) * Math.min(F.drift, Math.abs(1 - factor));
        factor = Math.round(Math.min(F.max, Math.max(F.min, factor)) * 100) / 100;
      }
      setStock(db, g, it.id, it.stock, { back: backStock(it), factor: regular(it) ? factor : 1, sold: 0 });
    }
    for (const it of Object.values(HOLIDAY_COLLECTIBLES)) setStock(db, g, it.id, isHoliday(now) ? it.stock : 0);
    for (const it of Object.values(PARTY_ITEMS)) setStock(db, g, it.id, onPartyShelf(it.id, now) ? it.stock : 0);
    db.setMeta(`shop.mystery:${g}`, polygons(rng.int(SHOP_RULES.mystery[0], SHOP_RULES.mystery[1])));
    db.setMeta(`shop.delivered:${g}`, slot);
    if (!first) db.setMeta(`shop.truck:${g}`, slot);
    return { at: slot, delivered: !first };
  });
}

/** A Rush Order: one regular item back to its full stock in this server. Returns how many were added. */
export function restockOne(db: Db, g: string, id: string): number {
  const it = ITEMS[id];
  if (!it || it.ready === false || id === 'rushorder') return 0;
  const before = stockOf(db, g, id);
  if (before >= it.stock) return 0;
  setStock(db, g, id, it.stock);
  return it.stock - before;
}

/** An item's list price, before demand and discounts (the Mystery box's is rolled at each delivery). */
export function priceOf(db: Db, g: string, id: string): Cents {
  const it = anyItem(id);
  if (!it) throw new Error(`Unknown item ${id}`);
  return it.price ?? (Number(db.meta(`shop.mystery:${g}`)) || polygons(SHOP_RULES.mystery[0]));
}

export interface Quote { base: Cents; shelf: Cents; each: Cents; factor: number; sale: Sale | null; loyalty: number }
/** What one costs this player right now: the list price, moved by demand, then the best sale, then their
 *  loyalty discount. Collectibles, the Mystery box and the Title are never discounted. */
export function quote(db: Db, g: string, id: string, userId: string | null, now = Date.now()): Quote {
  const base = priceOf(db, g, id);
  const it = ITEMS[id];
  if (!regular(it) || !TUNING.prices) return { base, shelf: base, each: base, factor: 1, sale: null, loyalty: 0 };
  const factor = factorOf(db, g, id);
  const shelf = Math.round(base * factor);
  const sale = saleOn(it, now);
  const loyalty = userId ? levelOf(db, g, userId).off : 0;
  const each = Math.max(1, Math.floor(shelf * (1 - (sale?.off ?? 0)) * (1 - loyalty)));
  return { base, shelf, each, factor, sale, loyalty };
}

/** Refined Everything!: Marquez buys things back at a share of his price (well under it, so buying and selling
 *  back never pays) and puts them back on his shelf. Not collectibles (trade those), not fish or crops (they
 *  have their own buyers), not Goods. */
export const SELL_BACK = 0.4;
export function sellBackPrice(db: Db, g: string, id: string): Cents { return Math.floor(priceOf(db, g, id) * SELL_BACK); }
export function sellBack(db: Db, guildId: string, userId: string, id: string, qty: number, now = Date.now()): { item: Item; qty: number; paid: Cents; cash: Cents } {
  const it = ITEMS[id];
  if (!it || it.ready === false) throw new GameError('sell.no', isCollectible(id) ? `Marquez doesn't buy collectibles back. Trade them with other players: \`/trade\`.` : 'Marquez doesn\'t buy that.');
  return db.tx(() => {
    const have = count(db, guildId, userId, id);
    if (have < qty) throw new GameError('sell.short', have ? `You have ${have} × ${it.name}.` : `You don't have any ${it.name}.`);
    const each = sellBackPrice(db, guildId, id), paid = each * qty;
    if (balance(db, RESERVE) < paid) throw new GameError('reserve.empty', 'The Reserve is too low for Marquez to buy anything back right now.');
    takeItem(db, guildId, userId, id, qty);
    if (paid > 0) transfer(db, { from: RESERVE, to: wallet(guildId, userId), cents: paid, reason: 'shop.sellback', guildId, actorId: userId, now, note: { item: id, qty } });
    db.run('UPDATE shop_stock SET stock = MIN(stock + ?, ?) WHERE guild_id = ? AND item = ?', qty, it.stock, guildId, id);
    return { item: it, qty, paid, cash: balance(db, wallet(guildId, userId)) };
  });
}

export type BuyFail = 'unknown' | 'unavailable' | 'soldOut' | 'broke' | 'once' | 'notThisWeek';
export class ShopError extends GameError { constructor(readonly why: BuyFail, message: string) { super(`shop.${why}`, message); } }

/** Buys `qty` of an item. Throws a ShopError (with Marquez's reason) if it can't. */
export interface Bought { item: Item; qty: number; cost: Cents; tax: Cents; cash: Cents; quote: Quote; fromBack: number; level: Level | null; wished: boolean }
export function buy(db: Db, rng: Rng, guildId: string, userId: string, id: string, qty: number, now = Date.now()): Bought {
  restock(db, rng, guildId, now);
  const it = anyItem(id);
  if (!it) throw new ShopError('unknown', 'Marquez does not stock that.');
  if (!it.ready) throw new ShopError('unavailable', `${it.name} is not on sale yet.`);
  return db.tx(() => {
    if (it.shelf === 'party') {
      const p = partyOf(now);
      if (!p) throw new ShopError('unavailable', `${it.name} is party stock. It's back for the next birthday (${nextParty(now).at}).`);
      if (!onPartyShelf(id, now)) throw new ShopError('unavailable', `${it.name} isn't on the Party shelf this time.`);
      if (id.startsWith('col_')) {
        if (qty !== 1) throw new ShopError('once', 'Collectibles are one per customer.');
        const period = `party-${p.key}`;
        if (db.get('SELECT 1 FROM shop_buys WHERE guild_id = ? AND user_id = ? AND item = ? AND period = ?', guildId, userId, id, period)) throw new ShopError('once', `You already have a ${it.name} from this party.`);
        db.run('INSERT INTO shop_buys (guild_id, user_id, item, period) VALUES (?, ?, ?, ?)', guildId, userId, id, period);
      }
    } else if (it.shelf === 'holiday') {
      if (!isHoliday(now)) throw new ShopError('unavailable', `${it.name} is holiday stock. It's back in December.`);
      if (!it.stock) throw new ShopError('unavailable', `${it.name} isn't for sale. It's behind the last door of the advent calendar.`);
    }
    if (it.shelf === 'party') { /* checked above */ } else if (HOLIDAY_COLLECTIBLES[id]) {
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
    const family = levelOf(db, guildId, userId).id === 'family';
    const left = stockOf(db, guildId, id), back = family ? backOf(db, guildId, id) : 0;
    if (left + back < qty) {
      const when = `The truck brings more ${discordTime(nextDelivery(now))}.`;
      throw new ShopError('soldOut', left + back ? `Only ${left + back} ${it.name} left${back ? ', counting the back room' : ''}.` : `${it.name} is sold out. ${when}`);
    }
    const q = quote(db, guildId, id, userId, now);
    const cost = q.each * qty;
    const w = wallet(guildId, userId);
    // Under New Management: the mayor's sales tax, on top, into the city treasury
    const tax = Math.floor(cost * shopTax(db, guildId, now));
    if (balance(db, w) < cost + tax) throw new ShopError('broke', `${qty} × ${it.name} costs ${format(cost)}${tax ? ` plus ${format(tax)} sales tax` : ''}. The balance is ${format(balance(db, w))}.`);
    transfer(db, { from: w, to: RESERVE, cents: cost, reason: 'shop', guildId, actorId: userId, now, note: { item: id, qty } });
    if (tax > 0) { ensureAccount(db, cityAccount(guildId), 'city', guildId, null, now); transfer(db, { from: w, to: cityAccount(guildId), cents: tax, reason: 'city.tax.shop', guildId, actorId: userId, now, note: { item: id } }); }
    const fromShelf = Math.min(left, qty), fromBack = qty - fromShelf;
    db.run('UPDATE shop_stock SET stock = stock - ?, back = back - ?, sold = sold + ? WHERE guild_id = ? AND item = ?', fromShelf, fromBack, qty, guildId, id);
    addItem(db, guildId, userId, id, qty);
    const level = addSpent(db, guildId, userId, cost);
    const wished = onWishlist(db, guildId, userId, id);
    if (wished) unwish(db, guildId, userId, id);
    const award1 = (a: string) => award(db, guildId, userId, a, now);
    const levelAward = level ? ({ familiar: 'familiar_face', regular: 'regular_customer', friend: 'good_friend', family: 'part_of_the_family' } as Record<string, string>)[level.id] : undefined;
    if (levelAward) award1(levelAward);
    if (q.sale?.why === 'deal') award1('bargain_hunter');
    if (q.sale?.why === 'featured') award1('doorbuster');
    if (wished) award1('worth_the_wait');
    if (fromBack) award1('in_the_back');
    emit('shop.bought', { guildId, userId, item: id, qty, cents: cost, sale: q.sale?.why ?? null, level: level?.id ?? null, wished, fromBack });
    return { item: it, qty, cost: cost + tax, tax, cash: balance(db, w), quote: q, fromBack, level, wished };
  });
}
