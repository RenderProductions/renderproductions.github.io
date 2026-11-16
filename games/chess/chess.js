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
  let HAND_SIZE = 3;
  // A: Archer (shoots down a line without moving), X: Bomber (blows up the 3x3 around it), M: Necromancer (raises the dead)
  const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 100, A: 3, X: 2, M: 4 };
  const NAME = { P: 'Pawn', N: 'Knight', B: 'Bishop', R: 'Rook', Q: 'Queen', K: 'King', A: 'Archer', X: 'Bomber', M: 'Necromancer' };

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

  function add(side, type, x, y, extra) {
    const p = Object.assign({ id: ++uid, side, type, x, y, moved: false, shield: false, fortify: false, frozen: false }, extra || {});
    S.pieces.push(p);
    return p;
  }
  const has = (name) => !!(S.heirlooms && S.heirlooms.indexOf(name) >= 0);
  const trait = (p, t) => !!(p && p.unit && p.unit.traits && p.unit.traits.indexOf(t) >= 0);

  function capturable(att, def) {
    if (def.shield && def.side !== att.side) return false;
    if ((def.fortify || trait(def, 'iron')) && (att.type === 'P' || att.type === 'X')) return false;
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
    const boost = S.tiles[p.x][p.y].h > 0 ? (trait(p, 'highborn') ? 2 : 1) : 0;   // high ground: +1 range
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
      case 'K':
        ALL8.forEach(([dx, dy]) => ray(dx, dy, 1 + boost));
        if (p.side === 'player' && has('knightking')) JUMPS.forEach(([dx, dy]) => land(p.x + dx, p.y + dy));
        break;
      case 'M': ALL8.forEach(([dx, dy]) => ray(dx, dy, 1)); break;
      case 'A': {
        // steps like a King without capturing; shoots straight down a line (up to 3) without moving
        ALL8.forEach(([dx, dy]) => { const x = p.x + dx, y = p.y + dy; if (open(x, y) && !at(x, y)) out.push({ x, y, capture: null }); });
        ORTH.forEach(([dx, dy]) => {
          let x = p.x, y = p.y;
          for (let i = 0; i < 3 + boost; i++) {
            x += dx; y += dy;
            if (!open(x, y)) return;
            const o = at(x, y);
            if (attack) { out.push({ x, y, capture: o && o.side !== p.side ? o : null, shot: true }); if (o) return; continue; }
            if (o) { if (o.side !== p.side && capturable(p, o)) out.push({ x, y, capture: o, shot: true }); return; }
          }
        });
        break;
      }
      case 'X': {
        // shuffles forward one square at a time; its real threat is the blast (see planIntents)
        const f = p.side === 'player' ? 1 : -1;
        if (!attack && open(p.x, p.y + f) && !at(p.x, p.y + f)) out.push({ x: p.x, y: p.y + f, capture: null });
        if (attack) ALL8.forEach(([dx, dy]) => { if (inB(p.x + dx, p.y + dy)) out.push({ x: p.x + dx, y: p.y + dy, capture: null }); });
        break;
      }
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
          // heirloom: your pawns can also step sideways
          if (p.side === 'player' && has('sidestep')) [-1, 1].forEach((dx) => { if (open(p.x + dx, p.y) && !at(p.x + dx, p.y)) out.push({ x: p.x + dx, y: p.y, capture: null }); });
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

  // A free battle: an arena file, both armies from the file, every power card.
  function newBattle() {
    startBattle({
      name: arena.name, w: arena.w, h: arena.h, tiles: arena.tiles, intents: arena.intents,
      pieces: arena.pieces, deck: POWERS.filter((c) => !c.burn).map((c) => c.id), objective: { kind: 'king' }
    });
  }

  /* A battle from a config (free play, or a fight in a run; see run.js):
     { name, w, h, tiles, intents, pieces: [{side, type, x, y, unit?, boss?, hp?}], deck: [card ids],
       heirlooms: [...], objective: {kind: 'king'|'rout'|'survive'|'escort', turns?}, energy?, onEnd(result) } */
  function startBattle(cfg) {
    uid = 0;
    HAND_SIZE = 3 + ((cfg.heirlooms || []).indexOf('fourth') >= 0 ? 1 : 0);
    S = {
      w: cfg.w, h: cfg.h, intentCount: cfg.intents || 2, name: cfg.name,
      pieces: [], tiles: [], turn: 0, energy: (cfg.energy || 1) - 1, hand: [], draw: [], intents: [],
      phase: 'player', movesLeft: 1, lockPiece: null, movedThisTurn: false,
      selected: null, targeting: null, busy: false, over: false, fallen: [], log: [],
      heirlooms: cfg.heirlooms || [], objective: cfg.objective || { kind: 'king' }, onEnd: cfg.onEnd || null,
      lost: [], stats: { captures: 0, clever: 0 }, firstBlood: false, raiseEvery: 3
    };
    S.tiles = cfg.tiles.map((col) => col.map((t) => ({ kind: t.kind, h: t.h })));
    cfg.pieces.forEach((p) => {
      const q = add(p.side, p.type, p.x, p.y, { unit: p.unit || null, boss: !!p.boss, hp: p.hp || 1 });
      if (q.side === 'player' && (trait(q, 'vigilant'))) q.shield = true;
      if (q.side === 'player' && q.type === 'R' && has('bastion')) q.fortify = true;
    });
    // your deck is one shuffled draw pile; a played card is shuffled back in (burn cards are gone for this battle)
    S.draw = shuffle(cfg.deck.slice());
    Board3D.reset();
    $('overlay').hidden = true;
    say(`${cfg.name}. ${goalText()}. Red arcs show what the enemy will do after your move.`);
    planIntents();
    startPlayerTurn();
  }
  function goalText() {
    const o = S.objective;
    if (o.kind === 'rout') return 'Goal: take every enemy piece';
    if (o.kind === 'survive') return `Goal: keep your King alive for ${o.turns} turns`;
    if (o.kind === 'escort') return 'Goal: get a Pawn to the far side';
    return 'Goal: take the enemy King';
  }

  /* ---------- turn flow ---------- */
  function startPlayerTurn() {
    S.turn++;
    S.phase = 'player';
    S.energy = Math.min(MAX_ENERGY, S.energy + 1);
    const draws = S.turn === 1 ? HAND_SIZE : 1;
    for (let i = 0; i < draws && S.hand.length < HAND_SIZE && S.draw.length; i++) S.hand.push(S.draw.shift());
    if (S.turn > 1 && S.hand.length < HAND_SIZE && S.draw.length && has('fourth')) S.hand.push(S.draw.shift());
    S.movesLeft = 1; S.lockPiece = null; S.movedThisTurn = false;
    refresh();
  }

  async function endPlayerTurn() {
    if (!S || S.over || S.phase !== 'player' || S.busy) return;
    S.phase = 'enemy'; S.selected = null; S.targeting = null; S.lockPiece = null;
    refresh();
    await sleep(280);
    await runIntents();
    if (S.over) return;
    S.pieces.forEach((p) => { if (p.side === 'player') p.shield = false; else p.frozen = false; });
    Board3D.sync(S);
    if (S.objective.kind === 'survive' && S.turn >= S.objective.turns) { endBattle(true); return; }
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
      if (it.boom) { await blast(p); if (S.over) return; continue; }
      if (it.raise) {
        if (at(it.x, it.y) || !open(it.x, it.y)) { await Board3D.animateFizzle(p.id); continue; }
        await Board3D.animateFizzle(p.id);
        add('enemy', 'P', it.x, it.y, { moved: true });
        say('The Necromancer raised a Pawn from the dead.');
        Board3D.sync(S); await sleep(120); continue;
      }
      const m = movesFor(p).find((q) => q.x === it.x && q.y === it.y && !!q.shot === !!it.shot);
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
    if (m.shot) {
      // an Archer looses an arrow: the target falls, the Archer stays put
      await Board3D.animateFizzle(p.id);
      await capture(m.capture, p);
      S.busy = false; Board3D.sync(S);
      if (!S.over) checkKings();
      return;
    }
    await Board3D.animateMove(p.id, m.x, m.y);
    if (m.capture) await capture(m.capture, p);
    p.x = m.x; p.y = m.y; p.moved = true;
    promote(p);
    S.busy = false;
    Board3D.sync(S);
    if (!S.over) checkKings();
  }

  // the farthest empty floor tile from your pieces (where a hurt boss retreats to)
  function retreatTile() {
    let best = null;
    for (let x = 0; x < S.w; x++) for (let y = 0; y < S.h; y++) {
      if (!open(x, y) || at(x, y)) continue;
      const d = Math.min(...S.pieces.filter(own).map((p) => cheb(p, { x, y })), 99);
      if (!best || d > best.d) best = { x, y, d };
    }
    return best;
  }

  // how = 'pit' (shoved or fell), 'blast' (a Bomber), or nothing (an ordinary capture)
  async function capture(victim, by, how) {
    // a boss takes more than one hit: it staggers back across the board instead
    if (victim.boss && victim.hp > 1) {
      victim.hp--;
      const r = retreatTile();
      say(`The ${NAME[victim.type]} reels back, wounded (${victim.hp} left).`);
      if (r) { await Board3D.animateMove(victim.id, r.x, r.y); victim.x = r.x; victim.y = r.y; }
      if (by && by.side === 'player') gainFromKill(by, false);
      return;
    }
    const cap = Board3D.animateCapture(victim.id);
    S.pieces = S.pieces.filter((q) => q !== victim);
    S.intents = S.intents.filter((i) => i.pid !== victim.id);
    if (victim.side === 'player') {
      if (victim.type !== 'K') S.fallen.push(victim.type);
      if (victim.unit) S.lost.push(victim.unit.uid);
      say(by ? `Enemy ${NAME[by.type]} took your ${NAME[victim.type]}${victim.unit ? ', ' + victim.unit.name : ''}.` : `Your ${NAME[victim.type]} was lost.`);
    } else {
      S.stats.captures++;
      const clever = how === 'pit' || how === 'blast' && by && by.side === 'enemy';
      if (clever) {
        S.stats.clever++;
        S.energy = Math.min(MAX_ENERGY, S.energy + 1 + (has('gravedigger') ? 1 : 0));
        say(`Enemy ${NAME[victim.type]} ${how === 'pit' ? 'fell into the pit' : 'was caught in the blast'}. Clever! +${1 + (has('gravedigger') ? 1 : 0)} energy.`);
      } else if (by && by.side === 'player') {
        gainFromKill(by, true);
        say(`Your ${NAME[by.type]} took the enemy ${NAME[victim.type]}.`);
      } else say(`Enemy ${NAME[victim.type]} was lost.`);
    }
    await cap;
  }
  function gainFromKill(by, kill) {
    let e = 1;
    if (trait(by, 'bloodthirsty')) e++;
    if (!S.firstBlood && has('firstblood')) { e += 2; say('First blood: +2 energy.'); }
    S.firstBlood = true;
    S.energy = Math.min(MAX_ENERGY, S.energy + e);
    if (kill && by.unit) by.unit.kills = (by.unit.kills || 0) + 1;
  }

  // a Bomber goes off: everything in the 3x3 around it is lost, friend or foe (shields hold)
  async function blast(b) {
    say('The Bomber goes off!');
    const hit = S.pieces.filter((q) => q !== b && cheb(q, b) <= 1 && !(q.shield && q.side === 'player'));
    await Board3D.animateCapture(b.id);
    S.pieces = S.pieces.filter((q) => q !== b);
    for (const q of hit) { if (S.pieces.indexOf(q) >= 0) await capture(q, b, 'blast'); }
    Board3D.sync(S);
    if (!S.over) checkKings();
  }

  function promote(p) {
    if (p.type !== 'P') return;
    if ((p.side === 'player' && p.y === S.h - 1) || (p.side === 'enemy' && p.y === 0)) {
      if (p.side === 'player' && S.objective.kind === 'escort') { S.escorted = true; }
      p.type = 'Q';
      if (p.unit) p.unit.type = 'Q';   // in a run, a promotion is for keeps
      say(p.side === 'player' ? 'Your Pawn promoted to a Queen.' : 'An enemy Pawn promoted to a Queen.');
    }
  }

  function checkKings() {
    if (S.over) return;
    if (!kingOf('player')) return endBattle(false);
    const o = S.objective.kind;
    if (o === 'king' && !kingOf('enemy')) return endBattle(true);
    if (o === 'rout' && !S.pieces.some(foe)) return endBattle(true);
    if (o === 'escort' && S.escorted) return endBattle(true);
    if (o !== 'king' && !S.pieces.some(foe)) return endBattle(true);
  }
  function endBattle(won) {
    if (S.over) return;
    S.over = true; S.phase = 'over'; S.targeting = null; S.selected = null;
    Board3D.setIntents([]);
    refresh();
    if (S.onEnd) {
      const survivors = S.pieces.filter((p) => own(p) && p.unit).map((p) => p.unit.uid);
      const r = { won, turns: S.turn, lost: S.lost.slice(), survivors, clever: S.stats.clever, captures: S.stats.captures };
      setTimeout(() => S.onEnd(r), 900);
      return;
    }
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
      // a Bomber next to your pieces goes off; a Necromancer raises a Pawn every few turns
      if (e.type === 'X') {
        const near = S.pieces.filter((q) => q !== e && cheb(q, e) <= 1);
        const mine = near.filter(own);
        if (mine.length) { cands.push({ pid: e.id, x: e.x, y: e.y, boom: true, s: 60 + mine.reduce((a, q) => a + VALUE[q.type], 0) - near.filter(foe).length * 5 }); return; }
      }
      if (e.type === 'M' && S.turn % S.raiseEvery === 0) {
        const spot = ALL8.map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy })).find((c) => open(c.x, c.y) && !at(c.x, c.y));
        if (spot) { cands.push({ pid: e.id, x: spot.x, y: spot.y, raise: true, s: 35 }); return; }
      }
      movesFor(e).forEach((m) => {
        let s = Math.random() * 1.5;
        const unsafe = danger.has(key(m.shot ? e.x : m.x, m.shot ? e.y : m.y));
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
        if (!best || s > best.s) best = { pid: e.id, x: m.x, y: m.y, s, capture: !!m.capture, shot: !!m.shot };
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
    if (it.boom) {
      const area = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (inB(p.x + dx, p.y + dy)) area.push({ x: p.x + dx, y: p.y + dy });
      return { area };
    }
    const tgt = at(it.x, it.y);
    return { fx: p.x, fy: p.y, tx: it.x, ty: it.y, type: p.type, shot: !!it.shot, capture: !!(tgt && tgt.side === 'player') };
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
        if (!open(d.x, d.y)) { await capture(p, null, 'pit'); checkKings(); }
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
        if (pawn.unit) S.lost.push(pawn.unit.uid);
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
        if (pawn.unit) pawn.unit.type = 'Q';
        if (gone.unit) S.lost.push(gone.unit.uid);
        say('Your Pawn rises as a Queen.');
      } }
  ];
  const BASE_CARD = Object.fromEntries(POWERS.map((c) => [c.id, c]));
  // "shove+" is an upgraded Shove: one energy cheaper
  const UP = {};
  function cardOf(id) {
    if (!id.endsWith('+')) return BASE_CARD[id];
    if (!UP[id]) { const b = BASE_CARD[id.slice(0, -1)]; UP[id] = Object.assign({}, b, { id, name: b.name + '+', cost: Math.max(0, b.cost - 1), up: true }); }
    return UP[id];
  }
  const CARD = new Proxy({}, { get: (_, id) => (typeof id === 'string' ? cardOf(id) : undefined) });
  /** A card's face: its art if it has one (with a + for an upgrade), else a drawn card. */
  function cardFace(c) {
    if (c.file) return `<img src="cards/powers/${c.file}.svg" alt="${c.name}: ${c.text} Costs ${c.cost} energy.">${c.up ? '<span class="card-up">+</span><span class="card-cost">' + c.cost + '</span>' : ''}`;
    return `<div class="cardx${c.burn ? ' burn' : ''}"><b class="cx-cost">${c.cost}</b><div class="cx-name">${c.name}</div><div class="cx-icon">${c.icon || '✦'}</div><div class="cx-text">${c.text}</div>${c.burn ? '<div class="cx-burn">BURN</div>' : ''}</div>`;
  }

  function playCard(id) {
    if (S.phase !== 'player' || S.busy || S.over) return;
    const c = CARD[id];
    if (S.targeting && S.targeting.card === c) { cancel(); return; }
    if (S.energy < c.cost) { say(`${c.name} needs ${c.cost} energy.`); flash('energy'); return; }
    const why = c.playable ? c.playable() : '';
    if (why) { say(why); return; }
    S.selected = null;
    S.targeting = { card: c, picks: [] };
    if (!c.targets.length) { resolveCard(); return; }   // no targets: plays at once
    refresh();
  }
  function cancel() {
    if (!S) return;
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
    await resolveCard();
  }
  async function resolveCard() {
    const T = S.targeting, c = T.card;
    // resolve: the card is paid for, leaves your hand, and goes back into the draw pile at a random
    // spot, so it can come around again (a burn card is spent for the rest of this battle)
    S.energy -= c.cost;
    S.hand.splice(S.hand.indexOf(c.id), 1);
    if (!c.burn) S.draw.splice(Math.floor(Math.random() * (S.draw.length + 1)), 0, c.id);
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
    if (!S) return;
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
      return `<button class="card${poor ? ' poor' : ''}${active ? ' active' : ''}" data-id="${id}" title="${c.name} (${c.cost} energy${c.burn ? ', burns' : ''}): ${c.text}">${cardFace(c)}</button>`;
    }).join('') || '<p class="empty-hand">No cards in hand.</p>';

    // prompt
    let prompt = '';
    const pk = kingOf('player');
    const check = pk && S.phase === 'player' && !S.over && S.intents.some((i) => {
      if (!byId(i.pid)) return false;
      if (i.boom) return cheb(byId(i.pid), pk) <= 1 && !pk.shield;
      return i.x === pk.x && i.y === pk.y && !pk.shield;
    });
    document.body.classList.toggle('in-check', !!check);
    if (S.phase === 'enemy') prompt = 'ENEMY TURN';
    else if (check && !S.targeting) prompt = '<b class="check">CHECK</b> Your King is in the line of fire. Move it, block, or shield it.';
    else if (S.targeting) prompt = S.targeting.card.targets[S.targeting.picks.length].prompt + ' <span>Esc or right-click to cancel</span>';
    else if (S.lockPiece && S.movesLeft > 1) prompt = 'Haste: move the glowing piece again.';
    else if (S.lockPiece && S.movesLeft === 1 && S.movedThisTurn) prompt = 'Haste: one more move with that piece.';
    $('prompt').innerHTML = prompt;
    $('prompt').hidden = !prompt;

    // threats list
    $('threats').innerHTML = S.intents.filter((i) => byId(i.pid)).map((i) => {
      const p = byId(i.pid), t = at(i.x, i.y);
      const what = i.boom ? 'blows up everything around it' : i.raise ? 'raises a Pawn' : t && own(t) ? (i.shot ? 'shoots your ' : 'takes your ') + NAME[t.type] : 'moves';
      return `<li>${NAME[p.type]} <b>→</b> ${what}</li>`;
    }).join('') || '<li class="quiet">Nothing telegraphed.</li>';
    const g = $('goal'); if (g) g.textContent = goalText().replace('Goal: ', '') + (S.objective.kind === 'survive' ? ` (${Math.min(S.turn, S.objective.turns)}/${S.objective.turns})` : '');

    inspect();
  }

  function inspect() {
    const p = (hoverCell && at(hoverCell.x, hoverCell.y)) || (S.selected && byId(S.selected));
    const img = $('inspect-card'), info = $('inspect-info');
    if (!p) { img.hidden = true; info.innerHTML = '<span class="quiet">Hover a piece to see its card.</span>'; return; }
    img.hidden = false;
    const base = { A: 'Bishop', X: 'Pawn', M: 'Queen' }[p.type] || NAME[p.type];
    img.src = `cards/pieces/${base}.svg`;
    img.alt = NAME[p.type] + ' card';
    const tags = [own(p) ? 'YOURS' : 'ENEMY'];
    if (p.unit) { tags.push(p.unit.name.toUpperCase()); (p.unit.traits || []).forEach((t) => tags.push(t.toUpperCase())); }
    if (p.boss) tags.push('BOSS · ' + (p.hp || 1) + ' HP');
    if (['A', 'X', 'M'].indexOf(p.type) >= 0) tags.push(NAME[p.type].toUpperCase());
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
    $('end-turn').addEventListener('click', () => { if (!S) return; S.selected = null; endPlayerTurn(); });
    $('rot-l').addEventListener('click', () => Board3D.rotate(-1));
    $('rot-r').addEventListener('click', () => Board3D.rotate(1));
    $('again').addEventListener('click', () => newBattle());
    $('arena-pick').addEventListener('change', (e) => loadArena(e.target.value));
    // a run (run.js) takes over from here; free play only starts when asked (or for the editor's test arenas)
    window.addEventListener('keydown', (e) => {
      if (e.target.closest && e.target.closest('input,textarea,select')) return;
      if (e.key === 'Escape') cancel();
      else if (e.key === 'q' || e.key === 'Q') Board3D.rotate(-1);
      else if (e.key === 'e' || e.key === 'E') Board3D.rotate(1);
      else if (e.key === 'Enter' && S && S.phase === 'player') endPlayerTurn();
    });
    if (new URLSearchParams(location.search).has('test') || new URLSearchParams(location.search).has('arena') || !window.IsoRun) loadArenaList();
    else window.IsoRun.boot();
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
  window.IsoChess = { get state() { return S; }, onCell, playCard, endPlayerTurn, movesFor: (p) => movesFor(p),
    startBattle, cardOf, cardFace, POWERS, NAME, VALUE, freePlay: () => loadArenaList() };

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
