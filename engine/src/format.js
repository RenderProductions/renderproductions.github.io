// Helpers for showing money, times, and text the same way everywhere.
const config = require('./config');

// 123456 cents -> "1,234.56"
function money(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return sign + whole + '.' + String(abs % 100).padStart(2, '0');
}

// "1,234.56 Polygons"
const poly = (cents) => money(cents) + ' Polygons';

// Discord timestamp that shows as "in 3 hours" for each viewer
const relTime = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

// Parses a Polygon amount typed by a player ("12.5") into cents, or null if it isn't a number.
function parsePolygons(text) {
  const s = String(text || '').trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

// Eastern date like "2026-11-09" for a timestamp
function day(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

// The next midnight in the market's time zone, as a ms timestamp
function nextMidnight(ms) {
  const [y, mo, d] = day(ms).split('-').map(Number);
  const target = day(Date.UTC(y, mo - 1, d + 1, 12)); // tomorrow's date there
  // Midnight Eastern is 4 or 5 hours after midnight UTC depending on daylight saving.
  for (let h = 0; h <= 14; h++) {
    const t = Date.UTC(y, mo - 1, d + 1, h);
    if (day(t) === target && day(t - 1) !== target) return t;
  }
  return ms + 24 * 60 * 60 * 1000;
}

module.exports = { money, poly, relTime, parsePolygons, day, nextMidnight };
