#!/usr/bin/env node
// Advances every company's price by one step and rewrites prices.json
// in the repo root. Run by .github/workflows/update-prices.yml, or by hand:
//   node .github/scripts/tick.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '..', 'prices.json');
const POINTS = 48; // history length kept per company (about 24 hours at 30 min per tick)

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
try {
  const old = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  (old.companies || []).forEach((c) => { existing[c.id] = c; });
} catch (e) {
  // No file yet (or unreadable): every company starts fresh below.
}

const companies = COMPANIES.map((c) => {
  let history = existing[c.id] && Array.isArray(existing[c.id].history)
    ? existing[c.id].history.slice()
    : null;

  if (!history || history.length === 0) {
    // New company: build a believable past so the chart isn't empty.
    history = [c.start];
    while (history.length < POINTS) history.push(step(history[history.length - 1], c));
  } else {
    history.push(step(history[history.length - 1], c));
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

const data = { updated: new Date().toISOString(), companies };

// Keep each history array on one line so commits stay readable.
const text = JSON.stringify(data, null, 2).replace(
  /\[\s+(-?[\d.]+(?:,\s+-?[\d.]+)*)\s+\]/g,
  (m, inner) => '[' + inner.replace(/\s+/g, ' ') + ']'
);

fs.writeFileSync(FILE, text + '\n');
console.log('Updated ' + companies.length + ' companies at ' + data.updated);
