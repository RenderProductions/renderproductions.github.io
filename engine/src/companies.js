// Player companies: found one, grow it through levels, take it public, keep it afloat.
//
//   pending  -> waiting for a mod to approve the name (founding cost is held, refunded if rejected)
//   private  -> approved; levels up from its treasury, pays upkeep, earns from employees' shifts
//   public   -> listed after its IPO; anyone (except the owner) can trade its shares
//   dead     -> its share price hit 0 (or, while private, it missed upkeep 3 days running)
//
// Money in the treasury comes from the owner investing, IPO share sales, and employees' shifts.
// Each day it pays upkeep. Missing upkeep cuts the company's fair value and crashes the price,
// so a company nobody keeps afloat slides to 0 and dies.

const config = require('./config');
const reserve = require('./reserve');
const { money, have, amt } = require('./format');

const LEVELS = [
  // cost = founding cost (level 1) or price to reach this level, paid from the treasury
  // value = what the level adds to the company's worth (feeds the share price once public)
  { name: 'Startup',        cost: 2_500_00,  upkeep: 25_00,  value: 0,           payMult: 1.0 },
  { name: 'Small Business', cost: 5_000_00,  upkeep: 50_00,  value: 0,           payMult: 1.1 },
  { name: 'Firm',           cost: 12_000_00, upkeep: 100_00, value: 15_000_00,   payMult: 1.2 },
  { name: 'Corporation',    cost: 30_000_00, upkeep: 200_00, value: 40_000_00,   payMult: 1.35 },
  { name: 'Conglomerate',   cost: 75_000_00, upkeep: 400_00, value: 100_000_00,  payMult: 1.5 }
];

const RULES = {
  ipoLevel: 3,              // Firm
  listingFee: 2_000_00,     // paid from the treasury to go public
  totalShares: 1000,        // the price is the company's worth / 1000
  float: 400,               // shares the public can own at once
  dayMs: 24 * 60 * 60 * 1000,
  tickMs: 5 * 60 * 1000,
  historyLength: 288,       // 24 hours of 5-minute ticks
  salaryMaxPct: 0.10,       // owner can take up to 10% of the treasury per day
  revenueShare: 0.5,        // employees' shifts add half their pay to the treasury
  privateStrikes: 3,        // a private company closes after this many missed upkeeps in a row
  impact: 0.5               // buying/selling the whole float moves the price 50%
};

// ---- reading ----

const parse = (c) => (c ? { ...c, history: JSON.parse(c.history || '[]') } : null);

function get(db, ticker) {
  return parse(db.raw.prepare('SELECT * FROM pc_companies WHERE ticker = ?').get(String(ticker || '').toUpperCase()));
}
function list(db, statuses) {
  const marks = statuses.map(() => '?').join(', ');
  return db.raw.prepare(`SELECT * FROM pc_companies WHERE status IN (${marks}) ORDER BY ticker`).all(...statuses).map(parse);
}
const alive = (c) => !!c && (c.status === 'private' || c.status === 'public');

// The company this player runs right now (pending, private, or public), if any
function ownedBy(db, userId) {
  return parse(db.raw.prepare("SELECT * FROM pc_companies WHERE owner_id = ? AND status IN ('pending', 'private', 'public')").get(userId));
}

function level(c) { return LEVELS[c.level - 1]; }
function nextLevel(c) { return LEVELS[c.level] || null; }

// What a share should be worth from the treasury and level, cut by missed upkeep.
function fairValue(c) {
  const worth = (c.treasury + level(c).value) / 100 / RULES.totalShares;
  return worth * Math.max(0, 1 - 0.5 * c.strikes);
}

function sharesHeld(db, ticker) {
  return db.raw.prepare('SELECT COALESCE(SUM(shares), 0) AS n FROM pc_holdings WHERE ticker = ?').get(ticker).n;
}
function holding(db, guildId, userId, ticker) {
  const r = db.raw.prepare('SELECT shares FROM pc_holdings WHERE guild_id = ? AND user_id = ? AND ticker = ?').get(guildId, userId, ticker);
  return r ? r.shares : 0;
}
function holdingsOf(db, guildId, userId) {
  return db.raw.prepare('SELECT ticker, shares FROM pc_holdings WHERE guild_id = ? AND user_id = ? AND shares > 0 ORDER BY ticker').all(guildId, userId);
}
function employees(db, ticker) {
  return db.raw.prepare('SELECT count(*) AS n FROM players WHERE job = ?').get(ticker).n;
}
function change(c) {
  const h = c.history;
  return h.length && h[0] ? ((c.price - h[0]) / Math.abs(h[0])) * 100 : 0;
}

// ---- writing ----

const COLUMNS = new Set(['name', 'owner_name', 'level', 'treasury', 'status', 'price', 'offering_left', 'strikes',
  'approved_at', 'ipo_at', 'died_at', 'last_upkeep', 'last_salary', 'history', 'note']);

