#!/usr/bin/env node
// Advances every company's price and rewrites prices.json in the repo root.
// Run by .github/workflows/update-prices.yml, or by hand:
//   node .github/scripts/tick.js            (only ticks if a tick is due)
//   node .github/scripts/tick.js --force    (always does one tick, ignoring the schedule)
//
// GitHub's scheduler is "best effort": runs can start late or get skipped.
// So the schedule is NOT trusted for timing. Every run checks the "updated"
// time in prices.json, works out how many 30 minute ticks are due, and applies
// all of them. A late run catches up; an early run does nothing.

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'prices.json');
const POINTS = 288;                       // history length kept per company (24 hours at 5 min per tick)
const INTERVAL_MS = 30 * 60 * 1000;      // one market tick = 30 minutes
const FORCE = process.argv.includes('--force');

// To add, remove, or rename a company, edit this list.
// volatility = how far a price can move in one tick (0.04 = up to 4%)
const COMPANIES = [
  { id: 'RRM',  name: 'Render Room',              description: 'The server itself, publicly traded.',  start: 120.00, volatility: 0.040 },
  { id: 'NACH', name: 'De Nacho',                 description: 'Nachos, at scale.',                     start: 45.50,  volatility: 0.050 },
  { id: 'BLU',  name: "Builder's League United",  description: 'Building things together, allegedly.',  start: 78.25,  volatility: 0.035 },
  { id: 'BNW',  name: 'Business Numbers Working', description: 'Numbers. Business. Working, mostly.',   start: 12.80,  volatility: 0.060 }
];

const round2 = (n) => Math.round(n * 100) / 100;

// Random move, with a gentle pull back toward the starting price
// so nothing drifts to zero or runs away forever.
function step(price, c) {
  const shock = (Math.random() - 0.5) * 2 * c.volatility;
  const pull = ((c.start - price) / c.start) * 0.02;
  return Math.max(1, round2(price * (1 + shock + pull)));
}

let existing = {};
let lastUpdated = NaN;
try {
  const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  (old.companies || []).forEach((c) => { existing[c.id] = c; });
  lastUpdated = Date.parse(old.updated);
} catch (e) {
  // No file yet (or unreadable): every company starts fresh below.
}

// ---- How many ticks are due? ----
const now = Date.now();
const rawDue = isNaN(lastUpdated) ? 1 : Math.floor((now - lastUpdated) / INTERVAL_MS);

if (rawDue < 1 && !FORCE) {
  console.log('Not due yet (' + Math.round((now - lastUpdated) / 60000) + ' min since last tick). Nothing to do.');
  process.exit(0);
}

const tooFarBehind = rawDue > POINTS;                  // more than a whole history window missed
const steps = Math.max(1, Math.min(rawDue, POINTS));

// Move "updated" forward by whole ticks so the 30 minute rhythm doesn't drift.
// If there is no previous time, we were forced, or we're hopelessly behind, use now.
const stamp = (isNaN(lastUpdated) || tooFarBehind || rawDue < 1)
  ? now
  : lastUpdated + steps * INTERVAL_MS;

const companies = COMPANIES.map((c) => {
  let history = existing[c.id] && Array.isArray(existing[c.id].history)
    ? existing[c.id].history.slice()
    : null;

  if (!history || history.length === 0) {
    // New company: build a believable past so the chart isn't empty.
    history = [c.start];
    while (history.length < POINTS) history.push(step(history[history.length - 1], c));
  } else {
    // Apply every tick that was due (usually 1; more if a run was late).
    for (let i = 0; i < steps; i++) history.push(step(history[history.length - 1], c));
  }
  history = history.slice(-POINTS);

  const price = history[history.length - 1];
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    price,
    change: round2((price / history[0] - 1) * 100), // percent vs. start of history
    history
  };
});

// Lookup tables so the Discord bot can read a value by ticker, e.g. prices.RRM
const prices = {};
const changes = {};
companies.forEach((c) => { prices[c.id] = c.price; changes[c.id] = c.change; });

const data = { updated: new Date(stamp).toISOString(), prices, changes, companies };

// Keep each history array on one line so commits stay readable.
const text = JSON.stringify(data, null, 2).replace(
  /\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g,
  (m, inner) => '[' + inner.replace(/\s+/g, ' ') + ']'
);

fs.writeFileSync(FILE, text + '\n');
console.log('Applied ' + steps + ' tick(s) to ' + companies.length + ' companies. updated = ' + data.updated);