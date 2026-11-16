// One-time repairs to live data, run at startup. Each runs once (remembered in meta) and logs what it did.
// Add new ones to the end of FIXES; never change or reuse an id that has already shipped.
import type { Db } from './core/db';
import { format } from './core/money';
import { TAKEOVER, cancelBid, getCompany } from './companies/companies';

interface Fix { id: string; run: (db: Db, now: number) => string }
export const FIXES: Fix[] = [
  {
    // Nov 15, 2026: REND was hit by repeated takeover bids before the break fee and shield existed.
    id: '2026-11-15-rend-takeover',
    run(db, now) {
      const c = getCompany(db, 'REND');
      if (!c) return 'no company REND, nothing to do';
      const { bid, shield } = cancelBid(db, 'REND', now, TAKEOVER.shieldMs);
      return `${bid ? `removed the bid by ${bid.bidder_id} (refunded ${format(bid.premium)})` : 'no bid on it'}; shielded until ${new Date(shield!).toISOString()}`;
    }
  }
];

export function runFixes(db: Db, now = Date.now()): string[] {
  const done: string[] = [];
  for (const f of FIXES) {
    if (db.meta(`fix:${f.id}`)) continue;
    const what = db.tx(() => { const r = f.run(db, now); db.setMeta(`fix:${f.id}`, String(now)); return r; });
    done.push(`${f.id}: ${what}`);
  }
  return done;
}
