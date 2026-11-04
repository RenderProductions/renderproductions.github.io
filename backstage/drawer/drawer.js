// The drawer: draws art/drawer.svg and lays out everything this visitor has found on its floor.
// Each item always lands in the same spot (worked out from its id), so the drawer looks lived-in
// rather than reshuffled on every visit. Items further back sit a little smaller, for depth.
// Hover, focus or tap an item to read its tag (art/tag.svg).
// Items with "shakes" in items.json can be shaken: drag them back and forth (or tap fast)
// enough times in a row and they turn into something else (the Dead Bulb lights up).
(function () {
  'use strict';
  var art = document.getElementById('art');
  var floor = document.getElementById('floor');
  var empty = document.getElementById('empty');
  var slip = document.getElementById('slip');
  var slipName = document.getElementById('slip-name');
  var slipDesc = document.getElementById('slip-desc');
  var slipWords = document.getElementById('slip-words');

  // Long descriptions: shrink the writing until it fits on the tag.
  function fit() {
    var f = 1;
    slipWords.style.setProperty('--fit', f);
    while (f > 0.55 && slipWords.scrollHeight > slipWords.clientHeight + 1) {
      f -= 0.05;
      slipWords.style.setProperty('--fit', f.toFixed(2));
    }
  }

  // The visible floor in art/drawer.svg (480 x 388 units): from the bottom of the back wall
  // to the top of the front panel, between the two floor edges, which lean outward toward you.
  var W = 480, H = 388;
  var FLOOR = { back: 160.5, front: 260, cx: 240, backHalf: 130.6, lean: 0.37443 };
  function halfAt(y) { return FLOOR.backHalf + FLOOR.lean * (y - FLOOR.back); }
  var ITEM = 0.12;   // an item's width, as a share of the drawing's width (before size and depth)

  // Put the drawing in the page (inline, so the page's fonts and styles reach it).
  fetch('art/drawer.svg?v=4')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (svg) { art.innerHTML = svg; var el = art.querySelector('svg'); if (el) { el.removeAttribute('width'); el.removeAttribute('height'); } })
    .catch(function (e) { console.warn('[drawer] art/drawer.svg did not load', e); });

  if (!window.RPInventory) { empty.hidden = false; return; }

  // A tiny seeded random number generator, so an id always gives the same numbers.
  function seeded(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return function () {
      h += 0x6D2B79F5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  var selected = null;
  function show(btn, item, id, onLeft) {
    if (selected && selected !== btn) selected.classList.remove('sel');
    selected = btn;
    btn.classList.add('sel');
    slipName.textContent = item.name || id.replace(/_/g, ' ');
    slipDesc.textContent = item.desc || '';
    slipDesc.hidden = !item.desc;
    slip.classList.toggle('right', onLeft);   // the slip goes on the side away from the item
    slip.hidden = false;
    fit();
  }
  function hide(btn) {
    if (btn && selected !== btn) return;
    if (selected) selected.classList.remove('sel');
    selected = null;
    slip.hidden = true;
  }

  function draw() {
    RPInventory.catalog().then(function (cat) {
      [].slice.call(floor.querySelectorAll('.item')).forEach(function (el) { el.remove(); });
      hide();
      var ids = RPInventory.list();
      empty.hidden = ids.length > 0;
      var placed = [];
      ids.forEach(function (id) {
        var item = cat[id] || {};
        var rnd = seeded(item.spot || id);
        var size = +item.size || 1;
        // Try a few spots and keep the one furthest from everything already placed.
        var best = null, bestGap = -1;
        for (var tries = 0; tries < 30; tries++) {
          var v = 0.22 + rnd() * 0.56;                          // 0 = back wall, 1 = front panel
          var depth = 0.8 + 0.25 * v;                           // further back = a bit smaller
          var w = W * ITEM * size * depth;
          var y = FLOOR.back + v * (FLOOR.front - FLOOR.back);
          var room = Math.max(0, halfAt(y) - w * 0.45);
          var x = FLOOR.cx + (rnd() * 2 - 1) * room;
          var gap = 999;
          placed.forEach(function (p) { gap = Math.min(gap, Math.hypot(p.x - x, (p.y - y) * 1.6) - (p.w + w) * 0.42); });
          if (gap > bestGap) { bestGap = gap; best = { x: x, y: y, w: w, v: v }; }
          if (gap > 6) break;
        }
        placed.push(best);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item';
        btn.setAttribute('aria-label', item.name || id.replace(/_/g, ' '));
        btn.style.setProperty('--x', (best.x / W * 100).toFixed(2) + '%');
        btn.style.setProperty('--y', (best.y / H * 100).toFixed(2) + '%');
        btn.style.setProperty('--w', (best.w / W * 100).toFixed(2) + '%');
        btn.style.setProperty('--z', String(1 + Math.round(best.v * 40)));   // nearer items lie on top
        btn.style.setProperty('--r', ((rnd() - 0.5) * 50).toFixed(1) + 'deg');
        if (item.art) {
          var img = new Image();
          img.src = item.art; img.alt = ''; img.draggable = false;
          btn.appendChild(img);
        } else {
          var tag = document.createElement('span');
          tag.className = 'tag';
          var blank = new Image();
          blank.src = 'art/tag.svg'; blank.alt = ''; blank.draggable = false;
          var word = document.createElement('span');
          word.textContent = item.name || id.replace(/_/g, ' ');
          tag.appendChild(blank); tag.appendChild(word);
          btn.appendChild(tag);
        }
        var onLeft = best.x < FLOOR.cx;
        btn.addEventListener('pointerenter', function () { show(btn, item, id, onLeft); });
        btn.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(btn); });
        btn.addEventListener('focus', function () { show(btn, item, id, onLeft); });
        btn.addEventListener('blur', function () { hide(btn); });
        btn.addEventListener('click', function (e) { e.stopPropagation(); show(btn, item, id, onLeft); });
        if (item.shakes && item.shakes.into) shakeable(btn, id, item.shakes);
        floor.appendChild(btn);
      });
    });
  }

  // ---- shaking ----
  var actx = null;
  function noise(len, freq, vol) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var t = actx.currentTime, n = Math.floor(actx.sampleRate * len);
      var buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3);
      var src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 6; g.gain.value = vol;
      src.connect(f); f.connect(g); g.connect(actx.destination); src.start(t);
    } catch (e) {}
  }
  function hum() {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var t = actx.currentTime;
      [880, 1320].forEach(function (hz, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(i ? 0.02 : 0.05, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t + 1.7);
      });
    } catch (e) {}
  }

  function shakeable(btn, id, rule) {
    var need = rule.times || 14, count = 0, idle = 0, done = false;
    var down = false, last = null, dir = { x: 0, y: 0 }, from = { x: 0, y: 0 };
    btn.classList.add('shakeable');
    function paint() { btn.style.setProperty('--p', (count / need).toFixed(2)); btn.classList.toggle('flicker', count >= need * 0.4); }
    function settle() { count = 0; paint(); btn.classList.remove('flicker'); }
    function shake() {
      if (done) return;
      count++;
      btn.classList.remove('rattle'); void btn.offsetWidth; btn.classList.add('rattle');
      noise(0.05 + Math.random() * 0.03, 2600 + Math.random() * 1800, 0.35);
      paint();
      clearTimeout(idle); idle = setTimeout(settle, 2500);
      if (count >= need) light();
    }
    function light() {
      done = true; clearTimeout(idle);
      btn.classList.add('lit');
      hum();
      setTimeout(function () {
        RPInventory.swap(id, rule.into);
      }, 700);
    }
    // a shake = the drag turning back on itself after moving far enough one way
    btn.addEventListener('pointerdown', function (e) {
      down = true; last = from = { x: e.clientX, y: e.clientY }; dir = { x: 0, y: 0 };
      try { btn.setPointerCapture(e.pointerId); } catch (er) {}
    });
    btn.addEventListener('pointermove', function (e) {
      if (!down) return;
      var p = { x: e.clientX, y: e.clientY };
      ['x', 'y'].forEach(function (k) {
        var step = p[k] - last[k];
        if (!step) return;
        var s = step > 0 ? 1 : -1;
        if (s !== dir[k]) {
          if (dir[k] && Math.abs(last[k] - from[k]) > 12) shake();
          dir[k] = s; from[k] = last[k];
        }
      });
      last = p;
    });
    function up() { down = false; }
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    // a tap (or Enter/Space) is one little shake too
    btn.addEventListener('click', function () { shake(); });
  }

  // Tapping anywhere else puts the slip away (for touch screens).
  document.addEventListener('click', function () { hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  // Something found in another tab: it shows up here right away.
  document.addEventListener('rp:items', draw);
  draw();
})();
