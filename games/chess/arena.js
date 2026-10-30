/* Iso-Chess arena files: shared by the game and the arena editor.

   An arena is a small JSON file, written so it can also be read and edited by hand:

   {
     "v": 1,
     "name": "Opening Skirmish",
     "intents": 2,                 // enemy moves telegraphed per turn
     "grid": [                     // top row = the enemy's back rank,
       "..______..",               // bottom row = yours. Every row is the same length.
       ...
     ],
     "pieces": [ {"side": "player", "type": "K", "x": 4, "y": 0}, ... ]
   }

   Grid characters (one per tile):
     .        floor
     1 2 3    raised floor, that many levels up (any height gives +1 range)
     #        wall: blocks movement and lines
     o        pit: a hole; nothing can stand in it, things shoved in are lost
     _        void: no tile at all, for odd-shaped arenas (a space works too)

   Coordinates: x = column from the left, y = row counted from YOUR side (bottom = 0). */
(function () {
  'use strict';

  const MIN = 4, MAX = 24, MAX_HEIGHT = 3;
  const TYPES = ['K', 'Q', 'R', 'B', 'N', 'P'];
  const NAMES = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };

  function tileFromChar(c) {
    if (c === '#') return { kind: 'wall', h: 0 };
    if (c === 'o' || c === 'O') return { kind: 'pit', h: 0 };
    if (c === '_' || c === ' ') return { kind: 'void', h: 0 };
    if (c >= '1' && c <= String(MAX_HEIGHT)) return { kind: 'floor', h: +c };
    return { kind: 'floor', h: 0 };
  }
  function charFromTile(t) {
    if (t.kind === 'wall') return '#';
    if (t.kind === 'pit') return 'o';
    if (t.kind === 'void') return '_';
    return t.h > 0 ? String(Math.min(MAX_HEIGHT, t.h)) : '.';
  }

  // JSON text -> arena object {name, intents, w, h, tiles[x][y], pieces[]}
  function parse(src) {
    const d = typeof src === 'string' ? JSON.parse(src) : src;
    if (!d || !Array.isArray(d.grid) || !d.grid.length) throw new Error('Arena has no grid.');
    const h = d.grid.length;
    const w = Math.max(...d.grid.map((r) => String(r).length));
    if (w < MIN || h < MIN || w > MAX || h > MAX) throw new Error(`Arena must be between ${MIN} and ${MAX} tiles on each side.`);
    const tiles = [];
    for (let x = 0; x < w; x++) {
      tiles[x] = [];
      for (let y = 0; y < h; y++) {
        const row = String(d.grid[h - 1 - y]);           // first row in the file is the far side
        tiles[x][y] = tileFromChar(row[x] === undefined ? '_' : row[x]);
      }
    }
    const pieces = (d.pieces || []).map((p) => ({
      side: p.side === 'enemy' ? 'enemy' : 'player',
      type: TYPES.includes(String(p.type).toUpperCase()) ? String(p.type).toUpperCase() : 'P',
      x: p.x | 0, y: p.y | 0
    })).filter((p) => p.x >= 0 && p.y >= 0 && p.x < w && p.y < h);
    return {
      name: String(d.name || 'Untitled arena').slice(0, 40),
      intents: Math.max(1, Math.min(4, d.intents | 0 || 2)),
      w, h, tiles, pieces
    };
  }

  // arena object -> pretty JSON text (one piece per line so diffs stay readable)
  function serialize(a) {
    const grid = [];
    for (let y = a.h - 1; y >= 0; y--) {
      let row = '';
      for (let x = 0; x < a.w; x++) row += charFromTile(a.tiles[x][y]);
      grid.push(row);
    }
    const pieces = a.pieces.slice().sort((p, q) => (p.side === q.side ? 0 : p.side === 'player' ? -1 : 1) || p.y - q.y || p.x - q.x);
    return '{\n' +
      `  "v": 1,\n  "name": ${JSON.stringify(a.name)},\n  "intents": ${a.intents},\n` +
      '  "grid": [\n' + grid.map((r) => '    ' + JSON.stringify(r)).join(',\n') + '\n  ],\n' +
      '  "pieces": [\n' + pieces.map((p) => `    {"side": "${p.side}", "type": "${p.type}", "x": ${p.x}, "y": ${p.y}}`).join(',\n') + '\n  ]\n}\n';
  }

  function blank(w, h) {
    const tiles = [];
    for (let x = 0; x < w; x++) { tiles[x] = []; for (let y = 0; y < h; y++) tiles[x][y] = { kind: 'floor', h: 0 }; }
    return { name: 'Untitled arena', intents: 2, w, h, tiles, pieces: [] };
  }

  // Grow or shrink, keeping what fits (anchored bottom-left, so your side stays put).
  function resize(a, w, h) {
    w = Math.max(MIN, Math.min(MAX, w)); h = Math.max(MIN, Math.min(MAX, h));
    const b = blank(w, h);
    b.name = a.name; b.intents = a.intents;
    for (let x = 0; x < Math.min(w, a.w); x++) for (let y = 0; y < Math.min(h, a.h); y++) b.tiles[x][y] = { ...a.tiles[x][y] };
    b.pieces = a.pieces.filter((p) => p.x < w && p.y < h).map((p) => ({ ...p }));
    return b;
  }

  // Problems that would stop the arena from being playable.
  function validate(a) {
    const out = [];
    ['player', 'enemy'].forEach((side) => {
      const kings = a.pieces.filter((p) => p.side === side && p.type === 'K').length;
      const who = side === 'player' ? 'Your side' : 'The enemy';
      if (kings === 0) out.push(`${who} needs a King.`);
      if (kings > 1) out.push(`${who} has ${kings} Kings; use exactly one.`);
    });
    a.pieces.forEach((p) => {
      const t = a.tiles[p.x][p.y];
      if (t.kind !== 'floor') out.push(`A ${p.side === 'player' ? 'your' : 'enemy'} ${NAMES[p.type]} is standing on a ${t.kind}.`);
    });
    const seen = new Set();
    a.pieces.forEach((p) => { const k = p.x + ',' + p.y; if (seen.has(k)) out.push(`Two pieces share tile ${k}.`); seen.add(k); });
    return out;
  }

  window.Arena = { parse, serialize, blank, resize, validate, MIN, MAX, MAX_HEIGHT, TYPES, NAMES, tileFromChar, charFromTile };
})();
