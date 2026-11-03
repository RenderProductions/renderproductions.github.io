// Cedar's workbench: two things under the Bright Bulb, and he puts them together.
// Opens when Cedar says a dialogue node with "panel": "bench" (the "craft" node).
// Recipes live in /items.json ("recipes"). After a match, Cedar says that recipe's "say" node.
// Other nodes it uses (in dialogue.json): craft_miss, craft_key, craft_empty, craft_cancel.
// The Bright Bulb is the light, so it never goes on the bench and is never used up.
(function () {
  'use strict';
  var LIGHT = 'bright_bulb';
  var KEEP = { rusted_key: 'craft_key' };   // things he won't take apart, and what he says instead

  var room = document.getElementById('room');
  var bench = document.getElementById('bench');
  var tray = document.getElementById('bench-tray');
  var slotEls = [].slice.call(bench.querySelectorAll('.slot'));
  var goBtn = document.getElementById('bench-go');
  var noBtn = document.getElementById('bench-no');
  var inv = window.RPInventory;
  var slots = [null, null], cat = {}, open = false;

  // His desk is lit once he's seen the Bright Bulb and it's still in their drawer.
  function paintLight() {
    var lit = !!(inv && inv.has(LIGHT) && window.TALKER && TALKER.seen('can_craft'));
    room.classList.toggle('lit', lit || open);
  }

  function art(id, into) {
    var it = cat[id] || {};
    into.textContent = '';
    if (it.art) { var img = new Image(); img.src = it.art; img.alt = ''; img.draggable = false; into.appendChild(img); }
    else { var tag = document.createElement('span'); tag.className = 'tagonly'; tag.textContent = it.name || id; into.appendChild(tag); }
  }
  function name(id) { return (cat[id] && cat[id].name) || id; }

  function paint() {
    slotEls.forEach(function (el, i) {
      var id = slots[i];
      el.classList.toggle('full', !!id);
      if (id) { art(id, el); el.title = name(id) + ' (tap to take it back)'; el.setAttribute('aria-label', name(id) + ', take it back'); }
      else { el.textContent = ''; el.title = ''; el.setAttribute('aria-label', 'Empty spot'); }
    });
    [].forEach.call(tray.children, function (b) { b.classList.toggle('used', slots.indexOf(b.dataset.id) >= 0); });
    goBtn.disabled = !(slots[0] && slots[1]);
  }

  function fill() {
    tray.textContent = '';
    inv.list().filter(function (id) { return id !== LIGHT; }).forEach(function (id) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'thing'; b.dataset.id = id; b.title = name(id);
      var pic = document.createElement('span'); pic.className = 'pic'; art(id, pic);
      var label = document.createElement('span'); label.className = 'label'; label.textContent = name(id);
      b.appendChild(pic); b.appendChild(label);
      b.addEventListener('click', function () {
        var at = slots.indexOf(id);
        if (at >= 0) slots[at] = null;
        else if (!slots[0]) slots[0] = id;
        else if (!slots[1]) slots[1] = id;
        else slots[1] = id;
        paint();
      });
      tray.appendChild(b);
    });
  }

  function show() {
    open = true; slots = [null, null];
    fill(); paint(); paintLight();
    bench.hidden = false;
    requestAnimationFrame(function () { bench.classList.add('on'); });
    setTimeout(function () { var f = tray.querySelector('button'); if (f) f.focus({ preventScroll: true }); }, 60);
  }
  function hide() {
    open = false;
    bench.classList.remove('on');
    bench.hidden = true;
    paintLight();
  }
  function done(nodeId) { hide(); TALKER.go(nodeId); }

  function combine() {
    var a = slots[0], b = slots[1];
    if (!a || !b) return;
    if (KEEP[a] || KEEP[b]) return done(KEEP[a] || KEEP[b]);
    inv.recipes().then(function (list) {
      var r = list.filter(function (r) {
        var u = r.use || [];
        return u.length === 2 && ((u[0] === a && u[1] === b) || (u[0] === b && u[1] === a));
      })[0];
      if (!r || !inv.has(a) || !inv.has(b)) return done('craft_miss');
      inv.take(a); inv.take(b);
      inv.give(r.make);
      bench.classList.add('flash');
      setTimeout(function () { bench.classList.remove('flash'); done(r.say || 'craft_more'); }, 380);
    });
  }

  slotEls.forEach(function (el, i) { el.addEventListener('click', function () { slots[i] = null; paint(); }); });
  goBtn.addEventListener('click', combine);
  noBtn.addEventListener('click', function () { done('craft_cancel'); });
  bench.addEventListener('click', function (e) { e.stopPropagation(); });
  bench.addEventListener('keydown', function (e) {
    e.stopPropagation();   // Z, M and space belong to the bench while it's open
    if (e.key === 'Escape') { e.preventDefault(); done('craft_cancel'); }
  });

  document.addEventListener('talk:panel', function (e) {
    if (!e.detail || e.detail.panel !== 'bench' || !inv) return;
    inv.catalog().then(function (c) {
      cat = c;
      var things = inv.list().filter(function (id) { return id !== LIGHT; });
      if (!inv.has(LIGHT)) return TALKER.go('craft_cancel');
      if (things.length < 2) return TALKER.go('craft_empty');
      show();
    });
  });
  document.addEventListener('rp:items', paintLight);
  if (inv) inv.catalog().then(function (c) { cat = c; paintLight(); });
  setInterval(paintLight, 1500);   // he may have just seen the bulb mid-conversation
  setTimeout(paintLight, 0);
})();
