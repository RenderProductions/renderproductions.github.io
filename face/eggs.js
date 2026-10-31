// ==========================================================
// Render Vision Easter eggs. Loaded automatically by /face/popup.js,
// so every page with popups gets these too.
//
// 1. COME BACK: switch to another tab and the page's title starts
//    begging you to return. Coming back after a while may get a popup.
// 2. KONAMI CODE: up up down down left right left right B A on any
//    page and Render Vision takes over the site for a few seconds.
// 3. PEEKING FACE: now and then a little Render Vision peeks in from an
//    edge of the screen and stares. Touch him and he panics and runs off.
//    (Try it now from the console: RenderEggs.peek())
// ==========================================================
(function () {
  'use strict';
  if (window.RenderEggs) return;
  window.RenderEggs = {};

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }
  var backstage = location.pathname.indexOf('/backstage/') === 0;

  // ---------- 1. Come back ----------
  var AWAY_TITLES = [
    'COME BACK.',
    'I CAN STILL SEE YOU.',
    'WHERE DID YOU GO?',
    'PLEASE COME BACK :(',
    '(1) NEW MESSAGE FROM RENDER VISION',
    'IT\'S QUIET WITHOUT YOU.',
    'I\'LL WAIT.'
  ];
  var AWAY_TITLES_BACKSTAGE = [
    'DON\'T LEAVE THE DOOR OPEN.',
    'I KNOW YOU WERE HERE.',
    'COME BACK.',
    'YOU CAN\'T UNSEE IT.'
  ];
  var WELCOME_BACK = [
    'WELCOME BACK.',
    'WHERE WERE YOU?',
    'I COUNTED THE SECONDS. ALL OF THEM.',
    'DON\'T DO THAT AGAIN.'
  ];

  var realTitle = document.title, awayTimer = null, leftAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      realTitle = document.title;
      leftAt = Date.now();
      var list = backstage ? AWAY_TITLES_BACKSTAGE : AWAY_TITLES;
      var i = Math.floor(Math.random() * list.length);
      // Wait a moment first, so a quick tab flick doesn't trigger it.
      awayTimer = setTimeout(function swap() {
        document.title = list[i++ % list.length];
        awayTimer = setTimeout(swap, 4000);
      }, 1500);
    } else {
      clearTimeout(awayTimer);
      document.title = realTitle;
      var gone = Date.now() - leftAt;
      if (leftAt && gone > 20000 && Math.random() < 0.35 && window.RenderPopup) {
        setTimeout(function () {
          window.RenderPopup.spawn({ title: 'Render Vision', message: pick(WELCOME_BACK) });
        }, 600);
      }
    }
  });

  // ---------- 2. Konami code ----------
  var CODE = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];
  var LAUGHS = [
    'HAHAHAHAHA',
    'YOU FOUND IT.',
    'UP UP DOWN DOWN. CLASSIC.',
    'THIS SITE IS MINE NOW.',
    'HA. HA. HA.'
  ];
  var pos = 0, busy = false;

  var css = [
    '.rv-take{position:fixed;inset:0;z-index:9980;pointer-events:none;display:flex;align-items:center;justify-content:center;',
    'backdrop-filter:hue-rotate(-55deg) saturate(1.8) contrast(1.1);-webkit-backdrop-filter:hue-rotate(-55deg) saturate(1.8) contrast(1.1);',
    'background:radial-gradient(ellipse at center,rgba(255,0,0,.12),rgba(80,0,0,.45));opacity:0;transition:opacity .25s}',
    '.rv-take.on{opacity:1}',
    '.rv-take::before{content:"";position:absolute;inset:0;opacity:.18;',
    'background-image:url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'160\' height=\'160\'><filter id=\'n\'><feTurbulence type=\'fractalNoise\' baseFrequency=\'0.9\' numOctaves=\'2\' stitchTiles=\'stitch\'/></filter><rect width=\'100%\' height=\'100%\' filter=\'url(%23n)\'/></svg>")}',
    '.rv-take p{position:relative;margin:0 1rem;text-align:center;font:400 clamp(36px,8vw,84px)/1 VT323,"Courier New",monospace;',
    'letter-spacing:3px;color:#ff4d4d;text-shadow:0 0 18px rgba(255,40,40,.8),3px 0 0 rgba(0,200,255,.5),-3px 0 0 rgba(255,230,0,.4);',
    'animation:rvTakeJit .09s steps(2) infinite}',
    '@keyframes rvTakeJit{50%{transform:translate(2px,-1px) skewX(-2deg)}}',
    'html.rv-quake{animation:rvQuake .1s linear 12}',
    '@keyframes rvQuake{0%,100%{translate:0 0}25%{translate:-5px 3px}50%{translate:4px -3px}75%{translate:-3px -4px}}',
    '@media (prefers-reduced-motion:reduce){.rv-take p,html.rv-quake{animation:none}}'
  ].join('');

  function takeover() {
    if (busy) return;
    busy = true;
    if (!document.getElementById('rv-take-css')) {
      var st = document.createElement('style');
      st.id = 'rv-take-css';
      st.textContent = css;
      document.head.appendChild(st);
    }
    var layer = document.createElement('div');
    layer.className = 'rv-take';
    layer.setAttribute('role', 'alert');
    var text = document.createElement('p');
    text.textContent = 'RENDER VISION HAS TAKEN OVER.';
    layer.appendChild(text);
    document.body.appendChild(layer);
    requestAnimationFrame(function () { layer.classList.add('on'); });
    if (!reduce) {
      document.documentElement.classList.remove('rv-quake');
      void document.documentElement.offsetWidth;
      document.documentElement.classList.add('rv-quake');
    }

    var oldTitle = document.title;
    document.title = 'RENDER VISION HAS TAKEN OVER.';

    if (window.RenderPopup) {
      LAUGHS.forEach(function (msg, n) {
        setTimeout(function () {
          window.RenderPopup.spawn({ title: 'Render Vision', message: msg, mood: 'angry', theme: 'red' });
        }, 400 + n * 300);
      });
    }

    setTimeout(function () { text.textContent = 'JUST KIDDING.'; }, 4200);
    setTimeout(function () {
      layer.classList.remove('on');
      document.documentElement.classList.remove('rv-quake');
      if (document.title === 'RENDER VISION HAS TAKEN OVER.') document.title = oldTitle;
      setTimeout(function () { layer.remove(); busy = false; }, 300);
    }, 5600);
  }

  document.addEventListener('keydown', function (e) {
    var key = (e.key || '').toLowerCase();
    if (key === CODE[pos]) {
      pos++;
      if (pos === CODE.length) { pos = 0; takeover(); }
    } else {
      // A third "up" still leaves you two ups into the code.
      pos = key === 'arrowup' ? (pos === 2 ? 2 : 1) : 0;
    }
  });
  // ---------- 3. The peeking face ----------
  // Every so often a little Render Vision peeks in from an edge of the screen
  // and stares. Touch him with the pointer (or tap him) and he panics and flees.
  var PEEK_FIRST = [25, 75];     // seconds before the first possible peek
  var PEEK_AGAIN = [90, 200];    // seconds between later chances
  var PEEK_CHANCE = 0.5;         // chance he actually shows up each time
  var PEEK_STAY = 9000;          // he gives up and leaves after this long
  var FOUND_LINES = ['OH NO THEY FOUND ME!', 'ABORT! ABORT!', 'I WASN\'T HERE!', 'YOU SAW NOTHING!'];

  var peekCss = [
    '.rv-peek{position:fixed;width:0;height:0;z-index:9970;pointer-events:none}',
    '.rv-peek-body{position:absolute;left:-40px;top:0;width:80px;height:92px;pointer-events:auto;cursor:pointer;',
    'transform:translateY(8px);transition:transform .9s cubic-bezier(.2,.8,.3,1);filter:drop-shadow(0 0 10px rgba(255,230,0,.35))}',
    '.rv-peek.up .rv-peek-body{transform:translateY(-52px)}',
    '.rv-peek.found .rv-peek-body{animation:rvFound .75s cubic-bezier(.3,0,.5,1) forwards;transition:none}',
    '@keyframes rvFound{0%{transform:translateY(-52px)}22%{transform:translateY(-82px) scale(1.12) rotate(-6deg)}',
    '40%{transform:translateY(-74px) scale(1.08) rotate(5deg)}100%{transform:translateY(40px) scale(.9)}}',
    '.rv-bubble{position:fixed;z-index:9971;pointer-events:none;background:#fff;color:#000;border:2px solid #000;border-radius:10px;',
    'padding:6px 10px;font:bold 12px Tahoma,Verdana,sans-serif;white-space:nowrap;box-shadow:3px 3px 0 rgba(0,0,0,.4);',
    'animation:rvPop .15s ease-out}',
    '@keyframes rvPop{from{transform:scale(.6);opacity:0}}',
    '@media (prefers-reduced-motion:reduce){.rv-peek-body{transition:opacity .4s;transform:translateY(-52px);opacity:0}',
    '.rv-peek.up .rv-peek-body{opacity:1}.rv-peek.found .rv-peek-body{animation:none;opacity:0}.rv-bubble{animation:none}}'
  ].join('');

  var PEEK_SVG =
    '<svg viewBox="0 0 80 92" width="80" height="92" aria-hidden="true">' +
    '<line x1="40" y1="14" x2="40" y2="4" stroke="#5a6278" stroke-width="3" stroke-linecap="round"/>' +
    '<circle class="pk-led" cx="40" cy="4" r="4" fill="#ffe600"/>' +
    '<rect x="4" y="14" width="72" height="74" rx="12" fill="#05070d" stroke="#ffe600" stroke-width="3"/>' +
    '<rect x="11" y="21" width="58" height="60" rx="7" fill="#080c16"/>' +
    '<g class="pk-eyes"><rect class="pk-eye" x="23" y="30" width="9" height="22" rx="3" fill="#ffe600"/>' +
    '<rect class="pk-eye" x="48" y="30" width="9" height="22" rx="3" fill="#ffe600"/></g>' +
    '<rect class="pk-mouth" x="30" y="64" width="20" height="4" rx="2" fill="#ffe600"/>' +
    '<circle class="pk-o" cx="40" cy="66" r="5" fill="none" stroke="#ffe600" stroke-width="3" opacity="0"/>' +
    '</svg>';

  var peekEl = null;

  function peek() {
    if (peekEl || document.hidden) return;
    if (!document.getElementById('rv-peek-css')) {
      var st = document.createElement('style');
      st.id = 'rv-peek-css';
      st.textContent = peekCss;
      document.head.appendChild(st);
    }
    var W = window.innerWidth, H = window.innerHeight;
    // Pick an edge. Bottom is the most common; the top has him hanging upside down.
    var edges = ['bottom', 'bottom', 'left', 'right', 'top'];
    var edge = pick(edges);
    var x, y, rot;
    if (edge === 'bottom') { x = W * (0.12 + Math.random() * 0.76); y = H; rot = 0; }
    if (edge === 'top')    { x = W * (0.12 + Math.random() * 0.76); y = 0; rot = 180; }
    if (edge === 'left')   { x = 0; y = H * (0.25 + Math.random() * 0.6); rot = 90; }
    if (edge === 'right')  { x = W; y = H * (0.25 + Math.random() * 0.6); rot = -90; }

    var wrap = document.createElement('div');
    wrap.className = 'rv-peek';
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    wrap.style.transform = 'rotate(' + rot + 'deg)';
    var body = document.createElement('div');
    body.className = 'rv-peek-body';
    body.innerHTML = PEEK_SVG;
    wrap.appendChild(body);
    document.body.appendChild(wrap);
    peekEl = wrap;

    var eyes = body.querySelector('.pk-eyes');
    var rad = -rot * Math.PI / 180;
    function stare(e) {
      // Look toward the pointer (turned into the head's own sideways/upside-down frame).
      var dx = e.clientX - x, dy = e.clientY - y;
      var lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      var ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      var len = Math.hypot(lx, ly) || 1;
      eyes.setAttribute('transform', 'translate(' + (lx / len * 5).toFixed(1) + ' ' + (ly / len * 4).toFixed(1) + ')');
    }
    document.addEventListener('pointermove', stare);

    // Blink once in a while so he looks alive.
    var blinker = setInterval(function () {
      var e2 = body.querySelectorAll('.pk-eye');
      for (var i = 0; i < e2.length; i++) { e2[i].setAttribute('height', 3); e2[i].setAttribute('y', 40); }
      setTimeout(function () {
        for (var i = 0; i < e2.length; i++) { e2[i].setAttribute('height', 22); e2[i].setAttribute('y', 30); }
      }, 140);
    }, 2600);

    function cleanup(delay) {
      clearInterval(blinker);
      clearTimeout(leaveTimer);
      document.removeEventListener('pointermove', stare);
      setTimeout(function () { wrap.remove(); peekEl = null; }, delay);
    }

    var found = false;
    function onFound() {
      if (found) return;
      found = true;
      // Shock: wide eyes, little "o" mouth, red light, then he bolts.
      var e2 = body.querySelectorAll('.pk-eye');
      for (var i = 0; i < e2.length; i++) {
        e2[i].setAttribute('height', 26); e2[i].setAttribute('y', 27);
        e2[i].setAttribute('width', 11);
      }
      body.querySelector('.pk-mouth').setAttribute('opacity', '0');
      body.querySelector('.pk-o').setAttribute('opacity', '1');
      body.querySelector('.pk-led').setAttribute('fill', '#ff4d4d');
      wrap.classList.add('found');

      // Speech bubble, upright, a little inside the screen from where he was.
      var bubble = document.createElement('div');
      bubble.className = 'rv-bubble';
      bubble.textContent = pick(FOUND_LINES);
      document.body.appendChild(bubble);
      var nx = edge === 'left' ? 1 : edge === 'right' ? -1 : 0;
      var ny = edge === 'top' ? 1 : edge === 'bottom' ? -1 : 0;
      var bx = x + nx * 110, by = y + ny * 120;
      var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      bubble.style.left = Math.max(6, Math.min(W - bw - 6, bx - bw / 2)) + 'px';
      bubble.style.top = Math.max(6, Math.min(H - bh - 6, by - bh / 2)) + 'px';
      setTimeout(function () { bubble.remove(); }, 1400);
      cleanup(900);
    }
    body.addEventListener('pointerenter', onFound);
    body.addEventListener('pointerdown', onFound);

    requestAnimationFrame(function () { requestAnimationFrame(function () { wrap.classList.add('up'); }); });

    // Nobody noticed him: he slowly sinks back out of view.
    var leaveTimer = setTimeout(function () {
      if (found) return;
      wrap.classList.remove('up');
      cleanup(1000);
    }, PEEK_STAY);
  }

  function schedulePeek(range) {
    var ms = (range[0] + Math.random() * (range[1] - range[0])) * 1000;
    setTimeout(function () {
      if (Math.random() < PEEK_CHANCE) peek();
      schedulePeek(PEEK_AGAIN);
    }, ms);
  }
  // The big face lives on /face/, so the little one stays away from there.
  if (location.pathname.indexOf('/face/') !== 0) schedulePeek(PEEK_FIRST);

  window.RenderEggs = { peek: peek, takeover: takeover };
})();
