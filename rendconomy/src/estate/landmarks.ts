// Build It and They Will Come: each server funds landmarks together, one after another. Donations go into the
// Reserve (they leave players' hands for good), every finished landmark stands over the map and gives the whole
// server a perk, and the next one costs more.
import { award } from '../achievements/achievements';
import type { Db } from '../core/db';
import { RESERVE, transfer, wallet } from '../core/ledger';
import { addMoment } from '../core/moments';
import { polygons, type Cents } from '../core/money';
import { setLandmarkRent } from './estate';

export interface Landmark { id: 'statue' | 'stadium' | 'rocket'; name: string; emoji: string; cost: Cents; perk: string }
export const LANDMARKS: Landmark[] = [
  { id: 'statue', name: 'The TODD Statue', emoji: '🗿', cost: polygons(250_000), perk: '+5% rent on every building in the server' },
  { id: 'stadium', name: 'The Stadium', emoji: '🏟️', cost: polygons(1_000_000), perk: 'chat pay ×1.25 for everyone in the server' },
  { id: 'rocket', name: 'The Rocket', emoji: '🚀', cost: polygons(5_000_000), perk: 'the Rend-Sino\'s Rocket can fly to 100x (instead of 50x)' }
];
export const STATUE_RENT = 0.05;
export const STADIUM_CHAT = 1.25;

interface Row { guild_id: string; idx: number; funded: number; done_at: number | null }
const rows = (db: Db, g: string): Row[] => db.all<Row>('SELECT * FROM landmarks WHERE guild_id = ? ORDER BY idx', g);

/** Finished landmarks, in order. */
export const finished = (db: Db, g: string): Landmark[] => rows(db, g).filter((r) => r.done_at !== null).map((r) => LANDMARKS[r.idx]!).filter(Boolean);
export const isBuilt = (db: Db, g: string, id: Landmark['id']): boolean => finished(db, g).some((l) => l.id === id);
/** The landmark being funded now (null once all three stand), with how much is in. */
export function current(db: Db, g: string): { idx: number; l: Landmark; funded: Cents } | null {
  const done = finished(db, g).length;
  if (done >= LANDMARKS.length) return null;
  const r = rows(db, g).find((x) => x.idx === done);
  return { idx: done, l: LANDMARKS[done]!, funded: r?.funded ?? 0 };
}
export const donors = (db: Db, g: string, idx: number, n = 5) =>
  db.all<{ user_id: string; cents: number }>('SELECT user_id, cents FROM landmark_donors WHERE guild_id = ? AND idx = ? ORDER BY cents DESC LIMIT ?', g, idx, n);

export interface Donated { cents: Cents; finished: Landmark | null; idx: number; first: boolean }
/** Puts Polygons toward the current landmark (never more than it still needs). */
export function donate(db: Db, g: string, u: string, want: Cents, now: number): Donated {
  const c = current(db, g);
  if (!c) return { cents: 0, finished: null, idx: LANDMARKS.length, first: false };
  const cents = Math.min(want, c.l.cost - c.funded);
  if (cents <= 0) return { cents: 0, finished: null, idx: c.idx, first: false };
  transfer(db, { from: wallet(g, u), to: RESERVE, cents, reason: 'landmark.donate', guildId: g, actorId: u, now, note: { landmark: c.l.id } });
  const first = !db.get('SELECT 1 FROM landmark_donors WHERE guild_id = ? AND user_id = ? LIMIT 1', g, u);
  db.run('INSERT INTO landmarks (guild_id, idx, funded) VALUES (?, ?, ?) ON CONFLICT (guild_id, idx) DO UPDATE SET funded = funded + excluded.funded', g, c.idx, cents);
  db.run('INSERT INTO landmark_donors (guild_id, idx, user_id, cents) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, idx, user_id) DO UPDATE SET cents = cents + excluded.cents', g, c.idx, u, cents);
  award(db, g, u, 'brick_by_brick', now);
  let done: Landmark | null = null;
  if (c.funded + cents >= c.l.cost) {
    db.run('UPDATE landmarks SET done_at = ? WHERE guild_id = ? AND idx = ?', now, g, c.idx);
    done = c.l;
    const all = db.all<{ user_id: string; cents: number }>('SELECT user_id, cents FROM landmark_donors WHERE guild_id = ? AND idx = ? ORDER BY cents DESC', g, c.idx);
    for (const d of all) award(db, g, d.user_id, 'ribbon_cutting', now);
    if (all[0]) award(db, g, all[0].user_id, 'foreman', now);
    if (c.l.id === 'rocket') for (const d of all) award(db, g, d.user_id, 'we_have_liftoff', now);
    addMoment(`${c.l.emoji} A server just finished building ${c.l.name}`, now);
  }
  return { cents, finished: done, idx: c.idx, first };
}

let installed = false;
export function installLandmarks(): void {
  if (installed) return;
  installed = true;
  setLandmarkRent((db, g) => (isBuilt(db, g, 'statue') ? STATUE_RENT : 0));
}
