#!/usr/bin/env node
// Turns "start a crash" / "start a boost" choices into the settings the engine reads.
// Shared by the Actions-tab workflows (crash.yml, boost.yml) and the bot's r!crash and r!boost.
//   node .github/scripts/market/controls.js crash   (reads ACTION, SEVERITY, WARNING, CRASH, RECOVERY)
//   node .github/scripts/market/controls.js boost   (reads ACTION, STRENGTH, HOURS, TICKERS, HEADLINE)
// Each writes .github/market-crash.json or .github/market-boost.json.

const H = 3600 * 1000;
const TICKERS = ['RRM', 'NACH', 'BLU', 'BNW', 'BSTG'];
const num = (v, d, min) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) && n >= min ? n : d; };

// action: 'start' | 'end' (skip to recovery) | 'cancel'. Returns { settings } or { error }.
function crashSettings(cur, { action, severity, warning, crash, recovery } = {}, now = Date.now()) {
  cur = cur || {};
  let out;
  if (action === 'start') {
    if (severity && !['mild', 'normal', 'brutal'].includes(severity)) return { error: 'Severity is mild, normal or brutal.' };
    // A tremor of 0 hours needs one tick inside the window, so it is nudged to 5 minutes.
    const w = num(warning, 2, 0);
    const warn = Math.max(w, 5 / 60);
    out = { start: new Date(w === 0 ? now - warn * H : now).toISOString(), tremorHours: warn,
      crashHours: num(crash, 48, 1), recoveryHours: num(recovery, 72, 0), severity: severity || 'normal' };
  } else if (action === 'end') {
    if (!cur.start) return { error: 'No crash is running, so there is nothing to end.' };
    const t = cur.tremorHours || 2, c = cur.crashHours || 48;
    out = Object.assign({}, cur, { start: new Date(now - (t + c) * H - 60 * 1000).toISOString() });
  } else if (action === 'cancel') {
    out = Object.assign({}, cur, { start: null });
  } else return { error: 'Pick start, end or cancel.' };
  delete out.note;
  return { settings: out };
}

// action: 'start' | 'stop'. Returns { settings } or { error }.
function boostSettings(cur, { action, strength, hours, tickers, headline } = {}, now = Date.now()) {
  cur = cur || {};
  let out;
  if (action === 'start') {
    if (strength && !['small', 'normal', 'big'].includes(strength)) return { error: 'Strength is small, normal or big.' };
    const list = (Array.isArray(tickers) ? tickers : String(tickers || '').split(/[\s,]+/)).map((t) => String(t).toUpperCase()).filter(Boolean);
    const bad = list.filter((t) => !TICKERS.includes(t));
    if (bad.length) return { error: 'Unknown ticker(s): ' + bad.join(', ') + '. Use: ' + TICKERS.join(', ') };
    out = { start: new Date(now).toISOString(), hours: num(hours, 6, 0.1), strength: strength || 'normal', tickers: list,
      headline: String(headline || '').trim().slice(0, 200) };
  } else if (action === 'stop') {
    out = Object.assign({}, cur, { start: null });
  } else return { error: 'Pick start or stop.' };
  delete out.note;
  return { settings: out };
}

module.exports = { crashSettings, boostSettings, TICKERS };
