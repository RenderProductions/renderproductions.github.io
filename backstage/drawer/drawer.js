// The drawer: lays out everything this visitor has found.
// Each item always lands in the same spot (worked out from its id), so the drawer looks lived-in
// rather than reshuffled on every visit. Hover, focus or tap an item to read its slip.
(function () {
  'use strict';
  var floor = document.getElementById('floor');
  var empty = document.getElementById('empty');
  var slip = document.getElementById('slip');
  var slipName = document.getElementById('slip-name');
  var slipDesc = document.getElementById('slip-desc');
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
  function show(btn, item, id) {
    if (selected && selected !== btn) selected.classList.remove('sel');
    selected = btn;
    btn.classList.add('sel');
    slipName.textContent = item.name || id;
    slipDesc.textContent = item.desc || '';
    slipDesc.hidden = !item.desc;
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
        // Try a few spots and keep the one furthest from everything already placed.
        var best = null, bestGap = -1;
        for (var tries = 0; tries < 24; tries++) {
          var x = 14 + rnd() * 72, y = 18 + rnd() * 64, gap = 999;
          placed.forEach(function (p) { gap = Math.min(gap, Math.hypot(p[0] - x, (p[1] - y) * 0.75)); });
          if (gap > bestGap) { bestGap = gap; best = [x, y]; }
          if (gap > 26) break;
        }
        placed.push(best);

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'item';
        btn.setAttribute('aria-label', item.name || id);
        btn.style.setProperty('--x', best[0].toFixed(1) + '%');
        btn.style.setProperty('--y', best[1].toFixed(1) + '%');
        btn.style.setProperty('--r', ((rnd() - 0.5) * 50).toFixed(1) + 'deg');
        if (item.size) btn.style.setProperty('--s', item.size);
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
        btn.addEventListener('pointerenter', function () { show(btn, item, id); });
        btn.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(btn); });
        btn.addEventListener('focus', function () { show(btn, item, id); });
        btn.addEventListener('blur', function () { hide(btn); });
        btn.addEventListener('click', function (e) { e.stopPropagation(); show(btn, item, id); });
        floor.appendChild(btn);
      });
    });
  }

  // Tapping the empty floor puts the slip away (for touch screens).
  floor.addEventListener('click', function () { hide(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  // Something found in another tab: it shows up here right away.
  document.addEventListener('rp:items', draw);
  draw();
})();
