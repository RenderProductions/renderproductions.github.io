// Polygon Holidays: December only (Eastern time), switched on and off by the date alone.
//  - The advent calendar: one door a day from Dec 1 to 25 (per server, like balances). Missed doors can be
//    opened late, any time in December.
//  - Secret Santa (per server): sign up until Dec 14, pairs are drawn on Dec 15, gifts are held in escrow
//    and delivered on Christmas morning. Anyone whose Santa forgot gets a small present from Marquez.
//  - Limited collectibles and paints at Marquez's, gone after New Year (owned ones stay).
//  - Snow Day, a world event: no work, double chat pay.
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { ensureAccount, transfer, wallet, balance } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { dayKey } from '../core/time';
import { addItem } from '../shop/inventory';

export const HOLIDAY = { signupLastDay: 14, drawDay: 15, revealDay: 25, doors: 25, forgotten: polygons(250), giftMax: polygons(5000), giftMin: polygons(10) };

/** December, Eastern time. */
export function holidayDay(now = Date.now()): number { const k = dayKey(now); return k.slice(5, 7) === '12' ? Number(k.slice(8, 10)) : 0; }
export const isHoliday = (now = Date.now()): boolean => holidayDay(now) > 0;
/** The holiday season a date belongs to: December 2026 and January 2027 are both season 2026. */
export function season(now = Date.now()): number { const k = dayKey(now); const y = Number(k.slice(0, 4)); return k.slice(5, 7) === '12' ? y : y - 1; }

// ---------------------------------------------------------------- advent calendar
export interface Door { cents?: number; item?: string; qty?: number }
/** Behind each door. Collectibles on 6, 15, 20 and 23; the Star Topper only behind door 25. */
export const DOORS: Record<number, Door> = {
  1: { cents: 250 }, 2: { item: 'seed_carrot', qty: 3 }, 3: { item: 'coffee', qty: 2 }, 4: { cents: 300 }, 5: { item: 'lure' },
  6: { item: 'col_ornament' }, 7: { item: 'seed_corn', qty: 2 }, 8: { cents: 400 }, 9: { item: 'fertilizer', qty: 2 }, 10: { item: 'wrap' },
  11: { cents: 500 }, 12: { item: 'seed_tomato', qty: 2 }, 13: { item: 'mystery' }, 14: { cents: 600 }, 15: { item: 'col_snowglobe' },
  16: { item: 'seed_pumpkin', qty: 2 }, 17: { cents: 750 }, 18: { item: 'overtime' }, 19: { item: 'megaphone' }, 20: { item: 'col_gingerbread' },
  21: { cents: 1000 }, 22: { item: 'seed_polyfruit' }, 23: { item: 'col_nutcracker' }, 24: { cents: 1500 }, 25: { item: 'col_startopper', cents: 2500 }
};

export const openedDoors = (db: Db, guildId: string, userId: string, year: number): number[] =>
  db.all<{ day: number }>('SELECT day FROM holiday_doors WHERE guild_id = ? AND user_id = ? AND year = ? ORDER BY day', guildId, userId, year).map((r) => r.day);

/** Opens every door that's due and still shut. Returns what came out of each. */
export function openDoors(db: Db, guildId: string, userId: string, now: number): { day: number; door: Door; paid: Cents }[] {
  const today = Math.min(holidayDay(now), HOLIDAY.doors);
  if (!today) return [];
  const year = season(now);
  const done = new Set(openedDoors(db, guildId, userId, year));
  const out: { day: number; door: Door; paid: Cents }[] = [];
  for (let day = 1; day <= today; day++) {
    if (done.has(day)) continue;
    const door = DOORS[day]!;
    db.run('INSERT INTO holiday_doors (guild_id, user_id, year, day, opened_at) VALUES (?, ?, ?, ?, ?)', guildId, userId, year, day, now);
    if (door.item) addItem(db, guildId, userId, door.item, door.qty ?? 1);
    const paid = door.cents ? payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: polygons(door.cents), reason: 'holiday.advent', guildId, actorId: userId, now }) : 0;
    out.push({ day, door, paid });
  }
  return out;
}

// ---------------------------------------------------------------- Secret Santa
export interface Santa { guild_id: string; user_id: string; year: number; target_id: string | null; gift_cents: number; gift_item: string | null; note: string | null; gifted_at: number | null; delivered: number; told: number }
export const santaRow = (db: Db, guildId: string, userId: string, year: number): Santa | undefined =>
  db.get<Santa>('SELECT * FROM santa WHERE guild_id = ? AND user_id = ? AND year = ?', guildId, userId, year);
export const santaRows = (db: Db, guildId: string, year: number): Santa[] => db.all<Santa>('SELECT * FROM santa WHERE guild_id = ? AND year = ? ORDER BY user_id', guildId, year);
export const escrow = (guildId: string): string => `santa:${guildId}`;
export const drawn = (db: Db, guildId: string, year: number): string | null => db.meta(`santa.drawn:${guildId}:${year}`);

export const signupsOpen = (now: number): boolean => { const d = holidayDay(now); return d >= 1 && d <= HOLIDAY.signupLastDay; };
export function join(db: Db, guildId: string, userId: string, now: number): void {
  db.run('INSERT OR IGNORE INTO santa (guild_id, user_id, year) VALUES (?, ?, ?)', guildId, userId, season(now));
}
export function leave(db: Db, guildId: string, userId: string, now: number): boolean {
  return db.run('DELETE FROM santa WHERE guild_id = ? AND user_id = ? AND year = ? AND target_id IS NULL', guildId, userId, season(now)).changes > 0;
}

