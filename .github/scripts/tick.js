#!/usr/bin/env node
// Moves the market forward one 5-minute step and rewrites prices.json.
// Run by .github/workflows/update-prices.yml, or by hand:  node .github/scripts/tick.js
//
// The engine itself is in market/engine.js, and every headline is in market/stories.js.
// Test the tuning without touching anything:              node .github/scripts/market/sim.js 7
//
// Hidden market state (fair values, moods, health, upcoming results) is saved in
// .github/market-state.json. If the repository secret MARKET_SECRET exists, that file is
// encrypted, so nobody can read the repo and see what the market is about to do.
// Without the secret it is saved as plain text (it still works, it's just peekable).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { tick } = require('./market/engine');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'prices.json');
const STATE_FILE = path.join(ROOT, '.github', 'market-state.json');
const SECRET = process.env.MARKET_SECRET || '';

function key() { return crypto.createHash('sha256').update(SECRET).digest(); }

function loadState() {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return null; }
  if (!raw.encrypted) return raw.state || null;
  if (!SECRET) {
    console.log('market-state.json is encrypted but MARKET_SECRET is not set; starting the hidden state fresh.');
    return null;
  }
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(raw.iv, 'base64'));
    d.setAuthTag(Buffer.from(raw.tag, 'base64'));
    const text = Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8');
    return JSON.parse(text);
  } catch (e) {
    console.log('Could not decrypt market-state.json (did MARKET_SECRET change?); starting the hidden state fresh.');
    return null;
  }
}

function saveState(state) {
  let out;
  if (SECRET) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([c.update(JSON.stringify(state), 'utf8'), c.final()]);
    out = { note: 'Hidden Rend-Conomy market state. Encrypted on purpose: no peeking.', encrypted: true,
      iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  } else {
    out = { note: 'Hidden Rend-Conomy market state. Add a MARKET_SECRET repository secret to encrypt this.', encrypted: false, state };
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(out) + '\n');
}

let old = {};
try { old = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch (e) { /* first run */ }

const result = tick({ old, state: loadState(), now: Date.now() });
if (result.skip) {
  console.log('Market closed; nothing to update.');
  process.exit(0);
}
const { data, state, posts } = result;

// Keep each history array on one line so commits stay readable.
const text = JSON.stringify(data, null, 2).replace(
  /\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g,
  (m, inner) => '[' + inner.replace(/\s+/g, ' ') + ']'
);

// The Discord queue lives in the runner's temp folder, never in the repo.
if (process.env.RUNNER_TEMP) {
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'market-posts.json'), JSON.stringify(posts));
  if (posts.length) console.log('Queued ' + posts.length + ' Discord post(s).');
}

fs.writeFileSync(FILE, text + '\n');
saveState(state);
const fresh = data.news.filter((n) => n.time === data.updated);
console.log('Updated ' + data.companies.length + ' companies at ' + data.updated +
  (fresh.length ? ' | NEWS: ' + fresh.map((n) => n.headline).join(' / ') : ''));
