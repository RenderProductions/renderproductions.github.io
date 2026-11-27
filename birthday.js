// Birthdays on the site: confetti and a little banner while a birthday party is on (Eastern time, like the bot).
//  - RendConomy Big Birthday Blowout!: November 9 to 15 (from 2027; the bot arrived on November 9, 2026)
//  - Render Vision's Big Birthday!: August 17 to 19
// Reduced motion gets the banner without the confetti. Switch it off in Settings on the profile page.
// Preview any time with ?birthday=bot or ?birthday=dev.
(function () {
  try { if ((JSON.parse(localStorage.getItem('rp_prefs') || '{}')).birthday === false) return; } catch (e) {}
  var kind = null, age = 1;
  try {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    var get = function (t) { return Number((parts.filter(function (p) { return p.type === t; })[0] || {}).value); };
    var y = get('year'), m = get('month'), d = get('day');
    if (y > 2026 && m === 11 && d >= 9 && d <= 15) kind = 'bot';
    if (y > 2026 && m === 8 && d >= 17 && d <= 19) kind = 'dev';
    age = Math.max(1, y - 2026);
    var force = /[?&]birthday=(bot|dev)\b/.exec(location.search);
    if (force) kind = force[1];
  } catch (e) { return; }
  if (!kind) return;
  window.RP_BIRTHDAY = { kind: kind, age: age };
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  var css = document.createElement('style');
  css.textContent =
    '.rp-bday{position:fixed;left:14px;bottom:14px;z-index:9996;display:flex;align-items:center;gap:8px;padding:7px 12px 7px 10px;' +
    'font:500 13px/1.2 "IBM Plex Mono",monospace;color:#fff;background:linear-gradient(90deg,#ff7eb6,#b07cff);border:1px solid rgba(255,255,255,.35);' +
    'box-shadow:0 4px 18px rgba(255,126,182,.35);text-decoration:none;max-width:calc(100vw - 28px)}' +
    '.rp-bday:hover{filter:brightness(1.08)}.rp-bday b{font-weight:600}.rp-bday .x{margin-left:4px;opacity:.75;cursor:pointer;padding:0 2px}' +
    '.rp-confetti{position:fixed;inset:0;pointer-events:none;z-index:9997}';
  document.head.appendChild(css);

  var hidden = false;
  try { hidden = sessionStorage.getItem('rp_bday_hide') === '1'; } catch (e) {}
  if (!hidden) {
    var a = document.createElement('a');
    a.className = 'rp-bday';
    a.href = '/birthday/';
    a.innerHTML = kind === 'bot' ? '<span aria-hidden="true">🎂</span><span><b>RendConomy is ' + age + '!</b> Birthday Week</span>'
      : '<span aria-hidden="true">🎈</span><span><b>Render Vision\'s Big Birthday!</b></span>';
    var x = document.createElement('span');
    x.className = 'x'; x.textContent = '×'; x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Hide the birthday banner');
    x.addEventListener('click', function (e) { e.preventDefault(); a.remove(); try { sessionStorage.setItem('rp_bday_hide', '1'); } catch (er) {} });
    a.appendChild(x);
    (document.body ? Promise.resolve() : new Promise(function (r) { addEventListener('DOMContentLoaded', r); })).then(function () { document.body.appendChild(a); });
  }
  if (still) return;

  // ---- one burst of confetti when the page opens, then a few pieces drifting down for a while ----
  var cv = document.createElement('canvas');
  cv.className = 'rp-confetti'; cv.setAttribute('aria-hidden', 'true');
  var start = function () {
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d'), dpr = Math.min(2, window.devicePixelRatio || 1), W, H;
    var size = function () { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size(); addEventListener('resize', size);
    var colors = ['#ff7eb6', '#ffe600', '#4da3ff', '#3ddc84', '#b07cff', '#ff9f1c'];
    var bits = [], t0 = performance.now();
    var add = function (burst) {
      bits.push({ x: burst ? W / 2 + (Math.random() - 0.5) * 120 : Math.random() * W, y: burst ? H * 0.35 : -10,
        vx: burst ? (Math.random() - 0.5) * 9 : (Math.random() - 0.5) * 0.6, vy: burst ? -Math.random() * 9 - 2 : Math.random() * 1 + 0.6,
        r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3, w: 5 + Math.random() * 4, h: 3 + Math.random() * 3, c: colors[(Math.random() * colors.length) | 0] });
    };
    for (var i = 0; i < 90; i++) add(true);
    var frame = function (now) {
      var age = now - t0;
      if (age < 14000 && Math.random() < 0.25) add(false);
      ctx.clearRect(0, 0, W, H);
      for (var j = bits.length - 1; j >= 0; j--) {
        var b = bits[j];
        b.vy += 0.12; b.vx *= 0.99; if (b.vy > 2.2) b.vy = 2.2;
        b.x += b.vx + Math.sin((now + j * 300) / 600) * 0.3; b.y += b.vy; b.r += b.vr;
        if (b.y > H + 20) { bits.splice(j, 1); continue; }
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.r * 2))); ctx.restore();
      }
      if (age < 14000 || bits.length) requestAnimationFrame(frame); else cv.remove();
    };
    requestAnimationFrame(frame);
  };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start);
})();
