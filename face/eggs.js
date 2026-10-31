// ==========================================================
// Render Vision Easter eggs. Loaded automatically by /face/popup.js,
// so every page with popups gets these too.
//
// 1. COME BACK: switch to another tab and the page's title starts
//    begging you to return. Coming back after a while may get a popup.
// 2. KONAMI CODE: up up down down left right left right B A on any
//    page and Render Vision takes over the site for a few seconds.
// ==========================================================
(function () {
  'use strict';
  if (window.RenderEggs) return;
  window.RenderEggs = true;

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
})();
