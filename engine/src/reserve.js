// The Polygon Reserve: the house is not infinite.
// Every Polygon the bot hands out comes out of one global reserve (shared by every server), and every
// Polygon a player pays the bot goes back in:
//   out  work, daily, dividends, mystery box prizes, slots wins, TODD bailouts, starting Polygons,
//        selling stock (the bot buys it back), and the money a shift earns a player company
//   in   buying stock, shop items, slots bets, bailout repayments, company upkeep, listing and upgrade
//        fees, and whatever a dead company had left in its treasury
// Player-to-player money (loans, player company shares sold from the offering, salaries) never touches it.
// Below 25% payouts shrink. At zero a market crash starts. During the crash's recovery it slowly refills.
const { EventEmitter } = require('node:events');
const config = require('./config');

const RULES = {
  start: config.reserveStart,   // cents
  bands: [0.5, 0.25, 0.1, 0],    // warnings when it falls under each of these
  shrinkBelow: 0.25,             // payouts start shrinking under this level
  minPayout: 0.1,                // the smallest payouts get: TODD's emergency printer
  refillTo: 0.5,                 // the crash recovery refills it up to this level
  recrashHours: 12,              // after a reserve crash, wait this long before another can start
  crash: { severity: 'normal', warning_hours: '2', crash_hours: '24', recovery_hours: '48' }
};
const KEY = 'reserve';
const events = new EventEmitter();

function get(db) {
  const v = db.meta(KEY);
  if (v === null) { db.setMeta(KEY, RULES.start); return RULES.start; }
  return Number(v) || 0;
}
const level = (db) => get(db) / RULES.start;
// What share of a payout actually gets paid right now
function factor(db) {
  const l = level(db);
  return l >= RULES.shrinkBelow ? 1 : Math.max(RULES.minPayout, l / RULES.shrinkBelow);
}
const bandOf = (l) => RULES.bands.filter((b) => l <= b).length; // 0 = fine ... 4 = empty

// Moves Polygons in (+) or out (-) and raises an event when it crosses a warning line.
function move(db, cents) {
  cents = Math.round(cents);
  if (!cents) return;
  const before = get(db);
  const after = before + cents;
  db.setMeta(KEY, after);
  const b0 = bandOf(before / RULES.start), b1 = bandOf(after / RULES.start);
  if (b1 > b0) events.emit('low', { level: after / RULES.start, line: RULES.bands[b1 - 1], cents: after });
  if (b1 < b0 && b1 === 0 && before / RULES.start <= RULES.bands[0]) events.emit('safe', { level: after / RULES.start, cents: after });
}
const take = (db, cents) => move(db, Math.max(0, cents));     // a player paid the bot
const spend = (db, cents) => move(db, -Math.max(0, cents));   // the bot paid in full (trades, loans)
// A payout: shrinks when the reserve is low. Returns what actually gets paid.
function pay(db, cents) {
  const out = Math.round(Math.max(0, cents) * factor(db));
  move(db, -out);
  return out;
}

// One line for replies while payouts are shrunk
function note(db) {
  const f = factor(db);
  return f < 1 ? `\n🏦 *The Polygon Reserve is running low, so payouts are at ${Math.round(f * 100)}%. Buy stock and shop to fill it back up.*` : '';
}

function bar(l, width = 12) {
  const n = Math.max(0, Math.min(width, Math.round(l * width)));
  return '█'.repeat(n) + '░'.repeat(width - n);
}

// While a crash is recovering, the reserve refills toward 50% (call every 5 minutes).
function recover(db, m, tickMs = 5 * 60 * 1000) {
  const c = m && m.crash;
  if (!c || c.phase !== 'recovery' || level(db) >= RULES.refillTo) return 0;
  const hours = Math.max(1, (Date.parse(c.recoveryUntil) - Date.parse(c.crashUntil)) / 3600000);
  const step = Math.min(Math.round(RULES.start * RULES.refillTo / (hours * 3600000 / tickMs)), RULES.start * RULES.refillTo - get(db));
  if (step > 0) move(db, step);
  return step;
}

// At zero: start a market crash through the "Crash the market" workflow, once.
// Needs GITHUB_TOKEN with Actions: Read and write on the repo.
async function maybeCrash(db, m, now = Date.now()) {
  if (get(db) > 0 || (m && m.crash)) return { started: false };
  const last = Number(db.meta('reserve_crash_at')) || 0;
  if (now - last < RULES.recrashHours * 3600000) return { started: false };
  if (!config.githubToken) return { started: false, error: 'no GITHUB_TOKEN' };
  db.setMeta('reserve_crash_at', now);
  const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/actions/workflows/crash.yml/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rend-conomy-bot', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { action: 'start a crash', ...RULES.crash } })
  });
  if (!res.ok) {
    db.setMeta('reserve_crash_at', last); // try again next time
    return { started: false, error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` };
  }
  return { started: true };
}

function snapshot(db) {
  const cents = get(db);
  return { polygons: cents / 100, start: RULES.start / 100, level: Math.round(cents / RULES.start * 1000) / 1000, payouts: Math.round(factor(db) * 100) / 100 };
}

module.exports = { RULES, events, get, level, factor, move, take, spend, pay, note, bar, recover, maybeCrash, snapshot };
