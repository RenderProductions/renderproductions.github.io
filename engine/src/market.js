// Reads live market data from prices.json (written by the price workflow).
// The bot keeps a cached copy and refreshes it in the background.
// Later, the engine in .github/scripts/market can move in here so the bot ticks prices itself.
const config = require('./config');

const REFRESH_MS = 60 * 1000;
let data = null;
let fetchedAt = 0;
let inflight = null;

async function refresh() {
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

// Returns market data, refreshing if the cache is stale. Throws if nothing has ever loaded.
async function get() {
  if (!data || Date.now() - fetchedAt > REFRESH_MS) await refresh();
  if (!data) throw new Error('Market data is unavailable right now. Try again in a minute.');
  return data;
}

// Lets tests (or a future in-process engine) supply data directly.
function set(json) { data = json; fetchedAt = Date.now(); }

function startAutoRefresh() {
  refresh();
  return setInterval(refresh, REFRESH_MS).unref();
}

const toCents = (polygons) => Math.round(Number(polygons) * 100);

// Everything a command needs to know about one ticker.
function quote(m, ticker) {
  const id = String(ticker || '').toUpperCase();
  const c = (m.companies || []).find((x) => x.id === id);
  if (!c) return null;
  const marketOpen = !m.market || m.market.open !== false;
  const tradable = m.tradable ? m.tradable[id] !== false : true;
  return {
    id,
    name: c.name,
    priceCents: toCents(c.price),
    change: c.change,
    bankrupt: c.status === 'bankrupt' || !!c.bankrupt,
    statusText: (m.statusText && m.statusText[id]) || '',
    canTrade: marketOpen && tradable && c.status !== 'bankrupt',
    whyNot: !marketOpen ? 'The market is closed right now.'
      : c.status === 'bankrupt' ? `${c.name} is bankrupt. Trading is frozen.`
      : !tradable ? `${id} can't be traded right now.` : ''
  };
}

module.exports = { get, set, refresh, startAutoRefresh, quote, toCents };
