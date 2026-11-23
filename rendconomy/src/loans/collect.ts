// Collections (NachoBellGrande1065's idea): a lender whose loan is overdue can make the borrower pay with what they
// own, so walking away from a loan doesn't work. Three days after the due date the lender can run r!collect.
// What gets taken, in order, until the debt and the collection fee are covered: the wallet, savings (closed early,
// no interest), house shares at the market price, player-company shares, then shop items at Marquez's buy-back
// price. Never buildings, companies or collectibles. The lender only ever gets what they're owed; the fee goes to
// TODD (the Reserve).
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import { DAY } from '../core/time';
import { getCompany, holdingsOf, sellShares } from '../companies/companies';
import type { MarketData } from '../market/engine';
import { portfolio, sell } from '../market/trading';
import { items } from '../shop/inventory';
import { ITEMS } from '../shop/items';
import { sellBack, sellBackPrice } from '../shop/shop';
import { close as closeSavings, list as savingsOf } from '../social/savings';
import { type Loan, overdue, payLoan } from './loans';

export const COLLECT = { graceMs: 3 * DAY, fee: 0.1 };

/** When the lender can collect. */
export const collectableAt = (l: Loan): number => l.due_at + COLLECT.graceMs;

export interface Collected { toLender: Cents; fee: Cents; left: Cents; took: string[] }

/** Takes what the borrower owes (plus the fee) from what they own. Partial if they don't have enough. */
export function collect(db: Db, m: MarketData | null, l: Loan, now = Date.now()): Collected {
  if (l.status !== 'active') throw new GameError('collect.none', 'That loan is closed.');
  if (!overdue(l, now)) throw new GameError('collect.early', 'That loan isn\'t due yet.');
  if (now < collectableAt(l)) throw new GameError('collect.grace', `The borrower gets ${COLLECT.graceMs / DAY} days after the due date to pay. You can collect from <t:${Math.floor(collectableAt(l) / 1000)}:F>.`);
  const g = l.guild_id, u = l.borrower_id, w = wallet(g, u);
  const need = l.owed + Math.ceil(l.owed * COLLECT.fee);
  const short = () => need - balance(db, w);
  const took: string[] = [];
  return db.tx(() => {
    const cash = Math.min(balance(db, w), need);
    if (cash > 0) took.push(`${format(cash)} from their wallet`);
    // savings, closed early
    for (const a of savingsOf(db, g, u)) {
      if (short() <= 0) break;
      const before = balance(db, w);
      closeSavings(db, a, now);
      took.push(`a savings account (${format(balance(db, w) - before)})`);
    }
    // house shares at the market price (only while the market is open)
    if (m) for (const p of portfolio(db, m, g, u)) {
      if (short() <= 0) break;
      const qty = Math.min(p.shares, Math.ceil(short() / Math.max(1, p.quote.priceCents)));
      try {
        const r = sell(db, m, { guildId: g, userId: u, ticker: p.quote.id, qty, now });
        took.push(`${qty} ${p.quote.id} shares (${format(r.totalCents)})`);
      } catch { /* closed or untradable: skip */ }
    }
    // player-company shares
    for (const h of holdingsOf(db, g, u)) {
      if (short() <= 0) break;
      const c = getCompany(db, h.ticker);
      if (!c || c.status !== 'public' || c.price <= 0) continue;
      const qty = Math.min(h.shares, Math.ceil(short() / Math.max(1, Math.round(c.price * 100))));
      try {
        const r = sellShares(db, g, u, c, qty, now);
        took.push(`${qty} ${c.ticker} shares (${format(r.proceeds)})`);
      } catch { /* worthless or the Reserve can't pay: skip */ }
    }
    // shop items at Marquez's buy-back price, priciest first (no collectibles, no Goods)
    const shelf = items(db, g, u).filter((i) => ITEMS[i.item] && ITEMS[i.item]!.ready !== false)
      .map((i) => ({ ...i, each: sellBackPrice(db, i.item) })).filter((i) => i.each > 0).sort((a, b) => b.each - a.each);
    for (const i of shelf) {
      if (short() <= 0) break;
      const qty = Math.min(i.qty, Math.ceil(short() / i.each));
      try {
        const r = sellBack(db, g, u, i.item, qty, now);
        took.push(`${qty} × ${r.item.name} (${format(r.paid)})`);
      } catch { /* the Reserve can't pay: stop */ break; }
    }
    // pay the lender first, then TODD's fee
    const pot = Math.min(balance(db, w), need);
    const toLender = Math.min(l.owed, Math.floor(pot / (1 + COLLECT.fee)));
    if (toLender > 0) payLoan(db, l, toLender, now, 'loan.collect');
    const fee = Math.min(pot - toLender, balance(db, w));
    if (fee > 0) transfer(db, { from: w, to: RESERVE, cents: fee, reason: 'loan.collect.fee', guildId: g, now, note: { loan: l.id } });
    return { toLender, fee, left: l.owed - toLender, took };
  });
}
