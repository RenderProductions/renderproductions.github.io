// Player companies: found one, grow it through levels, take it public, keep it afloat.
//   pending -> waiting for approval (the founding cost already sits in the treasury; refunded if rejected)
//   private -> levels up from its treasury, pays upkeep, earns from employees' shifts
//   public  -> listed after its IPO; anyone but the owner can trade its shares
//   dead    -> its share price hit 0, or (private) it missed upkeep 3 days running
// The treasury is a ledger account ('company:<TICKER>'), so every Polygon in and out is on the books.
// Also: hostile takeovers and mergers (Heists & Schemes).
import { award } from '../achievements/achievements';
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { RESERVE, balance, ensureAccount, ensureEscrow, escrow, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import { DAY } from '../core/time';

export const LEVELS = [
  { name: 'Startup', cost: polygons(2500), upkeep: polygons(25), value: 0, payMult: 1.0 },
  { name: 'Small Business', cost: polygons(5000), upkeep: polygons(50), value: 0, payMult: 1.1 },
  { name: 'Firm', cost: polygons(12_000), upkeep: polygons(100), value: polygons(15_000), payMult: 1.2 },
  { name: 'Corporation', cost: polygons(30_000), upkeep: polygons(200), value: polygons(40_000), payMult: 1.35 },
  { name: 'Conglomerate', cost: polygons(75_000), upkeep: polygons(400), value: polygons(100_000), payMult: 1.5 }
];
export const CO = { ipoLevel: 3, listingFee: polygons(2000), totalShares: 1000, float: 400, historyLength: 288, salaryMaxPct: 0.1, revenueShare: 0.5, privateStrikes: 3, impact: 0.5 };
export const TAKEOVER = { stake: 0.5, premium: 0.25, poisonPill: 0.1, bidMs: DAY, mergeMs: DAY };

export interface Company { ticker: string; name: string; owner_id: string; owner_name: string | null; owner_guild: string; status: string; level: number; price: number; offering_left: number; strikes: number; created_at: number; approved_at: number | null; ipo_at: number | null; died_at: number | null; last_upkeep: number | null; last_salary: number | null; history: number[]; note: string | null }
type Row = Omit<Company, 'history'> & { history: string };

export const treasuryId = (t: string): string => `company:${t}`;
const parse = (r: Row | undefined): Company | null => (r ? { ...r, history: JSON.parse(r.history) as number[] } : null);
export const getCompany = (db: Db, t: string): Company | null => parse(db.get<Row>('SELECT * FROM companies WHERE ticker = ?', String(t ?? '').toUpperCase()));
export const listCompanies = (db: Db, statuses: string[]): Company[] => db.all<Row>(`SELECT * FROM companies WHERE status IN (${statuses.map(() => '?').join(', ')}) ORDER BY ticker`, ...statuses).map((r) => parse(r)!);
export const ownedBy = (db: Db, userId: string): Company | null => parse(db.get<Row>("SELECT * FROM companies WHERE owner_id = ? AND status IN ('pending', 'private', 'public')", userId));
export const alive = (c: Company | null): c is Company => !!c && (c.status === 'private' || c.status === 'public');
export const levelOf = (c: Company) => LEVELS[c.level - 1]!;
export const treasury = (db: Db, c: Company): Cents => balance(db, treasuryId(c.ticker));
export const worthOf = (db: Db, c: Company): Cents => treasury(db, c) + levelOf(c).value;
export const fairValue = (db: Db, c: Company, treasuryOverride?: Cents): number =>
  ((treasuryOverride ?? treasury(db, c)) + levelOf(c).value) / 100 / CO.totalShares * Math.max(0, 1 - 0.5 * c.strikes);
export const sharesHeld = (db: Db, t: string): number => db.get<{ n: number }>('SELECT COALESCE(SUM(shares), 0) AS n FROM company_holdings WHERE ticker = ?', t)!.n;
export const holding = (db: Db, g: string, u: string, t: string): number => db.get<{ shares: number }>('SELECT shares FROM company_holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?', g, u, t)?.shares ?? 0;
export const holdingsOf = (db: Db, g: string, u: string) => db.all<{ ticker: string; shares: number }>('SELECT ticker, shares FROM company_holdings WHERE guild_id = ? AND user_id = ? AND shares > 0 ORDER BY ticker', g, u);
export const employees = (db: Db, t: string): number => db.get<{ n: number }>('SELECT COUNT(*) AS n FROM players WHERE job = ?', t)!.n;
export const change = (c: Company): number => (c.history.length && c.history[0] ? ((c.price - c.history[0]) / Math.abs(c.history[0])) * 100 : 0);
const setHolding = (db: Db, g: string, u: string, t: string, n: number) =>
  db.run('INSERT INTO company_holdings (guild_id, user_id, ticker, shares) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, user_id, ticker) DO UPDATE SET shares = excluded.shares', g, u, t, n);
function update(db: Db, t: string, f: Partial<Company>): void {
  const keys = Object.keys(f) as (keyof Company)[];
  db.run(`UPDATE companies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ticker = ?`, ...keys.map((k) => (k === 'history' ? JSON.stringify(f[k]) : (f[k] as string | number | null))), t);
}

export const cleanName = (name: string): string => String(name ?? '').replace(/[*_~`|>\\@\n\r]/g, '').replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- lifecycle

export function found(db: Db, g: string, u: string, uname: string, ticker: string, name: string, houseTickers: readonly string[], now = Date.now()): Company {
  if (ownedBy(db, u)) throw new GameError('co.have', 'You already run a company.');
  if (!/^[A-Z]{2,5}$/.test(ticker)) throw new GameError('co.ticker', 'Tickers are 2 to 5 letters, for example MEOW.');
  if (houseTickers.includes(ticker)) throw new GameError('co.taken', `${ticker} is already a listed company.`);
  const taken = db.get<{ status: string }>("SELECT status FROM companies WHERE ticker = ? AND status != 'rejected'", ticker);
  if (taken) throw new GameError('co.taken', `${ticker} is taken${taken.status === 'dead' ? ' (by a company that went under)' : ''}.`);
  if (name.length < 3 || name.length > 32) throw new GameError('co.name', 'Company names are 3 to 32 characters.');
  return db.tx(() => {
    db.run("DELETE FROM companies WHERE ticker = ? AND status = 'rejected'", ticker);
    ensureAccount(db, treasuryId(ticker), 'company', null, ticker, now);
    transfer(db, { from: wallet(g, u), to: treasuryId(ticker), cents: LEVELS[0]!.cost, reason: 'company.found', guildId: g, actorId: u, now, note: { ticker } });
    db.run("INSERT INTO companies (ticker, name, owner_id, owner_name, owner_guild, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)", ticker, name, u, uname, g, now);
    award(db, g, u, 'founder', now);
    return getCompany(db, ticker)!;
  });
}

export function approve(db: Db, t: string, now = Date.now()): void { update(db, t, { status: 'private', approved_at: now, last_upkeep: now }); }

export function reject(db: Db, c: Company, reason: string, now = Date.now()): void {
  db.tx(() => {
    const left = treasury(db, c);
    if (left > 0) transfer(db, { from: treasuryId(c.ticker), to: wallet(c.owner_guild, c.owner_id), cents: left, reason: 'company.refund', guildId: c.owner_guild, now });
    update(db, c.ticker, { status: 'rejected', note: reason || null });
  });
}

export function invest(db: Db, c: Company, g: string, u: string, cents: Cents, now = Date.now()): void {
  transfer(db, { from: wallet(g, u), to: treasuryId(c.ticker), cents, reason: 'company.invest', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
}

export function upgrade(db: Db, c: Company, now = Date.now()): Company {
  const next = LEVELS[c.level];
  if (!next) throw new GameError('co.max', `${c.name} is already a ${levelOf(c).name}, the top level.`);
  if (treasury(db, c) < next.cost) throw new GameError('co.funds', `Reaching ${next.name} costs ${format(next.cost)} from the treasury, which holds ${format(treasury(db, c))}.`);
  return db.tx(() => {
    transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: next.cost, reason: 'company.upgrade', now, note: { ticker: c.ticker } });
    update(db, c.ticker, { level: c.level + 1 });
    if (c.level + 1 === LEVELS.length) award(db, c.owner_guild, c.owner_id, 'conglomerate', now);
    return getCompany(db, c.ticker)!;
  });
}

export function ipo(db: Db, c: Company, now = Date.now()): number {
  if (c.status !== 'private') throw new GameError('co.ipo', 'Only private companies can go public.');
  if (c.level < CO.ipoLevel) throw new GameError('co.ipo', `A company must be a ${LEVELS[CO.ipoLevel - 1]!.name} to go public.`);
  if (treasury(db, c) < CO.listingFee) throw new GameError('co.funds', `Listing costs ${format(CO.listingFee)} from the treasury.`);
  return db.tx(() => {
    transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: CO.listingFee, reason: 'company.listing', now, note: { ticker: c.ticker } });
    const price = Math.max(0.01, Math.round(fairValue(db, c) * 100) / 100);
    update(db, c.ticker, { status: 'public', price, offering_left: CO.float, ipo_at: now, history: [price] });
    award(db, c.owner_guild, c.owner_id, 'going_public', now);
    return price;
  });
}

export function die(db: Db, c: Company, reason: string, now = Date.now()): void {
  db.tx(() => {
    const left = treasury(db, c);
    if (left > 0) transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: left, reason: 'company.closed', now, note: { ticker: c.ticker } });
    update(db, c.ticker, { status: 'dead', price: 0, died_at: now, note: reason });
    db.run('DELETE FROM company_holdings WHERE ticker = ?', c.ticker);
    db.run('UPDATE players SET job = NULL WHERE job = ?', c.ticker);
    db.run('DELETE FROM takeovers WHERE ticker = ?', c.ticker);
  });
}

export function salary(db: Db, c: Company, cents: Cents, now = Date.now()): void {
  const t = treasury(db, c);
  if (c.last_salary && now - c.last_salary < DAY) throw new GameError('co.salary', 'A salary can be taken once a day.');
  if (cents > Math.floor(t * CO.salaryMaxPct)) throw new GameError('co.salary', `At most ${Math.round(CO.salaryMaxPct * 100)}% of the treasury a day: ${format(Math.floor(t * CO.salaryMaxPct))}.`);
  db.tx(() => {
    transfer(db, { from: treasuryId(c.ticker), to: wallet(c.owner_guild, c.owner_id), cents, reason: 'company.salary', guildId: c.owner_guild, actorId: c.owner_id, now });
    update(db, c.ticker, { last_salary: now, ...(c.status === 'public' ? { price: Math.max(0.01, c.price * (1 - 0.5 * cents / t)) } : {}) });
  });
}

/** Employees' shifts add to the treasury (paid from the Reserve, like the shift itself). */
export function addRevenue(db: Db, ticker: string, cents: Cents, now = Date.now()): void {
  if (cents > 0 && balance(db, RESERVE) >= cents) transfer(db, { from: RESERVE, to: treasuryId(ticker), cents, reason: 'company.revenue', now });
}

// ---------------------------------------------------------------- shares (fill at the average price across the move)

export function buyShares(db: Db, g: string, u: string, c: Company, n: number, now = Date.now()): { cost: Cents; priceCents: Cents; held: number } {
  if (c.status !== 'public') throw new GameError('co.notpublic', `${c.ticker} is not publicly traded.`);
  if (c.owner_id === u) throw new GameError('co.own', 'You cannot own shares of your own company.');
  const available = CO.float - sharesHeld(db, c.ticker);
  if (n > available) throw new GameError('co.available', available ? `Only ${available} shares of ${c.ticker} are available.` : `Every public share of ${c.ticker} is owned right now.`);
  const price = c.price * (1 + CO.impact * n / CO.float);
  const priceCents = Math.ceil(((c.price + price) / 2) * 100);
  const cost = n * priceCents;
  return db.tx(() => {
    const fromOffering = Math.min(n, c.offering_left);
    if (fromOffering) transfer(db, { from: wallet(g, u), to: treasuryId(c.ticker), cents: fromOffering * priceCents, reason: 'company.shares.buy', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
    if (n - fromOffering) transfer(db, { from: wallet(g, u), to: RESERVE, cents: (n - fromOffering) * priceCents, reason: 'company.shares.buy', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
    const held = holding(db, g, u, c.ticker) + n;
    setHolding(db, g, u, c.ticker, held);
    update(db, c.ticker, { offering_left: c.offering_left - fromOffering, price });
    return { cost, priceCents, held };
  });
}

export function sellShares(db: Db, g: string, u: string, c: Company, n: number, now = Date.now()): { proceeds: Cents; priceCents: Cents; held: number } {
  const owned = holding(db, g, u, c.ticker);
  if (n > owned) throw new GameError('co.short', `You hold ${owned} shares of ${c.ticker}.`);
  if (Math.round(c.price * 100) <= 0) throw new GameError('co.worthless', `${c.ticker} has no value at present.`);
  const price = Math.max(0.01, c.price * (1 - CO.impact * n / CO.float));
  const priceCents = Math.floor(((c.price + price) / 2) * 100);
  const proceeds = n * priceCents;
  if (balance(db, RESERVE) < proceeds) throw new GameError('reserve.empty', 'The Reserve cannot buy these shares back right now.');
  return db.tx(() => {
    transfer(db, { from: RESERVE, to: wallet(g, u), cents: proceeds, reason: 'company.shares.sell', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
    setHolding(db, g, u, c.ticker, owned - n);
    update(db, c.ticker, { price });
    return { proceeds, priceCents, held: owned - n };
  });
}

/** Player-company shares in net worth. */
export const companySharesValue = (db: Db, g: string, u: string): Cents =>
  holdingsOf(db, g, u).reduce((s, h) => { const c = getCompany(db, h.ticker); return s + (c && c.status === 'public' ? Math.round(c.price * 100) * h.shares : 0); }, 0);

// ---------------------------------------------------------------- the daily cycle (run every market tick)

export function companiesTick(db: Db, now: number, random: () => number): { ticker: string; type: 'missed' | 'dead' }[] {
  const events: { ticker: string; type: 'missed' | 'dead' }[] = [];
  for (const c of listCompanies(db, ['private', 'public'])) {
    let strikes = c.strikes, last = c.last_upkeep ?? now, price = c.price, days = 0;
    while (now >= last + DAY && days < 7) {
      const due = levelOf(c).upkeep;
      if (treasury(db, c) >= due) { transfer(db, { from: treasuryId(c.ticker), to: RESERVE, cents: due, reason: 'company.upkeep', now, note: { ticker: c.ticker } }); strikes = 0; }
      else { strikes++; events.push({ ticker: c.ticker, type: 'missed' }); if (c.status === 'public') price -= Math.max(price * 0.4, 0.5); }
      last += DAY; days++;
    }
    if (days === 7 && now >= last + DAY) last = now;
    if (c.status === 'private') {
      update(db, c.ticker, { strikes, last_upkeep: last });
      if (strikes >= CO.privateStrikes) { die(db, c, 'Missed upkeep 3 days in a row', now); events.push({ ticker: c.ticker, type: 'dead' }); }
      continue;
    }
    const fair = fairValue(db, { ...c, strikes });
    if (price > 0) price += (fair - price) * 0.03 + price * (random() - 0.5) * 2 * (0.012 / Math.sqrt(c.level - 1 || 1));
    price = Math.round(price * 100) / 100;
    if (price <= 0) { update(db, c.ticker, { strikes, last_upkeep: last }); die(db, c, 'Share price hit 0', now); events.push({ ticker: c.ticker, type: 'dead' }); continue; }
    update(db, c.ticker, { strikes, last_upkeep: last, price, history: c.history.concat(price).slice(-CO.historyLength) });
  }
  takeoversTick(db, now);
  return events;
}

// ---------------------------------------------------------------- takeovers and mergers

export interface Bid { ticker: string; bidder_id: string; bidder_guild: string; premium: Cents; ends_at: number }
export const bidOn = (db: Db, t: string): Bid | null => db.get<Bid>('SELECT * FROM takeovers WHERE ticker = ?', t) ?? null;

export function startBid(db: Db, g: string, u: string, c: Company, now = Date.now()): Bid {
  if (c.status !== 'public') throw new GameError('to.public', 'Only publicly traded companies can be taken over.');
  if (c.owner_id === u) throw new GameError('to.own', 'You already own it.');
  if (ownedBy(db, u)) throw new GameError('to.owner', 'You already run a company.');
  if (bidOn(db, c.ticker)) throw new GameError('to.bid', 'There is already a takeover bid on this company.');
  const need = Math.ceil(CO.float * TAKEOVER.stake);
  const have = holding(db, g, u, c.ticker);
  if (have < need) throw new GameError('to.stake', `A takeover needs ${need} of the ${CO.float} public shares. You hold ${have}.`);
  const premium = Math.round(worthOf(db, c) * TAKEOVER.premium);
  return db.tx(() => {
    transfer(db, { from: wallet(g, u), to: ensureEscrow(db, g, u, now), cents: premium, reason: 'takeover.premium', guildId: g, actorId: u, now, note: { ticker: c.ticker } });
    db.run('INSERT INTO takeovers (ticker, bidder_id, bidder_guild, premium, ends_at) VALUES (?, ?, ?, ?, ?)', c.ticker, u, g, premium, now + TAKEOVER.bidMs);
    return bidOn(db, c.ticker)!;
  });
}

/** The takeover goes through: the bidder owns it, their shares fold in, the old owner gets the premium. */
export function completeBid(db: Db, b: Bid, now = Date.now()): void {
  const c = getCompany(db, b.ticker);
  db.tx(() => {
    db.run('DELETE FROM takeovers WHERE ticker = ?', b.ticker);
    if (!alive(c)) { transfer(db, { from: escrow(b.bidder_guild, b.bidder_id), to: wallet(b.bidder_guild, b.bidder_id), cents: b.premium, reason: 'takeover.refund', now }); return; }
    transfer(db, { from: escrow(b.bidder_guild, b.bidder_id), to: wallet(c.owner_guild, c.owner_id), cents: b.premium, reason: 'takeover.premium.paid', guildId: c.owner_guild, now, note: { ticker: c.ticker } });
    db.run('DELETE FROM company_holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?', b.bidder_guild, b.bidder_id, b.ticker);
    db.run('UPDATE companies SET owner_id = ?, owner_guild = ? WHERE ticker = ?', b.bidder_id, b.bidder_guild, b.ticker);
    award(db, b.bidder_guild, b.bidder_id, 'hostile', now);
  });
}

/** The owner fights it off: a tenth of the company's worth from their pocket; the bidder is refunded. */
export function poisonPill(db: Db, c: Company, now = Date.now()): Cents {
  const b = bidOn(db, c.ticker);
  if (!b) throw new GameError('to.none', 'There is no takeover bid on your company.');
  const cost = Math.round(worthOf(db, c) * TAKEOVER.poisonPill);
  return db.tx(() => {
    transfer(db, { from: wallet(c.owner_guild, c.owner_id), to: RESERVE, cents: cost, reason: 'takeover.poisonpill', guildId: c.owner_guild, now });
    transfer(db, { from: escrow(b.bidder_guild, b.bidder_id), to: wallet(b.bidder_guild, b.bidder_id), cents: b.premium, reason: 'takeover.refund', now });
    db.run('DELETE FROM takeovers WHERE ticker = ?', c.ticker);
    award(db, c.owner_guild, c.owner_id, 'poison_pill', now);
    return cost;
  });
}

function takeoversTick(db: Db, now: number): void {
  for (const b of db.all<Bid>('SELECT * FROM takeovers WHERE ends_at <= ?', now)) completeBid(db, b, now);
}

export function proposeMerger(db: Db, from: Company, into: Company, now = Date.now()): void {
  db.setMeta(`merger:${into.ticker}`, JSON.stringify({ from: from.ticker, until: now + TAKEOVER.mergeMs }));
}
export function mergerFor(db: Db, ticker: string, now = Date.now()): string | null {
  try { const p = JSON.parse(db.meta(`merger:${ticker}`) ?? 'null') as { from: string; until: number } | null; return p && p.until > now ? p.from : null; } catch { return null; }
}

/** The bigger company absorbs the other: treasuries combine, the higher level stays, the smaller one's
 *  shareholders are bought out at its price (from the combined treasury), and its employees move over. */
export function merge(db: Db, a: Company, b: Company, now = Date.now()): Company {
  const [big, small] = worthOf(db, a) >= worthOf(db, b) ? [a, b] : [b, a];
  return db.tx(() => {
    const st = treasury(db, small);
    if (st > 0) transfer(db, { from: treasuryId(small.ticker), to: treasuryId(big.ticker), cents: st, reason: 'company.merge', now });
    for (const h of db.all<{ guild_id: string; user_id: string; shares: number }>('SELECT guild_id, user_id, shares FROM company_holdings WHERE ticker = ? AND shares > 0', small.ticker)) {
      const pay = Math.min(treasury(db, big), Math.round(small.price * 100) * h.shares);
      if (pay > 0) transfer(db, { from: treasuryId(big.ticker), to: wallet(h.guild_id, h.user_id), cents: pay, reason: 'company.buyout', guildId: h.guild_id, now });
    }
    db.run('DELETE FROM company_holdings WHERE ticker = ?', small.ticker);
    db.run('UPDATE players SET job = ? WHERE job = ?', big.ticker, small.ticker);
    update(db, big.ticker, { level: Math.max(big.level, small.level) });
    update(db, small.ticker, { status: 'dead', price: 0, died_at: now, note: `Merged into ${big.ticker}` });
    db.setMeta(`merger:${a.ticker}`, 'null'); db.setMeta(`merger:${b.ticker}`, 'null');
    award(db, a.owner_guild, a.owner_id, 'merger', now);
    award(db, b.owner_guild, b.owner_id, 'merger', now);
    return getCompany(db, big.ticker)!;
  });
}

export function spark(history: number[]): string {
  const bars = '▁▂▃▄▅▆▇█';
  const h = history.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 24)) === 0).slice(-24);
  if (h.length < 2) return '';
  const min = Math.min(...h), max = Math.max(...h), range = max - min || 1;
  return h.map((v) => bars[Math.round(((v - min) / range) * 7)]).join('');
}
