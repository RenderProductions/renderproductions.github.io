// Publishes player companies to the site. The bot writes player-companies.json as the only file
// on the repo's "data" branch (so it never triggers a site rebuild or touches main), and the
// exchange page reads it from raw.githubusercontent.com. Needs GITHUB_TOKEN; does nothing without it.
const config = require('./config');
const co = require('./companies');
const reserve = require('./reserve');
const botstats = require('./botstats');

const API = 'https://api.github.com';
const FILE = 'player-companies.json';
let lastBody = '';

// Everything the exchange page shows
function snapshot(db, now = Date.now()) {
  const card = (c) => ({
    ticker: c.ticker,
    name: c.name,
    owner: c.owner_name || 'unknown',
    level: c.level,
    levelName: co.level(c).name,
    status: c.status,
    price: c.status === 'public' ? c.price : null,
    change: c.status === 'public' ? Math.round(co.change(c) * 100) / 100 : null,
    history: c.status === 'public' ? c.history.filter((_, i, a) => i % 3 === 0 || i === a.length - 1) : [],
    treasury: c.treasury / 100,
    upkeep: co.level(c).upkeep / 100,
    strikes: c.strikes,
    employees: co.employees(db, c.ticker),
    available: c.status === 'public' ? co.RULES.float - co.sharesHeld(db, c.ticker) : null,
    offeringLeft: c.status === 'public' ? c.offering_left : null,
    founded: new Date(c.approved_at || c.created_at).toISOString(),
    ipo: c.ipo_at ? new Date(c.ipo_at).toISOString() : null
  });
  const weekAgo = now - 7 * co.RULES.dayMs;
  return {
    companies: co.list(db, ['public', 'private']).map(card),
    closed: co.list(db, ['dead']).filter((c) => c.died_at >= weekAgo)
      .sort((a, b) => b.died_at - a.died_at).slice(0, 10)
      .map((c) => ({ ticker: c.ticker, name: c.name, owner: c.owner_name || 'unknown', levelName: co.level(c).name, died: new Date(c.died_at).toISOString(), cause: c.note })),
    levels: co.LEVELS.map((l) => ({ name: l.name, cost: l.cost / 100, upkeep: l.upkeep / 100, payMult: l.payMult })),
    reserve: reserve.snapshot(db),
    bot: botstats.count(db),
    rules: { ipoLevel: co.RULES.ipoLevel, listingFee: co.RULES.listingFee / 100, float: co.RULES.float, founding: co.LEVELS[0].cost / 100 }
  };
}

async function gh(path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${config.githubToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'rend-conomy-bot',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Writes the file as the only commit on the data branch, replacing the previous one.
// Keeping a single commit means the branch never grows, no matter how often it updates.
async function publish(db) {
  if (!config.githubToken) return false;
  const data = snapshot(db);
  const m = require('./marketEngine').latest();
  const body = JSON.stringify(data) + (m ? m.updated : '');
  if (body === lastBody) return false; // nothing changed
  const repo = config.githubRepo;
  const files = { [FILE]: JSON.stringify({ updated: new Date().toISOString(), ...data }, null, 1) };
  // When the bot runs the market, the prices go on the data branch too
  const prices = require('./marketEngine').latest();
  if (prices) files['prices.json'] = JSON.stringify(prices);

  const tree = await gh(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ tree: await Promise.all(Object.entries(files).map(async ([path, content]) => {
      const blob = await gh(`/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) });
      return { path, mode: '100644', type: 'blob', sha: blob.sha };
    })) })
  });
  const commit = await gh(`/repos/${repo}/git/commits`, {
    method: 'POST', body: JSON.stringify({ message: 'Update site data', tree: tree.sha, parents: [] })
  });
  const ref = `heads/${config.dataBranch}`;
  if (await gh(`/repos/${repo}/git/ref/${ref}`)) {
    await gh(`/repos/${repo}/git/refs/${ref}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: true }) });
  } else {
    await gh(`/repos/${repo}/git/refs`, { method: 'POST', body: JSON.stringify({ ref: `refs/${ref}`, sha: commit.sha }) });
    console.log(`[publish] Created the ${config.dataBranch} branch`);
  }
  lastBody = body;
  return true;
}

// Publishes now and every 10 minutes. Errors are logged, never fatal.
function start(db) {
  if (!config.githubToken) {
    console.log('[publish] No GITHUB_TOKEN, so player companies stay off the site for now.');
    return null;
  }
  const run = () => publish(db).then((did) => did && console.log('[publish] Player companies updated on the site'))
    .catch((e) => console.error('[publish] Could not update the site:', e.message));
  setTimeout(run, 30_000).unref();
  return setInterval(run, 10 * 60 * 1000).unref();
}

module.exports = { snapshot, publish, start, FILE };
