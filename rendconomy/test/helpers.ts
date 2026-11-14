import { open } from '../src/core/db';
import { ensureReserve } from '../src/core/economy';
import { polygons } from '../src/core/money';

/** A fresh in-memory database with a funded Reserve. */
export function freshDb(reserve = polygons(25_000_000)) {
  const db = open(':memory:', { log: () => {} });
  ensureReserve(db, reserve, 0);
  return db;
}

/** A fixed instant from an Eastern wall-clock time, e.g. eastern('2026-11-13T23:59', -5). */
export const eastern = (local: string, offsetHours: number): number =>
  Date.parse(`${local}:00${offsetHours < 0 ? '-' : '+'}${String(Math.abs(offsetHours)).padStart(2, '0')}:00`);
