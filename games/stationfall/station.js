// Stationfall: a top-down station survival game for Render Productions. Original code.
// The world is a tile grid: terrain (space, ground, rock, ice, ore), floors, and one building per
// tile. You carry an inventory; crates make up the station's shared storage. Crew members walk the
// station with their own needs and jobs. Data tables live in data.js, pixel art in sprites.js.
(() => {
  'use strict';
  const { ITEMS, BUILDINGS: B, BUILD_TABS, RECIPES, ROLES, CREW_NAMES, SPR, ICON_URL, BUILD_ICON } = SF;

  // ---------- constants ----------
  const T = 32, W = 96, H = 96;
  const SAVE_KEY = 'stationfall-save-v2', BEST_KEY = 'stationfall-best';
  const DAY_LEN = 240;
  const SPACE = 0, GROUND = 1, ROCK = 2, ICE = 3, ORE = 4;
  const TILE_HP = { [ROCK]: 60, [ICE]: 50, [ORE]: 90 };
  const MINE_YIELD = { [ROCK]: { ore: 3 }, [ICE]: { ice: 2 }, [ORE]: { crystal: 2, ore: 1 } };
  const DRILL_YIELD = { [ROCK]: 'ore', [ICE]: 'ice', [ORE]: 'crystal' };
  const INV_SIZE = 18, HOTBAR = 6;
  const TOP_RES = ['ore', 'bar', 'circuit', 'ice', 'crystal', 'food'];
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const CALL_COST = { food: 6, circuit: 2 };

  const OBJECTIVES = [
    { text: 'Mine iron ore: hold left click on grey rock with the Mining Laser [1].', done: (g) => g.stats.ore >= 6 },
    { text: 'Press B, open Industry and build a Furnace. Press E at it to smelt Iron Bars.', done: (g) => g.stats.smelted >= 2 },
    { text: 'Build a Workbench and craft something. Circuits are a good start.', done: (g) => g.stats.crafted >= 1 },
    { text: 'Give your crew member a job: walk up to them and press E.', done: (g) => g.stats.roles >= 1 },
    { text: 'Build a Turret (Defense). Drone raids begin on the second night.', done: () => countType('turret') >= 1 },
    { text: 'Build another Bed and a Comms Console, then call down a survivor.', done: (g) => g.crew.length >= 2 },
    { text: 'Grow the station and survive. Each night brings more drones.', done: () => false }
  ];

  // ---------- state ----------
  let g = null;
  let terrain, tileHp, floor, shade;
  let build = new Array(W * H).fill(null);
  let roomId = new Int32Array(W * H).fill(-1);
  let rooms = [], buildList = [];
  let enemies = [], bullets = [], particles = [];
  let running = false, paused = true, retreating = false;
  let mode = 'play', buildTab = 0, selected = null;
  let mineTarget = -1, mineProgress = 0, shootCool = 0;
  let toastTimer = 0, saveTimer = 0, uiTimer = 0, flash = 0;
  let panel = null;               // { type, i } for a building, { type: 'crew', id } for a person
  let swapFrom = -1, lastPaint = -1;
  let zoom = 1.25;
  let makingAir = new Map();
  const occupied = new Set();     // door tiles someone is standing in
  const keys = new Set();
  const mouse = { x: 0, y: 0, left: false, right: false };
  const cam = { x: 0, y: 0 };
  const stars = [];

  const canvas = document.getElementById('view');
  const ctx = canvas.getContext('2d');
  const dark = document.createElement('canvas');
  const dctx = dark.getContext('2d');
  const $ = (id) => document.getElementById(id);

  // ---------- helpers ----------
  const idx = (x, y) => y * W + x;
  const inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const tileOf = (px) => Math.floor(px / T);
  const tileAt = (px, py) => idx(clamp(tileOf(px), 0, W - 1), clamp(tileOf(py), 0, H - 1));
  const center = (i) => ({ x: (i % W) * T + T / 2, y: Math.floor(i / W) * T + T / 2 });
  const minable = (t) => t === ROCK || t === ICE || t === ORE;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function countType(type) { let n = 0; for (const i of buildList) if (build[i].type === type) n++; return n; }
  function neighbors4(i) { const x = i % W, y = Math.floor(i / W), out = []; for (const [dx, dy] of N4) if (inMap(x + dx, y + dy)) out.push(idx(x + dx, y + dy)); return out; }

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function noise2(rand, size) {
    const n = Math.ceil(W / size) + 2, grid = [];
    for (let i = 0; i < n * n; i++) grid.push(rand());
    return (x, y) => {
      const gx = x / size, gy = y / size, x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const v = (a, b) => grid[(b % n) * n + (a % n)];
      const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
      const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
      return top + (bot - top) * sy;
    };
  }

  // ---------- inventory and storage ----------
  const invCount = (id) => g.inv.reduce((s, it) => s + (it && it.id === id ? it.n : 0), 0);
  const have = (id) => invCount(id) + (g.storage[id] || 0);
  const storeCap = () => countType('crate') * B.crate.holds;
  const storeUsed = () => Object.values(g.storage).reduce((s, n) => s + n, 0);
  function invAdd(id, n) {
    const max = ITEMS[id].stack;
    for (const it of g.inv) { if (n <= 0) break; if (it && it.id === id && it.n < max) { const k = Math.min(n, max - it.n); it.n += k; n -= k; } }
    for (let s = 0; s < INV_SIZE && n > 0; s++) if (!g.inv[s]) { const k = Math.min(n, max); g.inv[s] = { id, n: k }; n -= k; }
    return n;
  }
  function invTake(id, n) {
    let took = 0;
    for (let s = INV_SIZE - 1; s >= 0 && took < n; s--) {
      const it = g.inv[s]; if (!it || it.id !== id) continue;
      const k = Math.min(n - took, it.n); it.n -= k; took += k; if (!it.n) g.inv[s] = null;
    }
    return took;
  }
  function storeAdd(id, n) {
    const room = Math.max(0, storeCap() - storeUsed()), k = Math.min(room, n);
    if (k > 0) g.storage[id] = (g.storage[id] || 0) + k;
    return n - k;
  }
  function take(id, n) {
    const a = invTake(id, n);
    if (a < n) { g.storage[id] -= n - a; if (!g.storage[id]) delete g.storage[id]; }
  }
  const canAfford = (cost, times = 1) => Object.entries(cost).every(([k, v]) => have(k) >= v * times);
  function pay(cost) { for (const [k, v] of Object.entries(cost)) take(k, v); }
  /** Puts items somewhere: gear into the inventory first, materials into storage first, else the ground. */
  function give(id, n, x, y) {
    let left = n;
    if (ITEMS[id].kind !== 'mat') left = invAdd(id, left);
    left = storeAdd(id, left);
    if (left) left = invAdd(id, left);
    if (left) drop(id, left, x, y);
  }
  function drop(id, n, x, y) { if (n > 0) g.pickups.push({ id, n, x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 12 }); }

  // ---------- world generation ----------
  function generate(seed) {
    const rand = rng(seed);
    const edge = noise2(rand, 9), rockN = noise2(rand, 6), iceN = noise2(rand, 7), oreN = noise2(rand, 5);
    terrain = new Uint8Array(W * H); tileHp = new Uint8Array(W * H); floor = new Uint8Array(W * H);
    const cx = W / 2, cy = H / 2, R = 38;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = dist(x, y, cx, cy), i = idx(x, y);
      if (d > R + (edge(x, y) - 0.5) * 16) { terrain[i] = SPACE; continue; }
      let t = GROUND;
      if (rockN(x, y) > 0.64) t = ROCK;
      if (iceN(x, y) > 0.76) t = ICE;
      if (t === ROCK && oreN(x, y) > 0.66) t = ORE;
      if (d < 10) t = GROUND;
      terrain[i] = t;
      if (minable(t)) tileHp[i] = TILE_HP[t];
    }
    for (const [ox, oy, t] of [[8, -2, ICE], [9, -2, ICE], [8, -1, ICE], [-8, 1, ROCK], [-9, 1, ROCK], [-8, 2, ROCK], [-9, 2, ROCK], [-8, 3, ROCK], [-7, -7, ORE], [-8, -7, ORE]]) {
      const i = idx(cx + ox, cy + oy); terrain[i] = t; tileHp[i] = TILE_HP[t];
    }
  }
  function makeShade() {
    shade = new Float32Array(W * H);
    const rand = rng(g.seed + 7);
    for (let i = 0; i < W * H; i++) shade[i] = rand();
    stars.length = 0;
    for (let i = 0; i < 260; i++) stars.push({ x: rand() * 4000 - 2000, y: rand() * 4000 - 2000, s: rand() * 1.6 + 0.3, p: rand() * 0.5 + 0.15 });
  }

  function newCrew(x, y, name) {
    const used = new Set(g.crew.map((c) => c.name));
    const pool = CREW_NAMES.filter((n) => !used.has(n));
    return { id: g.nextId++, name: name || pool[Math.floor(Math.random() * pool.length)] || 'Crew', x, y, hp: 100, oxy: 100, hunger: 100, role: 'idle', path: [], task: null, carry: {}, think: 0, ang: Math.PI / 2, cool: 0, status: 'Settling in', stuck: 0 };
  }

  function newGame() {
    const seed = Math.floor(Math.random() * 1e9);
    g = {
      seed, day: 1, t: 20, raidDone: 0, nextId: 1,
      inv: new Array(INV_SIZE).fill(null), hand: 0, suit: null,
      storage: { bar: 30, circuit: 6, ice: 10, crystal: 6, food: 6 },
      power: 60, crew: [], pickups: [], pods: [],
      player: { x: 0, y: 0, hp: 100, oxy: 100, hunger: 100, stamina: 100, ang: 0 },
      stats: { ore: 0, ice: 0, smelted: 0, crafted: 0, roles: 0, harvests: 0, kills: 0 },
      obj: 0, log: []
    };
    g.inv[0] = { id: 'laser', n: 1 }; g.inv[1] = { id: 'pistol', n: 1 }; g.inv[2] = { id: 'food', n: 4 }; g.inv[3] = { id: 'medkit', n: 1 };
    generate(seed);
    build = new Array(W * H).fill(null);
    enemies = []; bullets = []; particles = []; retreating = false;
    // the shelter: a sealed 7x7 room with air, power, storage, a bed and lamps
    const cx = W / 2, cy = H / 2;
    for (let y = -4; y <= 4; y++) for (let x = -4; x <= 4; x++) {
      const i = idx(cx + x, cy + y);
      floor[i] = 1;
      if (Math.abs(x) === 4 || Math.abs(y) === 4) place(i, x === 0 && y === 4 ? 'airlock' : 'wall');
    }
    place(idx(cx - 3, cy - 3), 'o2gen'); place(idx(cx - 2, cy - 3), 'o2tank');
    place(idx(cx + 3, cy - 3), 'battery'); place(idx(cx + 2, cy - 3), 'crate');
    place(idx(cx + 3, cy + 1), 'bed');
    place(idx(cx - 3, cy + 3), 'lamp'); place(idx(cx + 3, cy + 3), 'lamp');
    place(idx(cx - 1, cy + 6), 'solar'); place(idx(cx + 1, cy + 6), 'solar'); place(idx(cx - 2, cy + 7), 'solar');
    refreshBuildList();
    g.player.x = cx * T + T / 2; g.player.y = cy * T + T / 2;
    g.crew.push(newCrew((cx - 1) * T + T / 2, (cy + 1) * T + T / 2, 'Ade'));
    makeShade();
    rooms = []; roomId = new Int32Array(W * H).fill(-1);
    rebuildRooms();
    for (const r of rooms) if (r.sealed) r.o2 = 1;
    for (const i of buildList) if (build[i].type === 'o2tank') build[i].air = 1;
    log('Shelter deployed. Air is on. Ade made it down with you.', 'good');
  }

  // ---------- buildings ----------
  function place(i, type) {
    if (type === 'floor') { floor[i] = 1; return; }
    build[i] = { type, hp: B[type].hp, on: false, t: 0, grow: 0, aim: 0, cool: 0, ice: 0, queue: [], air: 0, buf: 0, call: 0 };
  }
  function refreshBuildList() { buildList = []; for (let i = 0; i < W * H; i++) if (build[i]) buildList.push(i); }

  function placeError(i, type) {
    const def = B[type], c = center(i);
    if (terrain[i] !== GROUND) return terrain[i] === SPACE ? 'Needs solid ground' : 'Mine this out first';
    if (type === 'floor') return floor[i] ? 'Already a floor' : null;
    if (build[i]) return 'Something is already here';
    if (def.inside && !floor[i]) return 'Build a floor here first';
    if (!def.walk && dist(c.x, c.y, g.player.x, g.player.y) < T * 0.85) return 'You are standing there';
    if (!def.walk && g.crew.some((m) => dist(c.x, c.y, m.x, m.y) < T * 0.8)) return 'Someone is standing there';
    if (enemies.some((e) => dist(c.x, c.y, e.x, e.y) < T)) return 'Something is in the way';
    if (type === 'drill' && drillTarget(i) == null) return 'Drills go next to rock, ice or ore';
    return null;
  }
  function tryPlace(i, quiet = false) {
    const type = selected, err = placeError(i, type);
    if (err) { if (!quiet) toast(err, true); return; }
    if (!canAfford(B[type].cost)) { if (!quiet) toast('Not enough materials', true); return; }
    const c = center(i);
    if (dist(c.x, c.y, g.player.x, g.player.y) > T * 8) { if (!quiet) toast('Too far away', true); return; }
    pay(B[type].cost);
    place(i, type);
    refreshBuildList(); rebuildRooms();
    puff(c.x, c.y, '#ffe600', 5);
  }
  function tryRemove(i, quiet = false) {
    const c = center(i);
    if (dist(c.x, c.y, g.player.x, g.player.y) > T * 8) { if (!quiet) toast('Too far away', true); return; }
    const b = build[i];
    if (b) {
      if (b.type === 'crate' && storeUsed() > storeCap() - B.crate.holds) { if (!quiet) toast('Empty some storage before removing a crate', true); return; }
      build[i] = null; refreshBuildList();
      for (const [k, v] of Object.entries(B[b.type].cost)) give(k, Math.floor(v / 2), c.x, c.y);
      if (b.buf) give('ore', b.buf, c.x, c.y);
      rebuildRooms(); closePanelFor(i);
      puff(c.x, c.y, '#8a93ab', 6);
      return;
    }
    if (floor[i]) { floor[i] = 0; rebuildRooms(); }
  }
  function damageBuilding(i, dmg) {
    const b = build[i]; if (!b || !B[b.type].hp) return;
    b.hp -= dmg;
    const c = center(i);
    puff(c.x, c.y, '#ff6b6b', 2);
    if (b.hp > 0) return;
    build[i] = null; refreshBuildList();
    if (b.type === 'crate') {
      // a destroyed crate spills whatever the other crates can't hold
      let over = storeUsed() - storeCap();
      for (const k of Object.keys(g.storage)) { if (over <= 0) break; const n = Math.min(over, g.storage[k]); g.storage[k] -= n; over -= n; if (!g.storage[k]) delete g.storage[k]; drop(k, n, c.x, c.y); }
    }
    closePanelFor(i);
    puff(c.x, c.y, '#ff6b6b', 14);
    log(`${B[b.type].name} destroyed`, 'warn');
    rebuildRooms();
  }
  function drillTarget(i) {
    const x = i % W, y = Math.floor(i / W);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      if (!inMap(x + dx, y + dy)) continue;
      const j = idx(x + dx, y + dy);
      if (minable(terrain[j])) return j;
    }
    return null;
  }

  // ---------- rooms and air ----------
  // A room is a group of floor tiles walled in by walls, doors and airlocks. If air can reach a
  // tile that is neither floor nor a seal, the room is open and vents its air.
  function rebuildRooms() {
    const oldRooms = rooms, oldId = roomId;
    roomId = new Int32Array(W * H).fill(-1);
    rooms = [];
    const seals = (i) => build[i] && B[build[i].type].seal;
    for (let s = 0; s < W * H; s++) {
      if (!floor[s] || seals(s) || roomId[s] !== -1) continue;
      const id = rooms.length, room = { id, cells: [], sealed: true, o2: 0 };
      const queue = [s]; roomId[s] = id;
      while (queue.length) {
        const i = queue.pop(); room.cells.push(i);
        const x = i % W, y = Math.floor(i / W);
        for (const [dx, dy] of N4) {
          const nx = x + dx, ny = y + dy;
          if (!inMap(nx, ny)) { room.sealed = false; continue; }
          const n = idx(nx, ny);
          if (seals(n)) continue;
          if (!floor[n]) { room.sealed = false; continue; }
          if (roomId[n] === -1) { roomId[n] = id; queue.push(n); }
        }
      }
      let sum = 0;
      for (const c of room.cells) { const o = oldId[c]; sum += o >= 0 && oldRooms[o] ? oldRooms[o].o2 : 0; }
      room.o2 = sum / room.cells.length;
      if (!room.sealed && room.o2 > 0.3 && running) log('Hull breach! A room is venting air.', 'warn');
      rooms.push(room);
    }
  }
  const roomAt = (px, py) => { const i = tileAt(px, py); return roomId[i] >= 0 ? rooms[roomId[i]] : null; };
  const pressurized = (px, py) => { const r = roomAt(px, py); return !!r && r.o2 > 0.5; };

  // ---------- time ----------
  function daylight() {
    const t = g.t;
    if (t < 140) return 1;
    if (t < 160) return 1 - (t - 140) / 20;
    if (t < 225) return 0;
    return (t - 225) / 15;
  }
  const isNight = () => g.t >= 150 && g.t < 232;

  // ---------- simulation ----------
  function step(dt) {
    const before = g.t;
    g.t += dt;
    if (before < 140 && g.t >= 140 && g.day >= 2) toast('Dusk. Scanners pick up drones.', true);
    if (before < 155 && g.t >= 155 && g.day >= 2 && g.raidDone < g.day) startRaid();
    if (g.t >= DAY_LEN) { g.t -= DAY_LEN; g.day++; log(`Day ${g.day}. The sun is up.`, 'good'); }

    stepPower(dt);
    stepMachines(dt);
    stepAir(dt);
    stepPlayer(dt);
    for (const m of g.crew) stepCrew(m, dt);
    g.crew = g.crew.filter((m) => {
      if (m.hp > 0) return true;
      log(`${m.name} has died.`, 'warn'); puff(m.x, m.y, '#ff6b6b', 16);
      for (const [k, v] of Object.entries(m.carry)) drop(k, v, m.x, m.y);
      if (panel && panel.type === 'crew' && panel.id === m.id) closePanel();
      return false;
    });
    stepPods(dt);
    stepEnemies(dt);
    stepBullets(dt);
    for (const q of particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    particles = particles.filter((q) => q.life > 0);
    if (flash > 0) flash -= dt;
    while (g.obj < OBJECTIVES.length - 1 && OBJECTIVES[g.obj].done(g)) { g.obj++; log('Objective complete.', 'good'); }
    if (g.player.hp <= 0) gameOver();
  }

  function stepPower(dt) {
    const sun = daylight();
    let gen = 0, cap = 40;
    const consumers = [];
    for (const i of buildList) {
      const b = build[i], def = B[b.type];
      if (def.gen) gen += def.gen * sun;
      if (def.store) cap += def.store;
      if (def.use) consumers.push(i);
    }
    consumers.sort((a, b) => B[build[a].type].prio - B[build[b].type].prio);
    let avail = g.power + gen * dt, used = 0;
    for (const i of consumers) {
      const b = build[i];
      let use = B[b.type].use;
      if (b.type === 'med' && b.healing) use = 1.5;
      if (b.type === 'turret' && b.firing) use = 0.7;
      if (B[b.type].station && !b.queue.length && !b.call) use = 0.05;
      if (b.type === 'lamp' && sun > 0.6) use = 0;
      const need = use * dt;
      if (avail >= need) { avail -= need; used += use; b.on = true; } else b.on = false;
    }
    g.power = clamp(avail, 0, cap);
    g.cap = cap; g.net = gen - used;
    for (const i of buildList) { const b = build[i]; if (!B[b.type].use) b.on = true; }
  }

  function stepMachines(dt) {
    const p = g.player;
    makingAir = new Map();
    for (const i of buildList) {
      const b = build[i], c = center(i);
      switch (b.type) {
        case 'o2gen': {
          b.making = false;
          if (!b.on) break;
          const r = rooms[roomId[i]];
          if (!r || !r.sealed) break;
          b.ice += dt;
          if (b.ice >= 30) {
            if (have('ice') > 0) { take('ice', 1); b.ice = 0; }
            else { b.ice = 30; if (!b.warned) { log('Out of ice: an O2 generator has stopped.', 'warn'); b.warned = true; } break; }
          }
          b.warned = false; b.making = true;
          makingAir.set(r.id, (makingAir.get(r.id) || 0) + 1);
          break;
        }
        case 'farm': {
          const r = rooms[roomId[i]];
          b.air = !!r && r.o2 > 0.5;
          if (b.on && b.air && b.grow < 1) b.grow = Math.min(1, b.grow + dt / 60);
          break;
        }
        case 'drill': {
          if (!b.on) break;
          b.t += dt;
          if (b.t < 6) break;
          b.t = 0;
          const j = drillTarget(i);
          if (j == null) break;
          const res = DRILL_YIELD[terrain[j]];
          if (storeAdd(res, 1)) { if (b.buf < 20) { b.buf++; b.bufRes = res; } else break; }
          const tc = center(j); puff(tc.x, tc.y, res === 'ice' ? '#6fd3ee' : res === 'crystal' ? '#ffe600' : '#8a93ab', 3);
          tileHp[j] = Math.max(0, tileHp[j] - 20);
          if (tileHp[j] === 0) terrain[j] = GROUND;
          break;
        }
        case 'turret': {
          b.cool -= dt; b.firing = false;
          if (!b.on) break;
          let best = null, bd = T * 9;
          for (const e of enemies) { const d = dist(c.x, c.y, e.x, e.y); if (d < bd && clearShot(c.x, c.y, e.x, e.y)) { bd = d; best = e; } }
          if (best) {
            b.aim = Math.atan2(best.y - c.y, best.x - c.x); b.firing = true;
            if (b.cool <= 0) { b.cool = 0.55; shoot(c.x, c.y, b.aim, 'ally', 16, 760); }
          }
          break;
        }
        case 'med': {
          b.healing = false;
          if (!b.on) break;
          for (const who of [p, ...g.crew]) if (who.hp < 100 && dist(c.x, c.y, who.x, who.y) < T * 1.6) { who.hp = Math.min(100, who.hp + 9 * dt); b.healing = true; }
          break;
        }
        case 'furnace': case 'workbench': {
          const job = b.queue[0];
          if (!job || !b.on) break;
          job.left -= dt;
          if (job.left > 0) break;
          const r = RECIPES[b.type][job.r];
          give(r.out, r.n, c.x, c.y);
          if (b.type === 'furnace') g.stats.smelted += r.n; else g.stats.crafted++;
          b.queue.shift();
          puff(c.x, c.y, '#ffe600', 4);
          break;
        }
        case 'comms': {
          if (!b.call || !b.on) break;
          b.call -= dt;
          if (b.call <= 0) { b.call = 0; landPod(i); }
          break;
        }
      }
    }
  }

  function stepAir(dt) {
    // doors let air out while someone stands in them; airlocks never do
    occupied.clear();
    for (const who of [g.player, ...g.crew]) {
      const i = tileAt(who.x, who.y);
      if (build[i] && (build[i].type === 'door' || build[i].type === 'airlock')) occupied.add(i);
    }
    const leaking = new Set();
    for (const i of occupied) {
      if (!B[build[i].type].leaky) continue;
      const ns = neighbors4(i);
      const sides = ns.map((n) => (roomId[n] >= 0 ? rooms[roomId[n]] : null));
      const outside = ns.some((n) => !floor[n] && !(build[n] && B[build[n].type].seal)) || sides.some((r) => r && !r.sealed);
      const rs = [...new Set(sides.filter(Boolean))];
      if (outside) rs.forEach((r) => leaking.add(r.id));
      else if (rs.length === 2) {
        const avg = (rs[0].o2 * rs[0].cells.length + rs[1].o2 * rs[1].cells.length) / (rs[0].cells.length + rs[1].cells.length);
        for (const r of rs) r.o2 += (avg - r.o2) * Math.min(1, dt * 2);
      }
    }
    for (const r of rooms) {
      if (!r.sealed) { r.o2 = Math.max(0, r.o2 - dt * 0.5); continue; }
      const n = makingAir.get(r.id) || 0;
      if (n) r.o2 = Math.min(1, r.o2 + dt * n * 4 / r.cells.length);
      else r.o2 = Math.max(0, r.o2 - dt * 0.003);
      if (leaking.has(r.id)) r.o2 = Math.max(0, r.o2 - dt * 12 / r.cells.length);
    }
    // oxygen tanks: fill from a full room, refill a thin one
    for (const i of buildList) {
      const b = build[i]; if (b.type !== 'o2tank') continue;
      const r = rooms[roomId[i]]; if (!r || !r.sealed) continue;
      if (r.o2 > 0.97 && (makingAir.get(r.id) || 0) > 0) b.air = Math.min(1, b.air + dt * 0.03);
      else if (r.o2 < 0.9 && b.air > 0) { const out = Math.min(b.air, dt * 0.08); b.air -= out; r.o2 = Math.min(1, r.o2 + out * 40 / r.cells.length); }
    }
  }

  function stepPlayer(dt) {
    const p = g.player;
    let mx = 0, my = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my--;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my++;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx--;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx++;
    const moving = mx || my;
    const sprint = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && p.stamina > 1;
    if (sprint) p.stamina = Math.max(0, p.stamina - 25 * dt); else p.stamina = Math.min(100, p.stamina + 14 * dt);
    if (moving) { const len = Math.hypot(mx, my), speed = 150 * (sprint ? 1.6 : 1); moveBody(p, (mx / len) * speed * dt, (my / len) * speed * dt, 10, walkSolid); }
    const oxyMax = g.suit ? 250 : 100;
    if (pressurized(p.x, p.y)) p.oxy = Math.min(oxyMax, p.oxy + 40 * dt); else p.oxy = Math.max(0, p.oxy - 3.2 * dt);
    p.hunger = Math.max(0, p.hunger - dt * 100 / 360);
    if (p.oxy <= 0) p.hp -= 8 * dt;
    if (p.hunger <= 0) p.hp -= 2 * dt;
    if (p.hp > 0 && p.oxy > 50 && p.hunger > 60 && p.hp < 100) p.hp = Math.min(100, p.hp + 0.5 * dt);

    // walk over loot to pick it up
    g.pickups = g.pickups.filter((q) => {
      if (dist(q.x, q.y, p.x, p.y) > 22) return true;
      q.n = invAdd(q.id, q.n);
      return q.n > 0;
    });

    // the held item
    shootCool -= dt;
    const w = screenToWorld(mouse.x, mouse.y);
    p.ang = Math.atan2(w.y - p.y, w.x - p.x);
    const held = g.inv[g.hand], def = held && ITEMS[held.id];
    if (!(mouse.left && mode === 'play' && def)) { mineTarget = -1; return; }
    if (def.kind === 'tool') {
      const ti = tileAt(w.x, w.y), c = center(ti);
      if (minable(terrain[ti]) && dist(c.x, c.y, p.x, p.y) <= T * 2.6) {
        if (mineTarget !== ti) { mineTarget = ti; mineProgress = 0; }
        mineProgress += dt * def.mine;
        if (Math.random() < dt * 14) puff(c.x + (Math.random() - 0.5) * 20, c.y + (Math.random() - 0.5) * 20, terrain[ti] === ICE ? '#6fd3ee' : terrain[ti] === ORE ? '#ffe600' : '#8a93ab', 1);
        if (mineProgress >= tileHp[ti]) {
          const t = terrain[ti];
          let full = false;
          for (const [k, v] of Object.entries(MINE_YIELD[t])) { const left = invAdd(k, v); if (left) { drop(k, left, c.x, c.y); full = true; } g.stats[k === 'ice' ? 'ice' : 'ore'] += v; }
          if (full) toast('Inventory full: store materials in a crate', true);
          terrain[ti] = GROUND; tileHp[ti] = 0; mineTarget = -1;
          puff(c.x, c.y, '#d4bc00', 10);
        }
      } else mineTarget = -1;
    } else if (def.kind === 'gun' && shootCool <= 0) {
      if (def.ammo && have(def.ammo) <= 0) { shootCool = 0.5; toast('Out of ammo. Craft some at a workbench.', true); return; }
      if (def.ammo) take(def.ammo, 1);
      shootCool = def.rate;
      shoot(p.x, p.y, p.ang, 'ally', def.dmg, def.speed);
    }
  }

  // ---------- crew ----------
  const walkSolid = (i) => minable(terrain[i]) || (!!build[i] && !B[build[i].type].walk);
  /** Breadth-first search over walkable tiles. Returns the tiles to walk to reach the nearest goal. */
  function bfs(start, isGoal, max = 7000) {
    const prev = new Int32Array(W * H).fill(-1);
    prev[start] = start;
    const queue = [start]; let head = 0;
    while (head < queue.length && head < max) {
      const i = queue[head++];
      if (isGoal(i)) { const path = []; for (let k = i; k !== start; k = prev[k]) path.push(k); return path.reverse(); }
      for (const n of neighbors4(i)) if (prev[n] === -1 && !walkSolid(n)) { prev[n] = i; queue.push(n); }
    }
    return null;
  }
  const nextTo = (pred) => (i) => neighbors4(i).some(pred);
  const isType = (type) => (n) => !!build[n] && build[n].type === type;
  const carried = (m) => Object.values(m.carry).reduce((s, v) => s + v, 0);
  const airGoal = (i) => roomId[i] >= 0 && rooms[roomId[i]].o2 > 0.5;
  function setTask(m, task, path, status) { m.task = task; m.path = path || []; m.status = status; m.stuck = 0; }
  function nearestEnemy(x, y) { let best = null, bd = Infinity; for (const e of enemies) { const d = dist(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } } return best; }

  function think(m) {
    const here = tileAt(m.x, m.y), inAir = pressurized(m.x, m.y);
    // needs come first
    if (m.oxy < 45 && !inAir) { const path = bfs(here, airGoal); if (path) return setTask(m, { kind: 'walk' }, path, 'Needs air'); }
    if (m.hunger < 35 && (g.storage.food || 0) > 0) { const path = bfs(here, nextTo(isType('crate'))); if (path) return setTask(m, { kind: 'eat' }, path, 'Getting food'); }
    if (m.hp < 50 && countType('med')) { const path = bfs(here, nextTo(isType('med'))); if (path) return setTask(m, { kind: 'heal' }, path, 'Going to the med bay'); }
    // a full load goes back to storage
    if (carried(m) >= 10 || (carried(m) > 0 && m.role !== 'miner' && m.role !== 'farmer')) {
      const path = storeCap() > 0 ? bfs(here, nextTo(isType('crate'))) : null;
      if (path) return setTask(m, { kind: 'deposit' }, path, 'Hauling to storage');
    }
    if (m.role === 'miner' && storeCap() > 0 && m.oxy > 60) {
      let target = -1;
      const path = bfs(here, (i) => {
        const n = neighbors4(i).find((k) => minable(terrain[k]) && !g.crew.some((o) => o !== m && o.task && o.task.tile === k));
        if (n == null) return false;
        target = n; return true;
      }, 4000);
      if (path) return setTask(m, { kind: 'mine', tile: target, prog: 0 }, path, 'Mining');
    }
    if (m.role === 'farmer') {
      let target = -1;
      const path = bfs(here, (i) => { const n = neighbors4(i).find((k) => build[k] && build[k].type === 'farm' && build[k].grow >= 1); if (n == null) return false; target = n; return true; });
      if (path) return setTask(m, { kind: 'harvest', tile: target }, path, 'Harvesting');
    }
    if ((m.role === 'miner' || m.role === 'farmer') && carried(m) > 0 && storeCap() > 0) {
      const path = bfs(here, nextTo(isType('crate')));
      if (path) return setTask(m, { kind: 'deposit' }, path, 'Hauling to storage');
    }
    if (m.role === 'engineer' && have('bar') > 0) {
      let target = -1;
      const path = bfs(here, (i) => { const n = neighbors4(i).find((k) => build[k] && B[build[k].type].hp && build[k].hp < B[build[k].type].hp * 0.95); if (n == null) return false; target = n; return true; }, 5000);
      if (path) return setTask(m, { kind: 'repair', tile: target, spent: 0 }, path, 'Repairing');
    }
    if (m.role === 'guard' && enemies.length) {
      const e = nearestEnemy(m.x, m.y);
      if (e && dist(e.x, e.y, m.x, m.y) < T * 16) return setTask(m, { kind: 'fight' }, [], 'Fighting');
    }
    if (!inAir) { const path = bfs(here, airGoal); if (path) return setTask(m, { kind: 'walk' }, path, 'Heading inside'); }
    // nothing to do: wander about inside
    const idle = m.role === 'idle' ? 'No job yet' : m.role === 'miner' && !storeCap() ? 'Needs a crate' : 'Nothing to do';
    if (inAir && Math.random() < 0.5) {
      const r = roomAt(m.x, m.y), dest = r.cells[Math.floor(Math.random() * r.cells.length)];
      const path = bfs(here, (i) => i === dest, 1500);
      if (path) return setTask(m, { kind: 'walk' }, path, idle);
    }
    setTask(m, null, [], idle);
  }

  function stepCrew(m, dt) {
    if (pressurized(m.x, m.y)) m.oxy = Math.min(100, m.oxy + 40 * dt); else m.oxy = Math.max(0, m.oxy - 3.2 * dt);
    m.hunger = Math.max(0, m.hunger - dt * 100 / 420);
    if (m.oxy <= 0) m.hp -= 8 * dt;
    if (m.hunger <= 0) m.hp -= 2 * dt;
    if (m.hp > 0 && m.oxy > 50 && m.hunger > 60 && m.hp < 100) m.hp = Math.min(100, m.hp + 0.5 * dt);
    m.cool -= dt;

    m.think -= dt;
    const urgent = (m.oxy < 45 && !pressurized(m.x, m.y) && m.status !== 'Needs air') || (m.role === 'guard' && enemies.length && (!m.task || m.task.kind !== 'fight'));
    if ((!m.task || urgent) && m.think <= 0) { m.think = 0.6 + Math.random() * 0.4; think(m); }

    if (m.path.length) {
      if (walkSolid(m.path[0])) { m.path = []; m.task = null; return; }
      const c = center(m.path[0]), d = dist(m.x, m.y, c.x, c.y);
      if (d < 4) { m.path.shift(); m.stuck = 0; return; }
      const sp = 115 * dt, ang = Math.atan2(c.y - m.y, c.x - m.x);
      m.ang = ang;
      const ox = m.x, oy = m.y;
      moveBody(m, Math.cos(ang) * Math.min(sp, d), Math.sin(ang) * Math.min(sp, d), 8, walkSolid);
      if (dist(ox, oy, m.x, m.y) < sp * 0.2) { m.stuck += dt; if (m.stuck > 1.2) { m.path = []; m.task = null; m.think = 0; } }
      return;
    }
    const task = m.task;
    if (!task) return;
    switch (task.kind) {
      case 'walk': m.task = null; break;
      case 'eat':
        if ((g.storage.food || 0) > 0) { g.storage.food--; if (!g.storage.food) delete g.storage.food; m.hunger = Math.min(100, m.hunger + 40); }
        m.task = null; break;
      case 'heal':
        m.status = 'Healing';
        if (m.hp >= 95 || !countType('med')) m.task = null;
        break;
      case 'deposit':
        for (const [k, v] of Object.entries(m.carry)) { const left = storeAdd(k, v); if (left) m.carry[k] = left; else delete m.carry[k]; }
        if (carried(m)) { for (const [k, v] of Object.entries(m.carry)) drop(k, v, m.x, m.y); m.carry = {}; log('Storage is full. Build more crates.', 'warn'); }
        m.task = null; break;
      case 'mine': {
        const t = terrain[task.tile];
        if (!minable(t)) { m.task = null; break; }
        const c = center(task.tile); m.ang = Math.atan2(c.y - m.y, c.x - m.x);
        task.prog += dt * 30;
        if (Math.random() < dt * 8) puff(c.x, c.y, '#8a93ab', 1);
        if (task.prog >= tileHp[task.tile]) {
          for (const [k, v] of Object.entries(MINE_YIELD[t])) m.carry[k] = (m.carry[k] || 0) + v;
          terrain[task.tile] = GROUND; tileHp[task.tile] = 0; puff(c.x, c.y, '#d4bc00', 8);
          m.task = null;
        }
        break;
      }
      case 'harvest': {
        const b = build[task.tile];
        if (b && b.type === 'farm' && b.grow >= 1) { b.grow = 0; m.carry.food = (m.carry.food || 0) + 2; g.stats.harvests++; const c = center(task.tile); puff(c.x, c.y, '#b5e853', 8); }
        m.task = null; break;
      }
      case 'repair': {
        const b = build[task.tile];
        if (!b || b.hp >= B[b.type].hp) { m.task = null; break; }
        const c = center(task.tile); m.ang = Math.atan2(c.y - m.y, c.x - m.x);
        b.hp = Math.min(B[b.type].hp, b.hp + 30 * dt); task.spent += 30 * dt;
        if (task.spent >= 60) { task.spent = 0; if (have('bar') > 0) take('bar', 1); else m.task = null; }
        if (Math.random() < dt * 10) puff(c.x, c.y, '#ffe600', 1);
        break;
      }
      case 'fight': {
        const e = nearestEnemy(m.x, m.y);
        if (!e || dist(e.x, e.y, m.x, m.y) > T * 18) { m.task = null; break; }
        const d = dist(e.x, e.y, m.x, m.y);
        m.ang = Math.atan2(e.y - m.y, e.x - m.x);
        if (d < T * 6 && clearShot(m.x, m.y, e.x, e.y)) { if (m.cool <= 0) { m.cool = 0.3; shoot(m.x, m.y, m.ang, 'ally', 11, 720); } }
        else if (m.oxy > 40) {
          const path = bfs(tileAt(m.x, m.y), (i) => { const c = center(i); return dist(c.x, c.y, e.x, e.y) < T * 5; }, 3000);
          if (path) m.path = path.slice(0, 6); else m.task = null;
        } else m.task = null;
        break;
      }
    }
  }

  function landPod(commsTile) {
    const c = center(commsTile);
    for (let tries = 0; tries < 80; tries++) {
      const a = Math.random() * Math.PI * 2, r = (6 + Math.random() * 8) * T;
      const i = tileAt(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
      if (terrain[i] === GROUND && !build[i] && !floor[i]) { const pc = center(i); g.pods.push({ x: pc.x, y: pc.y, t: 5, fall: 1.5 }); toast('A survivor pod is coming down'); return; }
    }
    const pc = center(commsTile); g.pods.push({ x: pc.x, y: pc.y + T, t: 5, fall: 1.5 });
  }
  function stepPods(dt) {
    for (const pod of g.pods) {
      if (pod.fall > 0) { pod.fall -= dt; if (pod.fall <= 0) puff(pod.x, pod.y, '#ff9b3d', 20); continue; }
      pod.t -= dt;
      if (!pod.done && pod.t < 4) {
        pod.done = true;
        const m = newCrew(pod.x, pod.y + 18);
        g.crew.push(m);
        log(`${m.name} has joined the crew.`, 'good');
      }
    }
    g.pods = g.pods.filter((pod) => pod.t > 0 || pod.fall > 0);
  }

  // ---------- enemies and bullets ----------
  function startRaid() {
    g.raidDone = g.day; retreating = false;
    const drones = Math.min(24, 2 + Math.floor(g.day * 1.3));
    const brutes = Math.min(8, Math.max(0, g.day - 3));
    const a0 = Math.random() * Math.PI * 2;
    for (let n = 0; n < drones + brutes; n++) {
      const brute = n >= drones, a = a0 + (Math.random() - 0.5) * 1.6, r = 50 * T + Math.random() * 3 * T;
      enemies.push({
        x: (W / 2) * T + Math.cos(a) * r, y: (H / 2) * T + Math.sin(a) * r,
        kind: brute ? 'brute' : 'drone', hp: brute ? 90 : 30, max: brute ? 90 : 30,
        speed: brute ? 46 : 72, dmg: brute ? 14 : 6, rate: brute ? 1.6 : 1.1, range: (brute ? 5 : 6) * T,
        r: brute ? 13 : 9, cool: 1 + Math.random(), ang: 0
      });
    }
    toast(`RAID: ${drones + brutes} hostiles inbound`, true);
    log(`Night ${g.day}: ${drones} drones${brutes ? ` and ${brutes} brutes` : ''} incoming.`, 'warn');
  }
  const enemySolid = (i) => !!build[i] && build[i].type !== 'chair';

  function stepEnemies(dt) {
    const p = g.player;
    const dawn = enemies.length && !isNight() && g.t < 140;
    if (dawn && !retreating) { retreating = true; log('Dawn. The drones are pulling back.', 'good'); }
    const people = [p, ...g.crew];
    for (const e of enemies) {
      e.cool -= dt;
      if (dawn) {
        const a = Math.atan2(e.y - (H / 2) * T, e.x - (W / 2) * T);
        e.ang = a; e.x += Math.cos(a) * e.speed * 1.5 * dt; e.y += Math.sin(a) * e.speed * 1.5 * dt;
        if (dist(e.x, e.y, (W / 2) * T, (H / 2) * T) > 56 * T) e.gone = true;
        continue;
      }
      let tx = p.x, ty = p.y, bd = Infinity;
      for (const who of people) { const d = dist(e.x, e.y, who.x, who.y); if (d < T * 9 && d < bd) { bd = d; tx = who.x; ty = who.y; } }
      if (bd === Infinity) for (const i of buildList) { const c = center(i), d = dist(e.x, e.y, c.x, c.y); if (d < bd) { bd = d; tx = c.x; ty = c.y; } }
      const d = dist(e.x, e.y, tx, ty), ang = Math.atan2(ty - e.y, tx - e.x);
      e.ang = ang;
      const shot = clearShot(e.x, e.y, tx, ty, true);
      if (d > e.range * 0.7 || !shot) {
        const hit = moveBody(e, Math.cos(ang) * e.speed * dt, Math.sin(ang) * e.speed * dt, e.r, enemySolid);
        if (hit >= 0 && e.cool <= 0) { e.cool = e.rate; const c = center(hit); shoot(e.x, e.y, Math.atan2(c.y - e.y, c.x - e.x), 'enemy', e.dmg, 380); }
      }
      if (shot && d <= e.range && e.cool <= 0) { e.cool = e.rate; shoot(e.x, e.y, ang, 'enemy', e.dmg, 380); }
    }
  }

  function stepBullets(dt) {
    const p = g.player;
    for (const b of bullets) {
      for (let s = 0; s < 3 && b.life > 0; s++) {
        b.x += b.vx * dt / 3; b.y += b.vy * dt / 3;
        const tx = tileOf(b.x), ty = tileOf(b.y);
        if (!inMap(tx, ty)) continue;
        const i = idx(tx, ty);
        if (b.from === 'enemy') {
          if (build[i] && B[build[i].type].hp && build[i].type !== 'chair') { damageBuilding(i, b.dmg * 0.7); b.life = 0; break; }
          if (dist(b.x, b.y, p.x, p.y) < 12) { p.hp -= b.dmg * (g.suit ? 0.7 : 1); puff(b.x, b.y, '#ff6b6b', 4); b.life = 0; flash = 0.25; break; }
          const m = g.crew.find((c) => dist(b.x, b.y, c.x, c.y) < 11);
          if (m) { m.hp -= b.dmg; puff(b.x, b.y, '#ff6b6b', 4); b.life = 0; break; }
        } else {
          if (minable(terrain[i])) { puff(b.x, b.y, '#8a93ab', 2); b.life = 0; break; }
          for (const e of enemies) if (dist(b.x, b.y, e.x, e.y) < e.r + 3) { e.hp -= b.dmg; b.life = 0; puff(b.x, b.y, '#ffe600', 3); break; }
        }
      }
      b.life -= dt;
    }
    bullets = bullets.filter((b) => b.life > 0);
    const alive = [];
    for (const e of enemies) {
      if (e.gone) continue;
      if (e.hp > 0) { alive.push(e); continue; }
      g.stats.kills++;
      puff(e.x, e.y, '#ff6b6b', 16);
      drop('bar', e.kind === 'brute' ? 3 : 1, e.x, e.y);
      if (e.kind === 'brute' || Math.random() < 0.3) drop('circuit', 1, e.x, e.y);
    }
    if (enemies.length && !alive.length && !retreating) log('Raid repelled.', 'good');
    enemies = alive;
  }

  // ---------- movement and line of sight ----------
  function moveBody(o, dx, dy, r, solid) {
    let hit = -1;
    const blocked = (x, y) => {
      for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
        const tx = tileOf(x + ox), ty = tileOf(y + oy);
        if (!inMap(tx, ty)) { if (solid === enemySolid) continue; return idx(clamp(tx, 0, W - 1), clamp(ty, 0, H - 1)); }
        const i = idx(tx, ty);
        if (solid(i)) return i;
      }
      return -1;
    };
    const bx = blocked(o.x + dx, o.y);
    if (bx < 0) o.x += dx; else hit = bx;
    const by = blocked(o.x, o.y + dy);
    if (by < 0) o.y += dy; else hit = by;
    return hit;
  }
  function clearShot(x0, y0, x1, y1, enemyView = false) {
    const d = dist(x0, y0, x1, y1), n = Math.ceil(d / (T / 3));
    const t0 = tileAt(x0, y0), t1 = tileAt(x1, y1);
    for (let s = 1; s < n; s++) {
      const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
      const tx = tileOf(x), ty = tileOf(y);
      if (!inMap(tx, ty)) continue;
      const i = idx(tx, ty);
      if (i === t0 || i === t1) continue;
      if (enemyView) { if (build[i] && B[build[i].type].seal) return false; }
      else if (minable(terrain[i])) return false;
    }
    return true;
  }
  function shoot(x, y, ang, from, dmg, speed) {
    bullets.push({ x: x + Math.cos(ang) * 12, y: y + Math.sin(ang) * 12, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, from, dmg, life: 1.4 });
  }
  function puff(x, y, color, n) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 90;
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, color });
    }
  }

  // ---------- player actions ----------
  function useHeld() {
    const held = g.inv[g.hand]; if (!held) return;
    const def = ITEMS[held.id], p = g.player;
    if (def.kind === 'food') eat();
    else if (def.kind === 'heal') {
      if (p.hp >= 100) return toast('Already at full health', true);
      invTake('medkit', 1); p.hp = Math.min(100, p.hp + 45); puff(p.x, p.y, '#ff6b6b', 6);
    } else if (def.kind === 'suit') {
      g.inv[g.hand] = g.suit; g.suit = held; toast('Space suit on');
    }
  }
  function eat() {
    const p = g.player;
    if (invCount('food') <= 0) return toast('No rations in your inventory', true);
    if (p.hunger > 92) return toast('Not hungry', true);
    invTake('food', 1); p.hunger = Math.min(100, p.hunger + 32);
  }

  const USABLE = ['crate', 'furnace', 'workbench', 'comms', 'farm', 'drill'];
  /** What E acts on: the hovered thing if it's close, otherwise the nearest thing. */
  function interactTarget() {
    const p = g.player, w = screenToWorld(mouse.x, mouse.y);
    const crewHit = g.crew.find((m) => dist(m.x, m.y, w.x, w.y) < 14 && dist(m.x, m.y, p.x, p.y) < T * 2.5);
    if (crewHit) return { type: 'crew', id: crewHit.id };
    const usable = (i) => build[i] && USABLE.includes(build[i].type);
    const hi = tileAt(w.x, w.y), hc = center(hi);
    if (usable(hi) && dist(hc.x, hc.y, p.x, p.y) < T * 2.2) return { type: build[hi].type, i: hi };
    let best = null, bd = T * 1.9;
    for (const m of g.crew) { const d = dist(m.x, m.y, p.x, p.y); if (d < bd) { bd = d; best = { type: 'crew', id: m.id }; } }
    for (const i of buildList) { if (!usable(i)) continue; const c = center(i), d = dist(c.x, c.y, p.x, p.y); if (d < bd) { bd = d; best = { type: build[i].type, i }; } }
    return best;
  }
  function interact() {
    if (panel) return closePanel();
    const t = interactTarget();
    if (!t) return toast('Nothing to use here', true);
    if (t.type === 'farm') {
      const b = build[t.i], c = center(t.i);
      if (b.grow >= 1) { b.grow = 0; drop('food', invAdd('food', 2), c.x, c.y); g.stats.harvests++; puff(c.x, c.y, '#b5e853', 10); }
      else toast(b.air ? `Growing: ${Math.floor(b.grow * 100)}%` : 'Farms need air and power', true);
      return;
    }
    if (t.type === 'drill') {
      const b = build[t.i];
      if (!b.buf) return toast(storeCap() ? 'The drill sends its haul to storage' : 'Nothing to collect yet', true);
      b.buf = invAdd(b.bufRes || 'ore', b.buf);
      return;
    }
    openPanel(t);
  }

  // ---------- panels ----------
  function openPanel(t) { panel = t; panelHtml = ''; panelHeld = false; renderPanel(); $('panel').hidden = false; }
  function closePanel() { panel = null; $('panel').hidden = true; }
  function closePanelFor(i) { if (panel && panel.i === i) closePanel(); }
  const icon = (id) => `<img class="ic" src="${ICON_URL[id]}" alt="">`;
  const costHtml = (cost, times = 1) => Object.entries(cost).map(([k, v]) => `<span class="${have(k) >= v * times ? '' : 'short'}" title="${ITEMS[k].name}">${icon(k)}${v * times}</span>`).join(' ');

  function renderPanel() {
    if (!panel) return;
    let html = '';
    if (panel.type === 'crew') {
      const m = g.crew.find((c) => c.id === panel.id);
      if (!m) return closePanel();
      $('panel-title').textContent = m.name.toUpperCase();
      html += `<p class="muted">${esc(m.status)}</p>`;
      for (const [k, v, label] of [['hp', m.hp, 'Health'], ['oxy', m.oxy, 'Oxygen'], ['hunger', m.hunger, 'Food']]) html += `<div class="bar" data-k="${k}"><span>${label}</span><i><b style="width:${clamp(v, 0, 100)}%"></b></i></div>`;
      const c = Object.entries(m.carry);
      if (c.length) html += `<p class="muted">Carrying ${c.map(([k, v]) => `${icon(k)}${v}`).join(' ')}</p>`;
      html += '<h3>JOB</h3><div class="roles">';
      for (const [k, r] of Object.entries({ idle: { name: 'None', info: 'Wanders the station.' }, ...ROLES })) html += `<button class="btn role ${m.role === k ? 'on' : ''}" data-role="${k}" title="${esc(r.info)}">${r.name}</button>`;
      html += `</div><p class="muted small">${esc((ROLES[m.role] || { info: 'Give them something to do.' }).info)}</p>`;
    } else if (panel.type === 'crate') {
      if (!build[panel.i]) return closePanel();
      $('panel-title').textContent = 'STATION STORAGE';
      html += `<p class="muted">${storeUsed()} / ${storeCap()} used across ${countType('crate')} ${countType('crate') === 1 ? 'crate' : 'crates'}. Click an item to move it.</p>`;
      html += '<h3>STORAGE</h3><div class="grid">';
      const st = Object.entries(g.storage).filter(([, n]) => n > 0);
      html += st.length ? st.map(([k, n]) => `<button class="cell" data-take="${k}" title="Take ${esc(ITEMS[k].name)}">${icon(k)}<b>${n}</b></button>`).join('') : '<p class="muted small">Empty.</p>';
      html += '</div><h3>YOUR INVENTORY</h3><div class="grid">';
      html += g.inv.map((it, s) => (it ? `<button class="cell" data-store="${s}" title="Store ${esc(ITEMS[it.id].name)}">${icon(it.id)}<b>${it.n > 1 ? it.n : ''}</b></button>` : '<span class="cell empty"></span>')).join('');
      html += '</div><button class="btn wide" data-storeall="1">STORE ALL MATERIALS</button>';
    } else if (panel.type === 'furnace' || panel.type === 'workbench') {
      const b = build[panel.i];
      if (!b) return closePanel();
      $('panel-title').textContent = B[panel.type].name.toUpperCase();
      if (!b.on) html += '<p class="warn small">No power. Jobs wait until it has power.</p>';
      html += '<div class="recipes">';
      RECIPES[panel.type].forEach((r, k) => {
        html += `<div class="recipe">${icon(r.out)}<div class="rn"><b>${ITEMS[r.out].name}${r.n > 1 ? ` x${r.n}` : ''}</b><span>${costHtml(r.cost)} · ${r.time}s</span></div>`;
        html += `<button class="btn small" data-craft="${k}" data-n="1" ${canAfford(r.cost) ? '' : 'disabled'}>+1</button><button class="btn small" data-craft="${k}" data-n="5" ${canAfford(r.cost, 5) ? '' : 'disabled'}>+5</button></div>`;
      });
      html += '</div><h3>QUEUE</h3>';
      if (!b.queue.length) html += '<p class="muted small">Nothing queued.</p>';
      else {
        const first = b.queue[0], r0 = RECIPES[panel.type][first.r];
        html += `<div class="queue">${b.queue.map((q, k) => `<span class="qi">${icon(RECIPES[panel.type][q.r].out)}${k === 0 ? `<i class="prog"><b style="width:${100 * (1 - first.left / r0.time)}%"></b></i>` : ''}</span>`).join('')}</div>`;
        html += '<p class="muted small">Finished materials go to storage; gear goes to your inventory.</p>';
      }
    } else if (panel.type === 'comms') {
      const b = build[panel.i];
      if (!b) return closePanel();
      $('panel-title').textContent = 'COMMS CONSOLE';
      const beds = countType('bed'), pending = (b.call ? 1 : 0) + g.pods.filter((x) => !x.done).length;
      html += `<p class="muted">Crew ${g.crew.length} · Beds ${beds}</p>`;
      html += g.crew.map((m) => `<p class="small">${esc(m.name)}: ${m.role === 'idle' ? 'no job' : ROLES[m.role].name} · <span class="muted">${esc(m.status)}</span></p>`).join('');
      html += `<h3>CALL A SURVIVOR</h3><p class="muted small">Survivors drift through the belt in pods. Costs ${costHtml(CALL_COST)}. Needs a free bed.</p>`;
      if (b.call) html += `<p>Signal sent. Pod in ${Math.ceil(b.call)}s${b.on ? '' : ' (needs power)'}.</p>`;
      else html += `<button class="btn wide" data-call="1" ${canAfford(CALL_COST) && beds > g.crew.length + pending ? '' : 'disabled'}>SEND SIGNAL</button>`;
      if (beds <= g.crew.length + pending) html += '<p class="warn small">Build another bed first.</p>';
    }
    // only touch the DOM when something changed, and never mid-click
    if (html !== panelHtml && !panelHeld) { panelHtml = html; $('panel-body').innerHTML = html; }
  }
  let panelHtml = '', panelHeld = false;
  for (const id of ['panel', 'inv']) {
    $(id).addEventListener('pointerdown', () => { panelHeld = true; });
  }
  addEventListener('pointerup', () => { setTimeout(() => { panelHeld = false; }, 0); });

  $('panel').addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t || !panel) return;
    const d = t.dataset;
    if (d.role) {
      const m = g.crew.find((c) => c.id === panel.id);
      if (m && m.role !== d.role) { m.role = d.role; m.task = null; m.path = []; m.think = 0; if (m.role !== 'idle') g.stats.roles++; }
    }
    if (d.take) {
      const k = d.take, n = Math.min(g.storage[k] || 0, ITEMS[k].stack);
      const left = invAdd(k, n); g.storage[k] -= n - left; if (!g.storage[k]) delete g.storage[k];
      if (left) toast('Inventory full', true);
    }
    if (d.store) {
      const s = +d.store, it = g.inv[s];
      if (it) { it.n = storeAdd(it.id, it.n); if (it.n) toast('Storage is full', true); else g.inv[s] = null; }
    }
    if (d.storeall) {
      for (let s = 0; s < INV_SIZE; s++) { const it = g.inv[s]; if (!it || ITEMS[it.id].kind !== 'mat') continue; it.n = storeAdd(it.id, it.n); if (!it.n) g.inv[s] = null; }
      if (g.inv.some((it) => it && ITEMS[it.id].kind === 'mat')) toast('Storage is full', true);
    }
    if (d.craft) {
      const b = build[panel.i], r = RECIPES[panel.type][+d.craft];
      for (let k = 0; k < +d.n; k++) { if (!canAfford(r.cost) || b.queue.length >= 12) break; pay(r.cost); b.queue.push({ r: +d.craft, left: r.time }); }
    }
    if (d.call) {
      const b = build[panel.i];
      if (canAfford(CALL_COST)) { pay(CALL_COST); b.call = 20; log('Signal sent. A survivor is on the way.', 'good'); }
    }
    panelHeld = false; renderPanel(); renderBar();
  });
  $('panel-close').addEventListener('click', closePanel);

  // ---------- drawing ----------
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dark.width = innerWidth; dark.height = innerHeight;
  }
  function screenToWorld(sx, sy) { return { x: cam.x + (sx - innerWidth / 2) / zoom, y: cam.y + (sy - innerHeight / 2) / zoom }; }
  const sealAt = (i) => build[i] && (build[i].type === 'wall' || build[i].type === 'door' || build[i].type === 'airlock');

  function draw() {
    const vw = innerWidth, vh = innerHeight, p = g.player;
    cam.x += (p.x - cam.x) * 0.18; cam.y += (p.y - cam.y) * 0.18;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070d'; ctx.fillRect(0, 0, vw, vh);
    for (const s of stars) {
      const x = ((s.x - cam.x * s.p) % vw + vw) % vw, y = ((s.y - cam.y * s.p) % vh + vh) % vh;
      ctx.fillStyle = `rgba(244,236,184,${0.25 + s.p})`; ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.save();
    ctx.translate(Math.round(vw / 2), Math.round(vh / 2)); ctx.scale(zoom, zoom); ctx.translate(-Math.round(cam.x), -Math.round(cam.y));
    const x0 = clamp(tileOf(cam.x - vw / 2 / zoom) - 1, 0, W - 1), x1 = clamp(tileOf(cam.x + vw / 2 / zoom) + 1, 0, W - 1);
    const y0 = clamp(tileOf(cam.y - vh / 2 / zoom) - 1, 0, H - 1), y1 = clamp(tileOf(cam.y + vh / 2 / zoom) + 1, 0, H - 1);
    const now = performance.now() / 1000;

    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), t = terrain[i], px = x * T, py = y * T;
      if (t === SPACE) continue;
      ctx.drawImage(SPR['ground' + Math.floor(shade[i] * 3)], px, py, T, T);
      if (floor[i]) {
        ctx.drawImage(SPR.floor, px, py, T, T);
        const r = roomId[i] >= 0 ? rooms[roomId[i]] : null;
        if (r && r.o2 > 0) { ctx.fillStyle = `rgba(111,211,238,${r.o2 * 0.06})`; ctx.fillRect(px, py, T, T); }
        if (r && (!r.sealed || r.o2 < 0.5) && Math.sin(now * 6 + i * 0.7) > 0.5) { ctx.fillStyle = 'rgba(255,92,92,0.1)'; ctx.fillRect(px, py, T, T); }
      }
      if (minable(t)) ctx.drawImage(SPR[t === ICE ? 'ice' : t === ORE ? 'ore' : 'rock'], px, py, T, T);
    }
    const crack = (tile, prog) => {
      const c = center(tile), f = prog / Math.max(1, tileHp[tile]);
      ctx.strokeStyle = 'rgba(5,8,16,0.9)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let k = 0; k < Math.ceil(f * 6); k++) { const a = k * 1.1 + 0.4; ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * 13, c.y + Math.sin(a) * 13); }
      ctx.stroke();
    };
    if (mineTarget >= 0) { crack(mineTarget, mineProgress); const c = center(mineTarget); ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 2; ctx.strokeRect(c.x - T / 2 + 1, c.y - T / 2 + 1, T - 2, T - 2); }
    for (const m of g.crew) if (m.task && m.task.kind === 'mine' && !m.path.length) crack(m.task.tile, m.task.prog);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) { const i = idx(x, y); if (build[i]) drawBuilding(build[i], x * T, y * T, now, i); }
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        if (build[i] && build[i].type === 'wall' && y + 1 < H && !sealAt(idx(x, y + 1))) ctx.drawImage(SPR.wallFront, x * T, y * T + T, T, T / 2);
      }
    }

    for (const q of g.pickups) { const bob = Math.sin(now * 4 + q.x) * 2; ctx.drawImage(SPR['i_' + q.id], q.x - 10, q.y - 10 + bob, 20, 20); }
    for (const pod of g.pods) {
      if (pod.fall > 0) {
        const h = pod.fall * 260;
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(pod.x, pod.y, 14, 8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.drawImage(SPR.pod, pod.x - 16, pod.y - 16 - h, T, T);
        ctx.fillStyle = '#ff9b3d'; ctx.fillRect(pod.x - 3, pod.y - h + 14, 6, 10 + Math.random() * 8);
      } else ctx.drawImage(SPR.pod, pod.x - 16, pod.y - 16, T, T);
    }

    const w = screenToWorld(mouse.x, mouse.y);
    if (mode === 'build' && selected) {
      const i = tileAt(w.x, w.y), gx = (i % W) * T, gy = Math.floor(i / W) * T;
      const ok = !placeError(i, selected) && canAfford(B[selected].cost);
      ctx.globalAlpha = 0.55; ctx.drawImage(spriteFor(selected), gx, gy, T, T); ctx.globalAlpha = 1;
      ctx.strokeStyle = ok ? '#ffe600' : '#ff6b6b'; ctx.lineWidth = 2; ctx.strokeRect(gx + 1, gy + 1, T - 2, T - 2);
    }

    const drawPerson = (spr, x, y, ang) => { ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.drawImage(spr, -T / 2, -T / 2, T, T); ctx.restore(); };
    for (const m of g.crew) {
      drawPerson(m.hp < 40 ? SPR.crewHurt : SPR.crew, m.x, m.y, m.ang);
      if (carried(m)) ctx.drawImage(SPR['i_' + Object.keys(m.carry)[0]], m.x + 4, m.y - 22, 14, 14);
      if (m.task && (m.task.kind === 'mine' || m.task.kind === 'repair') && !m.path.length) {
        const c = center(m.task.tile); ctx.strokeStyle = m.task.kind === 'mine' ? '#6fd3ee' : '#ffe600'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(m.x, m.y); ctx.lineTo(c.x + (Math.random() - 0.5) * 6, c.y + (Math.random() - 0.5) * 6); ctx.stroke();
      }
    }
    if (mineTarget >= 0) {
      const c = center(mineTarget), held = g.inv[g.hand];
      ctx.strokeStyle = held && held.id === 'cutter' ? '#b88cff' : '#6fd3ee'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x + Math.cos(p.ang) * 14, p.y + Math.sin(p.ang) * 14); ctx.lineTo(c.x + (Math.random() - 0.5) * 6, c.y + (Math.random() - 0.5) * 6); ctx.stroke();
    }
    drawPerson(g.suit ? SPR.playerSuit : SPR.player, p.x, p.y, p.ang);
    const held = g.inv[g.hand];
    if (held) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang); ctx.drawImage(SPR['i_' + held.id], 6, -2, 16, 16); ctx.restore(); }

    for (const e of enemies) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang);
      const s = e.kind === 'brute' ? 34 : 26; ctx.drawImage(SPR[e.kind], -s / 2, -s / 2, s, s); ctx.restore();
      if (e.hp < e.max) { ctx.fillStyle = '#121a2c'; ctx.fillRect(e.x - 12, e.y - e.r - 9, 24, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(e.x - 12, e.y - e.r - 9, 24 * e.hp / e.max, 3); }
    }
    ctx.lineWidth = 2.5;
    for (const b of bullets) { ctx.strokeStyle = b.from === 'enemy' ? '#ff6b6b' : '#fff27a'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke(); }
    for (const q of particles) { ctx.globalAlpha = clamp(q.life * 2, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.restore();

    const night = 1 - daylight();
    if (night > 0.02) {
      dctx.globalCompositeOperation = 'source-over';
      dctx.clearRect(0, 0, vw, vh);
      dctx.fillStyle = `rgba(2,3,8,${0.8 * night})`; dctx.fillRect(0, 0, vw, vh);
      dctx.globalCompositeOperation = 'destination-out';
      const light = (wx, wy, r, a = 1) => {
        const sx = (wx - cam.x) * zoom + vw / 2, sy = (wy - cam.y) * zoom + vh / 2, rr = r * zoom;
        if (sx < -rr || sy < -rr || sx > vw + rr || sy > vh + rr) return;
        const grad = dctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
        grad.addColorStop(0, `rgba(0,0,0,${a})`); grad.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.fillStyle = grad; dctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      };
      light(p.x, p.y, T * 5.5);
      for (const m of g.crew) light(m.x, m.y, T * 2.5, 0.8);
      for (const i of buildList) {
        const b = build[i]; if (!b.on) continue;
        const c = center(i);
        if (B[b.type].light) light(c.x, c.y, T * B[b.type].light);
        else if (B[b.type].use) light(c.x, c.y, T * 1.6, 0.7);
      }
      for (const r of rooms) if (r.o2 > 0.5 && r.cells.length < 400) for (let k = 0; k < r.cells.length; k += 7) { const c = center(r.cells[k]); light(c.x, c.y, T * 2, 0.5); }
      ctx.drawImage(dark, 0, 0, vw, vh);
      ctx.fillStyle = `rgba(255,107,107,${0.9 * night})`;
      for (const e of enemies) { const sx = (e.x - cam.x) * zoom + vw / 2, sy = (e.y - cam.y) * zoom + vh / 2; ctx.beginPath(); ctx.arc(sx, sy, (e.kind === 'brute' ? 4 : 3) * zoom, 0, Math.PI * 2); ctx.fill(); }
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,107,107,${flash})`; ctx.fillRect(0, 0, vw, vh); }
  }

  function spriteFor(type, b) {
    switch (type) {
      case 'wall': return SPR.wallTop;
      case 'farm': return SPR['farm' + (b ? Math.min(3, Math.floor(b.grow * 3.999)) : 3)];
      case 'furnace': return b && b.on && b.queue.length ? SPR.furnaceOn : SPR.furnace;
      case 'lamp': return b && !b.on ? SPR.lampOff : SPR.lamp;
      case 'turret': return SPR.turretBase;
      default: return SPR[type] || SPR.crate;
    }
  }
  function drawBuilding(b, px, py, now, i) {
    const cx = px + T / 2, cy = py + T / 2;
    if (b.type === 'door' || b.type === 'airlock') ctx.drawImage(occupied.has(i) ? SPR[b.type + 'Open'] : SPR[b.type], px, py, T, T);
    else ctx.drawImage(spriteFor(b.type, b), px, py, T, T);
    switch (b.type) {
      case 'turret': ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.aim); ctx.drawImage(SPR.turretGun, -T / 2 + 4, -T / 2, T, T); ctx.restore(); break;
      case 'drill': ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.on ? now * 8 : 0); ctx.drawImage(SPR.drillBit, -12, -12, 24, 24); ctx.restore(); break;
      case 'battery': { const f = g.cap ? g.power / g.cap : 0; ctx.fillStyle = '#ffe600'; ctx.fillRect(px + 12, py + 26 - 16 * f, 8, 16 * f); break; }
      case 'o2gen': if (b.making) { ctx.strokeStyle = '#c9f3ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy + 2, 6, now * 3, now * 3 + 2); ctx.stroke(); } break;
      case 'o2tank': ctx.fillStyle = 'rgba(5,7,13,0.75)'; ctx.fillRect(px + 10, py + 4, 12, 24 * (1 - b.air)); break;
      case 'solar': if (daylight() > 0.3) { ctx.fillStyle = `rgba(255,230,0,${0.12 * daylight()})`; ctx.fillRect(px + 4, py + 4, T - 8, T - 8); } break;
      case 'workbench': if (b.queue.length && b.on && Math.random() < 0.3) puff(cx, cy - 4, '#ffe600', 1); break;
      case 'comms': if (b.call && Math.sin(now * 6) > 0) { ctx.fillStyle = '#6fd3ee'; ctx.fillRect(px + 20, py + 2, 4, 4); } break;
    }
    if (B[b.type].use && !b.on && !(b.type === 'lamp' && daylight() > 0.6) && Math.sin(now * 6 + i) > 0) { ctx.fillStyle = '#ff5c5c'; ctx.fillRect(px + T - 7, py + 3, 4, 4); }
    const max = B[b.type].hp;
    if (max && b.hp < max) { ctx.fillStyle = '#121a2c'; ctx.fillRect(px + 4, py + T - 5, T - 8, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(px + 4, py + T - 5, (T - 8) * b.hp / max, 3); }
  }

  // ---------- HUD ----------
  function buildHud() {
    $('res').innerHTML = TOP_RES.map((k) => `<div data-r="${k}" title="${ITEMS[k].name} (inventory + storage)">${icon(k)}<b>0</b></div>`).join('');
  }
  let barKey = '';
  function renderBar() {
    let html, tabs = '';
    if (mode === 'build') {
      const tab = BUILD_TABS[buildTab];
      tabs = BUILD_TABS.map((t, k) => `<button class="tab ${k === buildTab ? 'on' : ''}" data-tab="${k}">${t.label}</button>`).join('');
      html = tab.items.map((k, n) => {
        const d = B[k];
        return `<button class="slot bslot ${selected === k ? 'on' : ''} ${canAfford(d.cost) ? '' : 'poor'}" data-b="${k}" title="${esc(d.name)}: ${esc(d.info)}"><kbd>${n + 1}</kbd><img class="bi" src="${BUILD_ICON(k)}" alt=""><span class="nm">${d.name}</span><span class="ct">${costHtml(d.cost)}</span></button>`;
      }).join('');
    } else {
      html = '';
      for (let s = 0; s < HOTBAR; s++) {
        const it = g.inv[s];
        html += `<button class="slot hslot ${g.hand === s ? 'on' : ''}" data-h="${s}" title="${it ? esc(ITEMS[it.id].name + (ITEMS[it.id].info ? ': ' + ITEMS[it.id].info : '')) : 'Empty'}"><kbd>${s + 1}</kbd>${it ? `<img class="bi" src="${ICON_URL[it.id]}" alt=""><span class="nm">${ITEMS[it.id].name}</span>${it.n > 1 ? `<b class="n">${it.n}</b>` : ''}` : ''}</button>`;
      }
    }
    const help = mode === 'build'
      ? 'BUILD &middot; click or drag to build &middot; right-click or drag to remove (half back) &middot; 1&ndash;4 pick &middot; Tab next tab &middot; B / Esc leave'
      : 'WASD move &middot; Shift sprint &middot; 1&ndash;6 hold &middot; click use &middot; E interact &middot; F eat &middot; I inventory &middot; B build &middot; Esc pause';
    const key = tabs + html + help;
    if (key === barKey || panelHeld) return;     // only touch the DOM when something changed
    barKey = key;
    $('tabs').innerHTML = tabs; $('hotbar').innerHTML = html; $('help').innerHTML = help;
  }
  $('hotbar').addEventListener('pointerdown', () => { panelHeld = true; });
  $('tabs').addEventListener('pointerdown', () => { panelHeld = true; });
  $('tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) { buildTab = +t.dataset.tab; selected = null; panelHeld = false; renderBar(); } });
  $('hotbar').addEventListener('click', (e) => {
    const s = e.target.closest('.slot'); if (!s) return;
    if (s.dataset.b) selected = selected === s.dataset.b ? null : s.dataset.b;
    if (s.dataset.h) g.hand = +s.dataset.h;
    panelHeld = false; renderBar();
  });

  let invHtml = '';
  function renderInventory() {
    const html = g.inv.map((it, s) => `<button class="cell ${s < HOTBAR ? 'hot' : ''} ${swapFrom === s ? 'swap' : ''}" data-s="${s}" title="${it ? esc(ITEMS[it.id].name + (ITEMS[it.id].info ? ': ' + ITEMS[it.id].info : '')) : ''}">${it ? `${icon(it.id)}<b>${it.n > 1 ? it.n : ''}</b>` : ''}</button>`).join('');
    if (html !== invHtml && !panelHeld) { invHtml = html; $('inv-grid').innerHTML = html; }
    const suit = g.suit ? `${icon('suit')}<span>Space suit on. Click to take it off.</span>` : '<span class="muted">No suit. Craft one at a workbench, then use it.</span>';
    if ($('inv-suit').innerHTML !== suit && !panelHeld) $('inv-suit').innerHTML = suit;
  }
  $('inv-grid').addEventListener('click', (e) => {
    const c = e.target.closest('[data-s]'); if (!c) return;
    const s = +c.dataset.s;
    if (swapFrom < 0) { if (g.inv[s]) swapFrom = s; }
    else { [g.inv[swapFrom], g.inv[s]] = [g.inv[s], g.inv[swapFrom]]; swapFrom = -1; }
    panelHeld = false; renderInventory(); renderBar();
  });
  $('inv-suit').addEventListener('click', () => {
    if (!g.suit) return;
    if (invAdd('suit', 1)) return toast('Inventory full', true);
    g.suit = null; g.player.oxy = Math.min(g.player.oxy, 100); renderInventory(); renderBar();
  });
  function toggleInventory(show = $('inv').hidden) { $('inv').hidden = !show; swapFrom = -1; invHtml = ''; if (show) renderInventory(); }

  function updateHud() {
    const p = g.player;
    $('day').textContent = g.day;
    const night = isNight(), left = night ? 232 - g.t : (g.t < 150 ? 150 - g.t : DAY_LEN - g.t + 150);
    $('phase').textContent = night ? 'NIGHT' : 'DAY';
    $('phase-left').textContent = `${night ? 'dawn' : 'dusk'} in ${Math.ceil(left)}s`;
    $('phase').parentElement.classList.toggle('night', night);
    for (const k of TOP_RES) document.querySelector(`[data-r="${k}"] b`).textContent = have(k);
    const oxyMax = g.suit ? 250 : 100;
    for (const [k, v] of [['hp', p.hp], ['oxy', 100 * p.oxy / oxyMax], ['hunger', p.hunger], ['stamina', p.stamina]]) {
      const bar = document.querySelector(`.vitals .bar[data-k="${k}"]`);
      bar.querySelector('b').style.width = clamp(v, 0, 100) + '%';
      bar.classList.toggle('low', k !== 'stamina' && v < 25);
    }
    const inAir = pressurized(p.x, p.y);
    $('air').textContent = inAir ? 'PRESSURIZED' : `VACUUM: ${Math.ceil(p.oxy / 3.2)}s of air${g.suit ? ' (suit)' : ''}`;
    $('air').classList.toggle('vacuum', !inAir);
    document.querySelector('.bar[data-k="power"] b').style.width = (g.cap ? 100 * g.power / g.cap : 0) + '%';
    $('power-label').textContent = `${Math.floor(g.power)} / ${g.cap || 40}`;
    $('net').textContent = `${g.net >= 0 ? '+' : ''}${(g.net || 0).toFixed(1)}/s ${daylight() < 0.1 ? '· night: no solar' : ''}`;
    $('net').classList.toggle('neg', (g.net || 0) < 0);
    $('storage-line').textContent = `Storage ${storeUsed()} / ${storeCap()}`;
    $('objective').textContent = OBJECTIVES[g.obj].text;
    $('crew-list').innerHTML = g.crew.map((m) => `<li><b>${esc(m.name)}</b> ${m.role === 'idle' ? 'no job' : ROLES[m.role].name.toLowerCase()} · <span class="${m.hp < 40 || m.oxy < 30 || m.hunger < 20 ? 'warn' : 'muted'}">${esc(m.status)}</span></li>`).join('') || '<li class="muted">No crew.</li>';
    renderBar();
    if (panel) renderPanel();
    if (!$('inv').hidden) renderInventory();
    updateTip();
  }
  function updateTip() {
    const tip = $('tip');
    if (!running || paused) { tip.hidden = true; return; }
    const w = screenToWorld(mouse.x, mouse.y), i = tileAt(w.x, w.y);
    let text = '';
    const m = g.crew.find((c) => dist(c.x, c.y, w.x, w.y) < 14);
    if (m) text = `<b>${esc(m.name)}</b> · ${m.role === 'idle' ? 'no job' : ROLES[m.role].name}<br>${esc(m.status)}<br><span class="muted">E to talk</span>`;
    else if (build[i]) {
      const b = build[i], d = B[b.type];
      text = `<b>${d.name}</b>`;
      if (d.hp) text += ` · ${Math.ceil(b.hp)}/${d.hp}`;
      if (d.use && !(b.type === 'lamp' && daylight() > 0.6)) text += `<br>${b.on ? 'Powered' : '<span class="warn">No power</span>'}`;
      if (b.type === 'farm') text += `<br>${b.grow >= 1 ? 'Ripe: press E' : b.air ? `Growing ${Math.floor(b.grow * 100)}%` : '<span class="warn">Needs air</span>'}`;
      if (b.type === 'o2tank') text += `<br>Air stored ${Math.round(b.air * 100)}%`;
      if (b.type === 'o2gen' && !b.making) text += '<br><span class="warn">Not making air</span>';
      if (d.station && b.queue.length) text += `<br>${b.queue.length} queued`;
      if (b.type === 'crate') text += `<br>Storage ${storeUsed()}/${storeCap()}`;
      if (USABLE.includes(b.type) && b.type !== 'farm' && b.type !== 'drill') text += '<br><span class="muted">E to open</span>';
    } else if (minable(terrain[i])) text = `<b>${terrain[i] === ICE ? 'Ice' : terrain[i] === ORE ? 'Crystal ore' : 'Iron rock'}</b><br><span class="muted">Mine it with your laser</span>`;
    else if (roomId[i] >= 0) { const r = rooms[roomId[i]]; text = `<b>Room</b> · air ${Math.round(r.o2 * 100)}%${r.sealed ? '' : ' · <span class="warn">LEAKING</span>'}`; }
    tip.hidden = !text;
    if (text) { tip.innerHTML = text; tip.style.left = Math.min(mouse.x + 16, innerWidth - 220) + 'px'; tip.style.top = mouse.y + 14 + 'px'; }
  }
  function log(msg, kind = '') {
    if (!g) return;
    g.log.unshift({ msg, kind }); g.log.length = Math.min(g.log.length, 10);
    $('log').innerHTML = g.log.map((l) => `<li class="${l.kind}">${esc(l.msg)}</li>`).join('');
  }
  function toast(msg, warn = false) { const el = $('toast'); el.textContent = msg; el.hidden = false; el.classList.toggle('warn', warn); toastTimer = 2.2; }
  function setMode(m) {
    mode = m; selected = null;
    if (m === 'build') closePanel();
    canvas.style.cursor = m === 'build' ? 'cell' : 'crosshair';
    renderBar();
  }

  // ---------- save / load ----------
  function save() {
    if (!g || !running) return;
    const data = {
      ...g,
      terrain: Array.from(terrain).join(''), tileHp: Array.from(tileHp), floor: Array.from(floor).join(''),
      builds: buildList.map((i) => ({ i, ...build[i] })),
      air: rooms.filter((r) => r.o2 > 0).map((r) => [r.cells[0], +r.o2.toFixed(3)]),
      enemies, retreating
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
  }
  function load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!data || !data.terrain) return false;
    terrain = Uint8Array.from(data.terrain, Number); tileHp = Uint8Array.from(data.tileHp); floor = Uint8Array.from(data.floor, Number);
    build = new Array(W * H).fill(null);
    for (const b of data.builds) { const { i, ...rest } = b; build[i] = rest; }
    enemies = data.enemies || []; retreating = !!data.retreating; bullets = []; particles = [];
    const air = data.air || [];
    for (const k of ['terrain', 'tileHp', 'floor', 'builds', 'air', 'enemies', 'retreating']) delete data[k];
    g = data;
    for (const m of g.crew) { m.path = []; m.task = null; m.think = 0; }
    refreshBuildList(); makeShade();
    rooms = []; roomId = new Int32Array(W * H).fill(-1);
    rebuildRooms();
    for (const [cell, o2] of air) { const r = rooms[roomId[cell]]; if (r) r.o2 = o2; }
    return true;
  }

  // ---------- game flow ----------
  function start(fresh) {
    if (fresh || !load()) newGame();
    cam.x = g.player.x; cam.y = g.player.y;
    $('overlay').hidden = true;
    running = true; paused = false; barKey = '';
    setMode('play'); closePanel(); toggleInventory(false);
    $('log').innerHTML = g.log.map((l) => `<li class="${l.kind}">${esc(l.msg)}</li>`).join('');
  }
  function pause(on) {
    if (!running) return;
    paused = on;
    if (on) {
      save();
      $('ov-title').textContent = 'PAUSED';
      $('ov-text').textContent = `Day ${g.day}. ${g.crew.length} crew. Your station is saved.`;
      $('ov-continue').hidden = false; $('ov-new').textContent = 'NEW STATION';
      $('overlay').hidden = false;
    } else $('overlay').hidden = true;
  }
  function gameOver() {
    running = false; paused = true;
    const best = Math.max(g.day, Number(localStorage.getItem(BEST_KEY) || 0));
    try { localStorage.setItem(BEST_KEY, String(best)); localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    $('ov-title').textContent = 'STATION LOST';
    $('ov-text').textContent = `You held out for ${g.day} ${g.day === 1 ? 'day' : 'days'} with ${g.crew.length} crew and destroyed ${g.stats.kills} drones.`;
    $('ov-best').textContent = `Best: ${best} ${best === 1 ? 'day' : 'days'}`;
    $('ov-continue').hidden = true; $('ov-new').textContent = 'TRY AGAIN';
    $('overlay').hidden = false;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (g) {
      if (running && !paused) {
        step(dt);
        if (mode === 'build' && selected && (mouse.left || mouse.right)) {
          const w = screenToWorld(mouse.x, mouse.y), i = tileAt(w.x, w.y);
          if (i !== lastPaint) { lastPaint = i; if (mouse.left) tryPlace(i, true); else tryRemove(i, true); }
        }
        saveTimer += dt; if (saveTimer > 20) { saveTimer = 0; save(); }
      }
      draw();
      uiTimer += dt;
      if (uiTimer > 0.15) { updateHud(); uiTimer = 0; }
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') {
      if (panel) return closePanel();
      if (!$('inv').hidden) return toggleInventory(false);
      if (mode === 'build') return setMode('play');
      if (running) pause(!paused);
      return;
    }
    if (!running || paused) return;
    if (e.code === 'Tab') { e.preventDefault(); if (mode === 'build') { buildTab = (buildTab + 1) % BUILD_TABS.length; selected = null; renderBar(); } return; }
    keys.add(e.code);
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = +digit[1] - 1;
      if (mode === 'build') { const k = BUILD_TABS[buildTab].items[n]; if (k) selected = selected === k ? null : k; }
      else if (n < HOTBAR) g.hand = n;
      renderBar();
    }
    if (e.code === 'KeyB') setMode(mode === 'build' ? 'play' : 'build');
    if (e.code === 'KeyE') interact();
    if (e.code === 'KeyF') eat();
    if (e.code === 'KeyI') toggleInventory();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; if (running && !paused) pause(true); });
  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!running || paused) return;
    lastPaint = -1;
    const w = screenToWorld(e.clientX, e.clientY), i = tileAt(w.x, w.y);
    if (e.button === 0) {
      mouse.left = true;
      if (mode === 'build' && selected) { lastPaint = i; tryPlace(i); }
      else if (mode === 'play') { const it = g.inv[g.hand]; if (it && ['food', 'heal', 'suit'].includes(ITEMS[it.id].kind)) useHeld(); }
    }
    if (e.button === 2) { mouse.right = true; if (mode === 'build') { lastPaint = i; tryRemove(i); } }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = clamp(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.6, 2.4); }, { passive: false });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('beforeunload', save);
  $('ov-new').addEventListener('click', () => { if (running && !confirm('Start a new station? Your current one will be lost.')) return; start(true); });
  $('ov-continue').addEventListener('click', () => { if (running) pause(false); else start(false); });
  $('inv-close').addEventListener('click', () => toggleInventory(false));

  // ---------- boot ----------
  resize();
  buildHud();
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  if (best) $('ov-best').textContent = `Best: ${best} ${best === 1 ? 'day' : 'days'}`;
  if (localStorage.getItem(SAVE_KEY)) $('ov-continue').hidden = false;
  requestAnimationFrame(frame);

  // for testing from the console
  window.__stationfall = {
    get g() { return g; }, step, rooms: () => rooms, build: () => build, terrain: () => terrain,
    place: (i, t) => { place(i, t); refreshBuildList(); }, rebuildRooms, startRaid, enemies: () => enemies,
    newGame, save, load, idx, have, storeCap, interact, openPanel, setMode, occupied
  };
})();
