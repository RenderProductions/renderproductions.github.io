// Iso-Chess on the site (games/chess): what a player has unlocked, and a few Polygons for finished runs.
// The game runs in the browser, so the bot can't see it being played: payouts are small, capped per day,
// paid once per run, and a run that claims more than is possible (or was played impossibly fast) pays nothing.
import { economy } from '../config';
import { getProgress, setProgress } from '../achievements/achievements';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import { format, polygons } from '../core/money';
import { dayKey } from '../core/time';
import { ITEMS } from '../shop/items';
import { count } from '../shop/inventory';

export const CHESS = {
  pay: { battle: polygons(10), elite: polygons(25), boss: polygons(60), victory: polygons(150) },
  dailyCap: polygons(250),
  /** 3 acts: at most 15 fights before the bosses (5 rows each), 3 bosses */
  maxFights: 15, maxBosses: 3,
  /** nobody wins a battle faster than this */
  minSecondsPerFight: 30
};
export const UNLOCKS = Object.values(ITEMS).filter((i) => i.unlock).map((i) => i.id);

const today = (now: number) => Number(dayKey(now).replace(/-/g, ''));
function paidToday(db: Db, userId: string, now: number): number {
  return getProgress(db, userId, 'chess_day') === today(now) ? getProgress(db, userId, 'chess_paid') : 0;
}

export function chessStatus(db: Db, guildId: string, userId: string, now = Date.now()) {
  return {
    owned: UNLOCKS.filter((id) => count(db, guildId, userId, id) > 0),
    paid: paidToday(db, userId, now) / 100,
    cap: CHESS.dailyCap / 100
  };
}

export interface RunReport { id: string; b: number; e: number; x: number; v: number; t: number }

/** Pays for a finished run. Returns what to tell the player. */
export function chessFinish(db: Db, guildId: string, userId: string, raw: string, now = Date.now()): string {
  let r: RunReport;
  try { r = JSON.parse(raw); } catch { return 'That run report could not be read.'; }
  const n = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : -1);
  const b = n(r.b), e = n(r.e), x = n(r.x), t = n(r.t), v = r.v ? 1 : 0;
  const id = String(r.id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 40);
  if (!id || b < 0 || e < 0 || x < 0 || t < 0) return 'That run report could not be read.';
  if (db.meta(`chess.run:${id}`)) return 'This run has already been paid for.';
  db.setMeta(`chess.run:${id}`, String(now));
  const fights = b + e + x;
  if (b + e > CHESS.maxFights || x > CHESS.maxBosses || (v && x < CHESS.maxBosses) || t < fights * CHESS.minSecondsPerFight) {
    return 'Render\'s Vision looked at this run and didn\'t believe it. Nothing paid.';
  }
  const earned = b * CHESS.pay.battle + e * CHESS.pay.elite + x * CHESS.pay.boss + (v ? CHESS.pay.victory : 0);
  if (!earned) return 'Run recorded. Win a battle next time to earn some Polygons.';
  const before = paidToday(db, userId, now);
  const room = Math.max(0, CHESS.dailyCap - before);
  if (!room) return `Run recorded. You've already earned today's ${format(CHESS.dailyCap)} from Iso-Chess; come back tomorrow.`;
  const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: Math.min(earned, room), reason: 'chess', guildId, actorId: userId, now });
  setProgress(db, userId, 'chess_day', today(now));
  setProgress(db, userId, 'chess_paid', before + paid);
  return `Render's Vision paid you ${format(paid)} for this run${paid < earned ? ` (today's cap is ${format(CHESS.dailyCap)})` : ''}.`;
}
