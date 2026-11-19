// One-time repairs to live data, run at startup. Each runs once (remembered in meta) and logs what it did.
// Add new ones to the end of FIXES; never change or reuse an id that has already shipped.
import type { Db } from './core/db';
import { format } from './core/money';
import { TAKEOVER, cancelBid, getCompany } from './companies/companies';
import { RESERVE, transfer, wallet } from './core/ledger';
import { polygons } from './core/money';
import { addInbox } from './social/inbox';

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
  },
  {
    // Nov 18, 2026 (Farm Handiness Update): the Farmhand waters now, so the Sprinkler is gone. Owners get back
    // what Marquez charged (⬡2,500 each), and Marquez's stock of them is cleared.
    id: '2026-11-18-sprinklers',
    run(db, now) {
      const price = polygons(2500);
      const rows = db.all<{ guild_id: string; user_id: string; qty: number }>("SELECT guild_id, user_id, qty FROM inventory WHERE item = 'sprinkler' AND qty > 0");
      for (const r of rows) {
        transfer(db, { from: RESERVE, to: wallet(r.guild_id, r.user_id), cents: price * r.qty, reason: 'farm.refund', guildId: r.guild_id, actorId: r.user_id, now });
        addInbox(db, r.user_id, r.guild_id, 'Sprinkler refund', `Sprinklers are gone (your farmhand waters now). Marquez refunded ${format(price * r.qty)}.`, now);
      }
      db.run("DELETE FROM inventory WHERE item = 'sprinkler'");
      db.run("DELETE FROM shop_stock WHERE item = 'sprinkler'");
      return `refunded ${rows.length} ${rows.length === 1 ? 'owner' : 'owners'} (${rows.reduce((s, r) => s + r.qty, 0)} sprinklers)`;
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
