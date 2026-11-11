// 7-day price history (Heists & Schemes): the closing price of every company each hour, for a week.
// Kept in the bot's database (a few thousand rows at most) and published to the site as history-7d.json,
// so the company pages can show a 7-day chart next to the 24-hour one.
const HOUR = 60 * 60 * 1000;
const KEEP = 7 * 24 * HOUR;

// Saves this hour's price for every company (the main five and listed player companies)
function record(db, m, now = Date.now()) {
  const hour = Math.floor(now / HOUR) * HOUR;
  const put = db.raw.prepare('INSERT OR REPLACE INTO price_history (ticker, hour, price) VALUES (?, ?, ?)');
  db.tx(() => {
    if (m && m.prices) for (const [t, p] of Object.entries(m.prices)) if (Number.isFinite(Number(p))) put.run(t, hour, Number(p));
    for (const c of require('./companies').list(db, ['public'])) if (Number.isFinite(c.price)) put.run(c.ticker, hour, c.price);
    db.raw.prepare('DELETE FROM price_history WHERE hour < ?').run(now - KEEP);
  });
}

// { ticker: [[hourMs, price], ...] } oldest first
function all(db) {
  const out = {};
  for (const r of db.raw.prepare('SELECT ticker, hour, price FROM price_history ORDER BY hour').all()) (out[r.ticker] = out[r.ticker] || []).push([r.hour, Math.round(r.price * 100) / 100]);
  return out;
}
const of = (db, ticker) => all(db)[ticker] || [];

// What the site reads
function snapshot(db) { return { updated: new Date().toISOString(), hourly: all(db) }; }

module.exports = { HOUR, KEEP, record, all, of, snapshot };
