// ==========================================================
// Render Vision popups: XP-style "System Alert!" windows with a tiny face.
//
// Include on a page:
//   <script src="/face/popup.js" data-odds="20"></script>
//     -> 1 in 20 page views, one popup shows up after a short random delay.
//   <script src="/face/popup.js" data-every="45-90"></script>
//     -> a popup every 45 to 90 seconds (used on /face/).
//   (The homepage, market, company, bot, games and 404 pages use data-odds="20".)
//   No attributes: nothing appears on its own; call RenderPopup.spawn() yourself.
//
// Edit the MESSAGES and TITLES lists below to change what it says.
// ==========================================================
(function () {
  'use strict';
  if (window.RenderPopup) return;

  var MESSAGES = [
    'RENDER VISION HAS DETECTED A USER.',
    'YOU HAVE BEEN WATCHED FOR {seconds} SECONDS.',
    'DO NOT CLOSE THIS WINDOW.',
    'ARE YOU STILL THERE?',
    'I CAN SEE YOUR CURSOR.',
    'ERROR: TOO MUCH FUN DETECTED.',
    'HAVE YOU CHECKED THE MARKET TODAY?',
    'THIS IS FINE.',
    'PLEASE REMAIN CALM.',
    'HELLO :)'
  ];
  var TITLES = ['System Alert!', 'Render Vision', 'Warning', 'Important Message'];
  var DODGE_LINES = ['NOPE.', 'MISSED ME.', 'TOO SLOW.', 'NICE TRY.'];
  var DODGE_CHANCE = 0.35;   // chance the window jumps away instead of closing
  var MAX_OPEN = 5;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var started = Date.now();
  var open = [];
  var topZ = 9990;

  // ---------- Styles (injected once) ----------
  var css = [
    '.rv-pop{position:fixed;width:min(310px,calc(100vw - 16px));border:3px solid #0A246A;border-radius:8px 8px 0 0;',
    'background:#ECE9D8;font:11px Tahoma,Verdana,sans-serif;color:#000;user-select:none;overflow:hidden;',
    'box-shadow:4px 4px 0 rgba(0,0,0,.45),0 0 18px rgba(0,84,227,.45);animation:rvGlow 2s ease-in-out infinite}',
    '.rv-pop.rv-shake{animation:rvShake .12s linear 5,rvGlow 2s ease-in-out infinite}',
    '.rv-pop.rv-big{width:min(430px,calc(100vw - 16px))}',
    '.rv-title{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:3px 4px 3px 8px;',
    'background:linear-gradient(to bottom,#0054E3 0%,#0099FF 100%);color:#fff;font-weight:bold;cursor:grab;',
    'border-radius:5px 5px 0 0;box-shadow:inset 0 1px 0 rgba(255,255,255,.4);touch-action:none}',
    '.rv-title:active{cursor:grabbing}',
    '.rv-title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rv-btns{display:flex;gap:2px;flex:none}',
    '.rv-btn{width:18px;height:16px;padding:0;background:linear-gradient(to bottom,#D4D0C8,#B0A090);',
    'border:1px solid #fff;border-right-color:#404040;border-bottom-color:#404040;font:bold 9px Tahoma,sans-serif;',
    'color:#000;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.rv-btn:active{border-color:#404040 #fff #fff #404040}',
    '.rv-btn.rv-x{background:linear-gradient(to bottom,#E8775B,#C1361B);color:#fff}',
    '.rv-body{position:relative;display:flex;gap:12px;align-items:center;padding:14px}',
    '.rv-body::before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.5;',
    'background-image:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,0,0,.05) 10px,rgba(255,0,0,.05) 20px)}',
    '.rv-pop.rv-min .rv-body{display:none}',
    '.rv-face{flex:none;width:64px;height:64px}',
    '.rv-pop.rv-big .rv-face{width:96px;height:96px}',
    '.rv-msg{position:relative;font-weight:bold;color:#000080;font-size:12px;line-height:1.4}',
    '.rv-pop.rv-big .rv-msg{font-size:14px}',
    '@keyframes rvShake{0%,100%{translate:0 0}25%{translate:-4px 2px}50%{translate:3px -2px}75%{translate:-2px -3px}}',
    '@keyframes rvGlow{50%{box-shadow:4px 4px 0 rgba(0,0,0,.45),0 0 28px rgba(0,153,255,.7)}}',
    '@media (prefers-reduced-motion:reduce){.rv-pop,.rv-pop.rv-shake{animation:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Tiny face ----------
  var FACE_SVG =
    '<svg class="rv-face" viewBox="0 0 64 64" aria-hidden="true">' +
    '<rect x="2" y="2" width="60" height="60" rx="9" fill="#05070d" stroke="#ffe600" stroke-width="3"/>' +
    '<rect x="8" y="8" width="48" height="48" rx="5" fill="#080c16"/>' +
    '<g class="rv-eyes"><rect class="rv-eye" x="18" y="18" width="7" height="17" rx="2" fill="#ffe600"/>' +
    '<rect class="rv-eye" x="39" y="18" width="7" height="17" rx="2" fill="#ffe600"/></g>' +
    '<path class="rv-mouth" d="M20 44 Q32 51 44 44" fill="none" stroke="#ffe600" stroke-width="3" stroke-linecap="round"/>' +
    '</svg>';

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  function fill(text) {
    return text.replace('{seconds}', Math.max(1, Math.round((Date.now() - started) / 1000)));
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function place(win, x, y) {
    var w = win.offsetWidth, h = win.offsetHeight;
    x = clamp(x, 4, window.innerWidth - w - 4);
    y = clamp(y, 4, window.innerHeight - Math.min(h, 40) - 4);
    win.style.left = x + 'px';
    win.style.top = y + 'px';
  }
  function randomSpot(win) {
    place(win,
      Math.random() * (window.innerWidth - win.offsetWidth),
      Math.random() * (window.innerHeight - win.offsetHeight));
  }
  function shake(win) {
    if (reduce) return;
    win.classList.remove('rv-shake');
    void win.offsetWidth;
    win.classList.add('rv-shake');
  }
  function setMood(win, mood) {
    var eyes = win.querySelectorAll('.rv-eye'), mouth = win.querySelector('.rv-mouth');
    var color = mood === 'angry' ? '#ff4d4d' : '#ffe600';
    for (var i = 0; i < eyes.length; i++) {
      eyes[i].setAttribute('fill', color);
      eyes[i].setAttribute('height', mood === 'angry' ? 9 : 17);
      eyes[i].setAttribute('y', mood === 'angry' ? 24 : 18);
    }
    mouth.setAttribute('stroke', color);
    mouth.setAttribute('d', mood === 'angry' ? 'M20 48 Q32 41 44 48' : 'M20 44 Q32 51 44 44');
  }

  function close(win) {
    var i = open.indexOf(win);
    if (i >= 0) open.splice(i, 1);
    win.remove();
    document.dispatchEvent(new CustomEvent('renderpopup:close'));
  }

  function spawn(opts) {
    opts = opts || {};
    if (open.length >= MAX_OPEN) return null;

    var win = document.createElement('div');
    win.className = 'rv-pop';
    win.setAttribute('role', 'dialog');
    win.style.zIndex = ++topZ;
    win.innerHTML =
      '<div class="rv-title"><span>⚠️ ' + '</span><div class="rv-btns">' +
      '<button class="rv-btn" type="button" data-act="min" aria-label="Minimize">_</button>' +
      '<button class="rv-btn" type="button" data-act="max" aria-label="Maximize">□</button>' +
      '<button class="rv-btn rv-x" type="button" data-act="close" aria-label="Close">✕</button>' +
      '</div></div><div class="rv-body">' + FACE_SVG + '<p class="rv-msg"></p></div>';
    var title = opts.title || pick(TITLES);
    win.querySelector('.rv-title span').textContent = '⚠️ ' + title;
    win.setAttribute('aria-label', title);
    var msgEl = win.querySelector('.rv-msg');
    msgEl.textContent = fill(opts.message || pick(MESSAGES));
    document.body.appendChild(win);
    open.push(win);
    if (typeof opts.x === 'number') place(win, opts.x, opts.y); else randomSpot(win);
    if (opts.mood === 'angry') setMood(win, 'angry');
    shake(win);

    // Bring to front when touched
    win.addEventListener('pointerdown', function () { win.style.zIndex = ++topZ; });

    // Buttons
    var dodged = 0;
    win.querySelector('.rv-btns').addEventListener('click', function (e) {
      var act = e.target.getAttribute('data-act');
      if (act === 'min') win.classList.toggle('rv-min');
      if (act === 'max') { win.classList.toggle('rv-big'); place(win, win.offsetLeft, win.offsetTop); }
      if (act === 'close') {
        // Sometimes it runs away instead. It gives up after two dodges.
        if (dodged < 2 && Math.random() < DODGE_CHANCE) {
          dodged++;
          msgEl.textContent = pick(DODGE_LINES);
          setMood(win, 'angry');
          randomSpot(win);
          shake(win);
          setTimeout(function () { setMood(win, opts.mood === 'angry' ? 'angry' : 'calm'); }, 1200);
        } else {
          close(win);
        }
      }
    });

    // Drag by the title bar
    var bar = win.querySelector('.rv-title'), drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.rv-btn')) return;
      drag = { dx: e.clientX - win.offsetLeft, dy: e.clientY - win.offsetTop };
      bar.setPointerCapture(e.pointerId);
    });
    bar.addEventListener('pointermove', function (e) {
      if (drag) place(win, e.clientX - drag.dx, e.clientY - drag.dy);
    });
    bar.addEventListener('pointerup', function () { drag = null; });
    bar.addEventListener('pointercancel', function () { drag = null; });

    return win;
  }

  // Tiny faces' eyes follow the pointer
  document.addEventListener('pointermove', function (e) {
    for (var i = 0; i < open.length; i++) {
      var box = open[i].querySelector('.rv-face').getBoundingClientRect();
      var dx = clamp((e.clientX - (box.left + box.width / 2)) / 120, -1, 1) * 4;
      var dy = clamp((e.clientY - (box.top + box.height / 2)) / 120, -1, 1) * 4;
      open[i].querySelector('.rv-eyes').setAttribute('transform', 'translate(' + dx.toFixed(1) + ' ' + dy.toFixed(1) + ')');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open.length) close(open[open.length - 1]);
  });

  window.RenderPopup = { spawn: spawn, count: function () { return open.length; } };

  // ---------- Automatic modes ----------
  var me = document.currentScript;
  if (!me) return;
  var odds = parseInt(me.getAttribute('data-odds'), 10);
  var every = me.getAttribute('data-every');

  if (odds > 0 && Math.floor(Math.random() * odds) === 0) {
    setTimeout(function () { spawn(); }, 8000 + Math.random() * 22000);
  }
  if (every) {
    var range = every.split('-').map(Number);
    var lo = range[0] * 1000, hi = (range[1] || range[0]) * 1000;
    (function loop() {
      setTimeout(function () {
        if (!document.hidden) spawn();
        loop();
      }, lo + Math.random() * (hi - lo));
    })();
  }
})();