function update(db, ticker, fields) {
  const keys = Object.keys(fields);
  for (const k of keys) if (!COLUMNS.has(k)) throw new Error('Unknown company column: ' + k);
  const vals = keys.map((k) => (k === 'history' ? JSON.stringify(fields[k]) : fields[k]));
  db.raw.prepare(`UPDATE pc_companies SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE ticker = ?`).run(...vals, ticker);
}
function setHolding(db, guildId, userId, ticker, shares) {
  db.raw.prepare(`INSERT INTO pc_holdings (guild_id, user_id, ticker, shares) VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, ticker) DO UPDATE SET shares = excluded.shares`).run(guildId, userId, ticker, shares);
}

// Checks a requested ticker and name. Returns an error message, or null if they're fine.
function cleanName(name) {
  return String(name || '').replace(/[*_~`|>\\@\n\r]/g, '').replace(/\s+/g, ' ').trim();
}
function checkNew(db, ticker, name, officialIds) {
  if (!/^[A-Z]{2,5}$/.test(ticker)) return 'Tickers are 2 to 5 letters, like `MEOW`.';
  if (officialIds.includes(ticker)) return `**${ticker}** is already a listed company.`;
  const taken = db.raw.prepare("SELECT status FROM pc_companies WHERE ticker = ? AND status != 'rejected'").get(ticker);
  if (taken) return `**${ticker}** is taken${taken.status === 'dead' ? ' (by a company that went under)' : ''}.`;
  if (name.length < 3 || name.length > 32) return 'Company names are 3 to 32 characters.';
  return null;
}

function found(db, { ticker, name, owner, guildId }) {
  db.raw.prepare("DELETE FROM pc_companies WHERE ticker = ? AND status = 'rejected'").run(ticker); // a rejected ticker is free again
  db.raw.prepare(`INSERT INTO pc_companies (ticker, name, owner_id, owner_name, owner_guild, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)`).run(ticker, name, owner.id, owner.username || null, guildId, Date.now());
}

function approve(db, ticker, now = Date.now()) {
  // The founding cost becomes the company's first treasury
  update(db, ticker, { status: 'private', approved_at: now, treasury: LEVELS[0].cost, last_upkeep: now });
}

function reject(db, ticker, reason) {
  const c = get(db, ticker);
  db.tx(() => {
    db.player(c.owner_guild, { id: c.owner_id });
    db.addCash(c.owner_guild, c.owner_id, LEVELS[0].cost); // full refund
    update(db, ticker, { status: 'rejected', note: reason || null });
  });
}

function ipo(db, ticker, now = Date.now()) {
  const c = get(db, ticker);
  const after = { ...c, treasury: c.treasury - RULES.listingFee };
  const price = Math.max(0.01, Math.round(fairValue(after) * 100) / 100);
  update(db, ticker, {
    status: 'public', treasury: after.treasury, price, offering_left: RULES.float, ipo_at: now, history: [price]
  });
  reserve.take(db, RULES.listingFee);
  return price;
}

function die(db, ticker, reason, now = Date.now()) {
  db.tx(() => {
    const left = get(db, ticker).treasury;
    if (left > 0) reserve.take(db, left); // whatever it had left goes to the house
    update(db, ticker, { status: 'dead', price: 0, died_at: now, note: reason, treasury: 0 });
    db.raw.prepare('DELETE FROM pc_holdings WHERE ticker = ?').run(ticker);
    db.raw.prepare('UPDATE players SET job = NULL, shifts = 0 WHERE job = ?').run(ticker);
  });
}

// Buy n shares at the current price. Returns { cost, price, held } or { error }.
function buy(db, { guildId, user, ticker, n }) {
  const c = get(db, ticker);
  if (c.owner_id === user.id) return { error: "You can't own shares of your own company." };
  const available = RULES.float - sharesHeld(db, ticker);
  if (available <= 0) return { error: `Every public share of ${ticker} is owned right now. Wait for someone to sell.` };
  if (n > available) return { error: `Only ${available} shares of ${ticker} are available right now.` };
  const priceCents = Math.round(c.price * 100);
  const cost = n * priceCents;
  const p = db.player(guildId, user);
  if (p.cash < cost) return { error: `Not enough Polygons. That order costs ${amt(cost)} and you have ${have(p.cash)}.` };

  return db.tx(() => {
    const fromOffering = Math.min(n, c.offering_left);
    const held = holding(db, guildId, user.id, ticker) + n;
    db.addCash(guildId, user.id, -cost);
    reserve.take(db, cost - fromOffering * priceCents); // shares not from the offering are bought from the house
    setHolding(db, guildId, user.id, ticker, held);
    const price = Math.round(c.price * (1 + RULES.impact * n / RULES.float) * 100) / 100;
    update(db, ticker, {
      treasury: c.treasury + fromOffering * priceCents, // IPO shares fund the company
      offering_left: c.offering_left - fromOffering,
      price
    });
    db.logTrade(guildId, user.id, ticker, n, priceCents);
    return { cost, priceCents, held, raised: fromOffering * priceCents };
  });
}

// Sell n shares at the current price. Returns { proceeds, left } or { error }.
function sell(db, { guildId, user, ticker, n }) {
  const c = get(db, ticker);
  const owned = holding(db, guildId, user.id, ticker);
  if (n > owned) return { error: `You only own ${owned} shares of ${ticker}.` };
  const priceCents = Math.round(c.price * 100);
  if (priceCents <= 0) return { error: `${ticker} is worth nothing right now.` };
  const proceeds = n * priceCents;
  return db.tx(() => {
    db.player(guildId, user);
    db.addCash(guildId, user.id, proceeds);
    reserve.spend(db, proceeds); // the house buys them back
    setHolding(db, guildId, user.id, ticker, owned - n);
    const price = Math.max(0.01, Math.round(c.price * (1 - RULES.impact * n / RULES.float) * 100) / 100);
    update(db, ticker, { price });
    db.logTrade(guildId, user.id, ticker, -n, priceCents);
    return { proceeds, priceCents, left: owned - n };
  });
}

// Owner takes money out of a public company's treasury. Draining it scares investors.
function salary(db, ticker, cents, now = Date.now()) {
  const c = get(db, ticker);
  db.tx(() => {
    db.player(c.owner_guild, { id: c.owner_id });
    db.addCash(c.owner_guild, c.owner_id, cents);
    const price = Math.max(0.01, Math.round(c.price * (1 - 0.5 * cents / c.treasury) * 100) / 100);
    update(db, ticker, { treasury: c.treasury - cents, last_salary: now, price });
  });
}

// Employees' shifts earn the company money
function addRevenue(db, ticker, cents) {
  if (cents > 0) db.raw.prepare('UPDATE pc_companies SET treasury = treasury + ? WHERE ticker = ?').run(cents, ticker);
}

// Moves every living company forward: upkeep once a day, prices every tick.
// Returns a list of events (deaths, missed upkeep) for logging.
function tick(db, now = Date.now(), random = Math.random) {
  const events = [];
  for (const c of list(db, ['private', 'public'])) {
    // Daily upkeep (catches up after downtime, at most a week)
    let { treasury, strikes, last_upkeep: lastUpkeep, price } = c;
    let days = 0;
    while (now >= lastUpkeep + RULES.dayMs && days < 7) {
      const due = level(c).upkeep;
      if (treasury >= due) { treasury -= due; strikes = 0; reserve.take(db, due); }
      else {
        strikes += 1;
        events.push({ ticker: c.ticker, type: 'missed', strikes });
        if (c.status === 'public') price = price - Math.max(price * 0.4, 0.5); // the market panics
      }
      lastUpkeep += RULES.dayMs;
      days += 1;
    }
    if (days === 7 && now >= lastUpkeep + RULES.dayMs) lastUpkeep = now; // don't loop forever after long downtime

    if (c.status === 'private') {
      update(db, c.ticker, { treasury, strikes, last_upkeep: lastUpkeep });
      if (strikes >= RULES.privateStrikes) {
        die(db, c.ticker, 'Missed upkeep 3 days in a row', now);
        events.push({ ticker: c.ticker, type: 'dead' });
      }
      continue;
    }

    // Public: drift toward fair value, plus noise. Bigger companies swing less.
    const fair = fairValue({ ...c, treasury, strikes });
    if (price > 0) {
      const swing = 0.012 / Math.sqrt(c.level - 1 || 1);
      price += (fair - price) * 0.03 + price * (random() - 0.5) * 2 * swing;
    }
    price = Math.round(price * 100) / 100;
    if (price <= 0) {
      update(db, c.ticker, { treasury, strikes, last_upkeep: lastUpkeep });
      die(db, c.ticker, 'Share price hit 0', now);
      events.push({ ticker: c.ticker, type: 'dead' });
      continue;
    }
    const history = c.history.concat(price).slice(-RULES.historyLength);
    update(db, c.ticker, { treasury, strikes, last_upkeep: lastUpkeep, price, history });
  }
  return events;
}

// Text sparkline like the official companies have
function spark(history) {
  const bars = '▁▂▃▄▅▆▇█';
  const h = history.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 24)) === 0).slice(-24);
  if (h.length < 2) return '';
  const min = Math.min(...h); const max = Math.max(...h); const range = max - min || 1;
  return h.map((v) => bars[Math.round(((v - min) / range) * 7)]).join('');
}

// Who can approve or reject companies: the bot owner, or mods in the home server.
function canApprove(ctx) {
  if (config.ownerId && ctx.user.id === config.ownerId) return true;
  return !!(config.homeGuildId && ctx.guildId === config.homeGuildId && ctx.isMod);
}
const approvalsConfigured = () => !!(config.ownerId || config.homeGuildId);

module.exports = {
  LEVELS, RULES, get, list, alive, ownedBy, level, nextLevel, fairValue, sharesHeld, holding, holdingsOf,
  employees, change, update, cleanName, checkNew, found, approve, reject, ipo, die, buy, sell, salary,
  addRevenue, tick, spark, canApprove, approvalsConfigured
};
