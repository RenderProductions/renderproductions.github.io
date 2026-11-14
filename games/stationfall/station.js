// Stationfall: a top-down station survival game for Render Productions.
// Original code. One canvas, no libraries. Everything in the world lives on a tile grid:
// terrain (space, ground, rock, ice, ore), floors, and one building per tile.
(() => {
  'use strict';

  // ---------- constants ----------
  const T = 32;                 // tile size in world pixels
  const W = 96, H = 96;         // map size in tiles
  const SAVE_KEY = 'stationfall-save-v1';
  const BEST_KEY = 'stationfall-best';
  const DAY_LEN = 240;          // seconds in one asteroid day
  const SPACE = 0, GROUND = 1, ROCK = 2, ICE = 3, ORE = 4;
  const TILE_HP = { [ROCK]: 60, [ICE]: 50, [ORE]: 90 };
  const MINE_YIELD = { [ROCK]: { metal: 3 }, [ICE]: { ice: 2 }, [ORE]: { crystal: 2, metal: 1 } };
  const DRILL_YIELD = { [ROCK]: 'metal', [ICE]: 'ice', [ORE]: 'crystal' };
  const RES = [
    { k: 'metal', label: 'METAL', color: '#8a93ab' },
    { k: 'ice', label: 'ICE', color: '#6fd3ee' },
    { k: 'crystal', label: 'CRYSTAL', color: '#ffe600' },
    { k: 'food', label: 'FOOD', color: '#b5e853' }
  ];

  // Buildings. "inside" ones need a floor under them; "use" is power per second while running.
  const B = {
    floor:   { name: 'Floor',    key: '1', cost: { metal: 1 }, info: 'Seal rooms with walls to hold air' },
    wall:    { name: 'Wall',     key: '2', cost: { metal: 2 }, hp: 140, seal: true },
    door:    { name: 'Door',     key: '3', cost: { metal: 3 }, hp: 160, seal: true, walk: true },
    solar:   { name: 'Solar',    key: '4', cost: { metal: 6, crystal: 1 }, hp: 50, gen: 1.6 },
    battery: { name: 'Battery',  key: '5', cost: { metal: 6, crystal: 2 }, hp: 60, inside: true, store: 100 },
    o2gen:   { name: 'O2 Gen',   key: '6', cost: { metal: 10, crystal: 2 }, hp: 80, inside: true, use: 1.2, prio: 0 },
    farm:    { name: 'Farm',     key: '7', cost: { metal: 6, ice: 2 }, hp: 50, inside: true, use: 0.4, prio: 2 },
    drill:   { name: 'Drill',    key: '8', cost: { metal: 10, crystal: 3 }, hp: 90, use: 0.8, prio: 3 },
    turret:  { name: 'Turret',   key: '9', cost: { metal: 12, crystal: 4 }, hp: 120, use: 0.2, prio: 1 },
    med:     { name: 'Med Bay',  key: '0', cost: { metal: 8, crystal: 4 }, hp: 60, inside: true, use: 0.1, prio: 1 }
  };
  const ORDER = ['floor', 'wall', 'door', 'solar', 'battery', 'o2gen', 'farm', 'drill', 'turret', 'med'];

  const OBJECTIVES = [
    { text: 'Mine rock: hold the left mouse button on the grey rock near your shelter.', done: (g) => g.stats.rock >= 4 },
    { text: 'Mine ice (pale blue). Your oxygen generator burns it to make air.', done: (g) => g.stats.ice >= 3 },
    { text: 'Build a Farm [7] inside your shelter. Walk up and press E when it is ripe.', done: (g) => g.stats.harvests >= 1 },
    { text: 'Build a Drill [8] next to rock. It mines for you while it has power.', done: (g) => countType('drill') >= 1 },
    { text: 'Build a Turret [9]. Raids begin on the second night.', done: (g) => countType('turret') >= 1 },
    { text: 'Expand the station and survive. Each night brings more drones.', done: () => false }
  ];

  // ---------- state ----------
  let g = null;                 // the whole game, saved as JSON
  let terrain, tileHp, floor, shade;
  let build = new Array(W * H).fill(null);
  let roomId = new Int32Array(W * H);
  let rooms = [];
  let buildList = [];           // tile indices that hold a building
  let enemies = [], bullets = [], particles = [];
  let running = false, paused = true;
  let selected = null;          // building key in build mode
  let mineTarget = -1, mineProgress = 0;
  let shootCool = 0, retreating = false;
  let toastTimer = 0, saveTimer = 0, uiTimer = 0;
  let zoom = 1.25;
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
  const center = (i) => ({ x: (i % W) * T + T / 2, y: Math.floor(i / W) * T + T / 2 });
  const minable = (t) => t === ROCK || t === ICE || t === ORE;
  function countType(type) { let n = 0; for (const i of buildList) if (build[i].type === type) n++; return n; }

  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function noise2(rand, size) {
    // value noise on a coarse grid, smoothly interpolated
    const g2 = []; const n = Math.ceil(W / size) + 2;
    for (let i = 0; i < n * n; i++) g2.push(rand());
    return (x, y) => {
      const gx = x / size, gy = y / size, x0 = Math.floor(gx), y0 = Math.floor(gy);
      const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const v = (a, b) => g2[(b % n) * n + (a % n)];
      const top = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
      const bot = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
      return top + (bot - top) * sy;
    };
  }

  // ---------- world generation ----------
  function generate(seed) {
    const rand = rng(seed);
    const edge = noise2(rand, 9), rockN = noise2(rand, 6), iceN = noise2(rand, 7), oreN = noise2(rand, 5);
    terrain = new Uint8Array(W * H); tileHp = new Uint8Array(W * H); floor = new Uint8Array(W * H);
    const cx = W / 2, cy = H / 2, R = 38;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const d = dist(x, y, cx, cy);
      const i = idx(x, y);
      if (d > R + (edge(x, y) - 0.5) * 16) { terrain[i] = SPACE; continue; }
      let t = GROUND;
      if (rockN(x, y) > 0.64) t = ROCK;
      if (iceN(x, y) > 0.76) t = ICE;
      if (t === ROCK && oreN(x, y) > 0.66) t = ORE;
      if (d < 9) t = GROUND;                       // a clear landing site
      terrain[i] = t;
      if (minable(t)) tileHp[i] = TILE_HP[t];
    }
    // make sure some ice and rock sit close to the start
    for (const [ox, oy, t] of [[7, -2, ICE], [8, -2, ICE], [7, -1, ICE], [-7, 1, ROCK], [-8, 1, ROCK], [-7, 2, ROCK], [-8, 2, ROCK], [-6, -6, ORE]]) {
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

  function newGame() {
    const seed = Math.floor(Math.random() * 1e9);
    g = {
      seed, day: 1, t: 20, raidDone: 0,
      res: { metal: 30, ice: 8, crystal: 4, food: 4 },
      power: 60,
      player: { x: (W / 2) * T, y: (H / 2) * T, hp: 100, oxy: 100, hunger: 100, stamina: 100 },
      stats: { rock: 0, ice: 0, harvests: 0, kills: 0 },
      obj: 0, log: []
    };
    generate(seed);
    build = new Array(W * H).fill(null);
    enemies = []; bullets = []; particles = [];
    // the shelter kit: a sealed 5x5 room with air, a battery and two solar panels outside
    const cx = W / 2, cy = H / 2;
    for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
      const i = idx(cx + x, cy + y);
      floor[i] = 1;
      if (Math.abs(x) === 3 || Math.abs(y) === 3) place(i, x === 0 && y === 3 ? 'door' : 'wall', true);
    }
    place(idx(cx - 2, cy - 2), 'o2gen', true);
    place(idx(cx + 2, cy - 2), 'battery', true);
    place(idx(cx - 1, cy + 5), 'solar', true);
    place(idx(cx + 1, cy + 5), 'solar', true);
    g.player.x = cx * T + T / 2; g.player.y = (cy + 1) * T + T / 2;
    refreshBuildList();
    makeShade();
    rebuildRooms();
    for (const r of rooms) if (r.sealed) r.o2 = 1;
    log('Shelter deployed. Air is on.', 'good');
  }

  // ---------- buildings ----------
  function place(i, type, free = false) {
    if (type === 'floor') { floor[i] = 1; return; }
    build[i] = { type, hp: B[type].hp, on: false, t: 0, grow: 0, aim: 0, cool: 0, ice: 0 };
    if (!free) refreshBuildList();
  }
  function refreshBuildList() {
    buildList = [];
    for (let i = 0; i < W * H; i++) if (build[i]) buildList.push(i);
  }
  function canAfford(cost) { return Object.entries(cost).every(([k, v]) => g.res[k] >= v); }
  function pay(cost, sign = -1, factor = 1) { for (const [k, v] of Object.entries(cost)) g.res[k] += sign * Math.floor(v * factor); }

  function placeError(i, type) {
    const x = i % W, y = Math.floor(i / W);
    if (!inMap(x, y)) return 'Out of range';
    const def = B[type];
    if (terrain[i] !== GROUND) return terrain[i] === SPACE ? 'Needs solid ground' : 'Mine this out first';
    if (type === 'floor') return floor[i] ? 'Already a floor' : null;
    if (build[i]) return 'Something is already here';
    if (def.inside && !floor[i]) return 'Build a floor here first';
    const c = center(i);
    if (dist(c.x, c.y, g.player.x, g.player.y) < T * 0.9 && type !== 'door') return 'You are standing there';
    if (enemies.some((e) => dist(c.x, c.y, e.x, e.y) < T)) return 'Something is in the way';
    if (type === 'drill' && !drillTarget(i)) return 'Drills go next to rock, ice or ore';
    return null;
  }

  function tryPlace(i) {
    const type = selected;
    const err = placeError(i, type);
    if (err) return toast(err, true);
    if (!canAfford(B[type].cost)) return toast('Not enough materials', true);
    const c = center(i);
    if (dist(c.x, c.y, g.player.x, g.player.y) > T * 7) return toast('Too far away', true);
    pay(B[type].cost);
    place(i, type);
    rebuildRooms();
    puff(c.x, c.y, '#ffe600', 6);
  }

  function tryRemove(i) {
    const c = center(i);
    if (dist(c.x, c.y, g.player.x, g.player.y) > T * 7) return toast('Too far away', true);
    if (build[i]) {
      const type = build[i].type;
      pay(B[type].cost, +1, 0.5);
      build[i] = null; refreshBuildList(); rebuildRooms();
      puff(c.x, c.y, '#8a93ab', 6);
      return;
    }
    if (floor[i]) { floor[i] = 0; g.res.metal += 1; rebuildRooms(); }
  }

  function damageBuilding(i, dmg) {
    const b = build[i]; if (!b) return;
    b.hp -= dmg;
    const c = center(i);
    puff(c.x, c.y, '#ff6b6b', 2);
    if (b.hp <= 0) {
      build[i] = null; refreshBuildList();
      puff(c.x, c.y, '#ff6b6b', 14);
      log(`${B[b.type].name} destroyed`, 'warn');
      rebuildRooms();
    }
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
  // A room is a group of floor tiles walled in by walls and doors. If air can reach a tile that
  // is not floor and not a wall, the room is open to space and holds no air.
  function rebuildRooms() {
    const oldRooms = rooms, oldId = roomId;
    roomId = new Int32Array(W * H).fill(-1);
    rooms = [];
    const seals = (i) => build[i] && B[build[i].type].seal;
    for (let s = 0; s < W * H; s++) {
      if (!floor[s] || seals(s) || roomId[s] !== -1) continue;
      const id = rooms.length;
      const room = { id, cells: [], sealed: true, o2: 0 };
      const queue = [s]; roomId[s] = id;
      while (queue.length) {
        const i = queue.pop(); room.cells.push(i);
        const x = i % W, y = Math.floor(i / W);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!inMap(nx, ny)) { room.sealed = false; continue; }
          const n = idx(nx, ny);
          if (seals(n)) continue;
          if (!floor[n]) { room.sealed = false; continue; }
          if (roomId[n] === -1) { roomId[n] = id; queue.push(n); }
        }
      }
      // carry the air over from whatever room these tiles belonged to before
      let sum = 0;
      for (const c of room.cells) { const o = oldId[c]; sum += o >= 0 && oldRooms[o] ? oldRooms[o].o2 : 0; }
      const before = sum / room.cells.length;
      room.o2 = room.sealed ? before : 0;
      if (!room.sealed && before > 0.3 && g && running) log('Hull breach! A room lost its air.', 'warn');
      rooms.push(room);
    }
  }
  const roomAt = (px, py) => { const i = idx(clamp(tileOf(px), 0, W - 1), clamp(tileOf(py), 0, H - 1)); return roomId[i] >= 0 ? rooms[roomId[i]] : null; };
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
    const p = g.player;
    // time of day and raids
    const before = g.t;
    g.t += dt;
    if (before < 140 && g.t >= 140 && g.day >= 2) toast('Dusk. Scanners pick up drones.', true);
    if (before < 155 && g.t >= 155 && g.day >= 2 && g.raidDone < g.day) startRaid();
    if (g.t >= DAY_LEN) {
      g.t -= DAY_LEN; g.day++;
      log(`Day ${g.day}. The sun is up.`, 'good');
    }

    // power: generation, then consumers by priority (air first)
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
      const need = use * dt;
      if (avail >= need) { avail -= need; used += use; b.on = true; } else b.on = false;
    }
    g.power = clamp(avail, 0, cap);
    g.cap = cap; g.net = gen - used;
    for (const i of buildList) { const b = build[i]; if (!B[b.type].use) b.on = true; }

    // machines
    let makingAir = new Map();
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
            if (g.res.ice > 0) { g.res.ice--; b.ice = 0; bump('ice'); }
            else { b.ice = 30; if (!b.warned) { log('Out of ice: oxygen has stopped.', 'warn'); b.warned = true; } break; }
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
          if (b.t >= 6) {
            b.t = 0;
            const j = drillTarget(i);
            if (j == null) break;
            const res = DRILL_YIELD[terrain[j]];
            g.res[res] += 1; bump(res);
            const tc = center(j); puff(tc.x, tc.y, RES.find((r) => r.k === res).color, 3);
            tileHp[j] = Math.max(0, tileHp[j] - 20);
            if (tileHp[j] === 0) terrain[j] = GROUND;
          }
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
          b.healing = b.on && dist(c.x, c.y, p.x, p.y) < T * 1.6 && p.hp < 100;
          if (b.healing) p.hp = Math.min(100, p.hp + 9 * dt);
          break;
        }
      }
    }
    for (const r of rooms) {
      if (!r.sealed) { r.o2 = 0; continue; }
      const n = makingAir.get(r.id) || 0;
      r.o2 = n ? Math.min(1, r.o2 + dt * n * 4 / r.cells.length) : Math.max(0, r.o2 - dt * 0.004);
    }

    // player
    let mx = 0, my = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) my--;
    if (keys.has('KeyS') || keys.has('ArrowDown')) my++;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) mx--;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx++;
    const moving = mx || my;
    const sprint = moving && (keys.has('ShiftLeft') || keys.has('ShiftRight')) && p.stamina > 1;
    if (sprint) p.stamina = Math.max(0, p.stamina - 25 * dt); else p.stamina = Math.min(100, p.stamina + 14 * dt);
    if (moving) {
      const len = Math.hypot(mx, my), speed = 150 * (sprint ? 1.6 : 1);
      moveBody(p, (mx / len) * speed * dt, (my / len) * speed * dt, 10, playerSolid);
    }
    const inAir = pressurized(p.x, p.y);
    if (inAir) p.oxy = Math.min(100, p.oxy + 30 * dt); else p.oxy = Math.max(0, p.oxy - 3.2 * dt);
    p.hunger = Math.max(0, p.hunger - dt * 100 / 360);
    if (p.oxy <= 0) p.hp -= 8 * dt;
    if (p.hunger <= 0) p.hp -= 2 * dt;
    if (p.hp > 0 && p.oxy > 50 && p.hunger > 60 && p.hp < 100) p.hp = Math.min(100, p.hp + 0.5 * dt);

    // mining and shooting
    shootCool -= dt;
    const w = screenToWorld(mouse.x, mouse.y);
    const tx = tileOf(w.x), ty = tileOf(w.y);
    const ti = inMap(tx, ty) ? idx(tx, ty) : -1;
    if (mouse.left && !selected) {
      const c = ti >= 0 ? center(ti) : null;
      if (ti >= 0 && minable(terrain[ti]) && dist(c.x, c.y, p.x, p.y) <= T * 2.6) {
        if (mineTarget !== ti) { mineTarget = ti; mineProgress = 0; }
        mineProgress += dt * 45;
        if (Math.random() < dt * 14) puff(c.x + (Math.random() - 0.5) * 20, c.y + (Math.random() - 0.5) * 20, terrain[ti] === ICE ? '#6fd3ee' : terrain[ti] === ORE ? '#ffe600' : '#8a93ab', 1);
        if (mineProgress >= tileHp[ti]) {
          const t = terrain[ti];
          for (const [k, v] of Object.entries(MINE_YIELD[t])) { g.res[k] += v; bump(k); }
          if (t === ROCK || t === ORE) g.stats.rock++; else g.stats.ice++;
          terrain[ti] = GROUND; tileHp[ti] = 0; mineTarget = -1;
          puff(c.x, c.y, '#d4bc00', 10);
        }
      } else {
        mineTarget = -1;
        if (shootCool <= 0) { shootCool = 0.22; shoot(p.x, p.y, Math.atan2(w.y - p.y, w.x - p.x), 'ally', 12, 720); }
      }
    } else mineTarget = -1;

    // enemies
    const dawn = enemies.length && !isNight() && g.t < 140;
    if (dawn && !retreating) { retreating = true; log('Dawn. The drones are pulling back.', 'good'); }
    for (const e of enemies) {
      e.cool -= dt;
      if (dawn) {
        const a = Math.atan2(e.y - (H / 2) * T, e.x - (W / 2) * T);
        e.ang = a; e.x += Math.cos(a) * e.speed * 1.5 * dt; e.y += Math.sin(a) * e.speed * 1.5 * dt;
        if (dist(e.x, e.y, (W / 2) * T, (H / 2) * T) > 56 * T) e.gone = true;
        continue;
      }
      const dp = dist(e.x, e.y, p.x, p.y);
      let tx2 = p.x, ty2 = p.y;
      if (dp > T * 9 && buildList.length) {
        let bd = Infinity;
        for (const i of buildList) { const c = center(i); const d = dist(e.x, e.y, c.x, c.y); if (d < bd) { bd = d; tx2 = c.x; ty2 = c.y; } }
      }
      const d = dist(e.x, e.y, tx2, ty2);
      const ang = Math.atan2(ty2 - e.y, tx2 - e.x);
      e.ang = ang;
      const shot = clearShot(e.x, e.y, tx2, ty2, true);
      if (d > e.range * 0.7 || !shot) {
        const hit = moveBody(e, Math.cos(ang) * e.speed * dt, Math.sin(ang) * e.speed * dt, e.r, enemySolid);
        if (hit >= 0 && e.cool <= 0) { e.cool = e.rate; const c = center(hit); shoot(e.x, e.y, Math.atan2(c.y - e.y, c.x - e.x), 'enemy', e.dmg, 380); }
      }
      if (shot && d <= e.range && e.cool <= 0) { e.cool = e.rate; shoot(e.x, e.y, ang, 'enemy', e.dmg, 380); }
    }

    // bullets
    for (const b of bullets) {
      const steps = 3;
      for (let s = 0; s < steps && b.life > 0; s++) {
        b.x += b.vx * dt / steps; b.y += b.vy * dt / steps;
        const tx3 = tileOf(b.x), ty3 = tileOf(b.y);
        if (!inMap(tx3, ty3)) continue;
        const i = idx(tx3, ty3);
        if (b.from === 'enemy') {
          if (build[i]) { damageBuilding(i, b.dmg * 0.7); b.life = 0; break; }
          if (dist(b.x, b.y, p.x, p.y) < 12) { p.hp -= b.dmg; puff(b.x, b.y, '#ff6b6b', 4); b.life = 0; flash = 0.25; break; }
        } else {
          if (minable(terrain[i])) { puff(b.x, b.y, '#8a93ab', 2); b.life = 0; break; }
          for (const e of enemies) {
            if (dist(b.x, b.y, e.x, e.y) < e.r + 3) {
              e.hp -= b.dmg; b.life = 0; puff(b.x, b.y, '#ffe600', 3);
              break;
            }
          }
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
      g.res.metal += e.kind === 'brute' ? 3 : 2; bump('metal');
      if (e.kind === 'brute') { g.res.crystal += 1; bump('crystal'); }
    }
    if (enemies.length && !alive.length && !retreating) log('Raid repelled.', 'good');
    enemies = alive;

    // particles
    for (const q of particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt; }
    particles = particles.filter((q) => q.life > 0);
    if (flash > 0) flash -= dt;

    // objectives
    while (g.obj < OBJECTIVES.length - 1 && OBJECTIVES[g.obj].done(g)) { g.obj++; log('Objective complete.', 'good'); }

    if (p.hp <= 0) gameOver();
  }

  function startRaid() {
    g.raidDone = g.day; retreating = false;
    const drones = Math.min(24, 2 + Math.floor(g.day * 1.3));
    const brutes = Math.min(8, Math.max(0, g.day - 3));
    const a0 = Math.random() * Math.PI * 2;
    for (let n = 0; n < drones + brutes; n++) {
      const brute = n >= drones;
      const a = a0 + (Math.random() - 0.5) * 1.6;
      const r = 50 * T + Math.random() * 3 * T;
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

  // ---------- movement and line of sight ----------
  function playerSolid(i) {
    if (minable(terrain[i])) return true;
    const b = build[i];
    return !!b && !B[b.type].walk;
  }
  const enemySolid = (i) => !!build[i];        // drones fly over terrain, but not through buildings

  // Moves a round body, sliding along walls. Returns the tile it bumped into, or -1.
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
    const t0 = idx(tileOf(x0), tileOf(y0)), t1 = idx(tileOf(x1), tileOf(y1));
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
  let flash = 0;

  // ---------- actions ----------
  function harvest() {
    const p = g.player;
    for (const i of buildList) {
      const b = build[i]; if (b.type !== 'farm') continue;
      const c = center(i);
      if (dist(c.x, c.y, p.x, p.y) > T * 1.7) continue;
      if (b.grow >= 1) { b.grow = 0; g.res.food += 2; bump('food'); g.stats.harvests++; puff(c.x, c.y, '#b5e853', 10); return; }
      return toast(b.air ? 'Still growing' : 'Farms need air and power', true);
    }
    toast('Stand next to a farm to harvest', true);
  }
  function eat() {
    const p = g.player;
    if (g.res.food <= 0) return toast('No food. Build a farm.', true);
    if (p.hunger > 92) return toast('Not hungry', true);
    g.res.food--; p.hunger = Math.min(100, p.hunger + 32);
  }

  // ---------- drawing ----------
  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr;
    canvas.style.width = innerWidth + 'px'; canvas.style.height = innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    dark.width = innerWidth; dark.height = innerHeight;
  }
  function screenToWorld(sx, sy) { return { x: cam.x + (sx - innerWidth / 2) / zoom, y: cam.y + (sy - innerHeight / 2) / zoom }; }

  const COLORS = {
    space: '#050810', ground: ['#161c2c', '#1a2133', '#1d2438'], rock: '#3a4258', rockHi: '#4b5570',
    ice: '#2b7b93', iceHi: '#6fd3ee', ore: '#3a4258', floor: '#262d44', floorLine: '#323a56', wall: '#8a93ab', wallDark: '#4d556c'
  };

  function draw() {
    const vw = innerWidth, vh = innerHeight;
    cam.x += (g.player.x - cam.x) * 0.18; cam.y += (g.player.y - cam.y) * 0.18;
    ctx.fillStyle = COLORS.space; ctx.fillRect(0, 0, vw, vh);
    for (const s of stars) {
      const x = ((s.x - cam.x * s.p) % vw + vw) % vw, y = ((s.y - cam.y * s.p) % vh + vh) % vh;
      ctx.fillStyle = `rgba(244,236,184,${0.25 + s.p})`; ctx.fillRect(x, y, s.s, s.s);
    }

    ctx.save();
    ctx.translate(vw / 2, vh / 2); ctx.scale(zoom, zoom); ctx.translate(-cam.x, -cam.y);
    const x0 = clamp(tileOf(cam.x - vw / 2 / zoom) - 1, 0, W - 1), x1 = clamp(tileOf(cam.x + vw / 2 / zoom) + 1, 0, W - 1);
    const y0 = clamp(tileOf(cam.y - vh / 2 / zoom) - 1, 0, H - 1), y1 = clamp(tileOf(cam.y + vh / 2 / zoom) + 1, 0, H - 1);

    // terrain and floors
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), t = terrain[i], px = x * T, py = y * T;
      if (t === SPACE) continue;
      ctx.fillStyle = COLORS.ground[Math.floor(shade[i] * 3)]; ctx.fillRect(px, py, T, T);
      if (floor[i]) {
        ctx.fillStyle = COLORS.floor; ctx.fillRect(px, py, T, T);
        ctx.strokeStyle = COLORS.floorLine; ctx.lineWidth = 1; ctx.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
        const r = roomId[i] >= 0 ? rooms[roomId[i]] : null;
        if (r && r.o2 > 0) { ctx.fillStyle = `rgba(111,211,238,${r.o2 * 0.09})`; ctx.fillRect(px, py, T, T); }
      }
      if (minable(t)) drawRock(i, t, px, py);
    }
    // mining cracks
    if (mineTarget >= 0) {
      const c = center(mineTarget), f = mineProgress / Math.max(1, tileHp[mineTarget]);
      ctx.strokeStyle = 'rgba(5,8,16,0.9)'; ctx.lineWidth = 2;
      ctx.beginPath();
      for (let k = 0; k < Math.ceil(f * 6); k++) { const a = k * 1.1 + 0.4; ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * 14, c.y + Math.sin(a) * 14); }
      ctx.stroke();
      ctx.strokeStyle = '#ffe600'; ctx.strokeRect(c.x - T / 2 + 1, c.y - T / 2 + 1, T - 2, T - 2);
    }

    // buildings
    const now = performance.now() / 1000;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y), b = build[i];
      if (b) drawBuilding(b, x * T, y * T, now, i);
    }

    // build ghost
    const w = screenToWorld(mouse.x, mouse.y);
    const gx = tileOf(w.x), gy = tileOf(w.y);
    if (selected && inMap(gx, gy)) {
      const i = idx(gx, gy), ok = !placeError(i, selected) && canAfford(B[selected].cost);
      ctx.fillStyle = ok ? 'rgba(255,230,0,0.18)' : 'rgba(255,107,107,0.18)';
      ctx.fillRect(gx * T, gy * T, T, T);
      ctx.strokeStyle = ok ? '#ffe600' : '#ff6b6b'; ctx.lineWidth = 2; ctx.strokeRect(gx * T + 1, gy * T + 1, T - 2, T - 2);
    }

    // player
    const p = g.player, aim = Math.atan2(w.y - p.y, w.x - p.x);
    ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#050810'; ctx.beginPath(); ctx.arc(p.x + Math.cos(aim) * 4, p.y + Math.sin(aim) * 4, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#6fd3ee'; ctx.beginPath(); ctx.arc(p.x + Math.cos(aim) * 5, p.y + Math.sin(aim) * 5, 3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(p.x + Math.cos(aim) * 9, p.y + Math.sin(aim) * 9); ctx.lineTo(p.x + Math.cos(aim) * 16, p.y + Math.sin(aim) * 16); ctx.stroke();

    // enemies
    for (const e of enemies) {
      ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.ang + now * (e.kind === 'brute' ? 0.6 : 2));
      ctx.fillStyle = e.kind === 'brute' ? '#a33a3a' : '#ff6b6b';
      ctx.beginPath(); ctx.moveTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0); ctx.lineTo(0, -e.r); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#050810'; ctx.beginPath(); ctx.arc(e.x, e.y, e.r * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.arc(e.x + Math.cos(e.ang) * e.r * 0.15, e.y + Math.sin(e.ang) * e.r * 0.15, e.r * 0.18, 0, Math.PI * 2); ctx.fill();
      if (e.hp < e.max) { ctx.fillStyle = '#121a2c'; ctx.fillRect(e.x - 12, e.y - e.r - 8, 24, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(e.x - 12, e.y - e.r - 8, 24 * e.hp / e.max, 3); }
    }

    // bullets and particles
    ctx.lineWidth = 2.5;
    for (const b of bullets) {
      ctx.strokeStyle = b.from === 'enemy' ? '#ff6b6b' : '#fff27a';
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.02, b.y - b.vy * 0.02); ctx.stroke();
    }
    for (const q of particles) { ctx.globalAlpha = clamp(q.life * 2, 0, 1); ctx.fillStyle = q.color; ctx.fillRect(q.x - 1.5, q.y - 1.5, 3, 3); }
    ctx.globalAlpha = 1;
    ctx.restore();

    // night: darkness with light around the player and powered machines
    const night = 1 - daylight();
    if (night > 0.02) {
      dctx.globalCompositeOperation = 'source-over';
      dctx.clearRect(0, 0, vw, vh);
      dctx.fillStyle = `rgba(2,3,8,${0.78 * night})`; dctx.fillRect(0, 0, vw, vh);
      dctx.globalCompositeOperation = 'destination-out';
      const light = (wx, wy, r) => {
        const sx = (wx - cam.x) * zoom + vw / 2, sy = (wy - cam.y) * zoom + vh / 2, rr = r * zoom;
        if (sx < -rr || sy < -rr || sx > vw + rr || sy > vh + rr) return;
        const grad = dctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
        grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
        dctx.fillStyle = grad; dctx.fillRect(sx - rr, sy - rr, rr * 2, rr * 2);
      };
      light(p.x, p.y, T * 5.5);
      for (const i of buildList) { const b = build[i]; if (b.on && B[b.type].use) { const c = center(i); light(c.x, c.y, T * 2.6); } }
      for (const r of rooms) if (r.o2 > 0.5 && r.cells.length < 400) { for (let k = 0; k < r.cells.length; k += 6) { const c = center(r.cells[k]); light(c.x, c.y, T * 2.2); } }
      ctx.drawImage(dark, 0, 0, vw, vh);
      // hostiles' eyes glow through the dark
      ctx.fillStyle = `rgba(255,107,107,${0.9 * night})`;
      for (const e of enemies) {
        const sx = (e.x - cam.x) * zoom + vw / 2, sy = (e.y - cam.y) * zoom + vh / 2;
        ctx.beginPath(); ctx.arc(sx, sy, (e.kind === 'brute' ? 4 : 3) * zoom, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (flash > 0) { ctx.fillStyle = `rgba(255,107,107,${flash})`; ctx.fillRect(0, 0, vw, vh); }
  }

  function drawRock(i, t, px, py) {
    const inset = 2;
    ctx.fillStyle = t === ICE ? COLORS.ice : COLORS.rock;
    ctx.fillRect(px + inset, py + inset, T - inset * 2, T - inset * 2);
    ctx.fillStyle = t === ICE ? COLORS.iceHi : COLORS.rockHi;
    ctx.fillRect(px + inset, py + inset, T - inset * 2, 4);
    if (t === ICE) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(px + 8 + shade[i] * 10, py + 10, 3, 9); }
    if (t === ORE) {
      ctx.fillStyle = '#ffe600';
      const s = shade[i];
      for (const [ox, oy] of [[8 + s * 6, 12], [18 - s * 4, 20], [22, 9 + s * 6]]) {
        ctx.beginPath(); ctx.moveTo(px + ox, py + oy - 4); ctx.lineTo(px + ox + 3, py + oy); ctx.lineTo(px + ox, py + oy + 4); ctx.lineTo(px + ox - 3, py + oy); ctx.closePath(); ctx.fill();
      }
    }
  }

  function drawBuilding(b, px, py, now, i) {
    const cx = px + T / 2, cy = py + T / 2;
    const dim = B[b.type].use && !b.on;
    ctx.globalAlpha = dim ? 0.55 : 1;
    switch (b.type) {
      case 'wall':
        ctx.fillStyle = COLORS.wallDark; ctx.fillRect(px, py, T, T);
        ctx.fillStyle = COLORS.wall; ctx.fillRect(px + 2, py + 2, T - 4, T - 6);
        break;
      case 'door': {
        ctx.fillStyle = COLORS.wallDark; ctx.fillRect(px, py, T, T);
        ctx.fillStyle = '#050810'; ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
        ctx.fillStyle = '#ffe600';
        for (let k = 0; k < 4; k++) ctx.fillRect(px + 5 + k * 6, py + 5, 3, T - 10);
        break;
      }
      case 'solar':
        ctx.fillStyle = '#1b2a55'; ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
        ctx.strokeStyle = '#4a64b0'; ctx.lineWidth = 1;
        for (let k = 1; k < 3; k++) { ctx.beginPath(); ctx.moveTo(px + 2 + k * (T - 4) / 3, py + 2); ctx.lineTo(px + 2 + k * (T - 4) / 3, py + T - 2); ctx.moveTo(px + 2, py + 2 + k * (T - 4) / 3); ctx.lineTo(px + T - 2, py + 2 + k * (T - 4) / 3); ctx.stroke(); }
        ctx.fillStyle = `rgba(255,230,0,${0.25 * daylight()})`; ctx.fillRect(px + 2, py + 2, T - 4, T - 4);
        break;
      case 'battery': {
        ctx.fillStyle = '#0d1322'; ctx.fillRect(px + 6, py + 4, T - 12, T - 8);
        ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 1.5; ctx.strokeRect(px + 6, py + 4, T - 12, T - 8);
        const f = g.cap ? g.power / g.cap : 0;
        ctx.fillStyle = '#ffe600'; ctx.fillRect(px + 9, py + T - 7 - (T - 14) * f, T - 18, (T - 14) * f);
        break;
      }
      case 'o2gen':
        ctx.fillStyle = '#0d1322'; ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = b.making ? '#6fd3ee' : '#4d556c'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 10, now * 2, now * 2 + Math.PI * 1.4); ctx.stroke();
        ctx.fillStyle = b.making ? '#6fd3ee' : '#8a93ab'; ctx.font = '600 9px IBM Plex Mono, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('O2', cx, cy + 1);
        break;
      case 'farm': {
        ctx.fillStyle = '#2a2316'; ctx.fillRect(px + 3, py + 3, T - 6, T - 6);
        const h = 4 + b.grow * 10;
        ctx.fillStyle = b.grow >= 1 ? '#ffe600' : '#b5e853';
        for (let k = 0; k < 3; k++) { const sx = px + 8 + k * 8; ctx.fillRect(sx, py + T - 6 - h, 3, h); ctx.fillRect(sx - 2, py + T - 6 - h, 7, 3); }
        if (b.grow >= 1 && Math.sin(now * 5) > 0) { ctx.strokeStyle = '#ffe600'; ctx.lineWidth = 1.5; ctx.strokeRect(px + 2, py + 2, T - 4, T - 4); }
        break;
      }
      case 'drill': {
        ctx.fillStyle = '#4d556c'; ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.on ? now * 8 : 0);
        ctx.fillStyle = '#ffe600'; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(8, 6); ctx.lineTo(-8, 6); ctx.closePath(); ctx.fill();
        ctx.restore();
        break;
      }
      case 'turret':
        ctx.fillStyle = '#4d556c'; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(b.aim);
        ctx.fillStyle = '#ffe600'; ctx.fillRect(0, -3, 16, 6); ctx.fillStyle = '#0d1322'; ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        break;
      case 'med':
        ctx.fillStyle = '#e8e3c8'; ctx.fillRect(px + 4, py + 4, T - 8, T - 8);
        ctx.fillStyle = '#ff6b6b'; ctx.fillRect(cx - 3, cy - 9, 6, 18); ctx.fillRect(cx - 9, cy - 3, 18, 6);
        break;
    }
    ctx.globalAlpha = 1;
    if (dim && Math.sin(now * 6 + i) > 0) { ctx.fillStyle = '#ff6b6b'; ctx.fillRect(px + T - 7, py + 3, 4, 4); }
    const max = B[b.type].hp;
    if (max && b.hp < max) { ctx.fillStyle = '#121a2c'; ctx.fillRect(px + 4, py + T - 5, T - 8, 3); ctx.fillStyle = '#ff6b6b'; ctx.fillRect(px + 4, py + T - 5, (T - 8) * b.hp / max, 3); }
  }

  // ---------- HUD ----------
  function buildHud() {
    $('res').innerHTML = RES.map((r) => `<div data-r="${r.k}"><span class="sw" style="background:${r.color}"></span>${r.label} <b>0</b></div>`).join('');
    $('hotbar').innerHTML = ORDER.map((k) => {
      const d = B[k];
      const SHORT = { metal: 'met', ice: 'ice', crystal: 'cry' };
      const cost = Object.entries(d.cost).map(([r, v]) => `${v} ${SHORT[r]}`).join(' ');
      return `<button class="slot" data-b="${k}" title="${d.name}: ${Object.entries(d.cost).map(([r, v]) => `${v} ${r}`).join(', ')}"><kbd>${d.key}</kbd><span class="nm">${d.name}</span><span class="ct">${cost}</span></button>`;
    }).join('');
    $('hotbar').addEventListener('click', (e) => { const s = e.target.closest('.slot'); if (s) select(s.dataset.b); });
  }
  const bumps = {};
  function bump(k) { bumps[k] = 0.5; }
  function updateHud(dt) {
    const p = g.player;
    $('day').textContent = g.day;
    const night = isNight();
    const left = night ? (g.t < 232 ? 232 - g.t : 0) : (g.t < 150 ? 150 - g.t : DAY_LEN - g.t + 150);
    $('phase').textContent = night ? 'NIGHT' : 'DAY';
    $('phase-left').textContent = `${night ? 'dawn' : 'dusk'} in ${Math.ceil(left)}s`;
    $('phase').parentElement.classList.toggle('night', night);
    for (const r of RES) {
      const el = document.querySelector(`[data-r="${r.k}"]`);
      el.querySelector('b').textContent = g.res[r.k];
      if (bumps[r.k] > 0) { bumps[r.k] -= dt; el.classList.add('bump'); } else el.classList.remove('bump');
    }
    for (const [k, v] of [['hp', p.hp], ['oxy', p.oxy], ['hunger', p.hunger], ['stamina', p.stamina]]) {
      const bar = document.querySelector(`.bar[data-k="${k}"]`);
      bar.querySelector('b').style.width = clamp(v, 0, 100) + '%';
      bar.classList.toggle('low', k !== 'stamina' && v < 25);
    }
    const inAir = pressurized(p.x, p.y);
    $('air').textContent = inAir ? 'PRESSURIZED' : `VACUUM: ${Math.ceil(p.oxy / 3.2)}s of air left`;
    $('air').classList.toggle('vacuum', !inAir);
    const pb = document.querySelector('.bar[data-k="power"]');
    pb.querySelector('b').style.width = (g.cap ? 100 * g.power / g.cap : 0) + '%';
    $('power-label').textContent = `${Math.floor(g.power)} / ${g.cap || 40}`;
    $('net').textContent = `${g.net >= 0 ? '+' : ''}${(g.net || 0).toFixed(1)}/s ${daylight() < 0.1 ? '· night: no solar' : ''}`;
    $('net').classList.toggle('neg', (g.net || 0) < 0);
    $('objective').textContent = OBJECTIVES[g.obj].text;
    for (const s of document.querySelectorAll('.slot')) {
      s.classList.toggle('on', s.dataset.b === selected);
      s.classList.toggle('poor', !canAfford(B[s.dataset.b].cost));
    }
  }
  function log(msg, kind = '') {
    if (!g) return;
    g.log.unshift({ msg, kind }); g.log.length = Math.min(g.log.length, 12);
    $('log').innerHTML = g.log.map((l) => `<li class="${l.kind}">${l.msg}</li>`).join('');
  }
  function toast(msg, warn = false) {
    const el = $('toast'); el.textContent = msg; el.hidden = false; el.classList.toggle('warn', warn); toastTimer = 2.2;
  }
  function select(k) {
    selected = selected === k ? null : k;
    canvas.style.cursor = selected ? 'cell' : 'crosshair';
  }

  // ---------- save / load ----------
  function save() {
    if (!g || !running) return;
    const data = {
      ...g,
      terrain: Array.from(terrain).join(''),
      tileHp: Array.from(tileHp),
      floor: Array.from(floor).join(''),
      builds: buildList.map((i) => ({ i, ...build[i] })),
      air: rooms.filter((r) => r.o2 > 0).map((r) => [r.cells[0], +r.o2.toFixed(3)]),
      enemies
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch { /* storage full or blocked */ }
  }
  function load() {
    let data;
    try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return false; }
    if (!data || !data.terrain) return false;
    terrain = Uint8Array.from(data.terrain, Number);
    tileHp = Uint8Array.from(data.tileHp);
    floor = Uint8Array.from(data.floor, Number);
    build = new Array(W * H).fill(null);
    for (const b of data.builds) { const { i, ...rest } = b; build[i] = rest; }
    enemies = data.enemies || []; bullets = []; particles = [];
    const air = data.air || [];
    delete data.terrain; delete data.tileHp; delete data.floor; delete data.builds; delete data.air; delete data.enemies;
    g = data;
    refreshBuildList();
    makeShade();
    rooms = []; roomId = new Int32Array(W * H).fill(-1);
    rebuildRooms();
    for (const [cell, o2] of air) { const r = rooms[roomId[cell]]; if (r && r.sealed) r.o2 = o2; }
    $('log').innerHTML = g.log.map((l) => `<li class="${l.kind}">${l.msg}</li>`).join('');
    return true;
  }

  // ---------- game flow ----------
  function start(fresh) {
    if (fresh || !load()) newGame();
    cam.x = g.player.x; cam.y = g.player.y;
    $('overlay').hidden = true;
    running = true; paused = false;
    $('log').innerHTML = g.log.map((l) => `<li class="${l.kind}">${l.msg}</li>`).join('');
  }
  function pause(on) {
    if (!running) return;
    paused = on;
    if (on) {
      save();
      $('ov-title').textContent = 'PAUSED';
      $('ov-text').textContent = `Day ${g.day}. Your station is saved.`;
      $('ov-continue').hidden = false;
      $('ov-new').textContent = 'NEW STATION';
      $('overlay').hidden = false;
    } else $('overlay').hidden = true;
  }
  function gameOver() {
    running = false; paused = true;
    const best = Math.max(g.day, Number(localStorage.getItem(BEST_KEY) || 0));
    try { localStorage.setItem(BEST_KEY, String(best)); localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
    $('ov-title').textContent = 'STATION LOST';
    $('ov-text').textContent = `You held out for ${g.day} ${g.day === 1 ? 'day' : 'days'} and destroyed ${g.stats.kills} drones.`;
    $('ov-best').textContent = `Best: ${best} ${best === 1 ? 'day' : 'days'}`;
    $('ov-continue').hidden = true;
    $('ov-new').textContent = 'TRY AGAIN';
    $('overlay').hidden = false;
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (g) {
      if (running && !paused) {
        step(dt);
        saveTimer += dt; if (saveTimer > 20) { saveTimer = 0; save(); }
      }
      draw();
      uiTimer += dt;
      if (uiTimer > 0.1) { updateHud(uiTimer); uiTimer = 0; }
    }
    if (toastTimer > 0) { toastTimer -= dt; if (toastTimer <= 0) $('toast').hidden = true; }
    requestAnimationFrame(frame);
  }

  // ---------- input ----------
  addEventListener('keydown', (e) => {
    if (e.code === 'Escape') { if (selected) select(null); else if (running) pause(!paused); return; }
    if (!running || paused) return;
    keys.add(e.code);
    const k = ORDER.find((b) => `Digit${B[b].key}` === e.code);
    if (k) select(k);
    if (e.code === 'KeyE') harvest();
    if (e.code === 'KeyF') eat();
    if (e.code === 'KeyQ') select(null);
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => { keys.clear(); mouse.left = mouse.right = false; if (running && !paused) pause(true); });
  canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', (e) => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (!running || paused) return;
    const w = screenToWorld(e.clientX, e.clientY), tx = tileOf(w.x), ty = tileOf(w.y);
    if (e.button === 0) {
      mouse.left = true;
      if (selected && inMap(tx, ty)) tryPlace(idx(tx, ty));
    }
    if (e.button === 2) { mouse.right = true; if (selected && inMap(tx, ty)) tryRemove(idx(tx, ty)); }
  });
  addEventListener('mouseup', (e) => { if (e.button === 0) mouse.left = false; if (e.button === 2) mouse.right = false; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom = clamp(zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.6, 2.2); }, { passive: false });
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('beforeunload', save);

  $('ov-new').addEventListener('click', () => {
    if (running && !confirm('Start a new station? Your current one will be lost.')) return;
    start(true);
  });
  $('ov-continue').addEventListener('click', () => { if (running) pause(false); else start(false); });

  // ---------- boot ----------
  resize();
  buildHud();
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  if (best) $('ov-best').textContent = `Best: ${best} ${best === 1 ? 'day' : 'days'}`;
  if (localStorage.getItem(SAVE_KEY)) $('ov-continue').hidden = false;
  requestAnimationFrame(frame);

  // for testing from the console
  window.__stationfall = { get g() { return g; }, step, rooms: () => rooms, build: () => build, terrain: () => terrain, place, rebuildRooms, startRaid, enemies: () => enemies, newGame, save, load, idx };
})();
