// World events (Heists & Schemes): every few hours something happens across the whole Rend-Conomy for an
// hour, announced in the market news. Some follow the market: a booming company gets a hiring spree,
// a falling one gets a fire sale on shorts.
const config = require('./config');

const EVENTS = {
  labor_shortage: { emoji: '👷', name: 'Labor Shortage', desc: 'Nobody wants to work. Shifts and gigs pay **1.5x**.' },
  fish_frenzy:    { emoji: '🎣', name: 'Fish Frenzy', desc: 'The fish are biting! Cast every **90 seconds**, and plain bait works like a lure.' },
  police_strike:  { emoji: '🚔', name: 'Police Strike', desc: "TODD's security team walked out. Heists get **+15%** odds." },
  bear_rumors:    { emoji: '🐻', name: 'Bear Rumors', desc: 'Everyone smells a drop. Shorts open with **no fee**.' },
  chatty:         { emoji: '💬', name: 'Gossip Hour', desc: 'Chat pay is **doubled**, and so is the daily cap.' },
  spotlight:      { emoji: '🔦', name: 'Hiring Spree', desc: (t) => `**${t}** is hiring like crazy. Its shifts pay **2x**.` },
  fire_sale:      { emoji: '🔥', name: 'Fire Sale', desc: (t) => `**${t}** is sliding. Shorts on it open with **no fee**.` }
};
const RULES = { lengthMs: 60 * 60 * 1000, gapMinMs: 3 * 60 * 60 * 1000, gapMaxMs: 6 * 60 * 60 * 1000, firstMs: 60 * 60 * 1000 };
const KEY = 'world_event';

const read = (db) => { try { return JSON.parse(db.meta(KEY) || 'null') || {}; } catch (e) { return {}; } };
const write = (db, s) => db.setMeta(KEY, JSON.stringify(s));

// The event running right now, or null
function active(db, now = Date.now()) {
  const s = read(db);
  return s.id && s.until > now ? s : null;
}
const is = (db, id, ticker) => { const e = active(db); return !!e && e.id === id && (!ticker || e.ticker === ticker); };
const describe = (e) => { const E = EVENTS[e.id]; return `${E.emoji} **${E.name}**: ${typeof E.desc === 'function' ? E.desc(e.ticker) : E.desc}`; };

// Picks an event. Market-aware: a company up big gets a Hiring Spree, one down big gets a Fire Sale.
function pick(m, random = Math.random) {
  const changes = m && m.companies ? m.companies.map((c) => [c.id, Number((m.changes || {})[c.id] || 0)]).filter(([id]) => !m.statuses || m.statuses[id] !== 'bankrupt') : [];
  const up = changes.filter(([, x]) => x >= 8).sort((a, b) => b[1] - a[1])[0];
  const down = changes.filter(([, x]) => x <= -8).sort((a, b) => a[1] - b[1])[0];
  const r = random();
  if (up && r < 0.3) return { id: 'spotlight', ticker: up[0] };
  if (down && r < 0.6) return { id: 'fire_sale', ticker: down[0] };
  const plain = ['labor_shortage', 'fish_frenzy', 'police_strike', 'bear_rumors', 'chatty'];
  return { id: plain[Math.floor(random() * plain.length)] };
}

// Once per market tick. Returns the event that just started (to announce), or null.
function tick(db, m, now = Date.now(), random = Math.random) {
  const s = read(db);
  if (!s.next) { write(db, { next: now + RULES.firstMs }); return null; }
  if (s.id && s.until > now) return null;
  if (now < s.next) { if (s.id) write(db, { next: s.next }); return null; }
  const e = { ...pick(m, random), until: now + RULES.lengthMs };
  e.next = e.until + RULES.gapMinMs + Math.floor(random() * (RULES.gapMaxMs - RULES.gapMinMs));
  write(db, e);
  return e;
}

// Starts one right now (bot owner: r!event start <id> [ticker])
function start(db, id, ticker, now = Date.now()) {
  const e = { id, ticker: ticker || undefined, until: now + RULES.lengthMs, next: now + RULES.lengthMs + RULES.gapMinMs };
  write(db, e);
  return e;
}
function end(db, now = Date.now()) { write(db, { next: now + RULES.gapMinMs }); }

// Posts it to the market news
function announce(e) {
  if (!config.newsWebhook || !e) return;
  const body = JSON.stringify({
    username: 'Rend-Conomy Market', avatar_url: 'https://renderproductions.github.io/bot/market-icon.png',
    embeds: [{ color: 0x8c6239, title: '🌍 World event', description: `${describe(e)}\nFor the next hour. (\`${config.prefix}event\`)` }], allowed_mentions: { parse: [] }
  });
  for (const url of String(config.newsWebhook).split(/[\s,]+/).filter(Boolean)) {
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch((err) => console.error('[event] Could not post:', err.message));
  }
}

// ---- what each event changes ----
const workMult = (db, ticker) => (is(db, 'labor_shortage') ? 1.5 : 1) * (ticker && is(db, 'spotlight', ticker) ? 2 : 1);
const fishFrenzy = (db) => is(db, 'fish_frenzy');
const heistBonus = (db) => (is(db, 'police_strike') ? 0.15 : 0);
const noShortFee = (db, ticker) => is(db, 'bear_rumors') || is(db, 'fire_sale', ticker);
const chatMult = (db) => (is(db, 'chatty') ? 2 : 1);

module.exports = { EVENTS, RULES, active, is, describe, pick, tick, start, end, announce, workMult, fishFrenzy, heistBonus, noShortFee, chatMult };
