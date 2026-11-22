// One-time repairs to live data, run at startup. Each runs once (remembered in meta) and logs what it did.
// Add new ones to the end of FIXES; never change or reuse an id that has already shipped.
import type { Db } from './core/db';
import { format } from './core/money';
import { TAKEOVER, cancelBid, getCompany } from './companies/companies';
import { RESERVE, balance, escrow, transfer, wallet } from './core/ledger';
import { polygons } from './core/money';
import { addInbox } from './social/inbox';
import { award } from './achievements/achievements';

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
    // Refined Everything!: player-company pay follows the share price against the IPO price, which wasn't stored.
    // For companies already public, the oldest price still in their history is the best record of it.
    id: '2026-11-21-ipo-prices',
    run(db) {
      const rows = db.all<{ ticker: string; history: string; price: number }>("SELECT ticker, history, price FROM companies WHERE status = 'public'");
      for (const r of rows) { const h = JSON.parse(r.history) as number[]; db.setMeta(`co.ipo_price:${r.ticker}`, String(h[0] || r.price)); }
      return `${rows.length} public ${rows.length === 1 ? 'company' : 'companies'}`;
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
  },
  {
    // Nov 19, 2026 (Oh My God, 2 in 1!): the 15 fixed lots of Room to Grow are plowed down for the empty city
    // map. Every owner gets back the full list price of each lot, every open bid comes back out of escrow, and
    // everyone involved gets Eminent Domain and an inbox note. Then the old table goes.
    id: '2026-11-19-plow',
    run(db, now) {
      if (!db.get("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'estates_old'")) return 'no old lots, nothing to do';
      const PRICE: Record<string, number> = { shack: 2_500, apartment: 8_000, shop: 20_000, lighthouse: 45_000, mansion: 120_000 };
      const NAME: Record<string, string> = { shack: 'Shack', apartment: 'Apartment', shop: 'Corner Shop', lighthouse: 'Lighthouse', mansion: 'Mansion' };
      const rows = db.all<{ guild_id: string; lot: number; kind: string; owner_id: string | null; status: string; bidder_id: string | null; bid_cents: number }>('SELECT * FROM estates_old');
      const told = new Map<string, { guild: string; user: string; lots: string[]; refund: number; bids: number }>();
      const note = (g: string, u: string) => { const k = `${g}:${u}`; if (!told.has(k)) told.set(k, { guild: g, user: u, lots: [], refund: 0, bids: 0 }); return told.get(k)!; };
      let refunded = 0, bids = 0;
      for (const r of rows) {
        if (r.status === 'owned' && r.owner_id) {
          const cents = polygons(PRICE[r.kind] ?? 0);
          if (cents > 0) transfer(db, { from: RESERVE, to: wallet(r.guild_id, r.owner_id), cents, reason: 'estate.plowed', guildId: r.guild_id, actorId: r.owner_id, now, note: { lot: r.lot } });
          const n = note(r.guild_id, r.owner_id); n.lots.push(`lot ${r.lot} (${NAME[r.kind] ?? r.kind})`); n.refund += cents;
          refunded += cents;
        }
        if (r.bidder_id && r.bid_cents > 0) {
          const from = escrow(r.guild_id, r.bidder_id);
          const held = db.get('SELECT 1 FROM accounts WHERE id = ?', from) ? balance(db, from) : 0;
          const cents = Math.min(r.bid_cents, held);
          if (cents > 0) transfer(db, { from, to: wallet(r.guild_id, r.bidder_id), cents, reason: 'estate.refund', guildId: r.guild_id, actorId: r.bidder_id, now, note: { lot: r.lot } });
          note(r.guild_id, r.bidder_id).bids += cents;
          bids += cents;
        }
      }
      for (const n of told.values()) {
        award(db, n.guild, n.user, 'eminent_domain', now);
        const parts = [n.refund ? `${format(n.refund)} for ${n.lots.join(', ')}` : null, n.bids ? `${format(n.bids)} in bids` : null].filter(Boolean).join(', plus ');
        addInbox(db, n.user, n.guild, 'Eminent Domain', `🚜 The old 15 lots were plowed down for the new city map. You got back ${parts}. The land is open: build anything you like with \`r!property build\`.`, now);
      }
      db.run('DROP TABLE estates_old');
      db.run("DELETE FROM meta WHERE key LIKE 'ug.night:%' OR key LIKE 'ug.hosts:%'");
      return `refunded ${told.size} ${told.size === 1 ? 'player' : 'players'}: ${format(refunded)} for lots, ${format(bids)} in bids`;
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
