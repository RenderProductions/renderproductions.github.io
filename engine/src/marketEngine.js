// Runs the market inside the bot (MARKET_ENGINE=bot), instead of the GitHub Action.
// Uses the exact same engine (.github/scripts/market/engine.js), every 5 minutes on the dot:
//   * prices, the hidden market state and the crash/boost settings are saved in the bot's database
//   * news goes to the market news webhook (NEWS_WEBHOOK)
//   * prices.json is published to the data branch with the player companies, for the site
// The first time it runs it picks up where the GitHub Action left off: the live prices.json, the
// hidden state (needs MARKET_SECRET if it's encrypted), and the current crash and boost settings.
// The Actions-tab "Crash the market" and "Boost the market" buttons keep working: the bot checks
// those files every tick and adopts any change. r!crash and r!boost change them directly.
const crypto = require('node:crypto');
const config = require('./config');
const market = require('./market');

const ENGINE = require('../../.github/scripts/market/engine');
const NEWS = require('../../.github/scripts/post-news');
const controls = require('../../.github/scripts/market/controls');

const enabled = () => config.marketEngine === 'bot';
const K = { old: 'mk_old', state: 'mk_state', crash: 'mk_crash', boost: 'mk_boost', seenCrash: 'mk_seen_crash', seenBoost: 'mk_seen_boost', nudges: 'mk_nudges' };
let latest = null;   // the newest prices.json
let running = false;

const getJson = (db, key) => { try { return JSON.parse(db.meta(key) || 'null'); } catch (e) { return null; } };
const setJson = (db, key, v) => db.setMeta(key, JSON.stringify(v));

// A file from the repo's main branch (through the API when there's a token, so it isn't cached)
async function repoFile(path) {
  const url = config.githubToken
    ? `https://api.github.com/repos/${config.githubRepo}/contents/${path}?ref=main`
    : `https://raw.githubusercontent.com/${config.githubRepo}/main/${path}?t=${Date.now()}`;
  const headers = { 'User-Agent': 'rend-conomy-bot' };
  if (config.githubToken) Object.assign(headers, { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github.raw' });
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
}

// Same format tick.js saves (.github/market-state.json), encrypted with MARKET_SECRET or not
function openState(raw) {
  if (!raw || !raw.encrypted) return (raw && raw.state) || null;
  if (!config.marketSecret) { console.log('[market] The hidden state is encrypted and MARKET_SECRET is not set; starting it fresh.'); return null; }
  try {
    const key = crypto.createHash('sha256').update(config.marketSecret).digest();
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
    d.setAuthTag(Buffer.from(raw.tag, 'base64'));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8'));
  } catch (e) { console.log('[market] Could not decrypt the hidden state (wrong MARKET_SECRET?); starting it fresh.'); return null; }
}

function setCrash(db, settings) { setJson(db, K.crash, settings); ENGINE.configure({ crash: settings }); }
function setBoost(db, settings) { setJson(db, K.boost, settings); ENGINE.configure({ boost: settings }); }
const crash = (db) => getJson(db, K.crash) || {};
const boost = (db) => getJson(db, K.boost) || {};

// Adopts a change made from the Actions tab (the files on main)
async function syncControls(db) {
  for (const [file, seen, set] of [['.github/market-crash.json', K.seenCrash, setCrash], ['.github/market-boost.json', K.seenBoost, setBoost]]) {
    try {
      const text = await repoFile(file);
      if (text === db.meta(seen)) continue;
      const first = db.meta(seen) === null;
      db.setMeta(seen, text);
      const s = JSON.parse(text); delete s.note;
      // On the first look, only adopt the file if the bot has no settings of its own yet
      if (!first || !db.meta(set === setCrash ? K.crash : K.boost)) { set(db, s); if (!first) console.log(`[market] Picked up a change to ${file} from the Actions tab`); }
    } catch (e) { /* GitHub unreachable: keep what we have */ }
  }
}

// First run: continue from where the GitHub Action left off
async function seed(db) {
  if (getJson(db, K.old)) return;
  try {
    const res = await fetch(config.pricesUrl + '?t=' + Date.now(), { cache: 'no-store' });
    if (res.ok) setJson(db, K.old, await res.json());
  } catch (e) { console.warn('[market] Could not load the current prices to start from:', e.message); }
  try { setJson(db, K.state, openState(JSON.parse(await repoFile('.github/market-state.json')))); } catch (e) { /* start fresh */ }
  console.log('[market] Took over the market from', (getJson(db, K.old) || {}).updated || 'scratch');
}

// One 5-minute step
async function step(db, now = Date.now()) {
  const old = getJson(db, K.old) || {};
  const nudges = getJson(db, K.nudges) || {};
  const r = ENGINE.tick({ old, state: getJson(db, K.state), now, nudges });
  if (r.skip) return null;
  db.setMeta(K.nudges, '{}');
  setJson(db, K.old, r.data);
  setJson(db, K.state, r.state);
  latest = r.data;
  market.set(r.data);
  if (r.posts.length && config.newsWebhook) {
    NEWS.send(r.posts, config.newsWebhook.split(/[\s,]+/).filter(Boolean), { log: (m) => console.log('[market]', m) })
      .catch((e) => console.error('[market] News post failed:', e.message));
  }
  require('./publish').publish(db).catch((e) => console.error('[market] Could not publish prices:', e.message));
  return r.data;
}

async function run(db) {
  if (running) return;
  running = true;
  try {
    await syncControls(db);
    await step(db);
  } catch (e) { console.error('[market] Tick failed:', e); }
  finally { running = false; }
}

async function start(db) {
  if (!enabled()) return false;
  market.useLocal();
  await seed(db);
  ENGINE.configure({ crash: crash(db), boost: boost(db) });
  latest = getJson(db, K.old);
  if (latest) market.set(latest);
  await run(db);
  // Line up with the 5-minute marks, like the Action did
  const wait = ENGINE.TICK_MS - (Date.now() % ENGINE.TICK_MS) + 2000;
  setTimeout(() => { run(db); setInterval(() => run(db), ENGINE.TICK_MS).unref(); }, wait).unref();
  console.log('[market] Running the market in the bot (MARKET_ENGINE=bot)');
  return true;
}

// Work shifts nudge a company's stock (log terms, applied on the next tick). Only when the bot runs the market.
function nudge(db, ticker, amount) {
  if (!enabled() || !amount) return;
  const n = getJson(db, K.nudges) || {};
  n[ticker] = (n[ticker] || 0) + amount;
  setJson(db, K.nudges, n);
}

// For r!crash / r!boost and the Polygon Reserve: change the settings and tick right away.
async function control(db, kind, input) {
  const r = kind === 'crash' ? controls.crashSettings(crash(db), input) : controls.boostSettings(boost(db), input);
  if (r.error) return r;
  (kind === 'crash' ? setCrash : setBoost)(db, r.settings);
  await run(db);
  return r;
}

// The same thing through the GitHub workflows, for when the Action runs the market
async function dispatch(workflow, inputs) {
  if (!config.githubToken) return { error: 'The bot needs GITHUB_TOKEN (with Actions: Read and write) to do that.' };
  const res = await fetch(`https://api.github.com/repos/${config.githubRepo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rend-conomy-bot', 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs })
  });
  return res.ok ? { ok: true } : { error: `GitHub ${res.status}: ${(await res.text()).slice(0, 200)}` };
}

module.exports = { enabled, start, step, run, control, nudge, dispatch, crash, boost, setCrash, setBoost, latest: () => latest, openState };
