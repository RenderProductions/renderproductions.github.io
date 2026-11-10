// The rotating status: every entry produces sensible text, live ones skip when they should.
const assert = require('assert');
const path = require('path');
const db = require('../src/db').open(':memory:');
const statuses = require('../src/statuses');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const clone = (edit) => { const m = JSON.parse(JSON.stringify(base)); if (edit) edit(m); return m; };
const never = () => 0.99; // no breadcrumb

// Calm market: no crash, BSTG quiet, no player companies
const calm = clone((m) => { m.crash = { phase: 'none' }; m.changes.BSTG = 1.2; m.market.status = 'open'; m.market.halted = false; });
const seen = new Set();
for (let i = 0; i < statuses.STATUSES.length * 3; i++) {
  const s = statuses.next({ market: calm, db }, never);
  assert.ok(s.text && s.text.length <= 120, 'text: ' + JSON.stringify(s));
  assert.ok(['watching', 'listening', 'playing', 'competing', 'custom'].includes(s.type));
  seen.add(s.text);
}
const all = [...seen].join(' | ');
assert.ok(all.includes('🔔 Market open'), all);
assert.ok(/[A-Z]+ [▲▼] \d+\.\d\d%/.test(all), 'a ticker line: ' + all);
assert.ok(all.includes('Hiring at '), all);
assert.ok(!all.includes('CRASH'), 'no crash line in a calm market');
assert.ok(!all.includes('stupid'), 'BSTG line only on big swings');
assert.ok(!all.includes('player compan'), 'no company count when there are none');

// Wild market: crash on, BSTG swinging, after hours, a company exists
const wild = clone((m) => {
  m.crash = { phase: 'crash' }; m.changes.BSTG = -22; m.market.status = 'after-hours';
  m.market.nextOpen = new Date(Date.now() + 3 * 3_600_000 + 60_000).toISOString();
});
db.raw.exec("INSERT INTO pc_companies (ticker, name, owner_id, owner_guild, status, created_at) VALUES ('MEOW', 'Meow', '1', 'g', 'private', 1)");
const wildSeen = new Set();
for (let i = 0; i < statuses.STATUSES.length * 2; i++) wildSeen.add(statuses.next({ market: wild, db }, never).text);
const w = [...wildSeen].join(' | ');
assert.ok(w.includes('🚨 MARKET CRASH IN PROGRESS'), w);
assert.ok(w.includes('BSTG do something stupid'), w);
assert.ok(w.includes('🌙 After hours · opens in 3h'), w);
assert.ok(w.includes('1 player company'), w);

// The breadcrumb
assert.deepStrictEqual(statuses.next({ market: calm, db }, () => 0.01), { type: 'listening', text: '75.40' });

// Market data down: still shows something
for (let i = 0; i < 20; i++) assert.ok(statuses.next({ market: null, db }, never).text);

// Online dot follows the market
assert.strictEqual(statuses.presence(calm), 'online');
assert.strictEqual(statuses.presence(wild), 'idle');
assert.strictEqual(statuses.presence(clone((m) => { m.market.status = 'open'; m.market.halted = true; })), 'dnd');
assert.strictEqual(statuses.presence(null), 'online');

console.log('All status tests passed.');
