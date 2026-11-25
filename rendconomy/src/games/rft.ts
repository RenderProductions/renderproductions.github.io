// Render's File Tycoon on the site (games/rft): cashing out what you earned in the game into your RendConomy
// wallet, and the game's achievements. The game runs in the browser, so the bot can't watch it: the rate is low
// and there's a daily cap. What's been credited is remembered per player, so the same earnings never pay twice.
import { economy } from '../config';
import { award, getProgress, setProgress } from '../achievements/achievements';
import { BY_ID } from '../achievements/list';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import { format, polygons } from '../core/money';
import { dayKey } from '../core/time';

export const RFT = {
  /** ⬡5 to your wallet for every ⬡1,000 earned in the game (the user, Nov 24). */
  perThousand: polygons(5),
  dailyCap: polygons(500),
  /** No honest game gets near this. */
  maxEarned: 1e15,
  achievements: ['rft_first_byte', 'rft_six_figures', 'rft_gregulator', 'rft_fresh_install', 'rft_contractor', 'rft_backdoor']
};

const today = (now: number) => Number(dayKey(now).replace(/-/g, ''));
const paidToday = (db: Db, u: string, now: number) => (getProgress(db, u, 'rft_day') === today(now) ? getProgress(db, u, 'rft_paid') : 0);
/** Game ⬡ that has already been turned into wallet Polygons. */
const credited = (db: Db, u: string) => getProgress(db, u, 'rft_credited');

export function rftStatus(db: Db, userId: string, now = Date.now()) {
  return {
    paid: paidToday(db, userId, now) / 100, cap: RFT.dailyCap / 100, credited: credited(db, userId), perThousand: RFT.perThousand / 100,
    achievements: RFT.achievements.filter((id) => db.get('SELECT 1 FROM achievements WHERE user_id = ? AND id = ?', userId, id))
  };
}

/** Pays for game ⬡ earned since the last cash-out, up to today's cap. Returns what to tell the player. */
export function rftCashout(db: Db, guildId: string, userId: string, raw: string, now = Date.now()): string {
  let earned: number;
  try { earned = Number((JSON.parse(raw) as { earned?: unknown }).earned); } catch { return 'That cash-out could not be read.'; }
  if (!Number.isFinite(earned) || earned < 0 || earned > RFT.maxEarned) return 'RendConomy looked at those numbers and didn\'t believe them. Nothing paid.';
  earned = Math.floor(earned);
  const fresh = earned - credited(db, userId);
  if (fresh < 1000) return `Nothing new to cash out yet: every ⬡1,000 you earn in the game is worth ${format(RFT.perThousand)}.`;
  const thousands = Math.floor(fresh / 1000);
  const before = paidToday(db, userId, now);
  const room = Math.max(0, RFT.dailyCap - before);
  if (!room) return `You've already cashed out today's ${format(RFT.dailyCap)}. The rest keeps until tomorrow.`;
  const want = Math.min(thousands * RFT.perThousand, room - (room % RFT.perThousand));
  if (want <= 0) return `You've already cashed out today's ${format(RFT.dailyCap)}. The rest keeps until tomorrow.`;
  const paid = payFromReserve(db, economy.reserveStart, { to: wallet(guildId, userId), cents: want, reason: 'rft', guildId, actorId: userId, now });
  if (paid <= 0) return 'The Polygon Reserve is too low to pay out right now. Your earnings keep.';
  setProgress(db, userId, 'rft_credited', credited(db, userId) + Math.ceil(paid / RFT.perThousand) * 1000);
  setProgress(db, userId, 'rft_day', today(now));
  setProgress(db, userId, 'rft_paid', before + paid);
  const left = fresh - Math.ceil(paid / RFT.perThousand) * 1000;
  return `RendConomy paid ${format(paid)} into your wallet.${left >= 1000 ? ` Today's cap is ${format(RFT.dailyCap)}; the rest keeps until tomorrow.` : ''}`;
}

/** The game says you earned one of its achievements. */
export function rftAchieve(db: Db, guildId: string, userId: string, id: string, now = Date.now()): string {
  if (!RFT.achievements.includes(id) || !BY_ID[id]) return 'Unknown achievement.';
  const line = award(db, guildId, userId, id, now);
  return line || 'Already unlocked.';
}
