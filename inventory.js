// Render Productions inventory: things a visitor has found around the site.
// Saved in their own browser only (localStorage "rp_items"), the same way rp_flags is.
// Everything an item IS (name, description, art) lives in /items.json.
//
// Include it on any page:   <script src="/inventory.js"></script>
//
// Hide an item on a page:   <img data-item="brass_key" src="..." alt="">
//   Any element with data-item="<id>" becomes a pickup: clicking it puts the item in the
//   drawer and makes the element vanish. Once found, it stays gone on later visits.
//   Add data-item-keep to leave the element where it is after it's taken.
//
// From other scripts:
//   RPInventory.give('brass_key')        -> true if it was new (shows a little "found" slip)
//   RPInventory.give('brass_key', { quiet: true })   -> no slip
//   RPInventory.has('brass_key')         -> true / false
//   RPInventory.take('brass_key')        -> removes it (for trades and puzzles)
//   RPInventory.list()                   -> ['brass_key', ...] in the order they were found
//   RPInventory.catalog()                -> Promise of the items.json "items" object
//   document.addEventListener('rp:items', ...)   fires whenever the inventory changes
(function () {
  'use strict';
  if (window.RPInventory) return;

  var KEY = 'rp_items';
  var catalogP = null;

  function read() {
    try { var v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; }
    catch (e) { return {}; }
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function changed(detail) {
    try { document.dispatchEvent(new CustomEvent('rp:items', { detail: detail })); } catch (e) {}
  }

  function catalog() {
    if (!catalogP) {
      catalogP = fetch('/items.json?v=' + Date.now())
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { return (d && d.items) || {}; })
        .catch(function (e) { console.warn('[inventory] items.json did not load', e); return {}; });
    }
    return catalogP;
  }

  function has(id) { return !!read()[id]; }
  function list() {
    var v = read();
    return Object.keys(v).sort(function (a, b) { return v[a] - v[b]; });
  }
  function give(id, opts) {
    if (!id) return false;
    var v = read();
    if (v[id]) return false;
    v[id] = Date.now();
    if (!write(v)) return false;
    changed({ id: id, action: 'give' });
    if (!(opts && opts.quiet)) slip(id);
    return true;
  }
  function take(id) {
    var v = read();
    if (!v[id]) return false;
    delete v[id];
    write(v);
    changed({ id: id, action: 'take' });
    return true;
  }

  // ---- the "found" slip: a scrap of paper that drops in at the top of the screen ----
  var slipBox = null;
  function css() {
    if (document.getElementById('rp-inv-css')) return;
    var s = document.createElement('style');
    s.id = 'rp-inv-css';
    s.textContent =
      '.rp-slips{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483000;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none}' +
      '.rp-slip{display:flex;align-items:center;gap:12px;min-width:230px;max-width:min(92vw,380px);padding:9px 16px 9px 10px;background:#f1ead6;color:#2b2412;' +
      'font:14px "Special Elite","Courier New",monospace;box-shadow:0 2px 2px rgba(0,0,0,.25),0 12px 24px -8px rgba(0,0,0,.7);transform:rotate(-1.2deg);' +
      'animation:rp-slip-in .45s cubic-bezier(.3,1.4,.5,1) both}' +
      '.rp-slip.out{animation:rp-slip-out .35s ease-in forwards}' +
      '.rp-slip .art{flex:none;width:40px;height:40px;display:grid;place-items:center}' +
      '.rp-slip .art img{max-width:100%;max-height:100%;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))}' +
      '.rp-slip small{display:block;font-size:11px;letter-spacing:2px;color:#7a6a45;text-transform:uppercase}' +
      '.rp-slip b{display:block;font:400 18px "Permanent Marker","Comic Sans MS",cursive;letter-spacing:.5px}' +
      '@keyframes rp-slip-in{from{opacity:0;transform:translateY(-30px) rotate(-6deg)}to{opacity:1;transform:rotate(-1.2deg)}}' +
      '@keyframes rp-slip-out{to{opacity:0;transform:translateY(-20px) rotate(3deg)}}' +
      '[data-item]{cursor:pointer}' +
      '[data-item].rp-taken{animation:rp-taken .35s ease-in forwards;pointer-events:none}' +
      '@keyframes rp-taken{to{opacity:0;transform:scale(.4) rotate(-20deg)}}' +
      '@media (prefers-reduced-motion:reduce){.rp-slip,.rp-slip.out,[data-item].rp-taken{animation-duration:.01s}}';
    document.head.appendChild(s);
  }
  function slip(id) {
    catalog().then(function (cat) {
      var item = cat[id] || {};
      css();
      if (!slipBox || !slipBox.isConnected) {
        slipBox = document.createElement('div');
        slipBox.className = 'rp-slips';
        slipBox.setAttribute('role', 'status');
        slipBox.setAttribute('aria-live', 'polite');
        document.body.appendChild(slipBox);
      }
      var el = document.createElement('div');
      el.className = 'rp-slip';
      var art = document.createElement('span');
      art.className = 'art';
      if (item.art) { var img = new Image(); img.src = item.art; img.alt = ''; art.appendChild(img); }
      var words = document.createElement('span');
      var small = document.createElement('small'); small.textContent = item.found || 'into the drawer';
      var b = document.createElement('b'); b.textContent = item.name || id;
      words.appendChild(small); words.appendChild(b);
      el.appendChild(art); el.appendChild(words);
      slipBox.appendChild(el);
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { el.remove(); }, 400);
      }, 3200);
    });
  }

  // ---- pickups: anything on the page with data-item="<id>" ----
  function wire(root) {
    [].forEach.call((root || document).querySelectorAll('[data-item]:not([data-item-wired])'), function (el) {
      var id = el.getAttribute('data-item');
      el.setAttribute('data-item-wired', '');
      if (has(id) && !el.hasAttribute('data-item-keep')) { el.hidden = true; el.style.display = 'none'; return; }
      if (!el.hasAttribute('tabindex') && !/^(A|BUTTON)$/.test(el.tagName)) el.setAttribute('tabindex', '0');
      function grab(e) {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        if (!give(id) && !el.hasAttribute('data-item-keep')) { el.hidden = true; return; }
        if (el.hasAttribute('data-item-keep')) return;
        css();
        el.classList.add('rp-taken');
        setTimeout(function () { el.hidden = true; el.style.display = 'none'; }, 360);
      }
      el.addEventListener('click', grab);
      el.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') grab(e); });
    });
  }

  // Another tab gave or took something: tell this page too.
  window.addEventListener('storage', function (e) { if (e.key === KEY) changed({ action: 'sync' }); });

  window.RPInventory = { give: give, take: take, has: has, list: list, catalog: catalog, wire: wire };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { wire(); });
  else wire();
})();
