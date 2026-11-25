/* ==========================================================
   Render's File Tycoon · RenderOS (rebuilt for Site Care, Nov 2026)
   An idle desktop: services make files, files sell to the Rend-Conomy companies at live market prices,
   processing makes them worth more, hardware sets what the PC can run, contracts pay for batches, and
   Reformat trades everything for Format Points. Logged in, earnings cash out into the RendConomy wallet
   (⬡5 per ⬡1,000, ⬡500 a day, checked by the bot) and achievements unlock in the bot.
   Saves in localStorage (rft_save_v2). The old node-wiring game's save (rft_save_v1) isn't read.
   ========================================================== */
(function () {
'use strict';

/* ---------------------------------------------------------------- the numbers */

// Services, cheapest first. rate: files a second per service; cpu: CPU points each.
const SERVICES = [
  { id: 'doc',  name: 'Doc Scraper',      file: 'Document', value: 8,   rate: 0.125, cost: 15,          cpu: 1 },
  { id: 'ebook',name: 'Ebook Ripper',     file: 'Ebook',    value: 14,  rate: 0.43,  cost: 100,         cpu: 2 },
  { id: 'img',  name: 'Image Crawler',    file: 'Image',    value: 18,  rate: 2.2,   cost: 1100,        cpu: 3 },
  { id: 'aud',  name: 'Audio Grabber',    file: 'Audio',    value: 45,  rate: 5.6,   cost: 12000,       cpu: 5 },
  { id: 'arc',  name: 'Archive Mirror',   file: 'Archive',  value: 200, rate: 7.5,   cost: 130000,      cpu: 8 },
  { id: 'vid',  name: 'Video Puller',     file: 'Video',    value: 220, rate: 41,    cost: 1400000,     cpu: 12 },
  { id: 'soft', name: 'Software Depot',   file: 'Software', value: 380, rate: 158,   cost: 20000000,    cpu: 18 },
  { id: 'db',   name: 'Database Dumper',  file: 'Database', value: 550, rate: 727,   cost: 330000000,   cpu: 25 }
];
const GROWTH = 1.15;   // each service costs this much more than the last

// Which company buys which files (BSTG buys anything, see the hot pick).
const BUYERS = { BNW: ['Document', 'Database'], BLU: ['Software', 'Archive'], RRM: ['Video', 'Audio'], NACH: ['Image', 'Ebook'] };
const BUYER_OF = {}; Object.keys(BUYERS).forEach((t) => BUYERS[t].forEach((f) => { BUYER_OF[f] = t; }));
const NAMES = { BNW: 'Bits & Wires', BLU: 'Blue Moon', RRM: 'RRM', NACH: 'De Nacho', BSTG: 'Bastardly Glory' };

// Processing: each level adds `per` to the value of the files listed.
const PROCESSING = [
  { id: 'scanner',   name: 'File Scanner',    per: 0.05, files: 'all',                                        cost: 200 },
  { id: 'metadata',  name: 'Metadata Tagger', per: 0.10, files: ['Image', 'Audio', 'Ebook', 'Document'],    cost: 1200 },
  { id: 'antivirus', name: 'Antivirus',       per: 0.15, files: ['Software', 'Archive'],                     cost: 3000 },
  { id: 'compressor',name: 'Compressor',      per: 0.12, files: ['Archive', 'Video', 'Database'],           cost: 8000 },
  { id: 'decoder',   name: 'File Decoder',    per: 0.15, files: ['Video', 'Audio'],                          cost: 20000 },
  { id: 'encryptor', name: 'Encryptor',       per: 0.18, files: ['Database', 'Software', 'Document'],       cost: 60000 }
];
const PROC_GROWTH = 3, PROC_MAX = 10;

// Hardware: five slots, five tiers each (the last ones are the old game's jokes, now reachable).
const HARDWARE = {
  cpu: { label: 'CPU', what: 'CPU points: over the limit, everything slows down', tiers: [
    ['Intel i3-12100', 100, 0], ['Intel i5-13600K', 260, 600], ['Intel i7-14700K', 700, 9000], ['AMD Threadripper', 2000, 180000], ['The Gregulator', 60000, 1e9]] },
  ram: { label: 'RAM', what: 'how many services you can have', tiers: [
    ['8 GB DDR4', 20, 0], ['16 GB DDR4', 50, 400], ['32 GB DDR5', 120, 6000], ['128 GB DDR5', 300, 120000], ['264 GB MOTHERLOAD', 2000, 1e9]] },
  storage: { label: 'Storage', what: 'hours your PC keeps working while you\'re away', tiers: [
    ['240 GB SATA SSD', 1, 0], ['1 TB HDD', 2, 300], ['2 TB NVMe', 4, 5000], ['16 TB NAS RAID', 8, 90000], ['400 TB KICKER', 24, 1e9]] },
  nic: { label: 'Network', what: 'files sell for more', tiers: [
    ['WiFi 5 (onboard)', 1, 0], ['1 GbE Ethernet', 1.2, 500], ['2.5 GbE Ethernet', 1.45, 7000], ['10 GbE SFP+', 1.75, 140000], ['GOD HELP US', 3, 1e9]] },
  cooler: { label: 'Cooler', what: 'the temperature where it throttles', tiers: [
    ['Stock Cooler', 75, 0], ['Tower Air', 82, 400], ['240mm AIO', 88, 6000], ['Custom Loop', 95, 120000], ['Liquid Nitrogen', 999, 1e9]] }
};
const THROTTLE = 0.6;   // production while too hot

const CONTRACT = { offers: 3, active: 3, everyMs: 75000, minS: 180, maxS: 480, bonus: 2.5, needAt: 0.6 };
const REFORMAT = { at: 1e6, perPoint: 0.10 };
const CASH = { perThousand: 5, cap: 500 };   // what the bot pays (it checks); shown here
const SECRETS = {
  rft_backstage_market: { name: 'Backstage Market', what: 'everything sells for 25% more, no questions asked', sell: 1.25 },
  rft_honeypot: { name: 'Honeypot', what: 'catches junk before it clogs things: +10% production', make: 1.10 }
};
const ACH = [
  { id: 'rft_first_byte', name: 'First Byte', how: 'Sell your first file', bot: true },
  { id: 'rft_six_figures', name: 'Six Figures', how: 'Earn ⬡100,000', bot: true },
  { id: 'rft_gregulator', name: 'The Gregulator', how: 'Install The Gregulator', bot: true },
  { id: 'rft_fresh_install', name: 'Fresh Install', how: 'Reformat', bot: true },
  { id: 'rft_contractor', name: 'Contractor', how: 'Finish 50 contracts', bot: true },
  { id: 'rft_backdoor', name: '???', how: 'A secret', bot: true }
];

/* ---------------------------------------------------------------- the state */

const SAVE = 'rft_save_v2', OLD = 'rft_save_v1', FLAGS = 'rp_flags';
function fresh(keep) {
  const s = { v: 2, money: 50, run: 0, earned: 0, sold: 0, svc: {}, proc: {}, hw: { cpu: 0, ram: 0, storage: 0, nic: 0, cooler: 0 },
    offers: [], active: [], done: 0, nextOffer: 0, pts: 0, resets: 0, ach: {}, sent: {}, claimed: {}, frac: {}, seen: Date.now() };
  if (keep) ['earned', 'sold', 'done', 'pts', 'resets', 'ach', 'sent', 'claimed'].forEach((k) => { s[k] = keep[k]; });
  return s;
}
let G = fresh();
const flags = () => { try { return JSON.parse(localStorage.getItem(FLAGS)) || {}; } catch (e) { return {}; } };
const secret = (id) => !!flags()[id];
function setFlag(name) { const f = flags(); if (!f[name]) { f[name] = Date.now(); try { localStorage.setItem(FLAGS, JSON.stringify(f)); } catch (e) {} } }

/* ---------------------------------------------------------------- the market (live from the bot) */

const M = { prices: null, changes: {}, online: false, hot: null };
function mult(ticker) {
  const c = Number(M.changes[ticker]); if (!isFinite(c)) return 1;
  return Math.max(0.6, Math.min(1.8, 1 + c / 200));
}
// BSTG picks one kind of file every 3 minutes and pays wild money for it
function hotPick(now) {
  const slot = Math.floor(now / 180000);
  if (!M.hot || M.hot.slot !== slot) { const f = SERVICES[(slot * 7919) % SERVICES.length].file; M.hot = { slot, file: f, until: (slot + 1) * 180000 }; }
  return M.hot;
}
function bstgBoost(file, now) { return hotPick(now).file === file ? 1.5 * mult('BSTG') : 1; }
function onFeed(f) {
  if (!f || !f.prices) return;
  M.prices = f.prices; M.changes = f.changes || {}; M.online = true;
  drawMarket();
}
function loadMarket() {
  if (window.RV && RV.live) { RV.live(onFeed); return; }
  const get = () => fetch('https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io/data/prices.json?t=' + Date.now(), { cache: 'no-store' })
    .then((r) => r.json()).then(onFeed).catch(() => { M.online = false; drawMarket(); });
  get(); setInterval(get, 60000);
}

/* ---------------------------------------------------------------- the math */

const hw = (slot) => HARDWARE[slot].tiers[G.hw[slot]];
const count = (id) => G.svc[id] || 0;
const units = () => SERVICES.reduce((s, x) => s + count(x.id), 0);
const costOf = (s, n) => Math.ceil(s.cost * Math.pow(GROWTH, count(s.id)) * (Math.pow(GROWTH, n) - 1) / (GROWTH - 1));
const procLv = (id) => G.proc[id] || 0;
const procCost = (p) => Math.ceil(p.cost * Math.pow(PROC_GROWTH, procLv(p.id)));
function fileValue(file, now) {
  let v = SERVICES.find((s) => s.file === file).value;
  let bonus = 1;
  PROCESSING.forEach((p) => { if (p.files === 'all' || p.files.indexOf(file) >= 0) bonus += p.per * procLv(p.id); });
  v *= bonus * mult(BUYER_OF[file]) * bstgBoost(file, now) * hw('nic')[1];
  if (secret('rft_backstage_market')) v *= SECRETS.rft_backstage_market.sell;
  return v;
}
function load() { return SERVICES.reduce((s, x) => s + count(x.id) * x.cpu, 0); }
function temp() { return Math.round(30 + 60 * Math.min(1.5, load() / hw('cpu')[1])); }
function speed() {
  const cap = hw('cpu')[1], l = load();
  let k = l > cap ? cap / l : 1;
  if (temp() > hw('cooler')[1]) k *= THROTTLE;
  k *= 1 + G.pts * REFORMAT.perPoint;
  if (secret('rft_honeypot')) k *= SECRETS.rft_honeypot.make;
  return k;
}
const filesPerSec = (s) => count(s.id) * s.rate * speed();
function incomePerSec(now) { return SERVICES.reduce((sum, s) => sum + filesPerSec(s) * fileValue(s.file, now), 0); }

/* ---------------------------------------------------------------- the tick */

function earn(n) {
  G.money += n; G.run += n; G.earned += n;
  if (G.earned >= 100000) unlock('rft_six_figures');
}
function tick(dt, now) {
  SERVICES.forEach((s) => {
    const made = filesPerSec(s) * dt + (G.frac[s.id] || 0);
    let whole = Math.floor(made); G.frac[s.id] = made - whole;
    if (!whole) return;
    // contracts first
    G.active.forEach((c) => { if (whole && c.file === s.file && c.got < c.qty) { const take = Math.min(whole, c.qty - c.got); c.got += take; whole -= take; } });
    if (!whole) return;
    earn(whole * fileValue(s.file, now));
    G.sold += whole;
    unlock('rft_first_byte');
  });
  // contracts finishing or running out
  G.active = G.active.filter((c) => {
    if (c.got >= c.qty) { earn(c.pay); G.done++; log(`${c.ticker} paid ${fmt(c.pay)} for ${c.qty} ${c.file} files.`, 'ok'); if (G.done >= 50) unlock('rft_contractor'); return false; }
    if (now > c.ends) { log(`Missed: ${c.ticker}'s ${c.file} contract ran out.`, 'bad'); return false; }
    return true;
  });
  G.offers = G.offers.filter((o) => now < o.expires);
  if (now >= G.nextOffer && G.offers.length < CONTRACT.offers) { const o = makeOffer(now); if (o) G.offers.push(o); G.nextOffer = now + CONTRACT.everyMs; }
}

function makeOffer(now) {
  const made = SERVICES.filter((s) => count(s.id) > 0);
  if (!made.length) return null;
  const s = made[Math.floor(Math.random() * made.length)];
  const ticker = Math.random() < 0.2 ? 'BSTG' : BUYER_OF[s.file];
  const secs = CONTRACT.minS + Math.floor(Math.random() * (CONTRACT.maxS - CONTRACT.minS));
  const qty = Math.max(10, Math.round(filesPerSec(s) * secs * CONTRACT.needAt / 5) * 5);
  const pay = Math.round(qty * fileValue(s.file, now) * CONTRACT.bonus * (ticker === 'BSTG' ? 1.3 : 1));
  return { id: now + Math.random(), ticker, file: s.file, qty, secs, pay, expires: now + 4 * 60000 };
}

/* ---------------------------------------------------------------- actions */

let amt = '1';
function howMany(s) {
  if (amt !== 'max') return Number(amt);
  let n = 0; while (n < 1000 && costOf(s, n + 1) <= G.money && units() + n + 1 <= hw('ram')[1]) n++;
  return Math.max(1, n);
}
function buyService(id) {
  const s = SERVICES.find((x) => x.id === id), n = howMany(s), c = costOf(s, n);
  if (units() + n > hw('ram')[1]) return log(`Not enough RAM for ${n} more. Upgrade your RAM.`, 'bad');
  if (G.money < c) return log(`That's ${fmt(c)}.`, 'bad');
  G.money -= c; G.svc[id] = count(id) + n; save(); draw();
}
function buyProc(id) {
  const p = PROCESSING.find((x) => x.id === id), c = procCost(p);
  if (procLv(id) >= PROC_MAX || G.money < c) return;
  G.money -= c; G.proc[id] = procLv(id) + 1; save(); draw();
}
function buyHw(slot) {
  const next = HARDWARE[slot].tiers[G.hw[slot] + 1];
  if (!next || G.money < next[2]) return;
  G.money -= next[2]; G.hw[slot]++;
  log(`Installed ${next[0]}.`, 'ok');
  if (slot === 'cpu' && G.hw.cpu === 4) unlock('rft_gregulator');
  save(); draw();
}
function takeOffer(id) {
  const o = G.offers.find((x) => x.id === id);
  if (!o || G.active.length >= CONTRACT.active) return;
  G.offers = G.offers.filter((x) => x !== o);
  G.active.push(Object.assign({}, o, { got: 0, ends: Date.now() + o.secs * 1000 }));
  save(); draw();
}
function dropOffer(id) { G.offers = G.offers.filter((x) => x.id !== id); save(); draw(); }
const pointsFor = (run) => Math.floor(Math.sqrt(run / REFORMAT.at));
function reformat() {
  const pts = pointsFor(G.run);
  if (pts < 1) return;
  if (!confirmStep()) return;
  G = Object.assign(fresh(G), { pts: G.pts + pts, resets: G.resets + 1 });
  unlock('rft_fresh_install');
  log(`Reformatted. +${pts} Format Point${pts === 1 ? '' : 's'}: everything makes ${Math.round(G.pts * REFORMAT.perPoint * 100)}% more now.`, 'ok');
  save(); draw();
}
let armed = 0;
function confirmStep() {   // press twice within 4 seconds (no browser dialogs)
  if (Date.now() - armed < 4000) { armed = 0; return true; }
  armed = Date.now(); log('Press Reformat again to wipe your services, hardware and Polygons.', 'bad'); drawWallet(); return false;
}

/* ---------------------------------------------------------------- achievements and the bot */

function unlock(id) {
  if (G.ach[id]) return;
  G.ach[id] = Date.now();
  const a = ACH.find((x) => x.id === id);
  log(`Achievement: ${id === 'rft_backdoor' ? 'Backdoor' : a.name}.`, 'ok');
  sendAch();
  drawWallet();
}
const loggedIn = () => !!(window.RV && RV.me && RV.me() && RV.token && RV.token());
function withGuild() {
  if (RV.guild()) return Promise.resolve(RV.guild());
  return RV.servers().then((l) => { if (!l.length) throw new Error('play in a server with the bot first'); RV.setGuild(l[0].id); return l[0].id; });
}
let sending = false;
function sendAch() {
  if (!loggedIn() || sending) return;
  const todo = Object.keys(G.ach).filter((id) => !G.sent[id]);
  if (!todo.length) return;
  sending = true;
  const next = () => {
    const id = todo.shift();
    if (!id) { sending = false; save(); return; }
    withGuild().then(() => RV.run('__rft achieve ' + id)).then(() => { G.sent[id] = Date.now(); next(); }).catch(() => { sending = false; });
  };
  next();
}
let bot = null, cashMsg = '';
function fetchBot() {
  if (!loggedIn()) return;
  withGuild().then(() => RV.run('__rft status')).then((r) => { bot = r && r.rft; drawWallet(); }).catch(() => {});
}
function cashOut() {
  if (!loggedIn()) { RV.login(); return; }
  cashMsg = 'Talking to RendConomy…'; drawWallet();
  withGuild().then(() => RV.run('__rft cashout ' + JSON.stringify({ earned: Math.floor(G.earned) }))).then((r) => {
    cashMsg = String(r.content || 'Done.'); fetchBot();
  }).catch((e) => { cashMsg = e.message === 'login' ? 'Your login ran out. Log in again.' : 'Couldn’t reach the bot: ' + e.message; drawWallet(); });
}

/* ---------------------------------------------------------------- drawing */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmt(n) {
  n = Math.floor(n);
  if (n < 1e4) return '⬡' + n.toLocaleString('en-US');
  const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi']; let i = -1;
  while (n >= 1000 && i < u.length - 1) { n /= 1000; i++; }
  return '⬡' + (n < 100 ? n.toFixed(2) : n.toFixed(1)).replace(/\.?0+$/, '') + u[i];
}
const num = (n) => (n < 1e4 ? (Math.round(n * 10) / 10).toLocaleString('en-US') : fmt(n).slice(1));
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function bar(frac) { const f = Math.max(0, Math.min(1, frac)); return `<div class="bar"><i class="${f > 0.95 ? 'bad' : f > 0.8 ? 'warn' : ''}" style="width:${Math.round(f * 100)}%"></i></div>`; }

function drawTop(now) {
  $('money').textContent = fmt(G.money);
  $('rate').textContent = '+' + fmt(incomePerSec(now)) + '/s';
  $('clock').textContent = new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function drawServices(now) {
  const ram = hw('ram')[1];
  $('services').innerHTML = SERVICES.map((s, i) => {
    const n = howMany(s), c = costOf(s, n), shown = i === 0 || count(SERVICES[i - 1].id) > 0 || count(s.id) > 0;
    if (!shown) return `<div class="row locked"><span class="nm">??? <span class="dim">(after the ${esc(SERVICES[i - 1].name)})</span></span></div>`;
    return `<div class="row"><span class="nm"><b>${esc(s.name)}</b> × ${count(s.id)}</span>
      <span class="sub">${esc(s.file)} · ${num(filesPerSec(s))}/s · ${fmt(fileValue(s.file, now))} each · ${s.cpu} CPU</span>
      <span class="act"><button class="go" data-svc="${s.id}" ${G.money < c || units() + n > ram ? 'disabled' : ''}>${units() + n > ram ? (units() >= ram ? 'RAM full' : 'Needs RAM') : `Buy ${n > 1 ? n + ' ' : ''}${fmt(c)}`}</button></span></div>`;
  }).join('');
}
function drawProc() {
  $('proc').innerHTML = PROCESSING.map((p) => {
    const lv = procLv(p.id), c = procCost(p), max = lv >= PROC_MAX;
    return `<div class="row"><span class="nm"><b>${esc(p.name)}</b> lv ${lv}</span>
      <span class="sub">+${Math.round(p.per * 100)}% a level · ${p.files === 'all' ? 'every file' : esc(p.files.join(', '))}</span>
      <span class="act"><button class="go" data-proc="${p.id}" ${max || G.money < c ? 'disabled' : ''}>${max ? 'MAX' : fmt(c)}</button></span></div>`;
  }).join('') + Object.keys(SECRETS).filter(secret).map((id) => `<div class="row secret"><span class="nm"><b>${esc(SECRETS[id].name)}</b></span><span class="sub">${esc(SECRETS[id].what)}</span></div>`).join('');
}
function drawHw() {
  const cap = hw('cpu')[1], l = load(), t = temp(), lim = hw('cooler')[1];
  $('meters').innerHTML = [
    ['CPU', `${Math.round(l / cap * 100)}%`, l / cap], ['RAM', `${units()} / ${hw('ram')[1]}`, units() / hw('ram')[1]],
    ['Temp', `${t}°C${t > lim ? ' HOT' : ''}`, (t - 30) / Math.max(1, Math.min(lim, 120) - 30)], ['Speed', `×${speed().toFixed(2)}`, Math.min(1, speed() / 2)]
  ].map((m) => `<div class="meter"><div class="lbl">${m[0]}</div><div class="val">${m[1]}</div>${bar(m[2])}</div>`).join('');
  $('hw').innerHTML = Object.keys(HARDWARE).map((slot) => {
    const h = HARDWARE[slot], cur = hw(slot), next = h.tiers[G.hw[slot] + 1];
    return `<div class="row"><span class="nm"><b>${h.label}</b> ${esc(cur[0])}</span>
      <span class="sub">${esc(h.what)}${next ? ` · next: ${esc(next[0])}` : ' · the best there is'}</span>
      <span class="act">${next ? `<button class="go" data-hw="${slot}" ${G.money < next[2] ? 'disabled' : ''}>${fmt(next[2])}</button>` : ''}</span></div>`;
  }).join('');
}
function drawInbox(now) {
  const act = G.active.map((c) => `<div class="contract active"><div class="who">${c.ticker} · ${esc(NAMES[c.ticker])}</div>
    <div class="what">${c.got} / ${c.qty} ${esc(c.file)} files</div>${bar(c.got / c.qty)}
    <div class="meta">pays ${fmt(c.pay)} · ${mmss(c.ends - now)} left</div></div>`).join('');
  const off = G.offers.map((o) => `<div class="contract"><div class="who">✉ ${o.ticker} · ${esc(NAMES[o.ticker])}</div>
    <div class="what">${o.qty} ${esc(o.file)} files in ${mmss(o.secs * 1000)}</div>
    <div class="meta">pays ${fmt(o.pay)} · offer ends in ${mmss(o.expires - now)}</div>
    <div class="act"><button class="go" data-take="${o.id}" ${G.active.length >= CONTRACT.active ? 'disabled' : ''}>Take it</button><button data-drop="${o.id}">No thanks</button></div></div>`).join('');
  $('inbox').innerHTML = (act || off) ? act + off : `<p class="dim">${units() ? 'Nothing yet. Contracts arrive every minute or so.' : 'Buy a service and the companies will start writing.'}</p>`;
}
function drawMarket() {
  const st = $('mkt-status'); st.textContent = M.online ? 'LIVE' : 'OFFLINE'; st.className = 'live ' + (M.online ? 'on' : 'off');
  const now = Date.now(), hot = hotPick(now);
  $('market').innerHTML = `<div class="mkt">${['BNW', 'BLU', 'RRM', 'NACH', 'BSTG'].map((t) => {
    const m = mult(t), c = Number(M.changes[t]) || 0;
    return `<span class="tk">${t}</span><span class="ty">${t === 'BSTG' ? 'the hot pick, below' : esc(BUYERS[t].join(', '))}</span><span class="${m > 1.001 ? 'up' : m < 0.999 ? 'down' : ''}">×${m.toFixed(2)} ${c ? `(${c > 0 ? '▲' : '▼'}${Math.abs(c).toFixed(1)}%)` : ''}</span>`;
  }).join('')}</div>
  <div class="hot">BSTG wants <b>${esc(hot.file)}</b> files right now: ×${(1.5 * mult('BSTG')).toFixed(2)} on top, for ${mmss(hot.until - now)}.</div>`;
}
function drawWallet() {
  const P = CASH.perThousand;
  const fresh = bot ? Math.max(0, Math.floor(G.earned) - bot.credited) : null;
  $('wallet').innerHTML = `<div class="wallet">
    <p>Earned here, all time: <b>${fmt(G.earned)}</b> · files sold: ${num(G.sold)} · contracts: ${G.done}</p>
    ${loggedIn() ? `<p>Cash out: ⬡${P} for every ⬡1,000 into your RendConomy wallet, up to ⬡${CASH.cap} a day.${bot ? ` Today: ⬡${bot.paid} of ⬡${bot.cap}. Ready: about ⬡${Math.floor((fresh || 0) / 1000) * P}.` : ''}</p>
      <p><button class="go" id="cash">Cash out</button> <span class="dim">${esc(cashMsg)}</span></p>`
    : `<p class="dim">Log in with Discord to cash out (⬡${P} for every ⬡1,000, up to ⬡${CASH.cap} a day) and unlock these achievements in the bot.</p><p><button class="go" id="login">Log in</button></p>`}
  </div>`;
  const pts = pointsFor(G.run);
  $('reformat').innerHTML = `<div class="reformat"><p><b>Format Points:</b> ${G.pts} (everything makes ${Math.round(G.pts * REFORMAT.perPoint * 100)}% more)</p>
    <p class="dim">${pts ? `Reformat now for +${pts} point${pts === 1 ? '' : 's'}.` : `Earn ${fmt(REFORMAT.at)} since your last Reformat for your first point.`}</p>
    <p><button id="refmt" ${pts ? '' : 'disabled'}>${Date.now() - armed < 4000 ? 'Press again to wipe it all' : 'Reformat'}</button></p></div>`;
  $('ach').innerHTML = `<div class="ach">${ACH.map((a) => `<span class="${G.ach[a.id] ? 'got' : ''}" title="${esc(G.ach[a.id] || a.id !== 'rft_backdoor' ? a.how : 'A secret')}">${esc(G.ach[a.id] && a.id === 'rft_backdoor' ? 'Backdoor' : a.name)}</span>`).join('')}</div>`;
  if ($('cash')) $('cash').onclick = cashOut;
  if ($('login')) $('login').onclick = () => RV.login();
  $('refmt').onclick = reformat;
}
function draw() {
  const now = Date.now();
  drawTop(now); drawServices(now); drawProc(); drawHw(); drawInbox(now); drawWallet();
}
const logEl = () => $('log');
function log(msg, cls) { const el = logEl(); if (el) el.innerHTML = `<span class="${cls || ''}">${esc(msg)}</span>`; }

/* ---------------------------------------------------------------- the Terminal (codes live in terminal.json) */

let codes = null;
function termPrint(t, cls) { const o = $('term-out'); const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = t; o.appendChild(d); o.scrollTop = o.scrollHeight; }
async function sha256(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function termRun(raw) {
  const code = String(raw).trim().toUpperCase();
  if (!code) return;
  termPrint('> ' + code);
  if (code === 'HELP') return termPrint('Type a code. Codes are out there, if you know where to listen.');
  if (code === 'CLEAR') { $('term-out').innerHTML = ''; return; }
  try { if (!codes) codes = (await (await fetch('terminal.json', { cache: 'no-store' })).json()).codes || []; } catch (e) { return termPrint('Terminal offline.', 'err'); }
  const hash = await sha256(code);
  const e = codes.find((c) => (c.code && c.code.toUpperCase() === code) || (c.sha256 && c.sha256 === hash));
  if (!e) return termPrint('Unknown code.', 'err');
  const id = e.id || code;
  if (e.once !== false && G.claimed[id]) return termPrint('Already redeemed.', 'err');
  G.claimed[id] = Date.now();
  if (e.cash) earn(Number(e.cash) || 0);
  [].concat(e.flags || [], e.flag ? [e.flag] : []).forEach(setFlag);
  if ([].concat(e.flags || [], e.flag ? [e.flag] : []).some((f) => SECRETS[f])) unlock('rft_backdoor');
  termPrint(e.message || 'Accepted.', 'ok');
  save(); draw();
}

/* ---------------------------------------------------------------- saving */

function save() { G.seen = Date.now(); try { localStorage.setItem(SAVE, JSON.stringify(G)); } catch (e) {} }
function restore() {
  let d = null; try { d = JSON.parse(localStorage.getItem(SAVE)); } catch (e) {}
  if (d && d.v === 2) { G = Object.assign(fresh(), d); return true; }
  if (localStorage.getItem(OLD) && !localStorage.getItem('rft_rebuilt_seen')) {
    const n = $('note'); n.hidden = false;
    n.innerHTML = '<b>Render\'s File Tycoon was rebuilt from scratch.</b> The old pipeline game is gone, and its saves don\'t carry over, so everyone starts fresh. <button type="button" id="note-x">Got it</button>';
    $('note-x').onclick = () => { n.hidden = true; try { localStorage.setItem('rft_rebuilt_seen', '1'); } catch (e) {} };
  }
  return false;
}
function offline() {
  const away = Date.now() - (G.seen || Date.now());
  const capMs = hw('storage')[1] * 3600000;
  const secs = Math.min(away, capMs) / 1000;
  if (secs < 60) return;
  const before = G.money;
  const now = Date.now();
  SERVICES.forEach((s) => { const n = Math.floor(filesPerSec(s) * secs); if (n) { earn(n * fileValue(s.file, now)); G.sold += n; } });
  if (G.money > before) log(`While you were away (${Math.round(secs / 60)} min${away > capMs ? `, your storage keeps ${hw('storage')[1]}h` : ''}): +${fmt(G.money - before)}.`, 'ok');
}

/* ---------------------------------------------------------------- wiring it up */

function boot() {
  restore();
  offline();
  loadMarket();
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.svc) buyService(b.dataset.svc);
    else if (b.dataset.proc) buyProc(b.dataset.proc);
    else if (b.dataset.hw) buyHw(b.dataset.hw);
    else if (b.dataset.take) takeOffer(Number(b.dataset.take));
    else if (b.dataset.drop) dropOffer(Number(b.dataset.drop));
    else if (b.dataset.amt) { amt = b.dataset.amt; document.querySelectorAll('.buyamt button').forEach((x) => x.classList.toggle('on', x === b)); drawServices(Date.now()); }
  });
  $('btn-term').onclick = () => { $('term').hidden = false; if (!$('term-out').textContent) termPrint('RenderOS terminal. Type HELP.'); $('term-in').focus(); };
  $('term-x').onclick = () => { $('term').hidden = true; };
  $('term-form').onsubmit = (e) => { e.preventDefault(); const v = $('term-in').value; $('term-in').value = ''; termRun(v); };
  $('btn-help').onclick = () => { $('help').hidden = false; };
  $('help-x').onclick = () => { $('help').hidden = true; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('term').hidden = true; $('help').hidden = true; } });
  window.addEventListener('storage', (e) => { if (e.key === FLAGS) draw(); });
  draw(); drawMarket();
  let last = Date.now(), lastDraw = 0, lastSave = 0;
  setInterval(() => {
    const now = Date.now(), dt = Math.min(5, (now - last) / 1000); last = now;
    tick(dt, now);
    drawTop(now);
    if (now - lastDraw > 1000) { lastDraw = now; drawServices(now); drawProc(); drawHw(); drawInbox(now); if (!document.activeElement || !document.activeElement.closest('.w-wallet')) drawWallet(); if (now % 10000 < 1000) drawMarket(); }
    if (now - lastSave > 10000) { lastSave = now; save(); }
  }, 200);
  window.addEventListener('beforeunload', save);
  fetchBot(); sendAch();
}
window.RFT = { get state() { return G; }, SERVICES, HARDWARE, PROCESSING, tick, fileValue, incomePerSec, pointsFor };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
