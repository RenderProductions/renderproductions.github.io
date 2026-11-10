// The bot's rotating status. It changes every 30 seconds, going down this list in order.
//
// Each entry is a type plus either fixed text or a function. Functions get live data
// ({ market, db }) and return text, or null to be skipped this time around.
//
//   watching  -> "Watching ..."     listening -> "Listening to ..."
//   playing   -> "Playing ..."      competing -> "Competing in ..."
//   custom    -> just the text, no prefix
//
// Add, remove, or reorder lines freely. Keep text under about 120 characters.

const co = require('./companies');

const ROTATE_MS = 30 * 1000;
const BREADCRUMB_CHANCE = 1 / 20; // how often the hidden frequency shows instead
const BREADCRUMB = { type: 'listening', text: '75.40' };

// Cycles through the companies, one per turn
let tickerTurn = 0;
function nextCompany(m) {
  if (!m || !m.companies || !m.companies.length) return null;
  const c = m.companies[tickerTurn++ % m.companies.length];
  const change = Number((m.changes && m.changes[c.id]) ?? c.change) || 0;
  return { id: c.id, name: (m.names && m.names[c.id]) || c.name, change };
}
const arrow = (n) => `${n >= 0 ? '▲' : '▼'} ${Math.abs(n).toFixed(2)}%`;

function hoursUntil(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return null;
  const h = Math.floor(ms / 3_600_000), m = Math.ceil((ms % 3_600_000) / 60_000);
  return h ? `${h}h` : `${m}m`;
}

const STATUSES = [
  // ---- live from the market ----
  { type: 'watching', text: ({ market: m }) => { const c = nextCompany(m); return c && `${c.id} ${arrow(c.change)}`; } },
  { type: 'custom', text: ({ market: m }) => {
    if (!m || !m.market) return null;
    if (m.market.status === 'open' && !m.market.halted) return '🔔 Market open';
    if (m.market.halted) return '🛑 Trading halted';
    const left = hoursUntil(m.market.nextOpen);
    return `🌙 After hours${left ? ` · opens in ${left}` : ''}`;
  } },
  { type: 'custom', text: ({ market: m }) => (m && m.crash && m.crash.phase === 'crash' ? '🚨 MARKET CRASH IN PROGRESS' : null) },
  { type: 'watching', text: ({ db }) => {
    const n = co.list(db, ['public', 'private']).length;
    return n ? `${n} player compan${n === 1 ? 'y' : 'ies'}` : null;
  } },
  { type: 'watching', text: ({ market: m }) => {
    const change = Number(m && m.changes && m.changes.BSTG);
    return Math.abs(change) >= 10 ? 'BSTG do something stupid' : null;
  } },

  // ---- helpful ----
  { type: 'custom', text: 'r!help · /help' },
  { type: 'custom', text: 'Start a company: r!found' },
  { type: 'custom', text: 'Free Polygons: r!daily' },
  { type: 'custom', text: ({ market: m }) => { const c = nextCompany(m); return c && `Hiring at ${c.name}: r!apply ${c.id}`; } },

  // ---- flavor ----
  { type: 'listening', text: 'TODD count Polygons' },
  { type: 'custom', text: 'TODD is SO patient.' },
  { type: 'playing', text: 'the market' },
  { type: 'competing', text: 'the Rend-Sino' },
  { type: 'watching', text: 'the little guys run' }
];

// Picks the next status, skipping entries that have nothing to say right now.
let turn = 0;
function next(data, random = Math.random) {
  if (random() < BREADCRUMB_CHANCE) return BREADCRUMB;
  for (let tries = 0; tries < STATUSES.length; tries++) {
    const s = STATUSES[turn++ % STATUSES.length];
    let text = null;
    try { text = typeof s.text === 'function' ? s.text(data) : s.text; } catch (e) { text = null; }
    if (text) return { type: s.type, text: String(text).slice(0, 120) };
  }
  return { type: 'custom', text: 'r!help · /help' };
}

// The bot's online dot follows the market: online while trading, idle when closed,
// do not disturb while trading is halted. Online if the market data can't be reached.
function presence(m) {
  if (!m || !m.market) return 'online';
  if (m.market.halted) return 'dnd';
  return m.market.status === 'open' ? 'online' : 'idle';
}

module.exports = { STATUSES, ROTATE_MS, next, presence, BREADCRUMB };
