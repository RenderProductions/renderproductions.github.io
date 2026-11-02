// The drawer: draws art/drawer.svg and lays out everything this visitor has found on its floor.
// Each item always lands in the same spot (worked out from its id), so the drawer looks lived-in
// rather than reshuffled on every visit. Items further back sit a little smaller, for depth.
// Hover, focus or tap an item to read its slip.
(function () {
  'use strict';
  var art = document.getElementById('art');
  var floor = document.getElementById('floor');
  var empty = document.getElementById('empty');
  var slip = document.getElementById('slip');
  var slipName = document.getElementById('slip-name');
  var slipDesc = document.getElementById('slip-desc');

  // The visible floor in art/drawer.svg (480 x 372 units): from the bottom of the back wall
  // to the top of the front panel, between the two floor edges, which lean outward toward you.
  var W = 480, H = 372;
  var FLOOR = { back: 160.5, front: 260, cx: 240, backHalf: 130.6, lean: 0.37443 };
  function halfAt(y) { return FLOOR.backHalf + FLOOR.lean * (y - FLOOR.back); }
  var ITEM = 0.12;   // an item's width, as a share of the drawing's width (before size and depth)

  // Put the drawing in the page (inline, so the page's fonts and styles reach it).
  fetch('art/drawer.svg?v=3')
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
        var rnd = seeded(id);
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
          tag.textContent = item.name || id.replace(/_/g, ' ');
          btn.appendChild(tag);
        }
        var onLeft = best.x < FLOOR.cx;
        btn.addEventListener('pointerenter', function () { show(btn, item, id, onLeft); });
        btn.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(btn); });
        btn.addEventListener('focus', function () { show(btn, item, id, onLeft); });
        btn.addEventListener('blur', function () { hide(btn); });
        btn.addEventListener('click', function (e) { e.stopPropagation(); show(btn, item, id, onLeft); });
        floor.appendChild(btn);
      });
    });
  }

  // Tapping anywhere else puts the slip away (for touch screens).
  document.addEventListener('click', function () { hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  // Something found in another tab: it shows up here right away.
  document.addEventListener('rp:items', draw);
  draw();
})();
