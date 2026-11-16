/* Iso-Chess: isometric 3D board.
   A pure view: it draws whatever state chess.js hands it and reports clicks
   back as board cells. Built the same way as RFT's 3D view (same three.js
   copy, raycast picking), but with a fixed isometric orthographic camera.

   It draws any arena (see arena.js): any size from 4 to 24, odd shapes,
   raised floors, walls, pits and empty void.

   Board cell (x, y): x = column from the left, y = row from your side
   (your back rank is y = 0). World: (x - (w-1)/2, height, (h-1)/2 - y).

   Style rule: no circles. Every round shape is built with 8 sides,
   so pieces come out as faceted octagons like the card art. */
(function () {
  'use strict';

  const BOTTOM = -0.6;     // underside of every tile column
  const RAISE = 0.35;      // height of one raised level
  const WALL_TOP = 0.8;
  const PIT_TOP = -0.5;
  const SIDES = 8;         // octagons everywhere

  // Render Productions palette: yellow phosphor on deep navy (see /style.css)
  const COLORS = {
    bg: 0x050810,
    light: 0x233150,
    dark: 0x111a2e,
    pit: 0x020306,
    wall: 0x0d1322,
    wallEdge: 0xa08c00,
    tileEdge: 0x2c3242,
    player: 0xf4e27a,
    playerEdge: 0x050810,
    enemy: 0x10172a,
    enemyEdge: 0x8a93ab,
    move: 0xffe600,
    capture: 0xff6b6b,
    select: 0xffe600,
    target: 0xb5e853,
    hover: 0xfff27a,
    intent: 0xff6b6b,
    shield: 0xa78bfa,
    fortify: 0xf5a623,
    haste: 0xb5e853,
    frozen: 0x6fb8ff
  };

  let skin = { color: COLORS.player, edge: COLORS.playerEdge };

  /* ---------- looks: a theme per act, fire in the pits, the world around the board ---------- */
  const THEMES = {
    free: { bg: 0x050810, light: 0x233150, dark: 0x111a2e, wall: 0x0d1322, wallEdge: 0xa08c00, edge: 0x2c3242, key: 0xfff4cc, rim: 0xffe600, amb: 0x8a93ab, mote: 0xffe600, rock: 0x141b2e },
    // Act 1: the Rabble Fields at dusk (warm, earthy)
    act1: { bg: 0x0d0a08, light: 0x3a3a22, dark: 0x22200f, wall: 0x2a2014, wallEdge: 0xc49a3a, edge: 0x4a4228, key: 0xffd9a0, rim: 0xff9a3d, amb: 0x9a8a70, mote: 0xffc070, rock: 0x2a2316 },
    // Act 2: the Archers' Causeway in cold fog
    act2: { bg: 0x060b12, light: 0x24384a, dark: 0x132231, wall: 0x101c28, wallEdge: 0x6fb8ff, edge: 0x2b4256, key: 0xd8ecff, rim: 0x6fb8ff, amb: 0x7f97b0, mote: 0xbfe0ff, rock: 0x14202c },
    // Act 3: the Hollow Kingdom (violet stone over fire)
    act3: { bg: 0x0a0510, light: 0x2e2140, dark: 0x1a1226, wall: 0x170f22, wallEdge: 0xb57edc, edge: 0x3a2a4e, key: 0xf0d8ff, rim: 0xff6a3d, amb: 0x8a78a8, mote: 0xff8a50, rock: 0x1c1228 }
  };
  let theme = THEMES.free, themeName = 'free', fireOn = false;

  // A painted sky behind everything, one per act (drawn once on a canvas)
  const octPath = (g, cx, cy, r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i * Math.PI) / 4; g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } g.closePath(); };
  function skyTexture(name) {
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
    const g = c.getContext('2d');
    const grad = (stops) => { const l = g.createLinearGradient(0, 0, 0, 1024); stops.forEach(([o, col]) => l.addColorStop(o, col)); g.fillStyle = l; g.fillRect(0, 0, 1024, 1024); };
    const stars = (n, col, maxY) => { g.fillStyle = col; for (let i = 0; i < n; i++) { const s = Math.random() < 0.1 ? 3 : 2; g.globalAlpha = 0.3 + Math.random() * 0.7; g.fillRect(Math.random() * 1024, Math.random() * maxY, s, s); } g.globalAlpha = 1; };
    // a skyline of ruined towers and broken arches along the horizon
    const ruins = (y, col, seed) => {
      g.fillStyle = col; let x = -20, r = seed;
      const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
      g.beginPath(); g.moveTo(0, 1024); g.lineTo(0, y);
      while (x < 1044) {
        const w = 30 + rnd() * 70, h = 20 + rnd() * 140;
        if (rnd() < 0.35) { g.lineTo(x, y - h); g.lineTo(x + w * 0.3, y - h - 18); g.lineTo(x + w * 0.6, y - h); g.lineTo(x + w, y - h + 10); }
        else g.lineTo(x + w * 0.5, y - h * 0.3);
        g.lineTo(x + w, y); x += w + rnd() * 30;
      }
      g.lineTo(1024, 1024); g.closePath(); g.fill();
    };
    if (name === 'act1') {
      grad([[0, '#140c1e'], [0.42, '#3b1d33'], [0.62, '#8a3b2c'], [0.72, '#e07b3a'], [0.74, '#2a1410'], [1, '#0d0806']]);
      g.fillStyle = 'rgba(255,190,110,0.9)'; octPath(g, 640, 735, 120); g.fill();
      g.fillStyle = 'rgba(255,230,160,0.35)'; octPath(g, 640, 735, 170); g.fill();
      stars(80, '#ffd9a0', 380);
      ruins(760, '#1a0e0a', 7); ruins(800, '#0d0806', 3);
    } else if (name === 'act2') {
      grad([[0, '#03060c'], [0.5, '#0e2032'], [0.72, '#3a5a72'], [0.76, '#1a2c3a'], [1, '#060b12']]);
      g.fillStyle = 'rgba(220,236,255,0.12)'; octPath(g, 330, 175, 95); g.fill();
      g.fillStyle = 'rgba(220,236,255,0.85)'; octPath(g, 330, 175, 52); g.fill();
      stars(140, '#d8ecff', 600);
      ruins(790, '#0b1622', 11);
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(160,190,220,${0.05 + Math.random() * 0.06})`; g.fillRect(0, 640 + i * 40 + Math.random() * 20, 1024, 14 + Math.random() * 18); }
    } else if (name === 'act3') {
      grad([[0, '#040108'], [0.45, '#170a24'], [0.7, '#3a1020'], [0.82, '#7a2410'], [1, '#160404']]);
      g.fillStyle = 'rgba(255,106,42,0.18)'; octPath(g, 330, 175, 110); g.fill();
      g.fillStyle = '#ff6a2a'; octPath(g, 330, 175, 76); g.fill();
      g.fillStyle = '#0a0410'; octPath(g, 330, 175, 70); g.fill();        // an eclipse with a burning rim
      stars(120, '#ffb090', 700);
      ruins(820, '#120612', 5); ruins(870, '#080208', 19);
    } else {
      grad([[0, '#03050b'], [0.6, '#0a1222'], [1, '#050810']]);
      stars(160, '#fff6b0', 1024);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace || t.colorSpace;
    return t;
  }
  const lights = {};
  const fx = { fires: [], embers: null, emberData: [], glow: [], motes: null, rocks: [], pillars: [], under: [], debris: [], perimeter: [], lavaTex: null, nextCrumble: 0 };
  function lavaTexture() {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#b52a05'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 128, y = Math.random() * 128, r = 6 + Math.random() * 18;
      const l = g.createRadialGradient(x, y, 0, x, y, r);
      l.addColorStop(0, Math.random() < 0.5 ? '#ffd34d' : '#ff8a1d'); l.addColorStop(1, 'rgba(181,42,5,0)');
      g.fillStyle = l;
      [[0, 0], [128, 0], [-128, 0], [0, 128], [0, -128]].forEach(([ox, oy]) => { g.beginPath(); g.arc(x + ox, y + oy, r, 0, 7); g.fill(); });   // tiles seamlessly
    }
    for (let i = 0; i < 14; i++) { g.strokeStyle = 'rgba(40,6,0,0.6)'; g.lineWidth = 2; g.beginPath(); g.moveTo(Math.random() * 128, Math.random() * 128); g.lineTo(Math.random() * 128, Math.random() * 128); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }   // your army's colors (piece skins)
  let host, renderer, scene, camera, raycaster, mouse;
  let tileSig = '';           // what the tiles were last built from
  let W = 8, H = 8;
  let pickables = [];
  let pieces = {};            // pid -> rec
  let hlObjs = [];
  let intentObjs = [];
  let anims = [];
  let state = null;
  let handlers = { cell() {}, hover() {}, cancel() {} };
  // el: camera elevation in degrees (true isometric is 35.3). Lower shows more of the world; Z / X tilt it.
  let savedTilt = 27;
  try { savedTilt = Math.max(14, Math.min(55, Number(localStorage.getItem('isochess_tilt')) || 27)); } catch (e) { /* default */ }
  const view = { rot: 0, cur: 0, zoom: 1, px: 0, pz: 0, el: savedTilt, elCur: savedTilt };   // px/pz: panned offset

  const wx = (x) => x - (W - 1) / 2;
  const wz = (y) => (H - 1) / 2 - y;
  function topOf(t) {
    if (!t) return 0;
    if (t.kind === 'wall') return WALL_TOP;
    if (t.kind === 'pit') return PIT_TOP;
    return (t.h || 0) * RAISE;
  }
  function tileTop(x, y) {
    return topOf(state && state.tiles[x] && state.tiles[x][y]);
  }

  /* ---------- piece shapes ---------- */
  const V2 = (a) => a.map((p) => new THREE.Vector2(p[0], p[1]));
  function lathe(pts) {
    const g = new THREE.LatheGeometry(V2(pts), SIDES);
    g.rotateY(Math.PI / SIDES);
    return g;
  }
  function box(w, h, d, x, y, z) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  }
  const BASE = [[0, 0], [0.36, 0], [0.36, 0.08], [0.28, 0.12], [0.28, 0.16]];

  // Knight head: the same silhouette as the Knight card, extruded.
  const KNIGHT_PTS = [[212, 219], [214, 196], [221, 181], [209, 178.5], [193, 173], [187.5, 165],
    [191, 156.5], [206, 145.5], [216, 132], [219.5, 121], [223, 112.5], [230, 121], [244, 124],
    [252, 130], [249.5, 135], [258, 140], [255.5, 146], [264, 152], [261.5, 158], [268, 166],
    [266.5, 195], [269, 219]];

  const GEO = {};
  // the run's special enemy pieces reuse a base model and wear a colored ring (see MARK)
  const MODEL = { A: 'B', X: 'P', M: 'Q' };
  const MARK = { A: 0x6fb8ff, X: 0xff8a3d, M: 0xb57edc };
  function partsFor(type) {
    if (MODEL[type]) return partsFor(MODEL[type]);
    if (GEO[type]) return GEO[type];
    let parts;
    switch (type) {
      case 'P':
        parts = [{ g: lathe(BASE.concat([[0.2, 0.18], [0.13, 0.44], [0.22, 0.48], [0.22, 0.52],
          [0.12, 0.55], [0.19, 0.6], [0.2, 0.68], [0.15, 0.76], [0, 0.79]])) }];
        break;
      case 'R': {
        parts = [{ g: lathe(BASE.concat([[0.22, 0.2], [0.2, 0.64], [0.28, 0.68], [0.3, 0.84], [0, 0.84]])) }];
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          const g = box(0.13, 0.14, 0.13, Math.cos(a) * 0.2, 0.91, Math.sin(a) * 0.2);
          parts.push({ g });
        }
        break;
      }
      case 'B':
        parts = [
          { g: lathe(BASE.concat([[0.2, 0.2], [0.12, 0.56], [0.24, 0.6], [0.24, 0.64], [0.12, 0.67],
            [0.19, 0.75], [0.2, 0.85], [0.14, 0.96], [0.05, 1.01], [0, 1.01]])) },
          { g: (() => { const g = new THREE.OctahedronGeometry(0.07); g.translate(0, 1.07, 0); return g; })() }
        ];
        break;
      case 'Q': {
        parts = [{ g: lathe(BASE.concat([[0.22, 0.2], [0.14, 0.62], [0.25, 0.67], [0.25, 0.71],
          [0.15, 0.74], [0.2, 0.95], [0.27, 1.03], [0.2, 1.03], [0, 0.98]])) }];
        for (let i = 0; i < SIDES; i++) {
          const a = (i * Math.PI * 2) / SIDES + Math.PI / SIDES;
          const g = new THREE.ConeGeometry(0.05, 0.15, 4);
          g.translate(Math.cos(a) * 0.23, 1.1, Math.sin(a) * 0.23);
          parts.push({ g });
        }
        const top = new THREE.OctahedronGeometry(0.075); top.translate(0, 1.1, 0);
        parts.push({ g: top });
        break;
      }
      case 'K':
        parts = [
          { g: lathe(BASE.concat([[0.23, 0.2], [0.15, 0.66], [0.26, 0.71], [0.26, 0.75], [0.16, 0.78],
            [0.24, 0.92], [0.2, 1.04], [0.08, 1.08], [0, 1.08]])) },
          { g: box(0.08, 0.3, 0.08, 0, 1.22, 0) },
          { g: box(0.24, 0.08, 0.08, 0, 1.26, 0) }
        ];
        break;
      case 'N': {
        const k = 0.84 / (219 - 112.5);
        const shape = new THREE.Shape(KNIGHT_PTS.map(([px, py]) => new THREE.Vector2((px - 230) * k, (219 - py) * k + 0.16)));
        const head = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: false });
        head.translate(0, 0, -0.15);
        parts = [{ g: lathe(BASE.concat([[0, 0.16]])) }, { g: head, face: true }];
        break;
      }
    }
    GEO[type] = parts;
    return parts;
  }

  function makePiece(p) {
    const group = new THREE.Group();
    const mine = p.side === 'player';
    const mat = new THREE.MeshStandardMaterial({
      color: mine ? skin.color : COLORS.enemy,
      roughness: mine ? 0.62 : 0.45,
      metalness: mine ? 0.05 : 0.25,
      flatShading: true
    });
    const lineMat = new THREE.LineBasicMaterial({ color: mine ? skin.edge : COLORS.enemyEdge });
    const meshes = [];
    partsFor(p.type).forEach((part) => {
      const m = new THREE.Mesh(part.g, mat);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(part.g, 28), lineMat);
      if (part.face) {
        // player knights look at the enemy (-z), enemy knights look back
        const r = mine ? -Math.PI / 2 : Math.PI / 2;
        m.rotation.y = r; e.rotation.y = r;
      }
      m.userData = { kind: 'piece', pid: p.id };
      group.add(m, e);
      meshes.push(m);
    });
    scene.add(group);
    if (p.boss) group.scale.setScalar(1.35);
    const rec = { group, mat, lineMat, meshes, type: p.type, side: p.side, boss: !!p.boss, rings: {}, busy: false, dying: false };
    pieces[p.id] = rec;
    group.position.set(wx(p.x), tileTop(p.x, p.y), wz(p.y));
    return rec;
  }
  function disposePiece(id) {
    const r = pieces[id]; if (!r) return;
    scene.remove(r.group);
    r.group.traverse((o) => { if (o.isLineSegments) o.geometry.dispose(); });
    r.mat.dispose(); r.lineMat.dispose();
    Object.values(r.rings).forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
    delete pieces[id];
  }

  // flat octagon ring lying on the tile, under a piece
  function ringGeo(inner, outer) {
    const g = new THREE.RingGeometry(inner, outer, SIDES, 1, Math.PI / SIDES);
    g.rotateX(-Math.PI / 2);
    return g;
  }
  function setRing(rec, key, on, color, size) {
    if (on && !rec.rings[key]) {
      const m = new THREE.Mesh(ringGeo(size, size + 0.08),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide }));
      m.position.y = 0.015;
      rec.group.add(m);
      rec.rings[key] = m;
    } else if (!on && rec.rings[key]) {
      const m = rec.rings[key];
      rec.group.remove(m); m.geometry.dispose(); m.material.dispose();
      delete rec.rings[key];
    }
  }

  /* ---------- scene ---------- */
  function build(el) {
    host = el;
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(theme.bg, 1);
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;outline:none;touch-action:none';

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);

    // light from the left, like the rim light on the cards
    lights.amb = new THREE.AmbientLight(theme.amb, 0.6); scene.add(lights.amb);
    const key = new THREE.DirectionalLight(theme.key, 0.95); key.position.set(-10, 14, 6); scene.add(key); lights.key = key;
    const rim = new THREE.DirectionalLight(theme.rim, 0.35); rim.position.set(12, 6, -10); scene.add(rim); lights.rim = rim;
    const fill = new THREE.DirectionalLight(0x9fb0cc, 0.22); fill.position.set(8, 10, 12); scene.add(fill);

    scene.background = skyTexture(themeName);
    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
    new ResizeObserver(resize).observe(host);
    attachInput();
    resize();
    requestAnimationFrame(frame);
  }

  function resize() {
    const w = host.clientWidth || 800, h = host.clientHeight || 600;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    // fit the board whichever side of the screen is tighter
    const f = Math.max(W, H) / 8;    // bigger arenas zoom out to fit
    const half = (aspect < 1 ? 6.6 / aspect : 6.2) * f / view.zoom;
    camera.left = -half * aspect; camera.right = half * aspect;
    camera.top = half; camera.bottom = -half;
    camera.updateProjectionMatrix();
  }
  function placeCamera() {
    const th = Math.PI / 4 + view.cur;
    view.elCur += (view.el - view.elCur) * 0.14;
    const el = (view.elCur * Math.PI) / 180;
    const d = 30;
    camera.position.set(d * Math.cos(el) * Math.sin(th), d * Math.sin(el), d * Math.cos(el) * Math.cos(th));
    // aim a little toward the viewer and right, so the board sits
    // above the hand of cards and left of the side panel
    const f = Math.max(W, H) / 8;
    const side = host.clientWidth < 560 ? 0 : 0.7 * f * (view.offset === undefined ? 1 : view.offset);   // no side panel on phones
    const down = 0.75 * f * (view.offset === undefined ? 1 : view.offset);
    const tx = down * Math.sin(th) + side * Math.cos(th) + view.px, tz = down * Math.cos(th) - side * Math.sin(th) + view.pz;
    camera.position.x += tx; camera.position.z += tz;
    if (view.shake > 0.001) {
      const k = view.shake;
      camera.position.x += (Math.random() - 0.5) * k; camera.position.y += (Math.random() - 0.5) * k; camera.position.z += (Math.random() - 0.5) * k;
      view.shake *= 0.88;
    }
    camera.lookAt(tx, -0.6, tz);
  }
  function shake(k) { view.shake = Math.max(view.shake || 0, k); }

  /* ---------- input ---------- */
  function setMouse(e) {
    const r = renderer.domElement.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(mouse, camera);
  }
  function pickCell(e) {
    setMouse(e);
    const list = pickables.concat(...Object.values(pieces).filter((r) => !r.dying).map((r) => r.meshes));
    const hits = raycaster.intersectObjects(list, false);
    for (const h of hits) {
      const u = h.object.userData;
      if (u.kind === 'piece') {
        const p = state && state.pieces.find((q) => q.id === u.pid);
        if (p) return { x: p.x, y: p.y };
      } else if (u.kind === 'tiles' && h.instanceId !== undefined) {
        const c = tileCells[h.instanceId];
        if (c) return { x: c.x, y: c.y };
      }
    }
    return null;
  }
  function attachInput() {
    const el = renderer.domElement;
    let down = null;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, b: e.button, px: view.px, pz: view.pz, panning: false };
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = down.panning || Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 8;
      const b = down.b; down = null;
      el.style.cursor = 'default';
      if (moved) return;
      if (b === 2) { handlers.cancel(); return; }
      if (b !== 0) return;
      const c = pickCell(e);
      if (c) handlers.cell(c.x, c.y); else handlers.cell(-1, -1);
    });
    let lastHover = '';
    el.addEventListener('pointermove', (e) => {
      // dragging pans the view (big arenas don't fit on screen when zoomed in)
      if (down && (down.b === 0 || down.b === 1)) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (down.panning || Math.abs(dx) + Math.abs(dy) > 8) {
          down.panning = true;
          el.style.cursor = 'grabbing';
          const th = Math.PI / 4 + view.cur;
          const k = (camera.right - camera.left) / (el.clientWidth || 1);       // world units per pixel
          const up = k / Math.sin(Math.atan(1 / Math.SQRT2));                  // ground is foreshortened vertically
          view.px = down.px - dx * k * Math.cos(th) - dy * up * Math.sin(th);
          view.pz = down.pz + dx * k * Math.sin(th) - dy * up * Math.cos(th);
          const lim = Math.max(W, H) * 0.75;
          view.px = Math.max(-lim, Math.min(lim, view.px));
          view.pz = Math.max(-lim, Math.min(lim, view.pz));
          return;
        }
      }
      const c = pickCell(e);
      const k = c ? c.x + ',' + c.y : '';
      el.style.cursor = c ? 'pointer' : 'default';
      if (k !== lastHover) { lastHover = k; handlers.hover(c ? c.x : -1, c ? c.y : -1); }
    });
    el.addEventListener('pointerleave', () => { lastHover = ''; handlers.hover(-1, -1); });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      view.zoom = Math.min(4, Math.max(0.6, view.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      resize();
    }, { passive: false });
  }

  /* ---------- highlights & telegraphs ---------- */
  function clearList(list) {
    list.forEach((m) => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
    list.length = 0;
  }
  function octagon(r) {
    const g = new THREE.CircleGeometry(r, SIDES, Math.PI / SIDES);  // 8 segments = an octagon
    g.rotateX(-Math.PI / 2);
    return g;
  }
  function square(s) { const g = new THREE.PlaneGeometry(s, s); g.rotateX(-Math.PI / 2); return g; }
  function frameGeo(s, t) {
    const sh = new THREE.Shape([new THREE.Vector2(-s, -s), new THREE.Vector2(s, -s), new THREE.Vector2(s, s), new THREE.Vector2(-s, s)]);
    const i = s - t;
    sh.holes.push(new THREE.Path([new THREE.Vector2(-i, -i), new THREE.Vector2(-i, i), new THREE.Vector2(i, i), new THREE.Vector2(i, -i)]));
    const g = new THREE.ShapeGeometry(sh); g.rotateX(-Math.PI / 2); return g;
  }
  function setHighlights(list) {
    clearList(hlObjs);
    list.forEach((h) => {
      let g, color, op;
      switch (h.kind) {
        case 'move': g = octagon(0.15); color = COLORS.move; op = 0.8; break;
        case 'capture': g = frameGeo(0.46, 0.09); color = COLORS.capture; op = 0.9; break;
        case 'select': g = square(0.94); color = COLORS.select; op = 0.38; break;
        case 'target': g = frameGeo(0.46, 0.07); color = COLORS.target; op = 0.95; break;
        case 'picked': g = square(0.94); color = COLORS.target; op = 0.4; break;
        case 'hover': g = square(0.94); color = COLORS.hover; op = 0.1; break;
        default: return;
      }
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false }));
      m.position.set(wx(h.x), tileTop(h.x, h.y) + 0.012 + (h.kind === 'move' ? 0.004 : 0), wz(h.y));
      m.renderOrder = 2;
      scene.add(m);
      hlObjs.push(m);
    });
  }

  function setIntents(list) {
    clearList(intentObjs);
    const mat = () => new THREE.MeshBasicMaterial({ color: COLORS.intent, transparent: true, opacity: 0.9, depthWrite: false });
    const markAt = (x, y, big) => {
      const m = new THREE.Mesh(big ? frameGeo(0.46, 0.1) : frameGeo(0.36, 0.06), mat());
      m.position.set(wx(x), tileTop(x, y) + 0.02, wz(y));
      m.renderOrder = 3; m.userData.pulse = true; scene.add(m); intentObjs.push(m);
    };
    list.forEach((it) => {
      // a blast (a Bomber about to go off): every tile it will hit
      if (it.area) { it.area.forEach((c) => markAt(c.x, c.y, true)); return; }
      const a = new THREE.Vector3(wx(it.fx), tileTop(it.fx, it.fy) + 0.7, wz(it.fy));
      const b = new THREE.Vector3(wx(it.tx), tileTop(it.tx, it.ty) + 0.12, wz(it.ty));
      const lift = it.type === 'N' ? 1.6 : it.shot ? 0.3 : 0.9 + a.distanceTo(b) * 0.12;
      const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = Math.max(a.y, b.y) + lift;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.035, 6, false), mat());
      const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.26, 4), mat());
      const tan = curve.getTangent(1);
      head.position.copy(b).add(tan.clone().multiplyScalar(-0.1));
      head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tan);
      const mark = new THREE.Mesh(it.capture ? frameGeo(0.46, 0.1) : frameGeo(0.36, 0.06), mat());
      mark.position.set(wx(it.tx), tileTop(it.tx, it.ty) + 0.02, wz(it.ty));
      [tube, head, mark].forEach((m) => { m.renderOrder = 3; m.userData.pulse = true; scene.add(m); intentObjs.push(m); });
    });
  }

  /* ---------- tiles ---------- */
  // All tiles are ONE instanced mesh plus ONE set of edge lines, so even a
  // 24 x 24 arena is only two draw calls.
  const unitBox = new THREE.BoxGeometry(0.97, 1, 0.97);
  unitBox.translate(0, 0.5, 0);           // origin at the bottom, so scale.y = height
  let tileMesh = null, tileLines = null, tileCells = [];
  function disposeTiles() {
    if (tileMesh) { scene.remove(tileMesh); tileMesh.material.dispose(); tileMesh.dispose && tileMesh.dispose(); }
    if (tileLines) { scene.remove(tileLines); tileLines.geometry.dispose(); tileLines.material.dispose(); }
    tileMesh = tileLines = null; tileCells = []; pickables = [];
  }
  function buildTiles(s) {
    disposeTiles();
    const cream = new THREE.Color(0xf4ecb8);
    const cells = [];
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      const t = s.tiles[x][y];
      if (t.kind === 'void') continue;
      let color, edge;
      if (t.kind === 'wall') { color = new THREE.Color(theme.wall); edge = new THREE.Color(theme.wallEdge); }
      else if (t.kind === 'pit') { color = new THREE.Color(fireOn ? 0x1a0602 : COLORS.pit); edge = new THREE.Color(fireOn ? 0x8a3010 : theme.edge); }
      else {
        color = new THREE.Color((x + y) % 2 === 1 ? theme.light : theme.dark).lerp(cream, 0.06 * (t.h || 0));
        edge = new THREE.Color(theme.edge);
      }
      cells.push({ x, y, top: topOf(t), color, edge });
    }
    if (!cells.length) return;
    tileMesh = new THREE.InstancedMesh(unitBox,
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), cells.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const pos = [], col = [];
    const r = 0.485;
    cells.forEach((c, i) => {
      m4.compose(v.set(wx(c.x), BOTTOM, wz(c.y)), q, sc.set(1, c.top - BOTTOM, 1));
      tileMesh.setMatrixAt(i, m4);
      tileMesh.setColorAt(i, c.color);
      // the 12 edges of this column, merged into one line set
      const X = wx(c.x), Z = wz(c.y), y0 = BOTTOM, y1 = c.top;
      const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
      for (let k = 0; k < 4; k++) {
        const [ax, az] = corners[k], [bx, bz] = corners[(k + 1) % 4];
        pos.push(X + ax, y1, Z + az, X + bx, y1, Z + bz);   // top
        pos.push(X + ax, y0, Z + az, X + bx, y0, Z + bz);   // bottom
        pos.push(X + ax, y0, Z + az, X + ax, y1, Z + az);   // upright
      }
      for (let k = 0; k < 24; k++) col.push(c.edge.r, c.edge.g, c.edge.b);
    });
    tileMesh.instanceMatrix.needsUpdate = true;
    if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;
    tileMesh.userData = { kind: 'tiles' };
    scene.add(tileMesh);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    tileLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    scene.add(tileLines);
    tileCells = cells;
    pickables = [tileMesh];
    buildWorld(s);
  }

  // Fire rising out of the pits (some levels), embers, dust in the air, and rocks drifting around the board
  function clearWorld() {
    fx.fires.forEach((f) => { scene.remove(f.group); f.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); });
    fx.glow.forEach((l) => scene.remove(l));
    [fx.embers, fx.motes].forEach((p) => { if (p) { scene.remove(p); p.geometry.dispose(); p.material.dispose(); } });
    fx.rocks.forEach((r) => { scene.remove(r.mesh); r.mesh.geometry.dispose(); r.mesh.material.dispose(); r.line.geometry.dispose(); r.line.material.dispose(); });
    fx.pillars.forEach((p) => { scene.remove(p.group); p.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); });
    fx.under.forEach((m) => { scene.remove(m); m.geometry.dispose(); if (m.material.map && m.userData.mist === 0) m.material.map.dispose(); m.material.dispose(); });
    fx.debris.forEach((d) => { scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); });
    fx.fires = []; fx.glow = []; fx.embers = null; fx.motes = null; fx.rocks = []; fx.emberData = []; fx.pillars = []; fx.under = []; fx.debris = []; fx.perimeter = [];
  }
  function buildWorld(s) {
    clearWorld();
    const add = THREE.AdditiveBlending;
    const pits = [];
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (s.tiles[x][y].kind === 'pit') pits.push({ x, y });
    if (fireOn) {
      const flameGeo = (r, h) => { const g = new THREE.ConeGeometry(r, h, 6, 1, true); g.translate(0, h / 2, 0); return g; };
      pits.forEach((c, i) => {
        const group = new THREE.Group();
        group.position.set(wx(c.x), PIT_TOP + 0.02, wz(c.y));
        const flames = [];
        [[0xff3d00, 0.34, 1.45, 0.55], [0xff8a1d, 0.25, 1.2, 0.7], [0xffd34d, 0.14, 0.85, 0.85]].forEach(([color, r, h, op], k) => {
          for (let j = 0; j < (k === 2 ? 1 : 3); j++) {
            const m = new THREE.Mesh(flameGeo(r, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: add, depthWrite: false, side: THREE.DoubleSide }));
            const a = (j / 3) * Math.PI * 2 + i;
            if (k < 2) m.position.set(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
            m.userData = { phase: Math.random() * 6.28, speed: 5 + Math.random() * 4, h, op };
            m.renderOrder = 2;
            group.add(m); flames.push(m);
          }
        });
        // a pool of lava in the pit, slowly churning
        if (!fx.lavaTex) fx.lavaTex = lavaTexture();
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.96), new THREE.MeshBasicMaterial({ map: fx.lavaTex, transparent: true, opacity: 1 }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = 0.02; group.add(glow);
        scene.add(group);
        fx.fires.push({ group, flames, glow });
        if (i < 4) { const l = new THREE.PointLight(0xff6a1d, 1.1, 3.2, 2); l.position.set(wx(c.x), 0.5, wz(c.y)); l.userData.phase = Math.random() * 6; scene.add(l); fx.glow.push(l); }
      });
      // embers drifting up out of every pit
      const n = pits.length * 14;
      if (n) {
        const pos = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          const c = pits[Math.floor(i / 14)];
          fx.emberData.push({ cx: wx(c.x), cz: wz(c.y), y: Math.random() * 2, v: 0.006 + Math.random() * 0.012, dx: (Math.random() - 0.5) * 0.7, dz: (Math.random() - 0.5) * 0.7 });
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        fx.embers = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffa040, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: add, depthWrite: false }));
        scene.add(fx.embers);
      }
    }
    // the board is a floating island: rock hangs underneath it, and its edges crumble on fire levels
    const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < H && s.tiles[x][y].kind !== 'void';
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
      if (!solid(x, y)) continue;
      const edgeDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => !solid(x + dx, y + dy));
      edgeDirs.forEach(([dx, dy]) => fx.perimeter.push({ x, y, dx, dz: -dy }));
      const inner = Math.min(x, y, W - 1 - x, H - 1 - y);
      const h = 0.5 + Math.random() * 0.6 + inner * 0.55 + (Math.random() < 0.15 ? 1.2 : 0);
      const g = new THREE.ConeGeometry(0.5 + Math.random() * 0.12, h, 6);
      g.rotateX(Math.PI); g.translate(0, -h / 2, 0);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.95, flatShading: true }));
      m.position.set(wx(x) + (Math.random() - 0.5) * 0.2, BOTTOM, wz(y) + (Math.random() - 0.5) * 0.2);
      m.rotation.y = Math.random() * Math.PI;
      scene.add(m); fx.under.push(m);
    }
    // dust (or ash) hanging in the air over the board
    const m = 90, mp = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) { mp[i * 3] = (Math.random() - 0.5) * (W + 6); mp[i * 3 + 1] = Math.random() * 4 - 0.5; mp[i * 3 + 2] = (Math.random() - 0.5) * (H + 6); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    fx.motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: theme.mote, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.35, blending: add, depthWrite: false }));
    scene.add(fx.motes);
    // giant ruined pillars rising out of the void around the board (the ones between you and the board fade out)
    const R = Math.max(W, H) / 2;
    for (let i = 0; i < 12; i++) {
      const group = new THREE.Group();
      const a = (i / 12) * Math.PI * 2 + 0.13 + (i % 2) * 0.12;
      const d = R + 8 + (i % 3) * 2.5;
      const rad = 0.9 + (i % 3) * 0.35;
      const tall = 9 + ((i * 5) % 7) * 1.4;
      const broken = i % 3 === 1;
      const mat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.85, flatShading: true, transparent: true });
      const edgeMat = () => new THREE.LineBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true });
      // each pillar sinks into the dark below: its color (and its outline) fades to the sky's darkness toward the bottom
      const fade = (geo, y, top, bottom) => {
        const p = geo.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(top), b = new THREE.Color(bottom), c = new THREE.Color();
        for (let i = 0; i < p.count; i++) {
          const k = Math.max(0, Math.min(1, (p.getY(i) + y + 9) / 7));
          c.copy(b).lerp(a, k * k); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        return geo;
      };
      const part = (geo, y, rot) => {
        const m = new THREE.Mesh(fade(geo, y, theme.wall, theme.bg), mat()); m.position.y = y; if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
        const e = new THREE.LineSegments(fade(new THREE.EdgesGeometry(geo, 25), y, theme.wallEdge, theme.bg), edgeMat()); e.position.copy(m.position); e.rotation.copy(m.rotation);
        group.add(m, e);
      };
      part(new THREE.CylinderGeometry(rad, rad * 1.08, tall, 8), -10 + tall / 2);                       // the shaft
      part(new THREE.CylinderGeometry(rad * 1.35, rad * 1.35, 0.5, 8), -10 + tall);                    // its capital
      if (broken) part(new THREE.CylinderGeometry(rad, rad, 1.6, 8), -10 + tall + 1.3, [0.35, 0, 0.25]);   // a chunk slipping off
      else part(new THREE.CylinderGeometry(rad * 0.9, rad * 1.2, 0.9, 8), -10 + tall + 0.7);
      // a band of light near the top, to catch the eye
      const band = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.02, rad * 1.02, 0.16, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: theme.rim, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      band.position.y = -10 + tall - 1.2; band.userData.band = true; group.add(band);
      // fire levels: a brazier burning on top of the whole pillars
      if (fireOn && !broken) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.7, 1.8, 6, 1, true), new THREE.MeshBasicMaterial({ color: 0xff7a1d, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
        f.geometry.translate(0, 0.9, 0); f.position.y = -10 + tall + 1.15; f.userData.flame = Math.random() * 6; group.add(f);
      }
      group.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      scene.add(group);
      const dir = new THREE.Vector2(Math.cos(a), Math.sin(a)), th = Math.PI / 4 + view.cur;
      const fadeNow = dir.dot(new THREE.Vector2(Math.sin(th), Math.cos(th))) > -0.6 ? 0 : 1;   // start already faded if it's in front
      group.visible = fadeNow > 0;
      fx.pillars.push({ group, dir, fade: fadeNow });
    }
    // a dark mist in the void below: stacked soft layers that swallow the bottoms of the pillars, rocks and the island
    const mc = document.createElement('canvas'); mc.width = mc.height = 128;
    const mg2 = mc.getContext('2d'), rad = mg2.createRadialGradient(64, 64, 8, 64, 64, 64);
    rad.addColorStop(0, 'rgba(255,255,255,1)'); rad.addColorStop(0.6, 'rgba(255,255,255,0.7)'); rad.addColorStop(1, 'rgba(255,255,255,0)');
    mg2.fillStyle = rad; mg2.fillRect(0, 0, 128, 128);
    const mistTex = new THREE.CanvasTexture(mc);
    for (let i = 0; i < 4; i++) {
      const size = (R + 3) * 2.4;   // only under the island, so the sky stays clear
      const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color: theme.bg, map: mistTex, transparent: true, opacity: 0.28, depthWrite: false }));
      m.rotation.x = -Math.PI / 2; m.position.y = -1.4 - i * 0.9; m.userData.mist = i;
      scene.add(m); fx.under.push(m);
    }
    // broken pieces of the kingdom, drifting below and around the board
    for (let i = 0; i < 12; i++) {
      const g = new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.55, 0);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.9, flatShading: true }));
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: theme.edge }));
      const a = Math.random() * Math.PI * 2, d = R + 1.5 + Math.random() * 4;
      const base = new THREE.Vector3(Math.cos(a) * d, -1.8 - Math.random() * 4, Math.sin(a) * d);
      mesh.position.copy(base); line.position.copy(base);
      scene.add(mesh); scene.add(line);
      fx.rocks.push({ mesh, line, base, phase: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.004 });
    }
  }
  function animateWorld(ts) {
    const t = ts / 1000;
    fx.fires.forEach((f) => {
      f.flames.forEach((m) => {
        const u = m.userData, w = Math.sin(t * u.speed + u.phase) * 0.5 + Math.sin(t * u.speed * 1.7 + u.phase * 2) * 0.25;
        m.scale.set(1 + w * 0.12, 0.85 + w * 0.3, 1 + w * 0.12);
        m.rotation.y = t * 0.8 + u.phase;
        m.material.opacity = u.op * (0.8 + w * 0.25);
      });
    });
    if (fx.lavaTex) { fx.lavaTex.offset.set(Math.sin(t * 0.3) * 0.2, t * 0.04); }
    // fire levels: the edges of the board crumble away into the void
    if (fireOn && fx.perimeter.length && t > fx.nextCrumble) {
      fx.nextCrumble = t + 0.35 + Math.random() * 0.6;
      const c = fx.perimeter[Math.floor(Math.random() * fx.perimeter.length)];
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08 + Math.random() * 0.14, 0.08 + Math.random() * 0.12, 0.08 + Math.random() * 0.14),
        new THREE.MeshStandardMaterial({ color: Math.random() < 0.3 ? 0xff6a1d : theme.dark, emissive: Math.random() < 0.3 ? 0x7a2000 : 0x000000, flatShading: true, transparent: true }));
      m.position.set(wx(c.x) + c.dx * 0.5, BOTTOM + Math.random() * 0.5, wz(c.y) + c.dz * 0.5);
      scene.add(m);
      fx.debris.push({ m, vy: 0, spin: Math.random() * 0.1 });
    }
    for (let i = fx.debris.length - 1; i >= 0; i--) {
      const d = fx.debris[i];
      d.vy -= 0.0016; d.m.position.y += d.vy; d.m.rotation.x += d.spin; d.m.rotation.z += d.spin;
      if (d.m.position.y < -7) { scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); fx.debris.splice(i, 1); }
      else if (d.m.position.y < -4) d.m.material.opacity = (d.m.position.y + 7) / 3;
    }
    fx.glow.forEach((l) => { l.intensity = 0.9 + Math.sin(t * 9 + l.userData.phase) * 0.25 + Math.random() * 0.15; });
    if (fx.embers) {
      const a = fx.embers.geometry.attributes.position.array;
      fx.emberData.forEach((e, i) => {
        e.y += e.v; if (e.y > 2.4) { e.y = 0; e.dx = (Math.random() - 0.5) * 0.7; e.dz = (Math.random() - 0.5) * 0.7; }
        a[i * 3] = e.cx + e.dx * (0.4 + e.y * 0.3) + Math.sin(t * 2 + i) * 0.05; a[i * 3 + 1] = PIT_TOP + e.y; a[i * 3 + 2] = e.cz + e.dz * (0.4 + e.y * 0.3);
      });
      fx.embers.geometry.attributes.position.needsUpdate = true;
    }
    if (fx.motes) fx.motes.rotation.y = t * 0.01;
    flare *= 0.985;
    // pillars between the camera and the board fade away; the ones behind it stand tall
    const th = Math.PI / 4 + view.cur, cam = new THREE.Vector2(Math.sin(th), Math.cos(th));
    fx.pillars.forEach((p) => {
      const front = p.dir.dot(cam) > -0.6;   // only the ones well behind the board stay
      p.fade += ((front ? 0 : 1) - p.fade) * 0.12;
      p.group.visible = p.fade > 0.02;
      p.group.traverse((o) => {
        if (!o.material) return;
        if (o.userData.band) { o.material.opacity = (0.6 + Math.sin(t * 1.5) * 0.25 + flare) * p.fade; o.material.color.setHex(flare > 0.05 ? 0xff3030 : theme.rim); }
        else if (o.userData.flame !== undefined) { o.material.opacity = 0.75 * p.fade; o.scale.y = 0.85 + Math.sin(t * 8 + o.userData.flame) * 0.15; }
        else o.material.opacity = p.fade;
      });
    });
    fx.rocks.forEach((r) => {
      const y = r.base.y + Math.sin(t * 0.5 + r.phase) * 0.25;
      r.mesh.position.y = y; r.line.position.y = y;
      r.mesh.rotation.y += r.spin; r.mesh.rotation.x += r.spin * 0.5; r.line.rotation.copy(r.mesh.rotation);
    });
  }
  function setTheme(name, fire) {
    theme = THEMES[name] || THEMES.free; fireOn = !!fire;
    if (renderer) renderer.setClearColor(theme.bg, 1);
    if (scene && name !== themeName) { if (scene.background && scene.background.dispose) scene.background.dispose(); scene.background = skyTexture(name); }
    themeName = name;
    if (lights.key) { lights.key.color.setHex(theme.key); lights.rim.color.setHex(theme.rim); lights.amb.color.setHex(theme.amb); }
    tileSig = '';   // rebuild the board in the new look on the next sync
  }

  /* ---------- sync with game state ---------- */
  function sync(s) {
    state = s;
    const sig = s.w + 'x' + s.h + ':' + s.tiles.map((col) => col.map((t) => t.kind[0] + (t.h || 0)).join('')).join('|');
    if (sig !== tileSig) {
      const resized = s.w !== W || s.h !== H;
      W = s.w; H = s.h;
      tileSig = sig;
      buildTiles(s);
      if (resized) { view.px = 0; view.pz = 0; resize(); }
    }
    const alive = new Set();
    s.pieces.forEach((p) => {
      alive.add(p.id);
      let rec = pieces[p.id];
      if (rec && (rec.type !== p.type || rec.side !== p.side || rec.boss !== !!p.boss)) { disposePiece(p.id); rec = null; }   // promotion, or edited
      if (!rec) rec = makePiece(p);
      if (!rec.busy) rec.group.position.set(wx(p.x), tileTop(p.x, p.y), wz(p.y));
      setRing(rec, 'shield', !!p.shield, COLORS.shield, 0.4);
      setRing(rec, 'fortify', !!p.fortify, COLORS.fortify, 0.3);
      setRing(rec, 'haste', s.lockPiece === p.id, COLORS.haste, 0.5);
      setRing(rec, 'mark', !!MARK[p.type], MARK[p.type], 0.36);
      // a boss's health: one ring per point left
      for (let i = 1; i <= 3; i++) setRing(rec, 'hp' + i, !!p.boss && (p.hp || 1) >= i, 0xff6b6b, 0.42 + i * 0.1);
      setRing(rec, 'vet', !!(p.unit && p.unit.traits && p.unit.traits.length), 0xffe600, 0.22);
      rec.mat.emissive.setHex(p.frozen ? COLORS.frozen : 0x000000);
      rec.mat.emissiveIntensity = p.frozen ? 0.45 : 0;
    });
    Object.keys(pieces).forEach((id) => {
      if (!alive.has(+id) && !pieces[id].dying) disposePiece(id);
    });
  }

  /* ---------- animation ---------- */
  const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
  function tween(dur, fn) {
    return new Promise((res) => anims.push({ t0: performance.now(), dur, fn, res }));
  }
  function animateMove(pid, x, y) {
    const rec = pieces[pid]; if (!rec) return Promise.resolve();
    rec.busy = true;
    const from = rec.group.position.clone();
    const to = new THREE.Vector3(wx(x), tileTop(x, y), wz(y));
    const hop = rec.type === 'N' ? 1.1 : 0.22 + from.distanceTo(to) * 0.04;
    const dur = 260 + Math.min(260, from.distanceTo(to) * 45);
    return tween(dur, (k) => {
      const e = ease(k);
      rec.group.position.lerpVectors(from, to, e);
      rec.group.position.y += Math.sin(Math.PI * e) * hop;
    }).then(() => { rec.busy = false; });
  }
  // the piece bursts into shards that tumble away and fall into the void
  function shatter(rec) {
    const color = rec.mat.color.getHex(), edge = rec.lineMat.color.getHex();
    const at = rec.group.position.clone();
    const big = rec.boss ? 1.6 : 1;
    const shards = [];
    for (let i = 0; i < 16; i++) {
      const g = new THREE.TetrahedronGeometry((0.05 + Math.random() * 0.08) * big, 0);
      const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.5, transparent: true }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: edge, transparent: true }));
      m.add(e);
      m.position.set(at.x + (Math.random() - 0.5) * 0.3, at.y + 0.15 + Math.random() * 0.8 * big, at.z + (Math.random() - 0.5) * 0.3);
      const a = Math.random() * Math.PI * 2, sp = 0.025 + Math.random() * 0.04;
      shards.push({ m, e, v: new THREE.Vector3(Math.cos(a) * sp, 0.04 + Math.random() * 0.06, Math.sin(a) * sp), r: new THREE.Vector3(Math.random() * 0.3, Math.random() * 0.3, Math.random() * 0.3) });
      scene.add(m);
    }
    // a flash ring on the tile
    const ring = new THREE.Mesh(ringGeo(0.1, 0.18), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.position.set(at.x, at.y + 0.03, at.z); scene.add(ring);
    tween(900, (k) => {
      shards.forEach((sh) => {
        sh.v.y -= 0.0045; sh.m.position.add(sh.v);
        sh.m.rotation.x += sh.r.x; sh.m.rotation.y += sh.r.y; sh.m.rotation.z += sh.r.z;
        const o = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4; sh.m.material.opacity = o; sh.e.material.opacity = o;
      });
      ring.scale.setScalar(1 + k * 5); ring.material.opacity = 0.9 * (1 - k);
    }).then(() => {
      shards.forEach((sh) => { scene.remove(sh.m); sh.m.geometry.dispose(); sh.m.material.dispose(); sh.e.geometry.dispose(); sh.e.material.dispose(); });
      scene.remove(ring); ring.geometry.dispose(); ring.material.dispose();
    });
    shake(rec.boss ? 0.35 : 0.08);
  }
  function animateCapture(pid) {
    const rec = pieces[pid]; if (!rec) return Promise.resolve();
    rec.dying = true;
    shatter(rec);
    rec.mat.transparent = true; rec.lineMat.transparent = true;
    return tween(140, (k) => { rec.group.scale.setScalar((rec.boss ? 1.35 : 1) * (1 - k)); rec.mat.opacity = 1 - k; rec.lineMat.opacity = 1 - k; })
      .then(() => disposePiece(pid));
  }
  function animateCaptureOld(pid) {
    const rec = pieces[pid]; if (!rec) return Promise.resolve();
    rec.dying = true;
    const y0 = rec.group.position.y;
    const spin = (Math.random() < 0.5 ? -1 : 1) * 1.2;
    rec.mat.transparent = true; rec.lineMat.transparent = true;
    return tween(420, (k) => {
      rec.group.position.y = y0 + Math.sin(Math.PI * k) * 0.35 - k * k * 1.2;
      rec.group.rotation.z = spin * k;
      rec.group.scale.setScalar(1 - k * 0.5);
      rec.mat.opacity = 1 - k; rec.lineMat.opacity = 1 - k;
    }).then(() => disposePiece(pid));
  }
  // a boss drops out of the sky onto its square: a shockwave, a shake, and the pillars flare
  function bossEntrance(pid) {
    const rec = pieces[pid]; if (!rec) return Promise.resolve();
    rec.busy = true;
    const to = rec.group.position.clone(), from = to.clone(); from.y += 9;
    rec.group.position.copy(from);
    flare = 1;
    return new Promise((r) => setTimeout(r, 450)).then(() => tween(700, (k) => {
      const e = k * k * k;
      rec.group.position.lerpVectors(from, to, e);
      rec.group.rotation.y = (1 - e) * Math.PI * 2;
    })).then(() => {
      rec.group.rotation.y = 0;
      shake(0.6);
      const wave = new THREE.Mesh(ringGeo(0.3, 0.45), new THREE.MeshBasicMaterial({ color: 0xff6b6b, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      wave.position.set(to.x, to.y + 0.05, to.z); scene.add(wave);
      const dust = [];
      for (let i = 0; i < 24; i++) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: theme.mote, transparent: true }));
        const a = (i / 24) * Math.PI * 2; m.position.set(to.x, to.y + 0.1, to.z); scene.add(m);
        dust.push({ m, v: new THREE.Vector3(Math.cos(a) * 0.06, 0.03 + Math.random() * 0.04, Math.sin(a) * 0.06) });
      }
      return tween(900, (k) => {
        wave.scale.setScalar(1 + k * 14); wave.material.opacity = 0.9 * (1 - k);
        dust.forEach((d) => { d.v.y -= 0.003; d.m.position.add(d.v); d.m.material.opacity = 1 - k; });
      }).then(() => {
        scene.remove(wave); wave.geometry.dispose(); wave.material.dispose();
        dust.forEach((d) => { scene.remove(d.m); d.m.geometry.dispose(); d.m.material.dispose(); });
        rec.busy = false;
      });
    });
  }
  let flare = 0;   // the pillars' bands flare red for a boss

  // a small shake to show a telegraphed move fizzling out
  function animateFizzle(pid) {
    const rec = pieces[pid]; if (!rec) return Promise.resolve();
    rec.busy = true;
    const x0 = rec.group.position.x;
    return tween(300, (k) => { rec.group.position.x = x0 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k); })
      .then(() => { rec.group.position.x = x0; rec.busy = false; });
  }

  function frame(ts) {
    requestAnimationFrame(frame);
    const now = performance.now();
    for (let i = anims.length - 1; i >= 0; i--) {
      const a = anims[i];
      const k = Math.min(1, (now - a.t0) / a.dur);
      a.fn(k);
      if (k >= 1) { anims.splice(i, 1); a.res(); }
    }
    view.cur += (view.rot - view.cur) * 0.14;
    animateWorld(ts);
    const pulse = 0.55 + 0.35 * Math.sin(ts / 260);
    intentObjs.forEach((m) => { m.material.opacity = pulse; });
    placeCamera();
    renderer.render(scene, camera);
  }

  window.Board3D = {
    init(el, h) { Object.assign(handlers, h); build(el); },
    sync, setHighlights, setIntents, animateMove, animateCapture, animateFizzle, bossEntrance, shake,
    setSkin(color, edge) { skin = { color, edge }; Object.keys(pieces).forEach(disposePiece); },
    setTheme,
    rotate(dir) { view.rot += (dir * Math.PI) / 2; },
    tilt(deg) { view.el = Math.max(14, Math.min(55, view.el + deg)); try { localStorage.setItem('isochess_tilt', String(view.el)); } catch (e) { /* blocked */ } },
    // how far to nudge the board away from the game's HUD (0 = centered, for the editor)
    setFraming(k) { view.offset = k; },
    setZoom(z) { view.zoom = z; if (renderer) resize(); },
    reset() { Object.keys(pieces).forEach(disposePiece); clearList(hlObjs); clearList(intentObjs); },
    // test hook: screen position of a cell, for automated play-testing
    _cellToScreen(x, y) {
      const v = new THREE.Vector3(wx(x), tileTop(x, y) + 0.05, wz(y)).project(camera);
      const r = renderer.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    }
  };
})();
