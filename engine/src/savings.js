// Savings accounts: lock Polygons away for 3, 7 or 14 days and get them back with interest.
// The Polygons you put in are still yours (they count toward net worth). The interest is a payout from the
// Polygon Reserve, so it shrinks while the reserve is low. Taking money out early gives back what you put
// in, without the interest.
const reserve = require('./reserve');
const DAY = 86400000;

const RULES = {
  plans: { 3: 200, 7: 600, 14: 1500 }, // days -> interest at the end, basis points (2%, 6%, 15%)
  min: 100_00,
  maxTotal: 50000_00,                  // most anyone can have locked away in one server
  maxAccounts: 3
};

const list = (db, guildId, userId) =>
  db.raw.prepare('SELECT * FROM savings WHERE guild_id = ? AND user_id = ? ORDER BY ends_at').all(guildId, userId);
const total = (db, guildId, userId) =>
  (db.raw.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM savings WHERE guild_id = ? AND user_id = ?').get(guildId, userId) || {}).n || 0;
const interest = (acct) => Math.floor(acct.amount * acct.rate / 10000);

// Opens an account. Returns { acct } or { error }
function open(db, guildId, userId, cents, days, now = Date.now()) {
  const rate = RULES.plans[days];
  if (!rate) return { error: 'plan' };
  if (cents < RULES.min) return { error: 'min' };
  const p = db.player(guildId, { id: userId });
  if (p.cash < cents) return { error: 'cash', have: p.cash };
  if (list(db, guildId, userId).length >= RULES.maxAccounts) return { error: 'accounts' };
  if (total(db, guildId, userId) + cents > RULES.maxTotal) return { error: 'max', room: RULES.maxTotal - total(db, guildId, userId) };
  return db.tx(() => {
    db.addCash(guildId, userId, -cents);
    const r = db.raw.prepare('INSERT INTO savings (guild_id, user_id, amount, rate, days, opened_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(guildId, userId, cents, rate, days, now, now + days * DAY);
    return { acct: db.raw.prepare('SELECT * FROM savings WHERE id = ?').get(Number(r.lastInsertRowid)) };
  });
}

// Closes an account: matured ones pay interest, early ones don't. Returns { amount, interest, early }
function close(db, acct, now = Date.now()) {
  const early = now < acct.ends_at;
  return db.tx(() => {
    db.raw.prepare('DELETE FROM savings WHERE id = ?').run(acct.id);
    const extra = early ? 0 : reserve.pay(db, interest(acct));
    db.addCash(acct.guild_id, acct.user_id, acct.amount + extra);
    return { amount: acct.amount, interest: extra, early, days: acct.days };
  });
}

// Pays out every account that has reached its end
function collect(db, guildId, userId, now = Date.now()) {
  return list(db, guildId, userId).filter((a) => a.ends_at <= now).map((a) => close(db, a, now));
}

module.exports = { RULES, DAY, list, total, interest, open, close, collect };
