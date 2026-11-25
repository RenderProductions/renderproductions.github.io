// Main Street: player stores. Every finished Corner Shop is a store its owner stocks from their inventory and
// prices however they like (no cap: beating Marquez takes being smart about it). Buyers pay the price plus the
// mayor's sales tax; the owner keeps the price.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { award } from '../achievements/achievements';
import { balance, ensureAccount, transfer, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import { cityAccount, shopTax } from '../city/state';
import { lotsOf, tileName, type Lot } from '../estate/estate';
import { addInbox } from '../social/inbox';
import { addItem, count, takeItem } from './inventory';

export const STORES = {
  /** Shelf slots by Corner Shop level. */
  slots: [4, 6, 8],
  /** Below this condition (or with squatters) the store is closed until repaired. */
  minCondition: 25,
  maxPrice: 100_000_000_00,
  bigSeller: 10_000_000,
  emptiedForAward: 10
};

export interface Listing { id: number; guild_id: string; owner_id: string; lot: number; item: string; qty: number; price: Cents; listed_at: number }

/** The owner's finished Corner Shops (their stores), open or not. */
export const storesOf = (db: Db, g: string, owner: string, now: number): Lot[] =>
  lotsOf(db, g, now).filter((l) => l.kind === 'shop' && l.owner_id === owner && l.status === 'owned' && l.build_until <= now);
export const isOpen = (l: Lot): boolean => l.condition >= STORES.minCondition && !l.squatters;
export const slotsOf = (l: Lot): number => STORES.slots[Math.min(STORES.slots.length, Math.max(1, l.level)) - 1]!;

export const listings = (db: Db, g: string, owner?: string): Listing[] => owner
  ? db.all<Listing>('SELECT * FROM store_shelf WHERE guild_id = ? AND owner_id = ? ORDER BY lot, id', g, owner)
  : db.all<Listing>('SELECT * FROM store_shelf WHERE guild_id = ? ORDER BY owner_id, lot, id', g);

/** Listings whose Corner Shop is gone (sold, torn down, condemned) go back to the owner's inventory. */
export function sweepStores(db: Db, g: string, now: number, name: (id: string) => string = (x) => x): number {
  let n = 0;
  const shops = new Set(lotsOf(db, g, now).filter((l) => l.kind === 'shop' && l.status === 'owned').map((l) => `${l.owner_id}:${l.lot}`));
  for (const l of listings(db, g)) {
    if (shops.has(`${l.owner_id}:${l.lot}`)) continue;
    addItem(db, g, l.owner_id, l.item, l.qty);
    db.run('DELETE FROM store_shelf WHERE id = ?', l.id);
    addInbox(db, l.owner_id, g, 'Store closed', `Your Corner Shop on ${tileName(l.lot)} is gone, so ${l.qty} × ${name(l.item)} went back to your inventory.`, now);
    n++;
  }
  return n;
}

/** Puts items on a store shelf. The same item already listed by this owner gets the new price and the extra
 *  units (and stays in its store); a new item takes a free slot (in `lot` if given). */
export function stock(db: Db, g: string, owner: string, item: string, qty: number, price: Cents, now: number, lot?: number): Listing {
  if (!Number.isInteger(qty) || qty < 1) throw new GameError('store.qty', 'Stock at least 1.');
  if (!Number.isInteger(price) || price < 1 || price > STORES.maxPrice) throw new GameError('store.price', `Pick a price between ⬡0.01 and ${format(STORES.maxPrice)}.`);
  return db.tx(() => {
    sweepStores(db, g, now);
    const shops = storesOf(db, g, owner, now);
    if (!shops.length) throw new GameError('store.none', 'You need a finished Corner Shop to run a store. Build one on the map.');
    if (count(db, g, owner, item) < qty) throw new GameError('store.short', `You have ${count(db, g, owner, item)} of those.`);
    const mine = listings(db, g, owner);
    const same = mine.find((l) => l.item === item);
    takeItem(db, g, owner, item, qty);
    if (same) {
      db.run('UPDATE store_shelf SET qty = qty + ?, price = ? WHERE id = ?', qty, price, same.id);
      return { ...same, qty: same.qty + qty, price };
    }
    const pick = shops.filter((l) => lot === undefined || l.lot === lot).find((l) => mine.filter((x) => x.lot === l.lot).length < slotsOf(l));
    if (!pick) {
      addItem(db, g, owner, item, qty);
      throw new GameError('store.full', lot !== undefined && !shops.some((l) => l.lot === lot)
        ? `You don't have a finished Corner Shop on ${tileName(lot)}.`
        : `Every shelf slot is taken (${shops.map((l) => `${tileName(l.lot)}: ${slotsOf(l)}`).join(', ')}). Upgrade a Corner Shop for more, or take something down.`);
    }
    const id = Number(db.run('INSERT INTO store_shelf (guild_id, owner_id, lot, item, qty, price, listed_at) VALUES (?, ?, ?, ?, ?, ?, ?)', g, owner, pick.lot, item, qty, price, now).lastInsertRowid);
    return { id, guild_id: g, owner_id: owner, lot: pick.lot, item, qty, price, listed_at: now };
  });
}

/** Takes items back off the shelf into the inventory. */
export function unstock(db: Db, g: string, owner: string, item: string, qty: number | 'all'): { item: string; qty: number } {
  return db.tx(() => {
    const l = listings(db, g, owner).find((x) => x.item === item);
    if (!l) throw new GameError('store.unlisted', 'That isn\'t on your shelves.');
    const n = qty === 'all' ? l.qty : Math.min(qty, l.qty);
    if (n >= l.qty) db.run('DELETE FROM store_shelf WHERE id = ?', l.id);
    else db.run('UPDATE store_shelf SET qty = qty - ? WHERE id = ?', n, l.id);
    addItem(db, g, owner, item, n);
    return { item, qty: n };
  });
}

export interface StoreSale { listing: Listing; qty: number; cost: Cents; tax: Cents; cash: Cents; emptied: boolean }
/** Buys from a player's store. */
export function buyFrom(db: Db, g: string, buyer: string, listingId: number, qty: number, now: number): StoreSale {
  return db.tx(() => {
    sweepStores(db, g, now);
    const l = db.get<Listing>('SELECT * FROM store_shelf WHERE id = ? AND guild_id = ?', listingId, g);
    if (!l) throw new GameError('store.gone', 'That\'s already gone.');
    if (l.owner_id === buyer) throw new GameError('store.self', 'That\'s your own shelf. Take it back with `shop unstock`.');
    const shop = storesOf(db, g, l.owner_id, now).find((x) => x.lot === l.lot);
    if (!shop || !isOpen(shop)) throw new GameError('store.closed', 'That store is closed until its owner fixes the place up.');
    if (qty < 1 || qty > l.qty) throw new GameError('store.qty', `There ${l.qty === 1 ? 'is' : 'are'} only ${l.qty} on the shelf.`);
    const cost = l.price * qty;
    const tax = Math.floor(cost * shopTax(db, g, now));
    const w = wallet(g, buyer);
    if (balance(db, w) < cost + tax) throw new GameError('funds.short', `That's ${format(cost)}${tax ? ` plus ${format(tax)} sales tax` : ''}. You have ${format(balance(db, w))}.`);
    ensureAccount(db, wallet(g, l.owner_id), 'wallet', g, l.owner_id, now);
    transfer(db, { from: w, to: wallet(g, l.owner_id), cents: cost, reason: 'store.sale', guildId: g, actorId: buyer, now, note: { item: l.item, qty, store: l.lot } });
    if (tax > 0) { ensureAccount(db, cityAccount(g), 'city', g, null, now); transfer(db, { from: w, to: cityAccount(g), cents: tax, reason: 'city.tax.shop', guildId: g, actorId: buyer, now, note: { item: l.item } }); }
    const emptied = qty === l.qty;
    if (emptied) db.run('DELETE FROM store_shelf WHERE id = ?', l.id);
    else db.run('UPDATE store_shelf SET qty = qty - ? WHERE id = ?', qty, l.id);
    addItem(db, g, buyer, l.item, qty);
    db.run(`INSERT INTO store_totals (guild_id, user_id, sales, cents, emptied) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (guild_id, user_id) DO UPDATE SET sales = sales + excluded.sales, cents = cents + excluded.cents, emptied = emptied + excluded.emptied`, g, l.owner_id, qty, cost, emptied ? 1 : 0);
    const t = totalsOf(db, g, l.owner_id);
    if (t.sales === qty) award(db, g, l.owner_id, 'grand_opening', now);
    if (t.emptied >= STORES.emptiedForAward) award(db, g, l.owner_id, 'cleaned_out', now);
    if (t.cents >= STORES.bigSeller) award(db, g, l.owner_id, 'shopkeeper', now);
    emit('store.sold', { guildId: g, userId: l.owner_id, buyerId: buyer, item: l.item, qty, cents: cost, sales: t.sales, emptied: t.emptied });
    return { listing: l, qty, cost, tax, cash: balance(db, w), emptied };
  });
}

export const totalsOf = (db: Db, g: string, u: string): { sales: number; cents: Cents; emptied: number } =>
  db.get<{ sales: number; cents: number; emptied: number }>('SELECT sales, cents, emptied FROM store_totals WHERE guild_id = ? AND user_id = ?', g, u) ?? { sales: 0, cents: 0, emptied: 0 };
