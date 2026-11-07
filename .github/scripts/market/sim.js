#!/usr/bin/env node
// Runs the market engine forward in memory and prints how it behaved. Writes nothing.
//   node .github/scripts/market/sim.js        (7 days, starting from today's prices.json)
//   node .github/scripts/market/sim.js 30     (30 days)
//   node .github/scripts/market/sim.js 7 fresh (start every company from its start price)

const fs = require('fs');
const path = require('path');
const { tick, COMPANIES, TICK_MS } = require('./engine');

const days = Number(process.argv[2]) || 7;
const fresh = process.argv[3] === 'fresh';
let old = {};
if (!fresh) { try { old = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'prices.json'), 'utf8')); } catch (e) {} }

let state = null;
let now = Date.now();
now -= now % TICK_MS;
const start = {};
(old.companies || []).forEach((c) => { start[c.id] = c.price; });

const daily = {};      // id -> [{lo, hi, first, last}]
const counts = {};     // news type -> count
const swings = {};
let posts = 0;
COMPANIES.forEach((c) => { daily[c.id] = []; swings[c.id] = 0; });

for (let i = 0; i < (days * 24 * 60 * 60 * 1000) / TICK_MS; i++) {
  const r = tick({ old, state, now });
  if (!r.skip) {
    old = r.data; state = r.state;
    r.data.news.filter((n) => n.time === r.data.updated).forEach((n) => { counts[n.type] = (counts[n.type] || 0) + 1; });
    r.posts.forEach((p) => { posts++; if (p.kind === 'swing') swings[p.id]++; });
    const day = Math.floor(i / 288);
    r.data.companies.forEach((c) => {
      const d = daily[c.id][day] || (daily[c.id][day] = { lo: c.price, hi: c.price, first: c.price, last: c.price });
      d.lo = Math.min(d.lo, c.price); d.hi = Math.max(d.hi, c.price); d.last = c.price;
    });
  }
  now += TICK_MS;
}

console.log('Simulated ' + days + ' days' + (fresh ? ' from start prices' : ' from current prices.json') + '\n');
console.log('TICKER  START    END      MIN      MAX      avg day range  avg |day move|  worst day  best day  swings');
COMPANIES.forEach((c) => {
  const d = daily[c.id];
  const ranges = d.map((x) => x.hi / x.lo - 1);
  const movesPct = d.map((x) => x.last / x.first - 1);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const s0 = start[c.id] != null ? start[c.id] : d[0].first;
  console.log(
    c.id.padEnd(7),
    String(s0.toFixed(2)).padEnd(8),
    String(d[d.length - 1].last.toFixed(2)).padEnd(8),
    String(Math.min(...d.map((x) => x.lo)).toFixed(2)).padEnd(8),
    String(Math.max(...d.map((x) => x.hi)).toFixed(2)).padEnd(8),
    ((avg(ranges) * 100).toFixed(1) + '%').padEnd(14),
    ((avg(movesPct.map(Math.abs)) * 100).toFixed(1) + '%').padEnd(15),
    ((Math.min(...movesPct) * 100).toFixed(1) + '%').padEnd(10),
    ((Math.max(...movesPct) * 100).toFixed(1) + '%').padEnd(9),
    swings[c.id]
  );
});
console.log('\nNews by type:', counts);
console.log('Discord posts:', posts);
