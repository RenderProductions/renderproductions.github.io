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
    '/patch-notes/': {
      lines: [
        'NOBODY READS THE PATCH NOTES. EXCEPT YOU. HI.',
        'KNOWN ISSUE: ME.',
        'I WROTE SOME OF THESE. GUESS WHICH.',
        'FIXED: NOTHING. ADDED: MORE ME.'
      ],
      titles: ['Update Available!', 'Patch Installed', 'System Alert!']
    },
    '/discord/': {
      lines: [
        'COUNT THE GREEN DOTS. I DO. ALL DAY.',
        'JOIN THE RENDER ROOM. I\'LL BE THERE. I\'M ALWAYS THERE.',
        'I KNOW WHO\'S ONLINE. DO YOU?',
        'MEMBER COUNT GO UP. PLEASE.'
      ],
      titles: ['Server Status', 'Ping!', 'System Alert!']
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
    RRM: ['RRM IS THE SERVER. THE SERVER IS WATCHING.', 'RRM TO THE MOON.'],
    BSTG: ['BSTG IS AT 400! NO WAIT. 2.', 'BUY BSTG! SELL BSTG! BUY BSTG!', 'GLORIOUS. OR BASTARDLY. CHECK BACK IN AN HOUR.']
  };
  var DODGE_LINES = ['NOPE.', 'MISSED ME.', 'TOO SLOW.', 'NICE TRY.'];
  var DODGE_CHANCE = 0.45;   // first chance the window glides away instead of closing; halves after every dodge
  var MAX_OPEN = 5;

  // Settings from the profile page's Settings tab (localStorage rp_prefs: { popups, sound, peekers, comeback, holiday, emoji, motion }).
  function pref(k) { try { return (JSON.parse(localStorage.getItem('rp_prefs') || '{}'))[k] !== false; } catch (e) { return true; } }
  var reduce = (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || !pref('motion');
  // /face/ is the pop-up toy itself, so it keeps them on even when they're switched off elsewhere.
  var toyPage = location.pathname.indexOf('/face/') === 0;
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
  // Three retro skins: pixel (yellow on black, like the bot's emojis), win95 (grey bevels), crt (a
  // terminal glowing in the page's own color). Each pop-up picks one at random unless Settings says which.
  var css = [
    '.rv-pop{position:fixed;width:min(320px,calc(100vw - 16px));user-select:none;overflow:hidden}',
    '.rv-pop.rv-big{width:min(440px,calc(100vw - 16px))}',
    '.rv-pop.rv-shake{animation:rvShake .12s linear 5}',
    '.rv-title{display:flex;justify-content:space-between;align-items:center;gap:6px;cursor:grab;touch-action:none}',
    '.rv-title:active{cursor:grabbing}',
    '.rv-title span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.rv-btns{display:flex;gap:3px;flex:none}',
    '.rv-btn{padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center}',
    '.rv-body{position:relative;display:flex;gap:12px;align-items:center;padding:14px}',
    '.rv-face{flex:none;width:64px;height:64px;image-rendering:pixelated;shape-rendering:crispEdges}',
    '.rv-pop.rv-big .rv-face{width:96px;height:96px}',
    '.rv-msg{position:relative;margin:0;overflow-wrap:anywhere}',
    '.rv-foot{display:flex;align-items:center;gap:10px;padding:0 14px 12px}',
    '.rv-ok{cursor:pointer}',
    '.rv-stop{margin-left:auto;opacity:.7;text-decoration:none}.rv-stop:hover{opacity:1;text-decoration:underline}',
    '.rv-pop.rv-min .rv-body,.rv-pop.rv-min .rv-foot{display:none}',
    '.rv-pop.rv-glide{transition:left .55s cubic-bezier(.2,1.25,.4,1),top .55s cubic-bezier(.2,1.25,.4,1)}',
    '@keyframes rvShake{0%,100%{translate:0 0}25%{translate:-4px 2px}50%{translate:3px -2px}75%{translate:-2px -3px}}',
    // pixel
    '.rv-s-pixel{--y:#ffe600;--y2:#e6cf00;background:#0d1322;font-family:VT323,"Courier New",monospace;',
    'box-shadow:0 0 0 2px #05070d,0 0 0 4px var(--y),0 0 0 6px #05070d,8px 8px 0 4px rgba(0,0,0,.55)}',
    '.rv-s-pixel.rv-red{--y:#ff4d4d;--y2:#e03e3e}',
    '.rv-s-pixel .rv-title{padding:3px 5px 3px 8px;color:#05070d;font-size:19px;letter-spacing:1px;background:repeating-linear-gradient(90deg,var(--y) 0 4px,var(--y2) 4px 8px)}',
    '.rv-s-pixel .rv-btn{width:17px;height:17px;border:0;background:#05070d;color:var(--y);font:17px/17px VT323,monospace}',
    '.rv-s-pixel .rv-btn.rv-x{background:#ff4d4d;color:#05070d}',
    '.rv-s-pixel.rv-red .rv-btn.rv-x{background:#05070d;color:#ff4d4d;box-shadow:inset 0 0 0 2px #ff4d4d}',
    '.rv-s-pixel .rv-body{background-image:linear-gradient(rgba(255,230,0,.05) 50%,transparent 50%);background-size:100% 4px}',
    '.rv-s-pixel .rv-msg{color:var(--y);font-size:22px;line-height:1.05;letter-spacing:.5px}',
    '.rv-s-pixel.rv-big .rv-msg{font-size:28px}',
    '.rv-s-pixel .rv-ok{font:19px VT323,monospace;padding:0 14px;border:0;background:var(--y);color:#05070d}',
    '.rv-s-pixel .rv-ok:active{background:#05070d;color:var(--y);box-shadow:inset 0 0 0 2px var(--y)}',
    '.rv-s-pixel .rv-stop{font:16px VT323,monospace;color:var(--y)}',
    // win95
    '.rv-s-win95{background:#c0c0c0;border:2px solid;border-color:#fff #404040 #404040 #fff;',
    'box-shadow:1px 1px 0 #000,inset -1px -1px 0 #808080,inset 1px 1px 0 #dfdfdf,6px 6px 0 rgba(0,0,0,.35);font:11px "MS Sans Serif","Microsoft Sans Serif",Tahoma,sans-serif;color:#000}',
    '.rv-s-win95 .rv-title{margin:2px;padding:3px 3px 3px 4px;color:#fff;font-weight:bold;background:linear-gradient(90deg,#000080,#1084d0)}',
    '.rv-s-win95.rv-red .rv-title{background:linear-gradient(90deg,#800000,#d04a3a)}',
    '.rv-s-win95 .rv-btn{width:16px;height:14px;background:#c0c0c0;border:1px solid;border-color:#fff #404040 #404040 #fff;box-shadow:inset -1px -1px 0 #808080;color:#000;font:bold 9px Tahoma,sans-serif}',
    '.rv-s-win95 .rv-btn:active{border-color:#404040 #fff #fff #404040}',
    '.rv-s-win95 .rv-msg{font-size:12px;font-weight:bold;color:#000}',
    '.rv-s-win95.rv-red .rv-msg{color:#800000}',
    '.rv-s-win95.rv-big .rv-msg{font-size:15px}',
    '.rv-s-win95 .rv-foot{justify-content:center}',
    '.rv-s-win95 .rv-ok{min-width:76px;padding:4px 0;background:#c0c0c0;border:1px solid;border-color:#fff #404040 #404040 #fff;box-shadow:1px 1px 0 #000;font:11px Tahoma,sans-serif;color:#000;outline:1px dotted #000;outline-offset:-5px}',
    '.rv-s-win95 .rv-ok:active{border-color:#404040 #fff #fff #404040;box-shadow:none}',
    '.rv-s-win95 .rv-stop{margin-left:0;font-size:11px;color:#000080;text-decoration:underline}',
    // crt
    '.rv-s-crt{--c:var(--bright,#3ddc84);background:#030803;border:1px solid var(--c);font:17px/1.25 VT323,"Courier New",monospace;color:var(--c);',
    'text-shadow:0 0 6px var(--c);box-shadow:0 0 18px rgba(0,0,0,.6),0 0 14px -2px var(--c),inset 0 0 28px rgba(255,255,255,.04)}',
    '.rv-s-crt.rv-red{--c:#ff4d4d}',
    '.rv-s-crt::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(transparent 0 2px,rgba(0,0,0,.38) 2px 3px)}',
    '.rv-s-crt .rv-title{padding:4px 8px;border-bottom:1px dashed var(--c);letter-spacing:1px}',
    '.rv-s-crt .rv-btn{border:0;background:none;color:var(--c);font:17px VT323,monospace;text-shadow:inherit}',
    '.rv-s-crt .rv-msg{font-size:21px}',
    '.rv-s-crt.rv-big .rv-msg{font-size:27px}',
    '.rv-s-crt .rv-cur{display:inline-block;width:.5em;height:.95em;margin-left:2px;background:var(--c);vertical-align:-.12em;animation:rvBlink 1s steps(1) infinite}',
    '@keyframes rvBlink{50%{opacity:0}}',
    '.rv-s-crt .rv-ok{border:0;background:none;color:var(--c);font:19px VT323,monospace;text-shadow:inherit;padding:0}',
    '.rv-s-crt .rv-ok:hover{background:var(--c);color:#030803;text-shadow:none}',
    '.rv-s-crt .rv-stop{font:16px VT323,monospace;color:var(--c)}',
    '@media (prefers-reduced-motion:reduce){.rv-pop,.rv-pop.rv-shake,.rv-s-crt .rv-cur{animation:none}}'
  ].join('');
  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---------- Tiny face ----------
  // A 16x16 pixel Render Vision. The eyes (.rv-eye) and mouth (.rv-mouth / .rv-frown) are separate so
  // they can look around and change mood.
  var SKINS = ['pixel', 'win95', 'crt'];
  function chooseSkin() {
    var s = null;
    try { s = (JSON.parse(localStorage.getItem('rp_prefs') || '{}')).style; } catch (e) {}
    return SKINS.indexOf(s) >= 0 ? s : SKINS[Math.floor(Math.random() * SKINS.length)];
  }
  function accent() {
    var c = '';
    try { c = getComputedStyle(document.documentElement).getPropertyValue('--bright').trim(); } catch (e) {}
    return c || '#3ddc84';
  }
  var FACE_COLORS = {
    pixel: { rim: '#ffe600', ring: '#05070d', fill: '#0b1220', eye: '#ffe600' },
    win95: { rim: '#000000', ring: '#808080', fill: '#000080', eye: '#ffff00' },
    crt:   { rim: null, ring: '#030803', fill: '#06140a', eye: null }
  };
  function r(x, y, w, h, c, cls) { return '<rect' + (cls ? ' class="' + cls + '"' : '') + ' x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" fill="' + c + '"/>'; }
  function faceSvg(skin, red) {
    var k = FACE_COLORS[skin], a = skin === 'crt' ? (red ? '#ff4d4d' : accent()) : null;
    var rim = red && skin === 'pixel' ? '#ff4d4d' : (k.rim || a), eye = k.eye || a;
    return '<svg class="rv-face" viewBox="0 0 16 16" aria-hidden="true" data-eye="' + eye + '">' +
      r(1, 1, 14, 14, k.ring) + r(2, 2, 12, 12, k.fill) +
      r(2, 0, 12, 1, rim) + r(2, 15, 12, 1, rim) + r(0, 2, 1, 12, rim) + r(15, 2, 1, 12, rim) +
      r(1, 1, 1, 1, rim) + r(14, 1, 1, 1, rim) + r(1, 14, 1, 1, rim) + r(14, 14, 1, 1, rim) +
      '<g class="rv-eyes">' + r(4, 4, 2, 4, eye, 'rv-eye') + r(10, 4, 2, 4, eye, 'rv-eye') + '</g>' +
      '<g class="rv-mouth" fill="' + eye + '">' + r(4, 10, 1, 1, eye) + r(11, 10, 1, 1, eye) + r(5, 11, 6, 1, eye) + '</g>' +
      '<g class="rv-frown" style="display:none">' + r(5, 10, 6, 1, '#ff4d4d') + r(4, 11, 1, 1, '#ff4d4d') + r(11, 11, 1, 1, '#ff4d4d') + '</g>' +
      '</svg>';
  }

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
  // Dodge: slide to a spot well away from where the pointer just was.
  // Picks the farthest of a few random spots so the escape is easy to see.
  function glideAway(win) {
    var w = win.offsetWidth, h = win.offsetHeight;
    var fromX = win.offsetLeft, fromY = win.offsetTop, best = null, bestD = -1;
    for (var i = 0; i < 6; i++) {
      var x = clamp(Math.random() * (window.innerWidth - w), 4, window.innerWidth - w - 4);
      var y = clamp(Math.random() * (window.innerHeight - h), 4, window.innerHeight - Math.min(h, 40) - 4);
      var d = Math.hypot(x - fromX, y - fromY);
      if (d > bestD) { bestD = d; best = [x, y]; }
    }
    if (reduce) { place(win, best[0], best[1]); return; }
    win.classList.add('rv-glide');
    void win.offsetWidth;
    place(win, best[0], best[1]);
    clearTimeout(win._glideT);
    // Drop the transition afterwards so dragging stays instant.
    win._glideT = setTimeout(function () { win.classList.remove('rv-glide'); }, 600);
  }
  function shake(win) {
    if (reduce) return;
    win.classList.remove('rv-shake');
    void win.offsetWidth;
    win.classList.add('rv-shake');
  }
  function setMood(win, mood) {
    var svg = win.querySelector('.rv-face'), angry = mood === 'angry';
    var color = angry ? '#ff4d4d' : svg.getAttribute('data-eye');
    var eyes = win.querySelectorAll('.rv-eye');
    for (var i = 0; i < eyes.length; i++) {
      eyes[i].setAttribute('fill', color);
      eyes[i].setAttribute('height', angry ? 2 : 4);
      eyes[i].setAttribute('y', angry ? 6 : 4);
    }
    win.querySelector('.rv-mouth').style.display = angry ? 'none' : '';
    win.querySelector('.rv-frown').style.display = angry ? '' : 'none';
  }
  // The terminal skin types its message out.
  function say(win, el, text) {
    clearInterval(el._type);
    if (!win.classList.contains('rv-s-crt') || reduce) { el.textContent = text; return; }
    var cur = '<span class="rv-cur"></span>', n = 0;
    el.innerHTML = cur;
    el._type = setInterval(function () {
      n += 1 + (Math.random() < 0.3 ? 1 : 0);
      el.textContent = text.slice(0, n);
      el.insertAdjacentHTML('beforeend', cur);
      if (n >= text.length) clearInterval(el._type);
    }, 32);
  }

  // Items (see /inventory.js), fetched when needed since this file runs on pages without it.
  function giveItem(id) {
    if (window.RPInventory) { RPInventory.give(id); return; }
    var s = document.createElement('script');
    s.src = '/inventory.js?v=3';
    s.onload = function () { if (window.RPInventory) RPInventory.give(id); };
    document.head.appendChild(s);
  }

  function close(win) {
    var i = open.indexOf(win);
    if (i >= 0) open.splice(i, 1);
    win.remove();
    document.dispatchEvent(new CustomEvent('renderpopup:close'));
  }

  // The XP error "bum" when a popup appears. Each popup gets its own copy, so they overlap
  // and stack up. Browsers only allow sound after the visitor has clicked or pressed something
  // on the page, so the very first popup may be silent.
  // Turn it off from the console with RenderPopup.sound(false) (remembered in this browser).
  var SOUND_KEY = 'rvPopupSound', soundOn = true, playing = 0, MAX_BUMS = 8;
  var BUM_SRC = '/face/media/xp-error.mp3';
  try { soundOn = localStorage.getItem(SOUND_KEY) !== 'off' && pref('sound'); } catch (e) {}
  try { new Audio(BUM_SRC).preload = 'auto'; } catch (e) {}
  function playBum() {
    if (!soundOn || playing >= MAX_BUMS) return;   // a cap so a huge burst can't blow out ears
    try {
      var a = new Audio(BUM_SRC);
      a.volume = 0.55;
      playing++;
      a.addEventListener('ended', function () { playing--; });
      var p = a.play();
      if (p && p.catch) p.catch(function () { playing--; });
    } catch (e) {}
  }

  function spawn(opts) {
    opts = opts || {};
    if (!opts.force && !toyPage && !pref('popups')) return null;   // switched off in Settings (a preview or the Konami code still shows)
    if (open.length >= MAX_OPEN) return null;

    var win = document.createElement('div');
    var skin = opts.skin && SKINS.indexOf(opts.skin) >= 0 ? opts.skin : chooseSkin();
    win.className = 'rv-pop rv-s-' + skin;
    win.setAttribute('role', 'dialog');
    win.style.zIndex = ++topZ;
    var B = skin === 'crt' ? ['[_]', '[□]', '[x]'] : skin === 'pixel' ? ['-', '□', 'x'] : ['_', '□', '×'];
    win.innerHTML =
      '<div class="rv-title"><span></span><div class="rv-btns">' +
      '<button class="rv-btn" type="button" data-act="min" aria-label="Minimize">' + B[0] + '</button>' +
      '<button class="rv-btn" type="button" data-act="max" aria-label="Maximize">' + B[1] + '</button>' +
      '<button class="rv-btn rv-x" type="button" data-act="close" aria-label="Close">' + B[2] + '</button>' +
      '</div></div><div class="rv-body"><p class="rv-msg"></p></div>' +
      '<div class="rv-foot"><button class="rv-ok" type="button" data-act="close">' + (skin === 'crt' ? '[ OK ]' : 'OK') + '</button>' +
      (toyPage ? '' : '<a class="rv-stop" href="/profile/#settings">' + (skin === 'crt' ? '> make it stop' : 'Make it stop') + '</a>') + '</div>';
    if (page === null) page = pageInfo() || {};
    // Backstage (red pages) almost always stays in character.
    var local = page.lines && page.lines.length && Math.random() < (page.theme === 'red' ? 0.9 : 0.7);
    var title = opts.title || pick(local && page.titles ? page.titles : TITLES);
    var red = (opts.theme || page.theme) === 'red';
    if (red) win.classList.add('rv-red');
    win.querySelector('.rv-body').insertAdjacentHTML('afterbegin', faceSvg(skin, red));
    var baseMood = (opts.mood === 'angry' || red) ? 'angry' : 'calm';
    win.querySelector('.rv-title span').textContent = skin === 'crt' ? '[ ' + title.toUpperCase() + ' ]' : skin === 'pixel' ? '! ' + title.toUpperCase() : title;
    win.setAttribute('aria-label', title);
    var msgEl = win.querySelector('.rv-msg');
    document.body.appendChild(win);
    say(win, msgEl, fill(opts.message || pick(local ? page.lines : MESSAGES)));
    open.push(win);
    if (!opts.silent) playBum();
    if (typeof opts.x === 'number') place(win, opts.x, opts.y); else randomSpot(win);
    if (baseMood === 'angry') setMood(win, 'angry');
    shake(win);

    // Bring to front when touched
    win.addEventListener('pointerdown', function () { win.style.zIndex = ++topZ; });

    // Buttons
    var dodged = 0;
    // Console test: RenderPopup.spawn({ dodge: 1 }) sets the starting chance (100%, then 50%, 25%...).
    var dodgeChance = typeof opts.dodge === 'number' ? opts.dodge : DODGE_CHANCE;
    win.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      if (act === 'min') win.classList.toggle('rv-min');
      if (act === 'max') { win.classList.toggle('rv-big'); place(win, win.offsetLeft, win.offsetTop); }
      if (act === 'close') {
        // Sometimes it runs away instead. No limit on dodges, but each one
        // halves the odds of the next (45%, 22.5%, 11.25%...), so it always tires out.
        if (Math.random() < dodgeChance * Math.pow(0.5, dodged)) {
          dodged++;
          say(win, msgEl, pick(DODGE_LINES));
          setMood(win, 'angry');
          glideAway(win);
          setTimeout(function () { shake(win); }, reduce ? 0 : 550);
          setTimeout(function () { setMood(win, baseMood); }, 1200);
        } else {
          close(win);
          if (dodged > 0) giveItem('popup_shard');   // you caught one that ran: it breaks off a shard
        }
      }
    });

    // Drag by the title bar
    var bar = win.querySelector('.rv-title'), drag = null;
    bar.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.rv-btn')) return;
      win.classList.remove('rv-glide');
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
      var dx = Math.round(clamp((e.clientX - (box.left + box.width / 2)) / 90, -1, 1));
      var dy = Math.round(clamp((e.clientY - (box.top + box.height / 2)) / 90, -1, 1));
      open[i].querySelector('.rv-eyes').setAttribute('transform', 'translate(' + dx + ' ' + dy + ')');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open.length) close(open[open.length - 1]);
  });

  // Switching pop-ups off in Settings closes any that are open right now.
  document.addEventListener('rp:prefs', function () {
    soundOn = pref('sound');
    if (!pref('popups') && !toyPage) open.slice().forEach(close);
  });

  window.RenderPopup = {
    spawn: spawn,
    skins: SKINS,
    count: function () { return open.length; },
    sound: function (on) {
      soundOn = on !== false;
      try { localStorage.setItem(SOUND_KEY, soundOn ? 'on' : 'off'); } catch (e) {}
      return soundOn;
    }
  };

  // Load the Easter eggs (come-back titles, Konami code) on every page that has popups.
  var eggs = document.createElement('script');
  eggs.src = '/face/eggs.js';
  eggs.async = true;
  document.head.appendChild(eggs);

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