/**
 * Draws the pairs once sign-ups close: everyone is shuffled into one loop, so nobody draws themselves and
 * nobody knows who drew them. Needs at least 3 people; otherwise it's called off. Returns the server's state.
 */
export function draw(db: Db, guildId: string, now: number, rng: Rng): 'drawn' | 'cancelled' | 'waiting' {
  const year = season(now), done = drawn(db, guildId, year);
  if (done) return done as 'drawn' | 'cancelled';
  if (holidayDay(now) < HOLIDAY.drawDay && isHoliday(now)) return 'waiting';
  const rows = santaRows(db, guildId, year);
  if (!rows.length) return 'waiting';
  return db.tx(() => {
    if (rows.length < 3) { db.setMeta(`santa.drawn:${guildId}:${year}`, 'cancelled'); return 'cancelled' as const; }
    const ids = rows.map((r) => r.user_id);
    for (let i = ids.length - 1; i > 0; i--) { const j = rng.int(0, i); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
    ids.forEach((id, i) => db.run('UPDATE santa SET target_id = ? WHERE guild_id = ? AND user_id = ? AND year = ?', ids[(i + 1) % ids.length]!, guildId, id, year));
    db.setMeta(`santa.drawn:${guildId}:${year}`, 'drawn');
    return 'drawn' as const;
  });
}

/** Wraps a gift: Polygons go into escrow until Christmas, an item leaves the inventory. No fee. */
export function wrapGift(db: Db, guildId: string, userId: string, cents: Cents, item: string | null, note: string, now: number): void {
  const year = season(now);
  ensureAccount(db, escrow(guildId), 'escrow', guildId, null, now);
  if (cents > 0) transfer(db, { from: wallet(guildId, userId), to: escrow(guildId), cents, reason: 'holiday.santa', guildId, actorId: userId, now });
  db.run('UPDATE santa SET gift_cents = ?, gift_item = ?, note = ?, gifted_at = ? WHERE guild_id = ? AND user_id = ? AND year = ?', cents, item, note || null, now, guildId, userId, year);
}

export interface Delivery { to: string; from: string | null; cents: Cents; item: string | null; note: string | null }
/**
 * Christmas morning (or later, if the bot was asleep): every wrapped gift goes to its recipient. Anyone whose
 * Santa forgot gets a little something from Marquez. Each gift is delivered once.
 */
export function deliver(db: Db, guildId: string, now: number): Delivery[] {
  const year = season(now);
  if (drawn(db, guildId, year) !== 'drawn' || (isHoliday(now) && holidayDay(now) < HOLIDAY.revealDay)) return [];
  return db.tx(() => {
    const out: Delivery[] = [];
    for (const r of santaRows(db, guildId, year).filter((x) => !x.delivered && x.target_id)) {
      const to = r.target_id!;
      if (r.gifted_at) {
        if (r.gift_cents > 0) transfer(db, { from: escrow(guildId), to: wallet(guildId, to), cents: Math.min(r.gift_cents, balance(db, escrow(guildId))), reason: 'holiday.santa', guildId, actorId: r.user_id, now });
        if (r.gift_item) addItem(db, guildId, to, r.gift_item);
        out.push({ to, from: r.user_id, cents: r.gift_cents, item: r.gift_item, note: r.note });
      } else {
        const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, to), cents: HOLIDAY.forgotten, reason: 'holiday.santa', guildId, now });
        out.push({ to, from: null, cents: paid, item: null, note: null });
      }
      db.run('UPDATE santa SET delivered = 1 WHERE guild_id = ? AND user_id = ? AND year = ?', guildId, r.user_id, year);
    }
    return out;
  });
}

/** Servers with a Secret Santa this season. */
export const santaGuilds = (db: Db, year: number): string[] => db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM santa WHERE year = ?', year).map((r) => r.guild_id);


// ---------------------------------------------------------------- the background job (DMs)
export type Send = (userId: string, guildId: string, text: (server: string) => string) => void;
const giftText = (cents: Cents, item: string | null, name: (id: string) => string): string =>
  [cents > 0 ? `**${format(cents)}**` : null, item ? `a **${name(item)}**` : null].filter(Boolean).join(' and ');

/**
 * Runs every few minutes: draws the pairs once sign-ups close and tells everyone who they're shopping for,
 * and on Christmas morning delivers every gift. Safe to run as often as you like.
 */
export function holidayTick(db: Db, now: number, rng: Rng, send: Send, itemName: (id: string) => string, prefix: string): void {
  const year = season(now);
  for (const g of santaGuilds(db, year)) {
    const state = draw(db, g, now, rng);
    if (state === 'waiting') continue;
    for (const r of santaRows(db, g, year).filter((x) => !x.told)) {
      db.run('UPDATE santa SET told = 1 WHERE guild_id = ? AND user_id = ? AND year = ?', g, r.user_id, year);
      if (state === 'cancelled') send(r.user_id, g, (s) => `🎅 Secret Santa in **${s}** is off this year: it needs at least 3 people. Happy holidays all the same.`);
      else send(r.user_id, g, (s) => `🎅 **Secret Santa** in **${s}**: you're shopping for <@${r.target_id}>! Wrap something with \`${prefix}santa gift <amount> [item]\` before Christmas. It stays a secret until then.`);
    }
    for (const d of deliver(db, g, now)) {
      send(d.to, g, (s) => d.from
        ? `🎁 **Merry Christmas!** Your Secret Santa in **${s}** was <@${d.from}>. They gave you ${giftText(d.cents, d.item, itemName)}.${d.note ? `\n> ${d.note}` : ''}`
        : `🎁 **Merry Christmas!** Your Secret Santa in **${s}** forgot, so Marquez left something under the tree for you: **${format(d.cents)}**. "Happy holidays, friend."`);
    }
  }
}
