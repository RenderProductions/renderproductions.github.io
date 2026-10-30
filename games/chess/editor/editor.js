/* Iso-Chess arena editor.
   Paint an arena top-down in 2D; the same 3D renderer the game uses shows it
   live beside the grid. Saves arena JSON files (format in ../arena.js). */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const DRAFT_KEY = 'isochess_editor_draft';
  const TEST_KEY = 'isochess_test_arena';
  const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
  const TERRAIN = ['floor', 'raise', 'lower', 'wall', 'pit', 'void'];

  let A = null;              // the arena being edited
  let uid = 0;
  let tool = 'floor';
  let side = 'player';
  let painting = false;
  let strokeSeen = null;     // cells already painted in this drag (so Raise doesn't stack)
  const history = [];
  let previewOn = false;

  function store(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function withIds(a) { a.pieces.forEach((p) => { if (!p.id) p.id = ++uid; }); return a; }
  function snapshot() {
    history.push(Arena.serialize(A));
    if (history.length > 60) history.shift();
  }
  function undo() {
    const prev = history.pop();
    if (!prev) { toast('Nothing to undo.'); return; }
    A = withIds(Arena.parse(prev));
    render();
  }

  /* ---------- editing ---------- */
  const mirrorOn = () => $('mirror').checked;
  const pieceAt = (x, y) => A.pieces.find((p) => p.x === x && p.y === y);
  function removePiece(x, y) { A.pieces = A.pieces.filter((p) => !(p.x === x && p.y === y)); }

  function applyAt(x, y, t, s) {
    const tile = A.tiles[x][y];
    if (TERRAIN.includes(t)) {
      if (t === 'floor') { tile.kind = 'floor'; tile.h = 0; }
      else if (t === 'raise') { if (tile.kind !== 'floor') { tile.kind = 'floor'; tile.h = 0; } else tile.h = Math.min(Arena.MAX_HEIGHT, tile.h + 1); }
      else if (t === 'lower') { if (tile.kind === 'floor') tile.h = Math.max(0, tile.h - 1); }
      else { tile.kind = t; tile.h = 0; removePiece(x, y); }   // nothing stands on walls, pits or void
      return;
    }
    if (t === 'erase') { removePiece(x, y); return; }
    // placing a piece; a king replaces that side's other king
    if (t === 'K') A.pieces = A.pieces.filter((p) => !(p.side === s && p.type === 'K'));
    removePiece(x, y);
    if (tile.kind !== 'floor') { tile.kind = 'floor'; tile.h = 0; }
    A.pieces.push({ id: ++uid, side: s, type: t, x, y });
  }

  function paint(x, y) {
    const k = x + ',' + y;
    if (strokeSeen && strokeSeen.has(k)) return;
    if (strokeSeen) strokeSeen.add(k);
    applyAt(x, y, tool, side);
    if (mirrorOn()) {
      const my = A.h - 1 - y;
      if (my !== y) {
        const mk = x + ',' + my;
        if (!strokeSeen || !strokeSeen.has(mk)) {
          if (strokeSeen) strokeSeen.add(mk);
          applyAt(x, my, tool, side === 'player' ? 'enemy' : 'player');
        }
      }
    }
    render();
  }

  function setSize(w, h) {
    snapshot();
    A = withIds(Arena.resize(A, w, h));
    render();
  }

  /* ---------- drawing the 2D grid ---------- */
  function renderGrid() {
    const g = $('grid');
    const avail = Math.min(g.parentElement.clientWidth - 24, window.innerHeight - 190);
    const cell = Math.max(26, Math.min(58, Math.floor(avail / Math.max(A.w, A.h))));
    g.style.setProperty('--cell', cell + 'px');
    g.style.gridTemplateColumns = `repeat(${A.w}, var(--cell))`;
    let html = '';
    for (let y = A.h - 1; y >= 0; y--) {
      for (let x = 0; x < A.w; x++) {
        const t = A.tiles[x][y];
        const p = pieceAt(x, y);
        const cls = ['cell', t.kind];
        if (t.kind === 'floor') cls.push((x + y) % 2 ? 'light' : 'dark', 'h' + t.h);
        html += `<div class="${cls.join(' ')}" data-x="${x}" data-y="${y}">` +
          (t.kind === 'floor' && t.h ? `<span class="lvl">${t.h}</span>` : '') +
          (p ? `<span class="pc ${p.side}">${GLYPH[p.type]}</span>` : '') +
          '</div>';
      }
    }
    g.innerHTML = html;
  }

  function render() {
    renderGrid();
    $('name').value = A.name;
    $('w').textContent = A.w;
    $('h').textContent = A.h;
    $('intents').value = String(A.intents);
    const probs = Arena.validate(A);
    const counts = ['player', 'enemy'].map((s) => A.pieces.filter((p) => p.side === s).length);
    $('problems').innerHTML = (probs.length
      ? probs.map((p) => `<li class="bad">${p}</li>`).join('')
      : '<li class="good">Ready to play.</li>') +
      `<li class="quiet">Your pieces: ${counts[0]} &middot; Enemy pieces: ${counts[1]}</li>`;
    $('test').disabled = probs.length > 0;
    $('test').title = probs.length ? 'Fix the checks first' : 'Play this arena in a new tab';
    if (previewOn) Board3D.sync({ w: A.w, h: A.h, tiles: A.tiles, pieces: A.pieces, lockPiece: null });
    store(DRAFT_KEY, Arena.serialize(A));
  }

  function selectTool(t) {
    tool = t;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
  }
  function selectSide(s) {
    side = s;
    document.querySelectorAll('.side-btn').forEach((b) => b.classList.toggle('on', b.dataset.side === s));
    document.querySelector('.piece-tools').dataset.side = s;
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const slug = (s) => (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'arena');

  /* ---------- wiring ---------- */
  function cellFromEvent(e) {
    const el = e.target.closest && e.target.closest('.cell');
    return el ? { x: +el.dataset.x, y: +el.dataset.y } : null;
  }
  function wire() {
    const g = $('grid');
    g.addEventListener('contextmenu', (e) => e.preventDefault());
    g.addEventListener('pointerdown', (e) => {
      const c = cellFromEvent(e);
      if (!c) return;
      e.preventDefault();
      snapshot();
      if (e.button === 2) {
        removePiece(c.x, c.y);
        if (mirrorOn()) removePiece(c.x, A.h - 1 - c.y);
        render();
        return;
      }
      painting = true;
      strokeSeen = new Set();
      paint(c.x, c.y);
    });
    // elementFromPoint keeps drag-painting working on touch screens,
    // where the pointer stays captured by the first cell
    g.addEventListener('pointermove', (e) => {
      if (!painting) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const c = el && cellFromEvent({ target: el });
      if (c) paint(c.x, c.y);
    });
    window.addEventListener('pointerup', () => { painting = false; strokeSeen = null; });

    document.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.tool)));
    document.querySelectorAll('.side-btn').forEach((b) => b.addEventListener('click', () => selectSide(b.dataset.side)));
    document.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
      const [dim, d] = [b.dataset.size[0], +b.dataset.size.slice(1)];
      setSize(dim === 'w' ? A.w + d : A.w, dim === 'h' ? A.h + d : A.h);
    }));
    $('name').addEventListener('input', (e) => { A.name = e.target.value || 'Untitled arena'; store(DRAFT_KEY, Arena.serialize(A)); });
    $('name').addEventListener('change', () => snapshot());
    $('intents').addEventListener('change', (e) => { snapshot(); A.intents = +e.target.value; render(); });
    $('undo').addEventListener('click', undo);
    $('new').addEventListener('click', () => {
      if (!confirm('Start a new empty 8 x 8 arena? (Undo can bring this one back.)')) return;
      snapshot(); A = Arena.blank(8, 8); render();
    });
    $('open').addEventListener('change', async (e) => {
      const f = e.target.files[0]; e.target.value = '';
      if (!f) return;
      try { snapshot(); A = withIds(Arena.parse(await f.text())); render(); toast(`Opened ${f.name}.`); }
      catch (err) { toast('Could not open that file: ' + err.message); }
    });
    $('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(Arena.serialize(A)); toast('Arena JSON copied.'); }
      catch (e) { toast('Copy was blocked by the browser. Use Save file instead.'); }
    });
    $('save').addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([Arena.serialize(A)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = slug(A.name) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Saved ${slug(A.name)}.json`);
    });
    $('test').addEventListener('click', () => {
      if (!store(TEST_KEY, Arena.serialize(A))) { toast('Browser storage is blocked, so Test play cannot hand the arena over.'); return; }
      window.open('../?test=1', '_blank');
    });
    $('builtin').addEventListener('change', async (e) => {
      const file = e.target.value; e.target.value = '';
      if (!file) return;
      try {
        const text = await (await fetch('../arenas/' + file, { cache: 'no-store' })).text();
        snapshot(); A = withIds(Arena.parse(text)); render(); toast('Loaded ' + A.name + '.');
      } catch (err) { toast('Could not load that arena.'); }
    });
    $('rot-l').addEventListener('click', () => previewOn && Board3D.rotate(-1));
    $('rot-r').addEventListener('click', () => previewOn && Board3D.rotate(1));
    window.addEventListener('keydown', (e) => {
      if (e.target.closest('input,select,textarea')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
      else if (e.key === 'q' || e.key === 'Q') previewOn && Board3D.rotate(-1);
      else if (e.key === 'e' || e.key === 'E') previewOn && Board3D.rotate(1);
    });
    window.addEventListener('resize', renderGrid);
  }

  async function fillBuiltins() {
    try {
      const list = (await (await fetch('../arenas/index.json', { cache: 'no-store' })).json()).arenas || [];
      $('builtin').insertAdjacentHTML('beforeend', list.map((a) => `<option value="${a.file}">${a.name}</option>`).join(''));
    } catch (e) { /* offline or opened from disk: the list stays empty */ }
  }

  function startPreview() {
    try {
      const c = document.createElement('canvas');
      if (!window.THREE || !(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
      Board3D.init($('preview'), {
        cell(x, y) { if (x < 0) return; snapshot(); strokeSeen = null; paint(x, y); },
        hover() {}, cancel() {}
      });
      Board3D.setFraming(0);
      Board3D.setZoom(1.5);
      previewOn = true;
    } catch (e) {
      $('preview').innerHTML = '<p class="hint">The 3D preview needs WebGL.</p>';
    }
  }

  /* ---------- start ---------- */
  const draft = load(DRAFT_KEY);
  try { A = Arena.parse(draft); } catch (e) { A = null; }
  if (!A) {
    A = Arena.blank(8, 8);
    A.pieces = [{ side: 'player', type: 'K', x: 4, y: 0 }, { side: 'enemy', type: 'K', x: 4, y: 7 }];
  }
  withIds(A);
  wire();
  selectTool('floor');
  selectSide('player');
  startPreview();
  fillBuiltins();
  render();

  window.ArenaEditor = { get arena() { return A; }, paint: (x, y) => { snapshot(); strokeSeen = null; paint(x, y); }, selectTool, selectSide };
})();
