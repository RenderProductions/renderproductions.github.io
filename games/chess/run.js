/* Iso-Chess: the run. Three acts of a branching map; your army carries over and losses are for good.

   Opening (starting army + deck + heirloom) -> map -> battle / elite / event / forge / camp -> boss -> next act.
   Battles are played by chess.js (IsoChess.startBattle); this file builds them and handles everything between.
   The run is saved in this browser (localStorage), so a refresh doesn't lose it.

   Tie-in with Render's Vision (logged in on the site): openings and piece skins are unlocked at
   Marquez's shop (r!shop chess), and a finished run pays a few Polygons, up to a daily cap. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const SAVE = 'isochess_run_v1';
  const PREFS = 'isochess_prefs';

  /* ---------- seeded randomness (the map and arenas come from the run's seed) ---------- */
  function rng(seed) {
    let a = seed >>> 0;
    const next = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (l) => l[Math.floor(next() * l.length)], chance: (p) => next() < p,
      shuffle(l) { for (let i = l.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [l[i], l[j]] = [l[j], l[i]]; } return l; } };
  }

  /* ---------- content ---------- */
  const OPENINGS = {
    classic: { name: 'The Classic', blurb: 'A balanced little army. Free, always.', army: ['K', 'R', 'N', 'B', 'P', 'P', 'P'],
      deck: ['shove', 'shield', 'swap', 'freeze', 'haste', 'raise'], heirlooms: [], item: null },
    gambit: { name: 'The Gambit', blurb: 'A Queen up front, fewer pawns. First Blood and an extra energy each battle.', army: ['K', 'Q', 'N', 'P', 'P'],
      deck: ['shove', 'haste', 'bloodline', 'freeze', 'collapse', 'swap'], heirlooms: ['firstblood', 'deep'], item: 'chess_gambit' },
    fortress: { name: 'The Fortress', blurb: 'Two Rooks that pawns can’t touch, and a deck built to hold the line.', army: ['K', 'R', 'R', 'B', 'P', 'P', 'P'],
      deck: ['shield', 'fortify', 'freeze', 'raise', 'shove', 'swap'], heirlooms: ['bastion'], item: 'chess_fortress' },
    cavalry: { name: 'The Cavalry', blurb: 'Three Knights, and a King who rides like one.', army: ['K', 'N', 'N', 'N', 'P', 'P'],
      deck: ['haste', 'shove', 'swap', 'freeze', 'shield', 'martyr'], heirlooms: ['knightking'], item: 'chess_cavalry' }
  };
  const SKINS = {
    gold: { name: 'Gold', color: 0xf4e27a, edge: 0x050810, item: null },
    obsidian: { name: 'Obsidian', color: 0x3a3f52, edge: 0xffe600, item: 'skin_obsidian' },
    jade: { name: 'Jade', color: 0x5fd39a, edge: 0x062014, item: 'skin_jade' },
    crimson: { name: 'Crimson', color: 0xe0565b, edge: 0x1a0406, item: 'skin_crimson' },
    frost: { name: 'Frost', color: 0xbfe6ff, edge: 0x0a2233, item: 'skin_frost' }
  };
  const HEIRLOOMS = {
    sidestep: { name: 'Nimble Feet', text: 'Your Pawns can also step sideways.', icon: '↔' },
    bastion: { name: 'Bastion', text: 'Your Rooks start every battle immune to pawns.', icon: '♜' },
    firstblood: { name: 'First Blood', text: 'Your first capture each battle gives +2 energy.', icon: '🩸' },
    knightking: { name: 'The Rider King', text: 'Your King can also jump like a Knight.', icon: '♞' },
    deep: { name: 'Deep Reserves', text: 'Start every battle with +1 energy.', icon: '⬡' },
    fourth: { name: 'Fourth Card', text: 'Hold and draw up to 4 cards.', icon: '🂠' },
    gravedigger: { name: 'Gravedigger', text: 'Enemies lost to pits or blasts give +1 more energy.', icon: '⚰' }
  };
  const TRAITS = {
    iron: 'Pawns and Bombers can’t capture it.',
    vigilant: 'Starts every battle shielded.',
    bloodthirsty: '+1 energy whenever it captures.',
    highborn: '+2 range on high ground (Kings and Pawns).'
  };
  const NAMES = {
    K: ['King Aldric', 'King Osric', 'Queen-Regent Maud', 'King Edmund'],
    Q: ['Dame Isolde', 'Dame Rowena', 'Lady Brannoc', 'Dame Elspeth'],
    R: ['Old Barrow', 'The Bulwark', 'Stonewatch', 'Greyhold', 'Ironside'],
    B: ['Brother Anselm', 'Sister Wren', 'Father Corwin', 'Abbot Hale'],
    N: ['Sir Reginald', 'Sir Cador', 'Dame Lyra', 'Sir Bors', 'Sir Gawen', 'Dame Ottilie'],
    P: ['Pip', 'Wat', 'Hob', 'Tam', 'Nell', 'Dob', 'Kit', 'Ned', 'Mag', 'Will', 'Jory', 'Bess']
  };
  const ACTS = [
    { name: 'The Rabble Fields', pool: ['P', 'P', 'P', 'X', 'N', 'B'], size: 8, intents: 2,
      boss: { name: 'The Pretender', text: 'A false King who won’t stay down.', hp: 2, extra: ['X', 'X', 'N', 'P', 'P', 'P'] } },
    { name: 'The Archers’ Causeway', pool: ['P', 'P', 'A', 'N', 'B', 'R', 'X'], size: 9, intents: 3,
      boss: { name: 'The Longbow Court', text: 'A King behind a wall of Archers.', hp: 2, extra: ['A', 'A', 'A', 'R', 'P', 'P', 'P'] } },
    { name: 'The Hollow Kingdom', pool: ['P', 'P', 'M', 'A', 'R', 'Q', 'N', 'X'], size: 10, intents: 3,
      boss: { name: 'The Hollow King', text: 'He raises the dead faster than you can bury them.', hp: 3, extra: ['M', 'M', 'Q', 'A', 'R', 'P', 'P', 'P'] } }
  ];
  const NODE = {
    battle: { icon: '⚔', name: 'Battle' }, elite: { icon: '☠', name: 'Elite' }, event: { icon: '?', name: 'Event' },
    forge: { icon: '⚒', name: 'Forge' }, camp: { icon: '⛺', name: 'Camp' }, boss: { icon: '♚', name: 'Boss' }
  };
  const PAY = { battle: 10, elite: 25, boss: 60, victory: 150 };   // shown on the run-over screen; the bot decides what's paid

  /* ---------- state ---------- */
  let R = null;            // the run
  let prefs = { opening: 'classic', skin: 'gold' };
  let owned = { items: [], ready: false, note: '' };   // unlocks from the bot
  try { prefs = Object.assign(prefs, JSON.parse(localStorage.getItem(PREFS) || '{}')); } catch (e) { /* default */ }
  const save = () => { try { localStorage.setItem(SAVE, JSON.stringify(R)); } catch (e) { /* storage full or blocked */ } };
  const savePrefs = () => { try { localStorage.setItem(PREFS, JSON.stringify(prefs)); } catch (e) { /* blocked */ } };
  const load = () => { try { return JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch (e) { return null; } };
  const unlocked = (item) => !item || owned.items.indexOf(item) >= 0;

  function newUnit(type, r) {
    R.nextUid = (R.nextUid || 0) + 1;
    const used = R.army.map((u) => u.name);
    const pool = NAMES[type].filter((n) => used.indexOf(n) < 0);
    return { uid: R.nextUid, type, name: (pool.length ? r.pick(pool) : NAMES[type][0]) + (pool.length ? '' : ' ' + R.nextUid), traits: [], kills: 0, battles: 0 };
  }

  /* ---------- the map ---------- */
  function buildAct(act, r) {
    const rows = [];
    for (let y = 0; y < 6; y++) {
      if (y === 5) { rows.push([{ type: 'boss', links: [] }]); continue; }
      const n = y === 0 ? 3 : r.int(2, 4);
      const row = [];
      for (let i = 0; i < n; i++) {
        let type = 'battle';
        if (y > 0) {
          const roll = r.next();
          type = roll < 0.42 ? 'battle' : roll < 0.56 && y >= 2 ? 'elite' : roll < 0.72 ? 'event' : roll < 0.86 ? 'forge' : 'camp';
        }
        if (y === 4 && i === 0) type = 'camp';    // always a chance to rest before the boss
        row.push({ type, links: [] });
      }
      rows.push(row);
    }
    // link each node to 1-2 nearby nodes in the next row; every node is reachable
    for (let y = 0; y < 5; y++) {
      const a = rows[y], b = rows[y + 1];
      a.forEach((node, i) => {
        const at = Math.round((i / Math.max(1, a.length - 1)) * (b.length - 1));
        node.links = [at];
        if (b.length > 1 && r.chance(0.5)) node.links.push(Math.max(0, Math.min(b.length - 1, at + (r.chance(0.5) ? 1 : -1))));
        node.links = Array.from(new Set(node.links));
      });
      b.forEach((_, j) => { if (!a.some((n) => n.links.indexOf(j) >= 0)) a[Math.min(a.length - 1, Math.round((j / Math.max(1, b.length - 1)) * (a.length - 1)))].links.push(j); });
    }
    return { name: ACTS[act].name, rows };
  }

  /* ---------- arenas and armies ---------- */
  function makeArena(r, size, kind, fire) {
    const w = size, h = size;
    const tiles = [];
    for (let x = 0; x < w; x++) { tiles[x] = []; for (let y = 0; y < h; y++) tiles[x][y] = { kind: 'floor', h: 0 }; }
    const mid = () => ({ x: r.int(0, w - 1), y: r.int(3, h - 4) });
    const nPits = r.int(1, 3) + (kind === 'elite' ? 1 : 0) + (fire ? 2 : 0), nWalls = r.int(1, 4), nHigh = r.int(2, 5);
    for (let i = 0; i < nPits; i++) { const c = mid(); tiles[c.x][c.y] = { kind: 'pit', h: 0 }; }
    for (let i = 0; i < nWalls; i++) { const c = mid(); if (tiles[c.x][c.y].kind === 'floor') tiles[c.x][c.y] = { kind: 'wall', h: 0 }; }
    for (let i = 0; i < nHigh; i++) { const c = mid(); if (tiles[c.x][c.y].kind === 'floor') tiles[c.x][c.y].h = r.int(1, 2); }
    return { w, h, tiles };
  }
  function deploy(arena) {
    const out = [], w = arena.w, cx = Math.floor((w - 1) / 2);
    const order = (row) => { const l = []; for (let d = 0; d < w; d++) { const a = cx - Math.ceil(d / 2) * (d % 2 ? 1 : -1); if (a >= 0 && a < w && l.indexOf(a) < 0) l.push(a); } for (let x = 0; x < w; x++) if (l.indexOf(x) < 0) l.push(x); return l.map((x) => ({ x, y: row })); };
    const back = order(0), front = order(1), third = order(2);
    const king = R.army.find((u) => u.type === 'K');
    const officers = R.army.filter((u) => u.type !== 'K' && u.type !== 'P');
    const pawns = R.army.filter((u) => u.type === 'P');
    const slots = { back: back.slice(), front: front.concat(third) };
    if (king) out.push({ side: 'player', type: 'K', unit: king, ...slots.back.shift() });
    officers.forEach((u) => out.push({ side: 'player', type: u.type, unit: u, ...(slots.back.shift() || slots.front.shift()) }));
    pawns.forEach((u) => out.push({ side: 'player', type: u.type, unit: u, ...(slots.front.shift() || slots.back.shift()) }));
    return out;
  }
  function enemies(r, arena, act, kind, objective) {
    const A = ACTS[act], w = arena.w, h = arena.h;
    const spots = [];
    for (let y = h - 1; y >= h - 3; y--) for (let x = 0; x < w; x++) if (arena.tiles[x][y].kind === 'floor') spots.push({ x, y });
    r.shuffle(spots);
    const take = () => spots.shift();
    const out = [];
    const cx = Math.floor((w - 1) / 2);
    let list;
    if (kind === 'boss') {
      arena.tiles[cx][h - 1] = { kind: 'floor', h: 1 };
      out.push({ side: 'enemy', type: 'K', x: cx, y: h - 1, boss: true, hp: A.boss.hp });
      const i = spots.findIndex((s) => s.x === cx && s.y === h - 1); if (i >= 0) spots.splice(i, 1);
      list = A.boss.extra.slice();
    } else {
      let budget = (kind === 'elite' ? 15 : 8) + act * 5 + (objective.kind === 'survive' ? 6 : objective.kind === 'rout' ? -3 : 0);
      list = [];
      while (budget > 0) { const t = r.pick(A.pool); list.push(t); budget -= ({ P: 1, X: 2, N: 3, B: 3, A: 3, R: 5, M: 4, Q: 9 })[t]; }
      if (kind === 'elite') list.push(r.pick(['Q', 'R', 'M'].filter((t) => act > 0 || t !== 'M')));
      if (objective.kind === 'king') {
        const s = spots.find((p) => p.y === h - 1) || take();
        spots.splice(spots.indexOf(s), 1);
        out.push({ side: 'enemy', type: 'K', x: s.x, y: s.y });
      }
    }
    list.forEach((t) => { const s = take(); if (s) out.push({ side: 'enemy', type: t, x: s.x, y: s.y }); });
    return out;
  }
  function objectiveFor(r, kind) {
    if (kind === 'boss' || kind === 'elite') return { kind: 'king' };
    const roll = r.next();
    return roll < 0.5 ? { kind: 'king' } : roll < 0.75 ? { kind: 'rout' } : roll < 0.9 ? { kind: 'survive', turns: 6 } : { kind: 'escort' };
  }

  /* ---------- screens ---------- */
  const screen = () => $('run-screen');
  function show(html, cls) {
    const el = screen();
    el.className = 'run-screen' + (cls ? ' ' + cls : '');
    el.innerHTML = '<div class="run-box">' + html + '</div>';
    el.hidden = false;
    document.body.classList.add('in-menu');
    return el;
  }
  function hide() { screen().hidden = true; document.body.classList.remove('in-menu'); }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const cardBtn = (id, extra) => { const c = IsoChess.cardOf(id); return `<button class="card pick" data-card="${id}" title="${esc(c.name)} (${c.cost} energy): ${esc(c.text)}" ${extra || ''}>${IsoChess.cardFace(c)}</button>`; };
  const glyph = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  function armyList(sel) {
    return '<div class="army">' + R.army.map((u) => `<button class="unit${sel ? ' pickable' : ''}" data-uid="${u.uid}" title="${esc(u.traits.map((t) => t + ': ' + TRAITS[t]).join(' · ') || 'No traits yet')}">
      <span class="g">${glyph[u.type]}</span><span class="n">${esc(u.name)}</span><span class="t">${u.traits.map((t) => t.toUpperCase()).join(' · ') || (u.kills ? u.kills + ' kill' + (u.kills > 1 ? 's' : '') : 'Fresh')}</span></button>`).join('') + '</div>';
  }
  function heirloomList() {
    return R.heirlooms.length ? '<div class="heir">' + R.heirlooms.map((h) => `<span title="${esc(HEIRLOOMS[h].text)}">${HEIRLOOMS[h].icon} ${esc(HEIRLOOMS[h].name)}</span>`).join('') + '</div>' : '';
  }

  function title() {
    const saved = load();
    const opening = (k) => { const o = OPENINGS[k], ok = unlocked(o.item); return `<button class="opt${prefs.opening === k ? ' on' : ''}${ok ? '' : ' locked'}" data-open="${k}" ${ok ? '' : 'disabled'}>
      <b>${esc(o.name)}</b><span>${esc(o.blurb)}</span><i>${o.army.map((t) => glyph[t]).join(' ')}</i>${ok ? '' : '<em>Unlock at Marquez’s: r!shop chess</em>'}</button>`; };
    const skin = (k) => { const sk = SKINS[k], ok = unlocked(sk.item); return `<button class="sw${prefs.skin === k ? ' on' : ''}" data-skin="${k}" ${ok ? '' : 'disabled'} title="${sk.name}${ok ? '' : ' (unlock at Marquez’s)'}" style="--c:#${sk.color.toString(16).padStart(6, '0')}"></button>`; };
    const me = window.RV && RV.me();
    show(`<h1>ISO-CHESS</h1><p class="sub">A roguelike chess march across a broken kingdom. Three acts. Your army is all you have: what falls stays fallen.</p>
      ${saved && !saved.over ? `<button class="btn big" id="cont">CONTINUE · Act ${saved.act + 1}, ${esc(saved.opening ? OPENINGS[saved.opening].name : '')}</button>` : ''}
      <h2>CHOOSE YOUR OPENING</h2><div class="opts">${Object.keys(OPENINGS).map(opening).join('')}</div>
      <h2>PIECES</h2><div class="sws">${Object.keys(SKINS).map(skin).join('')}<span class="skin-name">${SKINS[prefs.skin].name}</span></div>
      <div class="row"><button class="btn big" id="go">${saved && !saved.over ? 'NEW RUN' : 'BEGIN THE MARCH'}</button><button class="btn ghost" id="free">FREE BATTLE</button></div>
      <p class="acct">${me ? `Playing as <b>${esc(me.name)}</b>. ${esc(owned.note)}` : 'Log in on the site to unlock openings and skins with Polygons, and to earn a few Polygons per run. <a href="#" id="login">Log in with Discord</a>'}</p>`, 'scr-title');
    screen().querySelectorAll('[data-open]').forEach((b) => (b.onclick = () => { prefs.opening = b.dataset.open; savePrefs(); title(); }));
    screen().querySelectorAll('[data-skin]').forEach((b) => (b.onclick = () => { prefs.skin = b.dataset.skin; savePrefs(); applySkin(); title(); }));
    $('go').onclick = () => { if (saved && !saved.over && !confirm('Start a new run? Your current one will be lost.')) return; newRun(); };
    if ($('cont')) $('cont').onclick = () => { R = saved; applySkin(); if (R.pending) resume(); else mapScreen(); };
    $('free').onclick = () => { hide(); Board3D.setTheme('free', false); document.body.classList.add('free-play'); $('mode-tag').textContent = 'FREE'; IsoChess.freePlay(); };
    if ($('login')) $('login').onclick = (e) => { e.preventDefault(); RV.login(); };
  }
  function applySkin() { const k = (R && R.skin) || prefs.skin; const sk = SKINS[unlocked(SKINS[k].item) ? k : 'gold']; Board3D.setSkin(sk.color, sk.edge); }

  function newRun() {
    const seed = (Math.random() * 2 ** 31) >>> 0;
    const o = OPENINGS[unlocked(OPENINGS[prefs.opening].item) ? prefs.opening : 'classic'];
    R = { v: 1, id: seed.toString(36) + Date.now().toString(36), seed, opening: prefs.opening, skin: prefs.skin, act: 0, row: -1, col: -1,
      army: [], deck: o.deck.slice(), heirlooms: o.heirlooms.slice(), maps: [], started: Date.now(),
      won: { battle: 0, elite: 0, boss: 0 }, clever: 0, over: false, victory: false, nextUid: 0 };
    const r = rng(seed);
    o.army.forEach((t) => R.army.push(newUnit(t, r)));
    for (let a = 0; a < 3; a++) R.maps.push(buildAct(a, rng(seed + a * 7919)));
    save(); applySkin(); mapScreen();
  }

  function mapScreen() {
    const map = R.maps[R.act];
    const reach = R.row < 0 ? map.rows[0].map((_, i) => i) : map.rows[R.row][R.col].links;
    const H = 6, rowsHtml = map.rows.map((row, y) => `<div class="mrow">${row.map((n, x) => {
      const done = y < R.row || (y === R.row && x === R.col);
      const here = y === R.row && x === R.col;
      const can = y === R.row + 1 && reach.indexOf(x) >= 0;
      return `<button class="node ${n.type}${done ? ' done' : ''}${here ? ' here' : ''}${can ? ' can' : ''}" data-x="${x}" data-y="${y}" ${can ? '' : 'disabled'} title="${NODE[n.type].name}">${NODE[n.type].icon}<small>${NODE[n.type].name}</small></button>`;
    }).join('')}</div>`).reverse().join('');
    show(`<div class="mhead"><div><h1>ACT ${R.act + 1}</h1><p class="sub">${esc(map.name)}</p></div><button class="btn ghost small" id="quit">MENU</button></div>
      <div class="map">${rowsHtml}<svg class="links"></svg></div>
      <h2>YOUR ARMY <span>${R.army.length} pieces · ${R.deck.length} cards</span></h2>${armyList()}${heirloomList()}
      <details class="deck"><summary>Your deck</summary><div class="cards">${R.deck.map((id) => cardBtn(id, 'disabled')).join('')}</div></details>`, 'map-screen');
    drawLinks(map, H);
    screen().querySelectorAll('.node.can').forEach((b) => (b.onclick = () => enter(+b.dataset.y, +b.dataset.x)));
    $('quit').onclick = title;
  }
  function drawLinks(map) {
    const box = screen().querySelector('.map'), svg = box.querySelector('.links');
    const rb = box.getBoundingClientRect();
    svg.setAttribute('width', rb.width); svg.setAttribute('height', rb.height);
    const pos = (y, x) => { const b = box.querySelector(`.node[data-y="${y}"][data-x="${x}"]`).getBoundingClientRect(); return [b.left - rb.left + b.width / 2, b.top - rb.top + b.height / 2]; };
    let d = '';
    map.rows.forEach((row, y) => row.forEach((n, x) => n.links.forEach((j) => { const a = pos(y, x), b = pos(y + 1, j); d += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" class="${y < R.row || (y === R.row && x === R.col) ? 'walked' : ''}"/>`; })));
    svg.innerHTML = d;
  }

  function enter(y, x) {
    R.row = y; R.col = x;
    const n = R.maps[R.act].rows[y][x];
    R.pending = n.type; save();   // a refresh puts you back into this node, not past it
    resume();
  }
  function resume() {
    const n = { type: R.pending };
    if (n.type === 'battle' || n.type === 'elite' || n.type === 'boss') return battle(n.type);
    if (n.type === 'forge') return forge();
    if (n.type === 'camp') return camp();
    return event();
  }

  /* ---------- battle ---------- */
  function battle(kind) {
    const r = rng(R.seed + R.act * 1000 + R.row * 37 + R.col * 7 + 1);
    const A = ACTS[R.act];
    const objective = objectiveFor(r, kind);
    // fire pours out of the pits in the Hollow Kingdom, and wherever a boss waits
    const fire = R.act === 2 || kind === 'boss' || (R.act === 1 && kind === 'elite');
    const arena = makeArena(r, A.size, kind, fire);
    const pieces = deploy(arena).concat(enemies(r, arena, R.act, kind, objective));
    // keep deploy squares clear of terrain
    pieces.forEach((p) => { if (arena.tiles[p.x][p.y].kind !== 'floor') arena.tiles[p.x][p.y] = { kind: 'floor', h: 0 }; });
    const name = kind === 'boss' ? A.boss.name : (kind === 'elite' ? 'Elite: ' : '') + A.name;
    const intents = A.intents + (kind === 'elite' ? 1 : 0) + (kind === 'boss' ? 1 : 0);
    hide();
    const intro = kind === 'boss' ? `<h1>${esc(A.boss.name)}</h1><p class="sub">${esc(A.boss.text)} Capture it ${A.boss.hp} times.</p>` : '';
    const go = () => (Board3D.setTheme('act' + (R.act + 1), fire), IsoChess.startBattle({
      name, w: arena.w, h: arena.h, tiles: arena.tiles, intents, pieces, deck: R.deck.slice(), heirlooms: R.heirlooms,
      objective, energy: 1 + (R.heirlooms.indexOf('deep') >= 0 ? 1 : 0), onEnd: (res) => afterBattle(kind, res)
    }));
    if (intro) { show(intro + '<button class="btn big" id="fight">FIGHT</button>', 'boss-intro'); $('fight').onclick = () => { hide(); go(); }; }
    else go();
  }

  function afterBattle(kind, res) {
    R.pending = null;
    // losses are for good
    R.army = R.army.filter((u) => res.lost.indexOf(u.uid) < 0);
    if (!res.won) return runOver(false);
    R.won[kind]++; R.clever += res.clever;
    // veterans: survivors earn traits from their kills
    const r = rng(R.seed + R.row * 101 + R.act);
    const promoted = [];
    R.army.forEach((u) => {
      u.battles = (u.battles || 0) + 1;
      const want = u.kills >= 5 ? 2 : u.kills >= 2 ? 1 : 0;
      while (u.traits.length < want) {
        const t = r.pick(Object.keys(TRAITS).filter((k) => u.traits.indexOf(k) < 0));
        u.traits.push(t); promoted.push(`${u.name} is now <b>${t.toUpperCase()}</b>: ${TRAITS[t]}`);
      }
    });
    save();
    const pool = IsoChess.POWERS.map((c) => c.id);
    const offer = rng(R.seed + R.act * 333 + R.row * 13 + R.col).shuffle(pool.slice()).slice(0, 3);
    const heirs = Object.keys(HEIRLOOMS).filter((h) => R.heirlooms.indexOf(h) < 0);
    const heirOffer = kind !== 'battle' ? r.shuffle(heirs.slice()).slice(0, 3) : [];
    const lostNames = res.lost.length ? `<p class="loss">Fallen: ${res.lost.length} piece${res.lost.length > 1 ? 's' : ''}. They won’t be back.</p>` : '';
    show(`<h1>VICTORY</h1><p class="sub">${res.turns} turns${res.clever ? ` · ${res.clever} clever kill${res.clever > 1 ? 's' : ''}` : ''}</p>${lostNames}
      ${promoted.length ? '<div class="vets">' + promoted.map((p) => `<p>★ ${p}</p>`).join('') + '</div>' : ''}
      <h2>TAKE A CARD</h2><div class="cards">${offer.map((id) => cardBtn(id)).join('')}</div>
      ${heirOffer.length ? `<h2>AND AN HEIRLOOM</h2><div class="opts">${heirOffer.map((h) => `<button class="opt" data-heir="${h}"><b>${HEIRLOOMS[h].icon} ${esc(HEIRLOOMS[h].name)}</b><span>${esc(HEIRLOOMS[h].text)}</span></button>`).join('')}</div>` : ''}
      ${kind === 'boss' ? `<h2>A NEW RECRUIT</h2><div class="opts">${['N', 'B', 'R'].map((t) => `<button class="opt" data-rec="${t}"><b>${glyph[t]} ${{ N: 'Knight', B: 'Bishop', R: 'Rook' }[t]}</b></button>`).join('')}</div>` : ''}
      <div class="row"><button class="btn big" id="on">CONTINUE</button><button class="btn ghost" id="skip">SKIP THE CARD</button></div>`, 'reward');
    let pickedCard = null, pickedHeir = heirOffer.length ? null : 'none', pickedRec = kind === 'boss' ? null : 'none';
    const sel = (attr, fn) => screen().querySelectorAll(`[data-${attr}]`).forEach((b) => (b.onclick = () => { screen().querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.remove('on')); b.classList.add('on'); fn(b.dataset[attr]); }));
    sel('card', (v) => (pickedCard = v)); sel('heir', (v) => (pickedHeir = v)); sel('rec', (v) => (pickedRec = v));
    const finish = (takeCard) => {
      if (!pickedHeir || !pickedRec) { $('on').textContent = 'PICK AN HEIRLOOM' + (pickedRec ? '' : ' AND A RECRUIT'); return; }
      if (takeCard && pickedCard) R.deck.push(pickedCard);
      if (pickedHeir !== 'none') R.heirlooms.push(pickedHeir);
      if (pickedRec !== 'none') R.army.push(newUnit(pickedRec, r));
      next(kind);
    };
    $('on').onclick = () => finish(true);
    $('skip').onclick = () => finish(false);
  }
  function next(kind) {
    R.pending = null;
    if (kind === 'boss') {
      if (R.act === 2) return runOver(true);
      R.act++; R.row = -1; R.col = -1;
    }
    save(); mapScreen();
  }

  /* ---------- forge, camp, events ---------- */
  function forge() {
    show(`<h1>THE FORGE</h1><p class="sub">Temper one card (it costs 1 less), or melt one down for good.</p>
      <div class="cards">${R.deck.map((id, i) => cardBtn(id, `data-i="${i}"`)).join('')}</div>
      <div class="row"><button class="btn big" id="up" disabled>UPGRADE</button><button class="btn" id="rm" disabled>REMOVE</button><button class="btn ghost" id="leave">LEAVE</button></div>`, 'forge');
    let pick = -1;
    screen().querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => {
      screen().querySelectorAll('[data-i]').forEach((x) => x.classList.remove('on')); b.classList.add('on'); pick = +b.dataset.i;
      $('up').disabled = R.deck[pick].endsWith('+') || IsoChess.cardOf(R.deck[pick]).cost === 0; $('rm').disabled = R.deck.length <= 4;
    }));
    $('up').onclick = () => { R.deck[pick] += '+'; next('forge'); };
    $('rm').onclick = () => { R.deck.splice(pick, 1); next('forge'); };
    $('leave').onclick = () => next('forge');
  }
  function camp() {
    const r = rng(R.seed + R.row * 7 + R.act * 11 + 5);
    const pawns = R.army.filter((u) => u.type === 'P');
    show(`<h1>CAMP</h1><p class="sub">A quiet night. Choose one.</p>
      <div class="opts">
        <button class="opt" data-c="recruit"><b>♟ Recruit</b><span>A Pawn joins your army.</span></button>
        <button class="opt" data-c="train"><b>★ Train</b><span>One of your pieces gains a trait.</span></button>
        <button class="opt" data-c="promote" ${pawns.length ? '' : 'disabled'}><b>♞ Promote</b><span>A Pawn becomes a Knight.</span></button>
      </div>${armyList(true)}`, 'camp');
    let choice = null;
    screen().querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => {
      choice = b.dataset.c;
      if (choice === 'recruit') { R.army.push(newUnit('P', r)); return next('camp'); }
      screen().querySelector('.sub').textContent = choice === 'train' ? 'Pick a piece to train.' : 'Pick a Pawn to promote.';
    }));
    screen().querySelectorAll('[data-uid]').forEach((b) => (b.onclick = () => {
      const u = R.army.find((x) => x.uid === +b.dataset.uid);
      if (choice === 'train') {
        const left = Object.keys(TRAITS).filter((t) => u.traits.indexOf(t) < 0);
        if (!left.length) return;
        u.traits.push(r.pick(left)); next('camp');
      } else if (choice === 'promote' && u.type === 'P') { u.type = 'N'; next('camp'); }
    }));
  }
  const EVENTS = [
    { title: 'A Wandering Knight', text: 'A knight without a lord offers her sword, for a price.',
      a: ['Take her in (lose a random card)', () => { if (R.deck.length > 4) R.deck.splice(Math.floor(Math.random() * R.deck.length), 1); R.army.push(newUnit('N', rng(Date.now()))); }],
      b: ['Send her on her way', () => {}] },
    { title: 'The Old Shrine', text: 'Candles still burn at a shrine to a forgotten queen.',
      a: ['Pray (a random piece gains a trait)', () => { const u = R.army[Math.floor(Math.random() * R.army.length)]; const t = Object.keys(TRAITS).filter((k) => u.traits.indexOf(k) < 0); if (t.length) u.traits.push(t[Math.floor(Math.random() * t.length)]); }],
      b: ['Take the offerings (upgrade a random card)', () => { const l = R.deck.map((c, i) => i).filter((i) => !R.deck[i].endsWith('+') && IsoChess.cardOf(R.deck[i]).cost > 0); if (l.length) R.deck[l[Math.floor(Math.random() * l.length)]] += '+'; }] },
    { title: 'Deserters', text: 'Three pawns from the other side want to switch. One of them looks shifty.',
      a: ['Take all three (one is a spy: a random card is lost)', () => { const r = rng(Date.now()); for (let i = 0; i < 3; i++) R.army.push(newUnit('P', r)); if (R.deck.length > 4) R.deck.splice(Math.floor(Math.random() * R.deck.length), 1); }],
      b: ['Take just one', () => R.army.push(newUnit('P', rng(Date.now())))] },
    { title: 'The Smith’s Daughter', text: 'She can sharpen one thing before you march on.',
      a: ['Upgrade a random card', () => { const l = R.deck.map((c, i) => i).filter((i) => !R.deck[i].endsWith('+')); if (l.length) R.deck[l[Math.floor(Math.random() * l.length)]] += '+'; }],
      b: ['Ask for her blessing (a Pawn joins you)', () => R.army.push(newUnit('P', rng(Date.now())))] }
  ];
  function event() {
    const e = EVENTS[rng(R.seed + R.row * 19 + R.col * 3 + R.act).int(0, EVENTS.length - 1)];
    show(`<h1>${esc(e.title)}</h1><p class="sub">${esc(e.text)}</p><div class="opts"><button class="opt" id="ea"><b>${esc(e.a[0])}</b></button><button class="opt" id="eb"><b>${esc(e.b[0])}</b></button></div>`, 'event');
    $('ea').onclick = () => { e.a[1](); next('event'); };
    $('eb').onclick = () => { e.b[1](); next('event'); };
  }

  /* ---------- the end ---------- */
  function runOver(victory) {
    R.over = true; R.victory = victory; save();
    const est = R.won.battle * PAY.battle + R.won.elite * PAY.elite + R.won.boss * PAY.boss + (victory ? PAY.victory : 0);
    const me = window.RV && RV.me() && RV.token();
    show(`<h1>${victory ? 'THE KINGDOM IS YOURS' : 'YOUR KING HAS FALLEN'}</h1>
      <p class="sub">${victory ? 'All three acts, done.' : `You fell in Act ${R.act + 1}.`} ${R.won.battle + R.won.elite + R.won.boss} battles won · ${R.won.boss} boss${R.won.boss === 1 ? '' : 'es'} · ${R.clever} clever kills</p>
      ${armyList()}
      <div class="claim" id="claim">${me ? 'Sending your run to Render’s Vision…' : `Log in on the site to turn runs into Polygons (this one: about ⬡${est}). <a href="#" id="login">Log in</a>`}</div>
      <div class="row"><button class="btn big" id="again2">NEW RUN</button></div>`, victory ? 'reward win' : 'reward lose');
    $('again2').onclick = title;
    if ($('login')) $('login').onclick = (ev) => { ev.preventDefault(); RV.login(); };
    if (me) claim();
  }
  function claim() {
    const box = $('claim');
    const payload = { id: R.id, b: R.won.battle, e: R.won.elite, x: R.won.boss, v: R.victory ? 1 : 0, t: Math.round((Date.now() - R.started) / 1000) };
    withGuild().then(() => RV.run('__chess finish ' + JSON.stringify(payload))).then((r) => {
      box.innerHTML = esc(String(r.content || 'Run recorded.'));
    }).catch((e) => { box.textContent = e.message === 'login' ? 'Your login ran out, so this run wasn’t sent.' : 'Couldn’t reach the bot: ' + e.message; });
  }
  function withGuild() {
    if (RV.guild()) return Promise.resolve(RV.guild());
    return RV.servers().then((l) => { if (!l.length) throw new Error('play in a server with the bot first'); RV.setGuild(l[0].id); return l[0].id; });
  }

  /* ---------- unlocks from the bot ---------- */
  function fetchOwned() {
    if (!window.RV || !RV.me() || !RV.token()) return Promise.resolve();
    return withGuild().then(() => RV.run('__chess status')).then((r) => {
      const d = r && r.chess;
      if (d) { owned = { items: d.owned || [], ready: true, note: `Today: ⬡${d.paid} of ⬡${d.cap} earned from runs.` }; }
    }).catch(() => { owned.note = 'Couldn’t reach the bot for your unlocks.'; });
  }

  window.IsoRun = {
    boot() {
      title();
      fetchOwned().then(() => { if (!screen().hidden && screen().classList.contains('scr-title')) title(); applySkin(); });
    },
    get run() { return R; }
  };
})();
