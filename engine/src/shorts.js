// Short selling (Schemes): bet that a company's stock will fall.
// Opening a short borrows shares and sells them at today's price. You set aside half the position as
// margin (plus a 1% borrowing fee). Covering buys them back: if the price fell, you keep the difference;
// if it rose, the loss comes out of your margin. If the loss eats most of the margin, the short is
// covered for you (a margin call). If the company goes bankrupt, the short pays out in full.
// Profits come from the Polygon Reserve (and shrink when it's low); losses and fees go into it.
const reserve = require('./reserve');

const RULES = {
  maxShares: 100,     // per company, per player
  margin: 0.5,        // of the position's value, set aside when you open
  fee: 0.01,          // borrowing fee, of the position's value
  call: 0.9           // margin call once the loss reaches 90% of the margin
};

const list = (db, guildId, userId) => db.raw.prepare('SELECT * FROM shorts WHERE guild_id = ? AND user_id = ? ORDER BY ticker').all(guildId, userId);
const get = (db, guildId, userId, t) => db.raw.prepare('SELECT * FROM shorts WHERE guild_id = ? AND user_id = ? AND ticker = ?').get(guildId, userId, t) || null;

// The price a short settles at: 0 once the company has gone bankrupt since it was opened
function settlePrice(s, q) {
  if (!q) return s.entry;
  if (q.wipes > s.wipe_seen || q.status === 'bankrupt') return 0;
  return q.priceCents;
}
const pnl = (s, price) => (s.entry - price) * s.shares;
// What the position is worth to you right now (margin plus profit, never below 0)
const worth = (s, price) => Math.max(0, s.margin + pnl(s, price));

// Opens (or adds to) a short. Returns { short, fee } or { error }
function open(db, guildId, userId, q, qty) {
  if (!q || q.priceCents <= 0 || q.status === 'bankrupt') return { error: 'price' };
  const cur = get(db, guildId, userId, q.id);
  if ((cur ? cur.shares : 0) + qty > RULES.maxShares) return { error: 'max', room: RULES.maxShares - (cur ? cur.shares : 0) };
  const value = qty * q.priceCents;
  const margin = Math.ceil(value * RULES.margin);
  const fee = require('./worldEvents').noShortFee(db, q.id) ? 0 : Math.ceil(value * RULES.fee);
  const p = db.player(guildId, { id: userId });
  if (p.cash < margin + fee) return { error: 'cash', need: margin + fee, have: p.cash };
  return db.tx(() => {
    db.addCash(guildId, userId, -(margin + fee));
    reserve.take(db, fee);
    if (cur) {
      const shares = cur.shares + qty;
      const entry = Math.round((cur.entry * cur.shares + q.priceCents * qty) / shares);
      db.raw.prepare('UPDATE shorts SET shares = ?, entry = ?, margin = margin + ? WHERE guild_id = ? AND user_id = ? AND ticker = ?').run(shares, entry, margin, guildId, userId, q.id);
    } else {
      db.raw.prepare('INSERT INTO shorts (guild_id, user_id, ticker, shares, entry, margin, wipe_seen, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(guildId, userId, q.id, qty, q.priceCents, margin, q.wipes, Date.now());
    }
    return { short: get(db, guildId, userId, q.id), fee, margin };
  });
}

// Closes a short at a price. Returns { back, pnl, price }
function cover(db, s, price) {
  const p = pnl(s, price);
  return db.tx(() => {
    db.raw.prepare('DELETE FROM shorts WHERE guild_id = ? AND user_id = ? AND ticker = ?').run(s.guild_id, s.user_id, s.ticker);
    let back;
    if (p >= 0) back = s.margin + reserve.pay(db, p);
    else { const loss = Math.min(s.margin, -p); reserve.take(db, loss); back = s.margin - loss; }
    db.addCash(s.guild_id, s.user_id, back);
    return { back, pnl: back - s.margin, price, shares: s.shares, ticker: s.ticker, entry: s.entry };
  });
}

// Each market tick: margin calls and bankruptcies. Returns the shorts it closed.
function tick(db, m, quote) {
  const done = [];
  for (const s of db.raw.prepare('SELECT * FROM shorts').all()) {
    const q = quote(m, s.ticker);
    if (!q) continue;
    const price = settlePrice(s, q);
    if (price === 0) done.push({ ...cover(db, s, 0), why: 'bankrupt', s });
    else if (-pnl(s, price) >= s.margin * RULES.call) done.push({ ...cover(db, s, price), why: 'call', s });
  }
  return done;
}

// Total value of a player's shorts (for net worth)
function value(db, guildId, userId, m, quote) {
  return list(db, guildId, userId).reduce((t, s) => t + worth(s, settlePrice(s, m ? quote(m, s.ticker) : null)), 0);
}

module.exports = { RULES, list, get, open, cover, tick, value, pnl, worth, settlePrice };
