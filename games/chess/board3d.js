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
  let theme = THEMES.free, fireOn = false;
  const lights = {};
  const fx = { fires: [], embers: null, emberData: [], glow: [], motes: null, rocks: [] };   // your army's colors (piece skins)
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
  const view = { rot: 0, cur: 0, zoom: 1, px: 0, pz: 0 };   // px/pz: panned offset

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
    const el = Math.atan(1 / Math.SQRT2);  // true isometric elevation
    const d = 30;
    camera.position.set(d * Math.cos(el) * Math.sin(th), d * Math.sin(el), d * Math.cos(el) * Math.cos(th));
    // aim a little toward the viewer and right, so the board sits
    // above the hand of cards and left of the side panel
    const f = Math.max(W, H) / 8;
    const side = host.clientWidth < 560 ? 0 : 0.7 * f * (view.offset === undefined ? 1 : view.offset);   // no side panel on phones
    const down = 0.75 * f * (view.offset === undefined ? 1 : view.offset);
    const tx = down * Math.sin(th) + side * Math.cos(th) + view.px, tz = down * Math.cos(th) - side * Math.sin(th) + view.pz;
    camera.position.x += tx; camera.position.z += tz;
    camera.lookAt(tx, -0.6, tz);
  }

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
    fx.fires = []; fx.glow = []; fx.embers = null; fx.motes = null; fx.rocks = []; fx.emberData = [];
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
        [[0xff3d00, 0.34, 1.05, 0.55], [0xff8a1d, 0.25, 0.9, 0.7], [0xffd34d, 0.14, 0.62, 0.85]].forEach(([color, r, h, op], k) => {
          for (let j = 0; j < (k === 2 ? 1 : 3); j++) {
            const m = new THREE.Mesh(flameGeo(r, h), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: add, depthWrite: false, side: THREE.DoubleSide }));
            const a = (j / 3) * Math.PI * 2 + i;
            if (k < 2) m.position.set(Math.cos(a) * 0.14, 0, Math.sin(a) * 0.14);
            m.userData = { phase: Math.random() * 6.28, speed: 5 + Math.random() * 4, h, op };
            m.renderOrder = 2;
            group.add(m); flames.push(m);
          }
        });
        // a glow on the pit floor
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshBasicMaterial({ color: 0xff5a1a, transparent: true, opacity: 0.55, blending: add, depthWrite: false }));
        glow.rotation.x = -Math.PI / 2; glow.position.y = 0.01; group.add(glow);
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
    // dust (or ash) hanging in the air over the board
    const m = 90, mp = new Float32Array(m * 3);
    for (let i = 0; i < m; i++) { mp[i * 3] = (Math.random() - 0.5) * (W + 6); mp[i * 3 + 1] = Math.random() * 4 - 0.5; mp[i * 3 + 2] = (Math.random() - 0.5) * (H + 6); }
    const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    fx.motes = new THREE.Points(mg, new THREE.PointsMaterial({ color: theme.mote, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.35, blending: add, depthWrite: false }));
    scene.add(fx.motes);
    // broken pieces of the kingdom, drifting below and around the board
    const R = Math.max(W, H) / 2;
    for (let i = 0; i < 12; i++) {
      const g = new THREE.DodecahedronGeometry(0.25 + Math.random() * 0.55, 0);
      const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: theme.rock, roughness: 0.9, flatShading: true }));
      const line = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: theme.edge }));
      const a = Math.random() * Math.PI * 2, d = R + 1.5 + Math.random() * 4;
      const base = new THREE.Vector3(Math.cos(a) * d, -2.5 - Math.random() * 3, Math.sin(a) * d);
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
      f.glow.material.opacity = 0.45 + Math.sin(t * 7) * 0.1;
    });
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
    fx.rocks.forEach((r) => {
      const y = r.base.y + Math.sin(t * 0.5 + r.phase) * 0.25;
      r.mesh.position.y = y; r.line.position.y = y;
      r.mesh.rotation.y += r.spin; r.mesh.rotation.x += r.spin * 0.5; r.line.rotation.copy(r.mesh.rotation);
    });
  }
  function setTheme(name, fire) {
    theme = THEMES[name] || THEMES.free; fireOn = !!fire;
    if (renderer) renderer.setClearColor(theme.bg, 1);
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
  function animateCapture(pid) {
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
    sync, setHighlights, setIntents, animateMove, animateCapture, animateFizzle,
    setSkin(color, edge) { skin = { color, edge }; Object.keys(pieces).forEach(disposePiece); },
    setTheme,
    rotate(dir) { view.rot += (dir * Math.PI) / 2; },
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
