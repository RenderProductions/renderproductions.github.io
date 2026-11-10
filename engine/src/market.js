// Reads live market data from prices.json (written by the price workflow).
// The bot keeps a cached copy and refreshes it in the background.
const config = require('./config');

const REFRESH_MS = 60 * 1000;
let data = null;
let fetchedAt = 0;
let inflight = null;
let local = false; // true when the bot runs the market itself (src/marketEngine.js)

async function refresh() {
  if (local) return data;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(config.pricesUrl + '?t=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.prices || !json.companies) throw new Error('prices.json has no prices');
      data = json;
      fetchedAt = Date.now();
    } catch (e) {
      console.warn('[market] Could not refresh prices:', e.message);
    } finally {
      inflight = null;
    }
    return data;
  })();
  return inflight;
}

// Returns market data, refreshing if the cache is stale. Returns null if nothing has ever loaded.
async function get() {
  if (!data || Date.now() - fetchedAt > REFRESH_MS) await refresh();
  return data;
}

// Lets tests (and the in-bot market) supply data directly.
function set(json) { data = json; fetchedAt = json ? Date.now() : 0; }
// Stop fetching prices.json: the bot makes its own
function useLocal() { local = true; }

function startAutoRefresh() {
  if (local) return null;
  refresh();
  return setInterval(refresh, REFRESH_MS).unref();
}

const ids = (m) => (m && m.companies ? m.companies.map((c) => c.id) : config.tickers);
const tickerList = (m) => ids(m).join(', ');

// Everything a command needs to know about one ticker, or null if it doesn't exist.
function quote(m, ticker) {
  const id = String(ticker || '').toUpperCase();
  const c = m && (m.companies || []).find((x) => x.id === id);
  if (!c) return null;
  const price = Number(m.prices && m.prices[id] !== undefined ? m.prices[id] : c.price);
  return {
    id,
    name: (m.names && m.names[id]) || c.name,
    price,
    priceCents: Math.round(price * 100),
    change: m.changes && m.changes[id] !== undefined ? m.changes[id] : c.change,
    status: (m.statuses && m.statuses[id]) || c.status || 'ok',
    statusText: (m.statusText && m.statusText[id]) || '',
    spark: (m.sparks && m.sparks[id]) || '',
    chart: (m.charts && m.charts[id]) || '',
    wipes: Number((m.wipes && m.wipes[id]) || 0)
  };
}

// The market-wide reason trading is blocked, or '' if it's open (same checks as BDFD).
function closedReason(m) {
  const mk = m.market || {};
  if (mk.status && mk.status !== 'open') return mk.text || 'The market is closed right now.';
  if (mk.halted === true) return mk.text || 'Trading is halted right now.';
  return '';
}

module.exports = { get, set, useLocal, refresh, startAutoRefresh, quote, closedReason, ids, tickerList };
