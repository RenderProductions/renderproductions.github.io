/* Iso-Chess: one battle (prototype).
   Rules, turn loop, enemy telegraphs and power cards. Board3D draws it.

   How a round works:
   1. The enemy shows what it is about to do (red arcs), a few moves per turn.
   2. Your turn: gain energy, draw a card, play cards, make one move.
   3. The enemy carries out its telegraphed moves, if they are still legal.
      Dodge, block, shield or capture the attacker to stop them.
   Capture the enemy King to win. Lose your King and the battle is over.

   The board and both armies come from an arena file (see arena.js and arenas/).
   Arenas are designed in the 2D editor at editor/. */
(function () {
  'use strict';

  const MAX_ENERGY = 5;
  const HAND_SIZE = 3;
  const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100 };
  const NAME = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King' };

  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = (x, y) => x + ',' + y;
  const inB = (x, y) => x >= 0 && y >= 0 && x < S.w && y < S.h;
  // a tile a piece can stand on (not a wall, pit, void, or off the board)
  const open = (x, y) => inB(x, y) && S.tiles[x][y].kind === 'floor';
  const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  let S = null;
  let uid = 0;
  let hoverCell = null;

  /* ---------- board helpers ---------- */
  const at = (x, y) => S.pieces.find((p) => p.x === x && p.y === y) || null;
  const byId = (id) => S.pieces.find((p) => p.id === id) || null;
  const kingOf = (side) => S.pieces.find((p) => p.side === side && p.type === 'K') || null;
  const own = (p) => p && p.side === 'player';
  const foe = (p) => p && p.side === 'enemy';
  const tileAt = (x, y) => (inB(x, y) ? S.tiles[x][y] : null);

  function add(side, type, x, y) {
    const p = { id: ++uid, side, type, x, y, moved: false, shield: false, fortify: false, frozen: false };
    S.pieces.push(p);
    return p;
  }

  function capturable(att, def) {
    if (def.shield && def.side !== att.side) return false;
    if (def.fortify && att.type === 'P') return false;
    return true;
  }

  const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const ALL8 = DIAG.concat(ORTH);
  const JUMPS = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

  // Legal moves for a piece. attack=true lists squares it threatens instead
  // (used by the enemy so it doesn't walk into captures).
  function movesFor(p, attack) {
    const out = [];
    const boost = S.tiles[p.x][p.y].h > 0 ? 1 : 0;   // high ground: +1 range
    const far = Math.max(S.w, S.h);
    const land = (x, y) => {
      if (!open(x, y)) return;
      const o = at(x, y);
      if (attack) { out.push({ x, y, capture: o && o.side !== p.side ? o : null }); return; }
      if (!o) out.push({ x, y, capture: null });
      else if (o.side !== p.side && capturable(p, o)) out.push({ x, y, capture: o });
    };
    const ray = (dx, dy, max) => {
      let x = p.x, y = p.y;
      for (let i = 0; i < max; i++) {
        x += dx; y += dy;
        if (!open(x, y)) return;   // walls, pits and gaps block lines
        const o = at(x, y);
        if (o) { land(x, y); return; }
        land(x, y);
      }
    };
    switch (p.type) {
      case 'K': ALL8.forEach(([dx, dy]) => ray(dx, dy, 1 + boost)); break;
      case 'N': JUMPS.forEach(([dx, dy]) => land(p.x + dx, p.y + dy)); break;
      case 'B': DIAG.forEach(([dx, dy]) => ray(dx, dy, far)); break;
      case 'R': ORTH.forEach(([dx, dy]) => ray(dx, dy, far)); break;
      case 'Q': ALL8.forEach(([dx, dy]) => ray(dx, dy, far)); break;
      case 'P': {
        const f = p.side === 'player' ? 1 : -1;
        if (!attack) {
          const steps = Math.max(p.moved ? 1 : 2, 1 + boost);
          for (let i = 1; i <= steps; i++) {
            const y = p.y + f * i;
            if (!open(p.x, y) || at(p.x, y)) break;
            out.push({ x: p.x, y, capture: null });
          }
        }
        [-1, 1].forEach((dx) => {
          const x = p.x + dx, y = p.y + f;
          if (!open(x, y)) return;
          const o = at(x, y);
          if (attack) out.push({ x, y, capture: o && o.side !== p.side ? o : null });
          else if (o && o.side !== p.side && capturable(p, o)) out.push({ x, y, capture: o });
        });
        break;
      }
    }
    return out;
  }
  function threatened(side) {
    const set = new Set();
    S.pieces.filter((p) => p.side === side).forEach((p) => movesFor(p, true).forEach((m) => set.add(key(m.x, m.y))));
    return set;
  }

  /* ---------- battle setup ---------- */
  let arena = null;          // the arena being played (from arena.js)

  function newBattle() {
    uid = 0;
    S = {
      w: arena.w, h: arena.h, intentCount: arena.intents,
      pieces: [], tiles: [], turn: 0, energy: 1, hand: [], draw: [], intents: [],
      phase: 'player', movesLeft: 1, lockPiece: null, movedThisTurn: false,
      selected: null, targeting: null, busy: false, over: false, fallen: [], log: []
    };
    S.tiles = arena.tiles.map((col) => col.map((t) => ({ kind: t.kind, h: t.h })));
    arena.pieces.forEach((p) => add(p.side, p.type, p.x, p.y));

    // every power goes into one shuffled draw pile; played cards are used up
    S.draw = shuffle(POWERS.map((c) => c.id));

    Board3D.reset();
    $('overlay').hidden = true;
    S.log = [];
    say(`${arena.name}. Red arcs show what the enemy will do after your move.`);
    planIntents();
    startPlayerTurn();
  }

  /* ---------- turn flow ---------- */
  function startPlayerTurn() {
    S.turn++;
    S.phase = 'player';
    S.energy = Math.min(MAX_ENERGY, S.energy + 1);
    const draws = S.turn === 1 ? HAND_SIZE : 1;
    for (let i = 0; i < draws && S.hand.length < HAND_SIZE && S.draw.length; i++) S.hand.push(S.draw.shift());
    S.movesLeft = 1; S.lockPiece = null; S.movedThisTurn = false;
    refresh();
  }

  async function endPlayerTurn() {
    if (S.over || S.phase !== 'player' || S.busy) return;
    S.phase = 'enemy'; S.selected = null; S.targeting = null; S.lockPiece = null;
    refresh();
    await sleep(280);
    await runIntents();
    if (S.over) return;
    S.pieces.forEach((p) => { if (p.side === 'player') p.shield = false; else p.frozen = false; });
    Board3D.sync(S);
    await sleep(150);
    planIntents();
    startPlayerTurn();
  }

  async function runIntents() {
    const list = S.intents.slice();
    S.intents = [];
    for (let n = 0; n < list.length; n++) {
      const it = list[n];
      const p = byId(it.pid);
      if (!p) continue;
      // the arc being carried out disappears; the rest stay on screen
      Board3D.setIntents(list.slice(n + 1).filter((i) => byId(i.pid)).map(drawable));
      if (p.frozen) { say(`Enemy ${NAME[p.type]} is frozen and can't move.`); await Board3D.animateFizzle(p.id); continue; }
      const m = movesFor(p).find((q) => q.x === it.x && q.y === it.y);
      if (!m) {
        const o = at(it.x, it.y);
        say(o && o.shield ? `Your shield stopped the enemy ${NAME[p.type]}.` : `Enemy ${NAME[p.type]} couldn't follow through.`);
        await Board3D.animateFizzle(p.id);
        continue;
      }
      await doMove(p, m);
      if (S.over) return;
      await sleep(120);
    }
    Board3D.setIntents([]);
  }

  async function doMove(p, m) {
    S.busy = true;
    await Board3D.animateMove(p.id, m.x, m.y);
    if (m.capture) await capture(m.capture, p);
    p.x = m.x; p.y = m.y; p.moved = true;
    promote(p);
    S.busy = false;
    Board3D.sync(S);
    if (!S.over) checkKings();
  }

  async function capture(victim, by) {
    const cap = Board3D.animateCapture(victim.id);
    S.pieces = S.pieces.filter((q) => q !== victim);
    S.intents = S.intents.filter((i) => i.pid !== victim.id);
    if (victim.side === 'player') {
      if (victim.type !== 'K') S.fallen.push(victim.type);
      say(by ? `Enemy ${NAME[by.type]} took your ${NAME[victim.type]}.` : `Your ${NAME[victim.type]} was lost.`);
    } else {
      if (by && by.side === 'player') S.energy = Math.min(MAX_ENERGY, S.energy + 1);
      say(by ? `Your ${NAME[by.type]} took the enemy ${NAME[victim.type]}. +1 energy.` : `Enemy ${NAME[victim.type]} fell and was lost.`);
    }
    await cap;
  }

  function promote(p) {
    if (p.type !== 'P') return;
    if ((p.side === 'player' && p.y === S.h - 1) || (p.side === 'enemy' && p.y === 0)) {
      p.type = 'Q';
      say(p.side === 'player' ? 'Your Pawn promoted to a Queen.' : 'An enemy Pawn promoted to a Queen.');
    }
  }

  function checkKings() {
    if (!kingOf('enemy')) return endBattle(true);
    if (!kingOf('player')) return endBattle(false);
  }
  function endBattle(won) {
    S.over = true; S.phase = 'over'; S.targeting = null; S.selected = null;
    Board3D.setIntents([]);
    refresh();
    setTimeout(() => {
      $('overlay-title').textContent = won ? 'VICTORY' : 'DEFEAT';
      $('overlay-text').textContent = won
        ? `The enemy King has fallen in ${S.turn} turn${S.turn === 1 ? '' : 's'}.`
        : 'Your King has fallen. In a full run, this would end it.';
      $('overlay').className = won ? 'overlay win' : 'overlay lose';
      $('overlay').hidden = false;
    }, 500);
  }

  /* ---------- enemy planning ---------- */
  function planIntents() {
    S.intents = [];
    const danger = threatened('player');
    const pk = kingOf('player');
    const cands = [];
    S.pieces.filter(foe).forEach((e) => {
      let best = null;
      const inDanger = danger.has(key(e.x, e.y));
      movesFor(e).forEach((m) => {
        let s = Math.random() * 1.5;
        const unsafe = danger.has(key(m.x, m.y));
        if (m.capture) s += VALUE[m.capture.type] * 10;
        if (e.type === 'K') {
          if (inDanger && !unsafe) s += 400;
          else if (!inDanger) s -= 60;
          if (unsafe) s -= 500;
        } else {
          if (unsafe) s -= VALUE[e.type] * 6;
          if (inDanger && !unsafe) s += VALUE[e.type] * 4;   // step out of danger
          if (pk) s += (cheb(e, pk) - Math.max(Math.abs(m.x - pk.x), Math.abs(m.y - pk.y))) * 2;
          if (e.type === 'P') s += 0.5;
        }
        if (!best || s > best.s) best = { pid: e.id, x: m.x, y: m.y, s, capture: !!m.capture };
      });
      if (best && best.s > -30) cands.push(best);
    });
    cands.sort((a, b) => b.s - a.s);
    const used = new Set();
    for (const c of cands) {
      if (S.intents.length >= S.intentCount) break;
      if (used.has(key(c.x, c.y))) continue;
      used.add(key(c.x, c.y));
      S.intents.push(c);
    }
  }
  function drawable(it) {
    const p = byId(it.pid);
    const tgt = at(it.x, it.y);
    return { fx: p.x, fy: p.y, tx: it.x, ty: it.y, type: p.type, capture: !!(tgt && tgt.side === 'player') };
  }

  /* ---------- power cards ---------- */
  const adjacentToOwn = (e) => S.pieces.some((p) => own(p) && p !== e && cheb(p, e) === 1);
  const shoveDest = (e) => ({ x: e.x, y: e.y + 1 });   // "back" = toward the enemy's side

  const POWERS = [
    { id: 'swap', name: 'Swap', file: 'Swap', cost: 1, text: 'Two of your pieces trade places.',
      targets: [
        { kind: 'piece', prompt: 'Pick one of your pieces to swap.', ok: (t) => own(t) },
        { kind: 'piece', prompt: 'Pick the piece it trades places with.', ok: (t, k) => own(t) && t !== k[0] }],
      async apply([a, b]) {
        const ax = a.x, ay = a.y;
        await Promise.all([Board3D.animateMove(a.id, b.x, b.y), Board3D.animateMove(b.id, ax, ay)]);
        a.x = b.x; a.y = b.y; b.x = ax; b.y = ay;
        promote(a); promote(b);
      } },
    { id: 'haste', name: 'Haste', file: 'Haste', cost: 3, text: 'One piece moves twice this turn.',
      playable: () => S.movedThisTurn ? 'Play Haste before you move.' : '',
      targets: [{ kind: 'piece', prompt: 'Pick the piece that moves twice.', ok: (t) => own(t) }],
      apply([p]) { S.lockPiece = p.id; S.movesLeft = 2; S.selected = p.id; } },
    { id: 'shield', name: 'Shield', file: 'Shield', cost: 2, text: "One piece can't be captured until your next turn.",
      targets: [{ kind: 'piece', prompt: 'Pick a piece to shield.', ok: (t) => own(t) && !t.shield }],
      apply([p]) { p.shield = true; } },
    { id: 'fortify', name: 'Fortify', file: 'Fortify', cost: 2, text: 'One piece is immune to pawns for the rest of the battle.',
      targets: [{ kind: 'piece', prompt: 'Pick a piece to fortify.', ok: (t) => own(t) && !t.fortify }],
      apply([p]) { p.fortify = true; } },
    { id: 'raise', name: 'Raise Ground', file: 'RaiseGround', cost: 2, text: 'Lift a tile. A piece on it gains +1 range while it stays there.',
      targets: [{ kind: 'tile', prompt: 'Pick a tile to raise.', ok: (t) => open(t.x, t.y) && S.tiles[t.x][t.y].h < Arena.MAX_HEIGHT }],
      apply([t]) { S.tiles[t.x][t.y].h += 1; } },
    { id: 'collapse', name: 'Collapse', file: 'Collapse', cost: 3, text: 'Turn an empty tile into a pit. Anything that enters it is lost.',
      targets: [{ kind: 'tile', prompt: 'Pick an empty tile to collapse.', ok: (t) => open(t.x, t.y) && !at(t.x, t.y) }],
      apply([t]) { S.tiles[t.x][t.y] = { kind: 'pit', h: 0 }; } },
    { id: 'freeze', name: 'Freeze', file: 'Freeze', cost: 2, text: "An enemy piece can't move on its next turn.",
      targets: [{ kind: 'piece', prompt: 'Pick an enemy piece to freeze.', ok: (t) => foe(t) && !t.frozen }],
      apply([p]) { p.frozen = true; S.intents = S.intents.filter((i) => i.pid !== p.id); } },
    { id: 'shove', name: 'Shove', file: 'Shove', cost: 1, text: 'Push an enemy next to one of your pieces back one square.',
      targets: [{ kind: 'piece', prompt: 'Pick an enemy next to one of your pieces.',
        ok: (t) => {
          if (!foe(t) || !adjacentToOwn(t)) return false;
          const d = shoveDest(t), tile = tileAt(d.x, d.y);
          return !(tile && tile.kind === 'wall') && !at(d.x, d.y);   // walls and pieces stop a shove
        } }],
      async apply([p]) {
        const d = shoveDest(p);
        await Board3D.animateMove(p.id, d.x, d.y);
        p.x = d.x; p.y = d.y;
        // shoved into a pit, or off the edge of the arena
        if (!open(d.x, d.y)) { await capture(p, null); checkKings(); }
      } },
    { id: 'martyr', name: 'Martyr', file: 'Martyr', cost: 1, text: 'Sacrifice a pawn to revive a captured piece next to your king.',
      playable: () => !S.fallen.length ? 'None of your pieces have fallen yet.'
        : !S.pieces.some((p) => own(p) && p.type === 'P') ? 'You have no pawn to sacrifice.' : '',
      targets: [
        { kind: 'piece', prompt: 'Pick a pawn to sacrifice.', ok: (t) => own(t) && t.type === 'P' },
        { kind: 'tile', prompt: 'Pick an empty tile next to your King.',
          ok: (t) => { const k = kingOf('player'); return k && cheb(k, t) === 1 && !at(t.x, t.y) && open(t.x, t.y); } }],
      async apply([pawn, t]) {
        await Board3D.animateCapture(pawn.id);
        S.pieces = S.pieces.filter((q) => q !== pawn);
        const best = S.fallen.slice().sort((a, b) => VALUE[b] - VALUE[a])[0];
        S.fallen.splice(S.fallen.indexOf(best), 1);
        const p = add('player', best, t.x, t.y); p.moved = true;
        say(`Your ${NAME[best]} returns.`);
      } },
    { id: 'bloodline', name: 'Bloodline', file: 'Bloodline', cost: 2, text: 'Sacrifice a piece. A pawn of yours promotes on the spot.',
      playable: () => !S.pieces.some((p) => own(p) && p.type === 'P') ? 'You have no pawn to promote.' : '',
      targets: [
        { kind: 'piece', prompt: 'Pick a piece to sacrifice (not your King).', ok: (t) => own(t) && t.type !== 'K' },
        { kind: 'piece', prompt: 'Pick the pawn that promotes.', ok: (t, k) => own(t) && t.type === 'P' && t !== k[0] }],
      async apply([gone, pawn]) {
        await Board3D.animateCapture(gone.id);
        S.pieces = S.pieces.filter((q) => q !== gone);
        pawn.type = 'Q';
        say('Your Pawn rises as a Queen.');
      } }
  ];
  const CARD = Object.fromEntries(POWERS.map((c) => [c.id, c]));

  function playCard(id) {
    if (S.phase !== 'player' || S.busy || S.over) return;
    const c = CARD[id];
    if (S.targeting && S.targeting.card === c) { cancel(); return; }
    if (S.energy < c.cost) { say(`${c.name} needs ${c.cost} energy.`); flash('energy'); return; }
    const why = c.playable ? c.playable() : '';
    if (why) { say(why); return; }
    S.selected = null;
    S.targeting = { card: c, picks: [] };
    refresh();
  }
  function cancel() {
    if (S.targeting) { S.targeting = null; refresh(); return; }
    if (S.selected && !S.lockPiece) { S.selected = null; refresh(); }
  }
  function targetAt(spec, x, y) {
    if (!inB(x, y)) return null;
    return spec.kind === 'piece' ? at(x, y) : { x, y };
  }
  async function pickTarget(x, y) {
    const T = S.targeting, c = T.card;
    const spec = c.targets[T.picks.length];
    const t = targetAt(spec, x, y);
    if (!t || !spec.ok(t, T.picks)) { flash('prompt'); return; }
    T.picks.push(t);
    if (T.picks.length < c.targets.length) { refresh(); return; }
    // resolve: the card is paid for and used up
    S.energy -= c.cost;
    S.hand.splice(S.hand.indexOf(c.id), 1);
    S.targeting = null;
    S.busy = true;
    refresh();
    say(`Played ${c.name}.`);
    await c.apply(T.picks);
    S.busy = false;
    Board3D.sync(S);
    if (!S.over) checkKings();
    refresh();
  }

  /* ---------- clicks ---------- */
  async function onCell(x, y) {
    if (S.phase !== 'player' || S.busy || S.over) return;
    if (S.targeting) { if (x >= 0) pickTarget(x, y); return; }
    const sel = S.selected && byId(S.selected);
    if (sel && x >= 0) {
      const m = movesFor(sel).find((q) => q.x === x && q.y === y);
      if (m) { await playerMove(sel, m); return; }
    }
    const p = x >= 0 ? at(x, y) : null;
    if (own(p) && (!S.lockPiece || S.lockPiece === p.id)) S.selected = p.id === S.selected && !S.lockPiece ? null : p.id;
    else if (!S.lockPiece) S.selected = null;
    refresh();
  }
  async function playerMove(p, m) {
    S.selected = null;
    refresh();
    await doMove(p, m);
    if (S.over) return;
    S.movedThisTurn = true;
    S.movesLeft--;
    if (S.movesLeft > 0 && byId(p.id)) { S.selected = p.id; refresh(); return; }
    endPlayerTurn();
  }

  /* ---------- HUD ---------- */
  function say(t) {
    S.log.push(t);
    if (S.log.length > 7) S.log.shift();
    const el = $('log');
    if (el) el.innerHTML = S.log.map((l, i) => `<li class="${i === S.log.length - 1 ? 'new' : ''}">${l}</li>`).join('');
  }
  function flash(which) {
    const el = $(which);
    if (!el) return;
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
  }

  function refresh() {
    Board3D.sync(S);
    const hl = [];
    if (S.targeting) {
      const spec = S.targeting.card.targets[S.targeting.picks.length];
      S.targeting.picks.forEach((t) => hl.push({ x: t.x, y: t.y, kind: 'picked' }));
      for (let x = 0; x < S.w; x++) for (let y = 0; y < S.h; y++) {
        const t = targetAt(spec, x, y);
        if (t && spec.ok(t, S.targeting.picks)) hl.push({ x, y, kind: 'target' });
      }
    } else if (S.selected && byId(S.selected) && S.phase === 'player') {
      const p = byId(S.selected);
      hl.push({ x: p.x, y: p.y, kind: 'select' });
      movesFor(p).forEach((m) => hl.push({ x: m.x, y: m.y, kind: m.capture ? 'capture' : 'move' }));
    }
    if (hoverCell) hl.push({ x: hoverCell.x, y: hoverCell.y, kind: 'hover' });
    Board3D.setHighlights(hl);
    if (S.phase !== 'enemy') Board3D.setIntents(S.over ? [] : S.intents.filter((i) => byId(i.pid)).map(drawable));

    $('turn').textContent = S.turn;
    $('energy').innerHTML = Array.from({ length: MAX_ENERGY }, (_, i) => `<i class="pip${i < S.energy ? ' on' : ''}"></i>`).join('');
    $('pile').textContent = S.draw.length;
    $('end-turn').disabled = S.phase !== 'player' || S.busy || S.over;
    $('end-turn').textContent = S.movedThisTurn ? 'END TURN' : 'SKIP MOVE';
    document.body.classList.toggle('enemy-turn', S.phase === 'enemy');

    // hand
    $('hand').innerHTML = S.hand.map((id) => {
      const c = CARD[id];
      const poor = S.energy < c.cost || (c.playable && c.playable());
      const active = S.targeting && S.targeting.card === c;
      return `<button class="card${poor ? ' poor' : ''}${active ? ' active' : ''}" data-id="${id}" title="${c.name} (${c.cost} energy): ${c.text}">
        <img src="cards/powers/${c.file}.svg" alt="${c.name}: ${c.text} Costs ${c.cost} energy."></button>`;
    }).join('') || '<p class="empty-hand">No cards in hand.</p>';

    // prompt
    let prompt = '';
    if (S.phase === 'enemy') prompt = 'ENEMY TURN';
    else if (S.targeting) prompt = S.targeting.card.targets[S.targeting.picks.length].prompt + ' <span>Esc or right-click to cancel</span>';
    else if (S.lockPiece && S.movesLeft > 1) prompt = 'Haste: move the glowing piece again.';
    else if (S.lockPiece && S.movesLeft === 1 && S.movedThisTurn) prompt = 'Haste: one more move with that piece.';
    $('prompt').innerHTML = prompt;
    $('prompt').hidden = !prompt;

    // threats list
    $('threats').innerHTML = S.intents.filter((i) => byId(i.pid)).map((i) => {
      const p = byId(i.pid), t = at(i.x, i.y);
      return `<li>${NAME[p.type]} <b>→</b> ${t && own(t) ? 'takes your ' + NAME[t.type] : 'moves'}</li>`;
    }).join('') || '<li class="quiet">Nothing telegraphed.</li>';

    inspect();
  }

  function inspect() {
    const p = (hoverCell && at(hoverCell.x, hoverCell.y)) || (S.selected && byId(S.selected));
    const img = $('inspect-card'), info = $('inspect-info');
    if (!p) { img.hidden = true; info.innerHTML = '<span class="quiet">Hover a piece to see its card.</span>'; return; }
    img.hidden = false;
    img.src = `cards/pieces/${NAME[p.type]}.svg`;
    img.alt = NAME[p.type] + ' card';
    const tags = [own(p) ? 'YOURS' : 'ENEMY'];
    if (p.shield) tags.push('SHIELDED');
    if (p.fortify) tags.push('FORTIFIED');
    if (p.frozen) tags.push('FROZEN');
    if (S.tiles[p.x][p.y].h > 0) tags.push('HIGH GROUND');
    info.innerHTML = tags.map((t, i) => `<span class="chip${i === 0 ? (own(p) ? ' mine' : ' foe') : ''}">${t}</span>`).join('');
  }

  /* ---------- start ---------- */
  function boot() {
    Board3D.init($('stage'), {
      cell: onCell,
      hover(x, y) { hoverCell = x >= 0 ? { x, y } : null; if (S) refresh(); },
      cancel() { if (S) cancel(); }
    });
    $('hand').addEventListener('click', (e) => {
      const b = e.target.closest('.card');
      if (b) playCard(b.dataset.id);
    });
    $('end-turn').addEventListener('click', () => { S.selected = null; endPlayerTurn(); });
    $('rot-l').addEventListener('click', () => Board3D.rotate(-1));
    $('rot-r').addEventListener('click', () => Board3D.rotate(1));
    $('again').addEventListener('click', () => newBattle());
    $('arena-pick').addEventListener('change', (e) => loadArena(e.target.value));
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'Escape') cancel();
      else if (e.key === 'q' || e.key === 'Q') Board3D.rotate(-1);
      else if (e.key === 'e' || e.key === 'E') Board3D.rotate(1);
      else if (e.key === 'Enter' && S.phase === 'player') endPlayerTurn();
    });
    loadArenaList();
  }

  /* ---------- arenas ---------- */
  // Used if arenas/ can't be fetched (for example when opened straight from disk).
  const FALLBACK = {
    name: 'Opening Skirmish', intents: 2,
    grid: ['........', '........', '........', '........', '........', '........', '........', '........'],
    pieces: [['R', 0], ['N', 1], ['Q', 3], ['K', 4], ['N', 6], ['R', 7]].map(([type, x]) => ({ side: 'enemy', type, x, y: 7 }))
      .concat([0, 1, 3, 4, 6, 7].map((x) => ({ side: 'enemy', type: 'P', x, y: 6 })))
      .concat([['R', 0], ['N', 1], ['B', 2], ['K', 4], ['B', 5], ['R', 7]].map(([type, x]) => ({ side: 'player', type, x, y: 0 })))
      .concat([0, 2, 3, 4, 5, 7].map((x) => ({ side: 'player', type: 'P', x, y: 1 })))
  };
  const TEST_KEY = 'isochess_test_arena';   // the editor's "Test play" hands arenas over here

  async function loadArenaList() {
    const params = new URLSearchParams(location.search);
    const pick = $('arena-pick');
    let list = [];
    try {
      const r = await fetch('arenas/index.json', { cache: 'no-store' });
      list = (await r.json()).arenas || [];
    } catch (e) { list = []; }
    let testArena = null;
    if (params.has('test')) {
      try { testArena = localStorage.getItem(TEST_KEY); } catch (e) { testArena = null; }
    }
    pick.innerHTML = (testArena ? '<option value="@test">Editor test arena</option>' : '') +
      list.map((a) => `<option value="${a.file}">${a.name}</option>`).join('');
    const want = testArena ? '@test' : (list.find((a) => a.file === params.get('arena') + '.json' || a.file === params.get('arena')) || list[0] || {}).file;
    if (want) pick.value = want;
    loadArena(want || null, testArena);
  }

  async function loadArena(file, testText) {
    let data = FALLBACK;
    try {
      if (file === '@test') data = testText || localStorage.getItem(TEST_KEY);
      else if (file) data = await (await fetch('arenas/' + file, { cache: 'no-store' })).text();
      arena = Arena.parse(data);
      const problems = Arena.validate(arena);
      if (problems.length) throw new Error(problems[0]);
    } catch (e) {
      console.warn('[Iso-Chess] Could not load arena, using the default:', e.message);
      arena = Arena.parse(FALLBACK);
    }
    newBattle();
  }

  // test hooks for automated play-testing
  window.IsoChess = { get state() { return S; }, onCell, playCard, endPlayerTurn, movesFor: (p) => movesFor(p) };

  if (!window.THREE) {
    document.body.classList.add('no-3d');
    $('prompt').hidden = false;
    $('prompt').textContent = 'The 3D engine failed to load.';
    return;
  }
  try {
    const c = document.createElement('canvas');
    if (!(c.getContext('webgl2') || c.getContext('webgl'))) throw new Error('no webgl');
  } catch (e) {
    $('prompt').hidden = false;
    $('prompt').textContent = 'Iso-Chess needs WebGL, which this browser does not provide.';
    return;
  }
  boot();
})();
