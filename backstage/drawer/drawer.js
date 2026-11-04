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
        // Try lots of spots and keep the one with the most room around it, so things spread out
        // over the whole floor instead of piling up. Every spot keeps the item fully inside the drawer.
        var best = null, bestGap = -Infinity;
        for (var tries = 0; tries < 60; tries++) {
          var v = 0.08 + rnd() * 0.84;                          // 0 = back wall, 1 = front panel
          var depth = 0.8 + 0.25 * v;                           // further back = a bit smaller
          var w = W * ITEM * size * depth;
          var y = FLOOR.back + v * (FLOOR.front - FLOOR.back);
          // an item is centred on its point and tilted up to 25 degrees, so its corners reach ~0.62 of its width out
          y = Math.min(Math.max(y, FLOOR.back + w * 0.45), FLOOR.front - w * 0.64);
          var room = Math.max(0, halfAt(y) - w * 0.64);
          var x = FLOOR.cx + (rnd() * 2 - 1) * room;
          var gap = 999;
          placed.forEach(function (p) { gap = Math.min(gap, Math.hypot(p.x - x, (p.y - y) * 1.3) - (p.w + w) * 0.55); });
          if (gap > bestGap) { bestGap = gap; best = { x: x, y: y, w: w, v: (y - FLOOR.back) / (FLOOR.front - FLOOR.back) }; }
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
        if (item.plays && item.plays.to) playable(btn, item.plays);
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

  // ---- playing it: "plays": {"to": "/page/"} in items.json ----
  // Click it and it plays: garbled tape noise (made on the spot: hiss, a warbling dying tone, stuttering static),
  // the drawer glitches harder and harder, and then you're somewhere else.
  function garble(secs) {
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
      var t = actx.currentTime, out = actx.createGain(); out.gain.value = 0.5;
      var crush = actx.createWaveShaper(), curve = new Float32Array(256);
      for (var i = 0; i < 256; i++) { var x = i / 127.5 - 1; curve[i] = Math.round(x * 6) / 6; }   // a cheap bitcrush
      crush.curve = curve; crush.connect(out); out.connect(actx.destination);
      // tape hiss, swelling
      var n = Math.floor(actx.sampleRate * secs), buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
      for (var j = 0; j < n; j++) d[j] = (Math.random() * 2 - 1) * (0.25 + 0.75 * j / n);
      var hiss = actx.createBufferSource(), hf = actx.createBiquadFilter(), hg = actx.createGain();
      hiss.buffer = buf; hf.type = 'highpass'; hf.frequency.value = 1800; hg.gain.value = 0.18;
      hiss.connect(hf); hf.connect(hg); hg.connect(out); hiss.start(t);
      // the "voice" on side B: a sawtooth warbling and sagging like a tape being dragged, chopped up
      var o = actx.createOscillator(), og = actx.createGain(), wob = actx.createOscillator(), wg = actx.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(55, t + secs);
      wob.frequency.value = 7; wg.gain.value = 35; wob.connect(wg); wg.connect(o.frequency);
      og.gain.setValueAtTime(0, t);
      for (var k = 0, at = t; at < t + secs; k++) {                       // stutter: on, off, on, off
        var len = 0.04 + Math.random() * 0.16;
        og.gain.setValueAtTime(Math.random() < 0.7 ? 0.22 : 0, at); at += len;
      }
      o.connect(og); og.connect(crush); o.start(t); wob.start(t); o.stop(t + secs); wob.stop(t + secs);
      // bursts of loud static, more and more of them
      for (var b = 0; b < 14; b++) {
        var when = t + Math.pow(b / 14, 0.7) * secs * 0.95, bl = 0.03 + Math.random() * 0.12;
        var bb = actx.createBuffer(1, Math.floor(actx.sampleRate * bl), actx.sampleRate), bd = bb.getChannelData(0);
        for (var q = 0; q < bd.length; q++) bd[q] = Math.random() * 2 - 1;
        var bs = actx.createBufferSource(), bf = actx.createBiquadFilter(), bg = actx.createGain();
        bs.buffer = bb; bf.type = 'bandpass'; bf.frequency.value = 400 + Math.random() * 3000; bf.Q.value = 2; bg.gain.value = 0.35;
        bs.connect(bf); bf.connect(bg); bg.connect(crush); bs.start(when);
      }
    } catch (e) {}
  }
  function playable(btn, rule) {
    var going = false;
    btn.classList.add('playable');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (going) return; going = true;
      var secs = rule.secs || 2.6;
      garble(secs);
      document.body.classList.add('garble');
      btn.classList.add('playing');
      setTimeout(function () { document.body.classList.add('garble-hard'); }, secs * 550);
      setTimeout(function () { location.href = rule.to; }, secs * 1000);
    });
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
