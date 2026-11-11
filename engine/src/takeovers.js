// Takeovers and mergers for player companies (Heists & Schemes).
//
// Hostile takeover: own at least half the public float of a listed company (200 of its 400 public shares),
// don't run a company yourself, and put up a premium (a quarter of the company's worth). The owner has
// 24 hours: accept and take the premium, or defend with a poison pill (a tenth of the company's worth out
// of their own pocket, into the reserve), which kills the bid and refunds you. If they do nothing, the
// takeover goes through: you're the new owner, your shares fold into the company, the old owner gets the premium.
//
// Merger: two owners agree. The bigger company absorbs the other: treasuries combine, the higher level
// stays, the smaller company's shareholders are bought out at its share price (out of the combined
// treasury), and its employees move over. The absorbed company's owner walks away free to found another.
const co = require('./companies');
const reserve = require('./reserve');

const RULES = {
  stake: 0.5,          // of the public float, needed to bid
  premium: 0.25,       // of the company's worth, paid to the owner if it goes through
  poisonPill: 0.10,    // of the company's worth, what the owner pays to fight it off
  bidMs: 24 * 60 * 60 * 1000,
  mergeMs: 24 * 60 * 60 * 1000
};

const worth = (c) => c.treasury + co.level(c).value; // cents
const bid = (db, ticker) => db.raw.prepare('SELECT * FROM takeovers WHERE ticker = ?').get(ticker) || null;
const bidsBy = (db, userId) => db.raw.prepare('SELECT * FROM takeovers WHERE bidder_id = ?').all(userId);

// Starts a hostile takeover bid. Returns { bid } or { error, ... }
function startBid(db, { guildId, user, ticker }, now = Date.now()) {
  const c = co.get(db, ticker);
  if (!c || c.status !== 'public') return { error: 'notpublic' };
  if (c.owner_id === user.id) return { error: 'own' };
  if (co.ownedBy(db, user.id)) return { error: 'haveone' };
  if (bid(db, c.ticker)) return { error: 'pending' };
  if (bidsBy(db, user.id).length) return { error: 'onebid' };
  const need = Math.ceil(co.RULES.float * RULES.stake);
  const held = co.holding(db, guildId, user.id, c.ticker);
  if (held < need) return { error: 'stake', need, held };
  const premium = Math.round(worth(c) * RULES.premium);
  const p = db.player(guildId, user);
  if (p.cash < premium) return { error: 'cash', premium, have: p.cash };
  db.tx(() => {
    db.addCash(guildId, user.id, -premium);
    db.raw.prepare('INSERT INTO takeovers (ticker, bidder_id, bidder, guild_id, premium, ends_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(c.ticker, user.id, user.username || user.id, guildId, premium, now + RULES.bidMs);
  });
  return { bid: bid(db, c.ticker), company: c };
}

// The bid goes through: ownership changes hands
function complete(db, b) {
  const c = co.get(db, b.ticker);
  if (!c || c.status !== 'public' || co.ownedBy(db, b.bidder_id)) return refund(db, b, 'failed');
  db.tx(() => {
    db.raw.prepare('DELETE FROM takeovers WHERE ticker = ?').run(b.ticker);
    db.player(c.owner_guild, { id: c.owner_id });
    db.addCash(c.owner_guild, c.owner_id, b.premium);                       // the old owner gets the premium
    db.raw.prepare('DELETE FROM pc_holdings WHERE user_id = ? AND ticker = ?').run(b.bidder_id, b.ticker); // the raider's shares fold in
    db.raw.prepare('UPDATE pc_companies SET owner_id = ?, owner_name = ?, owner_guild = ? WHERE ticker = ?').run(b.bidder_id, b.bidder, b.guild_id, b.ticker);
  });
  return { done: true, oldOwner: c.owner_id, oldOwnerName: c.owner_name, company: co.get(db, b.ticker), premium: b.premium };
}

// The bid ends without a takeover: the premium goes back
function refund(db, b, why) {
  db.tx(() => {
    db.raw.prepare('DELETE FROM takeovers WHERE ticker = ?').run(b.ticker);
    db.player(b.guild_id, { id: b.bidder_id });
    db.addCash(b.guild_id, b.bidder_id, b.premium);
  });
  return { refunded: true, why, premium: b.premium };
}

// The owner fights it off. Returns { cost } or { error }
function defend(db, { guildId, user, ticker }) {
  const c = co.get(db, ticker);
  const b = c && bid(db, c.ticker);
  if (!b) return { error: 'nobid' };
  if (c.owner_id !== user.id) return { error: 'notowner' };
  const cost = Math.round(worth(c) * RULES.poisonPill);
  const p = db.player(guildId, user);
  if (p.cash < cost) return { error: 'cash', cost, have: p.cash };
  db.tx(() => { db.addCash(guildId, user.id, -cost); reserve.take(db, cost); });
  refund(db, b, 'defended');
  return { cost, bid: b };
}

// Each tick: bids whose 24 hours are up go through
function tick(db, now = Date.now()) {
  return db.raw.prepare('SELECT * FROM takeovers WHERE ends_at <= ?').all(now).map((b) => ({ bid: b, ...complete(db, b) }));
}

// ---- mergers ----
const proposalKey = (ticker) => `merge:${ticker}`;
function propose(db, from, into, now = Date.now()) {
  db.setMeta(proposalKey(into.ticker), JSON.stringify({ from: from.ticker, by: from.owner_id, until: now + RULES.mergeMs }));
}
function proposal(db, ticker, now = Date.now()) {
  try { const p = JSON.parse(db.meta(proposalKey(ticker)) || 'null'); return p && p.until > now ? p : null; } catch (e) { return null; }
}
const buyoutCost = (db, c) => (c.status === 'public' ? co.sharesHeld(db, c.ticker) * Math.round(c.price * 100) : 0);

// Merges two companies: the one with more worth absorbs the other. Returns { survivor, absorbed, paid } or { error }
function merge(db, a, b, now = Date.now()) {
  const [big, small] = worth(a) >= worth(b) ? [a, b] : [b, a];
  const cost = buyoutCost(db, small);
  if (big.treasury + small.treasury < cost) return { error: 'treasury', cost, have: big.treasury + small.treasury };
  return db.tx(() => {
    // Buy out the absorbed company's shareholders at its price
    const holders = db.raw.prepare('SELECT guild_id, user_id, shares FROM pc_holdings WHERE ticker = ? AND shares > 0').all(small.ticker);
    const price = Math.round((small.price || 0) * 100);
    for (const h of holders) { db.player(h.guild_id, { id: h.user_id }); db.addCash(h.guild_id, h.user_id, h.shares * price); }
    db.raw.prepare('DELETE FROM pc_holdings WHERE ticker = ?').run(small.ticker);
    db.raw.prepare('UPDATE players SET job = ? WHERE job = ?').run(big.ticker, small.ticker);
    co.update(db, big.ticker, { treasury: big.treasury + small.treasury - cost, level: Math.max(big.level, small.level) });
    co.update(db, small.ticker, { status: 'dead', price: 0, died_at: now, note: `Merged into ${big.name} (${big.ticker})`, treasury: 0 });
    db.setMeta(proposalKey(a.ticker), '');
    db.setMeta(proposalKey(b.ticker), '');
    return { survivor: co.get(db, big.ticker), absorbed: small, paid: cost, holders: holders.length };
  });
}

module.exports = { RULES, worth, bid, bidsBy, startBid, complete, refund, defend, tick, propose, proposal, merge, buyoutCost };
