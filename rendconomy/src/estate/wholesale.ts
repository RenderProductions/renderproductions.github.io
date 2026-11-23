// Wholesale (KorbedOut's idea): a Warehouse can order seeds straight from the supplier, with its own daily
// allowance, so stocking up doesn't mean fighting the whole server over Marquez's shelf (Polygon Fruit is only 2 a
// restock). It costs a little more than Marquez, and it never touches his stock.
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import { dayKey } from '../core/time';
import { CROPS, type Crop } from '../farming/farming';
import { addItem } from '../shop/inventory';

export const WHOLESALE = {
  markup: 0.1,
  /** Seeds a day of each kind, by Warehouse level (Polygon Fruit has its own, smaller allowance). */
  perDay: [10, 25, 50],
  polyfruitPerDay: [3, 6, 10]
};

export const wholesalePrice = (c: Crop): Cents => Math.ceil(polygons(c.seedPrice) * (1 + WHOLESALE.markup));
export const allowance = (c: Crop, level: number): number => level < 1 ? 0 : (c.id === 'polyfruit' ? WHOLESALE.polyfruitPerDay : WHOLESALE.perDay)[Math.min(level, 3) - 1]!;
const key = (g: string, u: string, c: Crop, now: number) => `wholesale:${g}:${u}:${c.id}:${dayKey(now)}`;
export const boughtToday = (db: Db, g: string, u: string, c: Crop, now = Date.now()): number => Number(db.meta(key(g, u, c, now)) ?? 0);

/** Buys seeds with a Warehouse of the given level. Throws if over today's allowance or short of money. */
export function buyWholesale(db: Db, g: string, u: string, c: Crop, qty: number, level: number, now = Date.now()): { qty: number; cost: Cents; left: number } {
  const cap = allowance(c, level);
  if (!cap) throw new GameError('wholesale.none', 'Wholesale needs a finished Warehouse.');
  const left = cap - boughtToday(db, g, u, c, now);
  if (left <= 0) throw new GameError('wholesale.limit', `You've ordered your ${cap} ${c.name} seeds for today. The supplier restocks you at midnight Eastern.`);
  if (qty > left) throw new GameError('wholesale.limit', `You can order ${left} more ${c.name} seeds today (${cap} a day at your Warehouse's level).`);
  const cost = wholesalePrice(c) * qty, w = wallet(g, u);
  if (balance(db, w) < cost) throw new GameError('funds.short', `${qty} ${c.name} seeds cost ${format(cost)} wholesale. You have ${format(balance(db, w))}.`);
  return db.tx(() => {
    transfer(db, { from: w, to: RESERVE, cents: cost, reason: 'wholesale', guildId: g, actorId: u, now, note: { seed: c.id, qty } });
    addItem(db, g, u, `seed_${c.id}`, qty);
    db.setMeta(key(g, u, c, now), String(boughtToday(db, g, u, c, now) + qty));
    return { qty, cost, left: left - qty };
  });
}

/** "polyfruit", "polygon fruit", "carrot seeds", "pumpkins" → the crop. */
export function findCrop(text: string): Crop | null {
  const t = String(text ?? '').toLowerCase().replace(/\bseeds?\b/g, '').replace(/[^a-z ]/g, '').trim();
  if (!t) return null;
  return Object.values(CROPS).find((c) => [c.id, c.name, c.plural].some((n) => n.toLowerCase() === t || n.toLowerCase().replace(/ /g, '') === t.replace(/ /g, '')) || (t.length >= 3 && c.name.toLowerCase().startsWith(t))) ?? null;
}
