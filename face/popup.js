// ==========================================================
// Render Vision popups: XP-style "System Alert!" windows with a tiny face.
//
// Include on a page:
//   <script src="/face/popup.js" data-odds="20"></script>
//     -> 1 in 20 page views, one popup shows up after a short random delay.
//   <script src="/face/popup.js" data-every="45-90"></script>
//     -> a popup every 45 to 90 seconds (/face/ and backstage use this).
//   Most pages use data-odds="10"; the games use data-odds="20".
//   Add data-page="404" (or any key from PAGES) to force a page's lines.
//   No attributes: nothing appears on its own; call RenderPopup.spawn() yourself.
//
// What it says:
//   MESSAGES  - general lines, used anywhere.
//   PAGES     - lines for one part of the site, matched by the address.
//   COMPANY   - lines for company pages; {ticker} and {name} get filled in.
//   TICKERS   - extra lines for one specific company.
// On a page with its own lines, about 70% of popups use them (90% backstage).
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

  // Longest match wins, so /backstage/frequency/ beats /backstage/.
  // theme: 'red' gives the window a red "something is wrong" look.
  var PAGES = {
    '/': {
      exact: true,
      lines: [
        'WELCOME TO RENDER PRODUCTIONS. I RUN THIS PLACE.',
        'THE BIOS SAID "WHAT?" I SAID "WHAT?" TOO.',
        'CLICK THE FACE. I DARE YOU.',
        'WE MAY OR MAY NOT KNOW WHAT WE\'RE DOING.',
        'JOIN THE RENDER ROOM. EVERYONE ELSE DID.'
      ]
    },
    '/rend-conomy/': {
      lines: [
        'BUY BNW!!',
        'BUY BNW. TRUST ME.',
        'SELL EVERYTHING. (THIS IS NOT FINANCIAL ADVICE.)',
        'STONKS.',
        'THE MARKET IS FAKE. MY FEELINGS ARE REAL.',
        'RRM TO THE MOON.',
        'I HAVE INSIDER INFORMATION. I WILL NOT SHARE IT.',
        'NUMBER GO UP. NUMBER GO DOWN. NUMBER GO UP.'
      ],
      titles: ['Market Alert!', 'Trading Tip', 'System Alert!']
    },
    '/bot/': {
      lines: [
        'TYPE r!help. I\'LL WAIT.',
        'THE BOT AND I ARE NOT RELATED. PROBABLY.',
        'ADD ME TO YOUR SERVER. PLEASE.',
        'r!daily. DO IT. DO IT NOW.'
      ]
    },
    '/bot/privacy/': {
      lines: [
        'I KNOW WHERE YOUR CURSOR IS. THAT\'S NOT IN THE POLICY.',
        'YOUR DATA IS SAFE. I\'M JUST LOOKING AT IT.',
        'I DON\'T STORE YOUR MESSAGES. I REMEMBER THEM.'
      ]
    },
    '/bot/terms/': {
      lines: [
        'YOU DIDN\'T READ ALL OF THIS. NOBODY DOES.',
        'BY CLOSING THIS WINDOW YOU AGREE TO NOTHING.',
        'SECTION 7: RENDER VISION IS ALWAYS RIGHT.'
      ]
    },
    '/games/': {
      lines: [
        'PLAY RFT. THE MARKET NEEDS YOUR FILES.',
        'I\'M BETTER AT CHESS THAN YOU.',
        'SOME GAMES DON\'T COME BACK.',
        'INSERT COIN.'
      ]
    },
    '/face/': {
      lines: [
        'THAT\'S ME. HI.',
        'STOP STARING. (DON\'T STOP.)',
        'I\'M RIGHT HERE. AND HERE. AND HERE.',
        'TRY SPINNING ME. NO, DON\'T.'
      ]
    },
    '404': {
      lines: [
        'YOU\'RE LOST. I\'M NOT.',
        'THIS PAGE DOESN\'T EXIST. NEITHER DO I.',
        'DO YOU REMEMBER WHAT IT WAS CALLED?',
        'NOTHING IS BROADCASTING HERE. EXCEPT ME.'
      ],
      titles: ['Error 404', 'System Alert!']
    },
    '/backstage/': {
      theme: 'red',
      lines: [
        'YOU\'RE NOT SUPPOSED TO BE BACK HERE.',
        'WHO LET YOU IN?',
        'DON\'T TOUCH THE BOARD.',
        'I SEE YOU READING THE NOTES.',
        'THE YARN CONNECTS EVERYTHING.',
        'LEAVE. NOW. (PLEASE STAY.)',
        'THIS ROOM IS BEING MONITORED.'
      ],
      titles: ['UNAUTHORIZED ACCESS', 'Security Alert!', 'ERROR']
    },
    '/backstage/frequency/': {
      theme: 'red',
      lines: [
        'TRY A NUMBER.',
        'SOME FREQUENCIES TALK BACK.',
        'I\'M ON CHANNEL 01 TOO.',
        'TURN THE KNOB. NO, THE OTHER ONE.',
        'STATIC IS JUST VOICES TALKING AT ONCE.'
      ],
      titles: ['SIGNAL DETECTED', 'UNAUTHORIZED ACCESS']
    }
  };

  var COMPANY = [
    '{ticker} IS GOING UP. PROBABLY.',
    'I WOULDN\'T BUY {ticker}. I WOULDN\'T SELL IT EITHER.',
    'YOU\'RE LOOKING AT {name}. {name} IS LOOKING BACK.',
    'HAVE YOU CHECKED {ticker}\'S GOAL? THE CLOCK IS TICKING.'
  ];
  var TICKERS = {
    BNW: ['BUY BNW!!', 'BUY BNW!! BUY BNW!!', 'THE NUMBERS ARE WORKING. MOSTLY.'],
    NACH: ['I CAN\'T EAT NACHOS. I HAVE LEDS, NOT A MOUTH.', 'NACHOS. AT SCALE.'],
    BLU: ['THEY\'RE BUILDING SOMETHING. NOBODY KNOWS WHAT.', 'ALLEGEDLY.'],
    RRM: ['RRM IS THE SERVER. THE SERVER IS WATCHING.', 'RRM TO THE MOON.']
  };
  var DODGE_LINES = ['NOPE.', 'MISSED ME.', 'TOO SLOW.', 'NICE TRY.'];
  var DODGE_CHANCE = 0.35;   // chance the window jumps away instead of closing
  var MAX_OPEN = 5;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var me = document.currentScript;

  // Which page are we on?
  function pageInfo() {
    var forced = me && me.getAttribute('data-page');
    if (forced && PAGES[forced]) return PAGES[forced];
    var path = location.pathname.replace(/index\.html$/, '');
    var best = null, bestLen = -1;
    Object.keys(PAGES).forEach(function (key) {
      var pg = PAGES[key];
      if (key.charAt(0) !== '/') return;
      var hit = pg.exact ? path === key : path.indexOf(key) === 0;
      if (hit && key.length > bestLen) { best = pg; bestLen = key.length; }
    });
    var ticker = document.body && document.body.getAttribute('data-ticker');
    if (ticker) {
      var h1 = document.querySelector('h1');
      var name = h1 ? h1.textContent.trim().toUpperCase() : ticker;
      var lines = COMPANY.concat(TICKERS[ticker] || []).map(function (l) {
        return l.split('{ticker}').join(ticker).split('{name}').join(name);
      });
      best = { lines: lines.concat(best ? best.lines : []), titles: best && best.titles };
    }
    return best;
  }
  var page = null;
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
    '.rv-pop.rv-red{border-color:#5a0a0a;box-shadow:4px 4px 0 rgba(0,0,0,.5),0 0 22px rgba(255,40,40,.5);animation:rvGlowRed 1.4s ease-in-out infinite}',
    '.rv-pop.rv-red.rv-shake{animation:rvShake .12s linear 5,rvGlowRed 1.4s ease-in-out infinite}',
    '.rv-red .rv-title{background:linear-gradient(to bottom,#B01010 0%,#E83A2A 100%)}',
    '.rv-red .rv-msg{color:#7a0000}',
    '.rv-red .rv-body::before{background-image:repeating-linear-gradient(45deg,transparent,transparent 10px,rgba(255,0,0,.12) 10px,rgba(255,0,0,.12) 20px)}',
    '@keyframes rvGlowRed{50%{box-shadow:4px 4px 0 rgba(0,0,0,.5),0 0 32px rgba(255,40,40,.8)}}',
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
    if (page === null) page = pageInfo() || {};
    // Backstage (red pages) almost always stays in character.
    var local = page.lines && page.lines.length && Math.random() < (page.theme === 'red' ? 0.9 : 0.7);
    var title = opts.title || pick(local && page.titles ? page.titles : TITLES);
    var red = (opts.theme || page.theme) === 'red';
    if (red) win.classList.add('rv-red');
    var baseMood = (opts.mood === 'angry' || red) ? 'angry' : 'calm';
    win.querySelector('.rv-title span').textContent = '⚠️ ' + title;
    win.setAttribute('aria-label', title);
    var msgEl = win.querySelector('.rv-msg');
    msgEl.textContent = fill(opts.message || pick(local ? page.lines : MESSAGES));
    document.body.appendChild(win);
    open.push(win);
    if (typeof opts.x === 'number') place(win, opts.x, opts.y); else randomSpot(win);
    if (baseMood === 'angry') setMood(win, 'angry');
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
          setTimeout(function () { setMood(win, baseMood); }, 1200);
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
