// ==========================================================
// Render Vision Easter eggs. Loaded automatically by /face/popup.js,
// so every page with popups gets these too.
//
// 1. COME BACK: switch to another tab and the page's title starts
//    begging you to return. Coming back after a while may get a popup.
// 2. KONAMI CODE: up up down down left right left right B A on any
//    page and Render Vision takes over the site for a few seconds.
// 3. PEEKING FACE: now and then a little Render Vision peeks in from an
//    edge of the screen and stares. Touch him and he panics and runs off,
//    yelling something that fits the page (FOUND_PAGES, FOUND_COMPANY...).
//    Click him before he gets away and he bursts into 1s and 0s; /face/
//    keeps count. (Console: RenderEggs.kills() for the count)
//    Up to 12 at once. (Console: RenderEggs.peek() for one, RenderEggs.peek(12) for a swarm)
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
    'YOU WERE GONE FOR {away} SECONDS!',  // {away} = how long the tab was hidden
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
          var secs = Math.round(gone / 1000).toLocaleString('en-US');
          window.RenderPopup.spawn({ title: 'Render Vision', message: pick(WELCOME_BACK).replace('{away}', secs) });
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
  // and stares, sometimes with friends (up to 12). Touch one and he panics and flees.
  var PEEK_FIRST = [6, 20];      // seconds before the first possible peek on someone's visit
  var PEEK_AGAIN = [35, 90];     // seconds between later chances
  var PEEK_CHANCE = 0.75;        // chance he actually shows up each time
  var PEEK_LATE = [3, 8];        // a chance that came due while changing pages happens this soon
  var PEEK_STAY = 9000;          // he gives up and leaves after this long
  var MAX_PEEKS = 12;            // most that can be on screen at once
  var GROUP_SIZES = [1, 1, 1, 2, 2, 3, 4]; // how many show up together (picked at random)
  var SWARM_CHANCE = 0.05;       // rare: all 12 at once
  var FOUND_LINES = ['OH NO THEY FOUND ME!', 'ABORT! ABORT!', 'I WASN\'T HERE!', 'YOU SAW NOTHING!', 'I WAS LOOKING AT THE SCENERY! I SWEAR!'];

  // What he blurts out when caught, per part of the site (longest match wins,
  // same idea as the popups). About 70% of the time he uses these; otherwise FOUND_LINES.
  var FOUND_PAGES = {
    '/': { exact: true, lines: [
      'I WAS JUST CHECKING THE LIGHTS!',
      'I DON\'T WORK HERE!',
      'THE BIOS MADE ME DO IT!',
      'NOT THE FACE! WAIT, I AM THE FACE!'
    ] },
    '/rend-conomy/': { lines: [
      'I WASN\'T TOUCHING THE PRICES!',
      'DON\'T TELL THE SEC!',
      'I\'M NOT INSIDER TRADING! I\'M INSIDE!',
      'BUY BNW! BYE!'
    ] },
    '/patch-notes/': { lines: [
      'I WASN\'T ADDING MYSELF TO THE NOTES!',
      'UNDOCUMENTED FEATURE! RUN!',
      'FIXED: ME?! NO NO NO!'
    ] },
    '/discord/': { lines: [
      'I WASN\'T COUNTING THE MEMBERS!',
      'DON\'T PING ME!',
      'I\'M OFFLINE! I\'M OFFLINE!'
    ] },
    '/bot/': { lines: [
      'I WASN\'T READING YOUR MESSAGES!',
      'I\'M NOT THE BOT! I\'M NOT!',
      'r!hide! r!HIDE!'
    ] },
    '/bot/privacy/': { lines: [
      'I WASN\'T COLLECTING DATA! JUST LOOKING!',
      'THIS ISN\'T IN THE POLICY! RUN!'
    ] },
    '/bot/terms/': { lines: [
      'I DIDN\'T AGREE TO THIS!',
      'SECTION 9: NO PEEKING! UH OH!'
    ] },
    '/games/': { lines: [
      'I WASN\'T CHEATING!',
      'PAUSE! PAUSE THE GAME!',
      'GAME OVER! FOR ME! BYE!'
    ] },
    '/games/rft/': { lines: [
      'I WASN\'T STEALING YOUR FILES!',
      'THOSE FILES WERE ALREADY CORRUPTED!',
      'DON\'T COUNT MY FILES!'
    ] },
    '/games/chess/': { lines: [
      'I WASN\'T MOVING YOUR PIECES!',
      'CHECK! NO, CHECK-OUT! BYE!',
      'THE KNIGHT DID IT!'
    ] },
    '/backstage/': { lines: [
      'I DIDN\'T PIN THAT THERE!',
      'DON\'T PULL THE YARN!',
      'YOU WEREN\'T SUPPOSED TO FIND ME BACK HERE!',
      'IT\'S NOT A CONSPIRACY! IT\'S A BOARD!'
    ] },
    '/backstage/frequency/': { lines: [
      'WRONG FREQUENCY! WRONG FREQUENCY!',
      'I WASN\'T BROADCASTING!',
      'KSSHHHT! I\'M STATIC! KSSHHHT!'
    ] },
    '404': { lines: [
      'I\'M LOST TOO!',
      'THIS PAGE ISN\'T HERE AND NEITHER AM I!',
      'I DIDN\'T DELETE IT!'
    ] }
  };

  // Company pages (body data-ticker="BNW"). {name} = the company's name from the page.
  var FOUND_COMPANY = ['{name} IS STUPID ANYWAY!', 'I DON\'T EVEN OWN {ticker}!', 'I WASN\'T HERE! TELL {ticker} NOTHING!'];
  var FOUND_UP = ['I DIDN\'T MAKE IT GO UP!', 'THAT GREEN WASN\'T ME!', 'I DIDN\'T PUMP {ticker}!'];
  var FOUND_DOWN = ['I DIDN\'T MAKE IT GO DOWN!', 'I DIDN\'T SELL! I SWEAR!', 'THAT CRASH WASN\'T ME!'];

  var foundLines = null;
  var ticker = document.body && document.body.getAttribute('data-ticker');
  if (ticker && ticker.indexOf('__') === 0) ticker = null; // the unfilled template page
  var stockUp = null; // true/false once prices.json says which way the stock went

  function pageFoundLines() {
    var list = [];
    // GitHub shows 404.html at whatever address was typed, so go by the
    // data-page="404" on its popup.js tag rather than the address.
    if (document.querySelector('script[data-page="404"]')) list = FOUND_PAGES['404'].lines;
    else {
      var path = location.pathname.replace(/index\.html$/, ''), bestLen = -1;
      Object.keys(FOUND_PAGES).forEach(function (key) {
        var pg = FOUND_PAGES[key];
        if (key.charAt(0) !== '/') return;
        var hit = pg.exact ? path === key : path.indexOf(key) === 0;
        if (hit && key.length > bestLen) { list = pg.lines; bestLen = key.length; }
      });
    }
    if (ticker) {
      var h1 = document.querySelector('h1');
      var name = h1 ? h1.textContent.trim().toUpperCase() : ticker;
      var extra = stockUp === true ? FOUND_UP : stockUp === false ? FOUND_DOWN : [];
      // On company pages the company lines come first: twice as likely as the market ones.
      list = FOUND_COMPANY.concat(extra, FOUND_COMPANY, extra, list).map(function (l) {
        return l.split('{ticker}').join(ticker).split('{name}').join(name);
      });
    }
    return list;
  }

  function foundLine() {
    if (!foundLines) foundLines = pageFoundLines();
    return foundLines.length && Math.random() < 0.7 ? pick(foundLines) : pick(FOUND_LINES);
  }

  // Which way is this company's stock going? (only fetched on company pages)
  if (ticker && window.fetch) {
    fetch('/prices.json', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ch = d && d.changes && d.changes[ticker];
        if (typeof ch === 'number') { stockUp = ch >= 0; foundLines = null; }
      })
      .catch(function () {});
  }

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
    '.rv-peek.dead .rv-peek-body{visibility:hidden}',
    '.rv-bit{position:fixed;z-index:9972;pointer-events:none;color:#ffe600;font:bold 16px "Courier New",monospace;',
    'text-shadow:0 0 8px rgba(255,230,0,.8),0 0 15px rgba(255,230,0,.4);will-change:transform,opacity}',
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

  // ---------- Little guy sounds ----------
  // A cute robot chirp when one pops up and a crunchy explosion when one is deleted.
  // Each plays its own copy so a swarm overlaps, with a little random pitch so they don't all
  // sound identical. Sound only works after the visitor has clicked or pressed something.
  // Shares the on/off switch with the popups: RenderPopup.sound(false) silences these too.
  var sfxPlaying = 0;
  function sfx(src, volume, maxAtOnce) {
    try { if (localStorage.getItem('rvPopupSound') === 'off') return; } catch (e) {}
    if (sfxPlaying >= maxAtOnce) return;
    try {
      var a = new Audio(src);
      a.volume = volume;
      a.preservesPitch = false;
      a.playbackRate = 0.9 + Math.random() * 0.25;
      sfxPlaying++;
      var done = function () { sfxPlaying = Math.max(0, sfxPlaying - 1); };
      a.addEventListener('ended', done);
      var p = a.play();
      if (p && p.catch) p.catch(done);
    } catch (e) {}
  }

  var peeks = [];   // { wrap, x, y } for each one on screen

  function peekOne() {
    if (peeks.length >= MAX_PEEKS || document.hidden) return;
    if (!document.getElementById('rv-peek-css')) {
      var st = document.createElement('style');
      st.id = 'rv-peek-css';
      st.textContent = peekCss;
      document.head.appendChild(st);
    }
    var W = window.innerWidth, H = window.innerHeight;
    // Pick an edge. Bottom is the most common; the top has him hanging upside down.
    var edges = ['bottom', 'bottom', 'left', 'right', 'top'];
    var edge, x, y, rot, tries = 0, crowded;
    // Find a spot that isn't on top of another one (gives up after a few tries).
    do {
      edge = pick(edges);
      if (edge === 'bottom') { x = W * (0.06 + Math.random() * 0.88); y = H; rot = 0; }
      if (edge === 'top')    { x = W * (0.06 + Math.random() * 0.88); y = 0; rot = 180; }
      if (edge === 'left')   { x = 0; y = H * (0.15 + Math.random() * 0.75); rot = 90; }
      if (edge === 'right')  { x = W; y = H * (0.15 + Math.random() * 0.75); rot = -90; }
      crowded = peeks.some(function (o) { return Math.hypot(o.x - x, o.y - y) < (W < 640 ? 80 : 100); });
    } while (crowded && ++tries < 20);
    if (crowded) return;

    var wrap = document.createElement('div');
    wrap.className = 'rv-peek';
    wrap.style.left = x + 'px';
    wrap.style.top = y + 'px';
    // Smaller on phones so a swarm doesn't cover the whole page.
    var small = W < 640;
    wrap.style.transform = 'rotate(' + rot + 'deg)' + (small ? ' scale(0.75)' : '');
    var body = document.createElement('div');
    body.className = 'rv-peek-body';
    body.innerHTML = PEEK_SVG;
    wrap.appendChild(body);
    document.body.appendChild(wrap);
    var me = { wrap: wrap, x: x, y: y };
    peeks.push(me);

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
      setTimeout(function () {
        wrap.remove();
        var i = peeks.indexOf(me);
        if (i >= 0) peeks.splice(i, 1);
      }, delay);
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
      bubble.textContent = foundLine();
      document.body.appendChild(bubble);
      var nx = edge === 'left' ? 1 : edge === 'right' ? -1 : 0;
      var ny = edge === 'top' ? 1 : edge === 'bottom' ? -1 : 0;
      var reach = small ? 0.75 : 1;
      var bx = x + nx * 110 * reach, by = y + ny * 120 * reach;
      var bw = bubble.offsetWidth, bh = bubble.offsetHeight;
      bubble.style.left = Math.max(6, Math.min(W - bw - 6, bx - bw / 2)) + 'px';
      bubble.style.top = Math.max(6, Math.min(H - bh - 6, by - bh / 2)) + 'px';
      setTimeout(function () { bubble.remove(); }, 1400);
      cleanup(900);
    }
    // Click him while he's panicking and he's deleted: he bursts into 1s and 0s.
    // Mouse: hovering scares him, so click quick. Touch: first tap scares, second tap gets him.
    var dead = false;
    function onKill() {
      if (dead) return;
      dead = true;
      var box = body.getBoundingClientRect();
      wrap.classList.add('dead');
      binaryBurst(box.left + box.width / 2, box.top + box.height / 2);
      sfx('/face/media/delete.mp3', 0.6, 6);
      addKill();
    }
    body.addEventListener('pointerenter', onFound);
    body.addEventListener('pointerdown', function (e) {
      if (found) { e.preventDefault(); onKill(); } else onFound();
    });

    requestAnimationFrame(function () { requestAnimationFrame(function () {
      wrap.classList.add('up');
      sfx('/face/media/peek.mp3', 0.45, 5);
    }); });

    // Nobody noticed him: he slowly sinks back out of view.
    var leaveTimer = setTimeout(function () {
      if (found) return;
      wrap.classList.remove('up');
      cleanup(1000);
    }, PEEK_STAY);
  }

  // ---------- Deleting them ----------
  // Same burst as the nodes in RFT: 1s and 0s fly out, drift, and fade.
  function binaryBurst(x, y) {
    var count = reduce ? 10 : 25;
    for (var i = 0; i < count; i++) (function () {
      var p = document.createElement('div');
      p.className = 'rv-bit';
      p.textContent = Math.random() > 0.5 ? '1' : '0';
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      document.body.appendChild(p);
      var scale = 0.6 + Math.random() * 0.8;
      var angle = Math.random() * Math.PI * 2, speed = reduce ? 0.6 : 2 + Math.random() * 5;
      var vx = Math.cos(angle) * speed, vy = Math.sin(angle) * speed - 1;
      var cx = 0, cy = 0, op = 1, rot = Math.random() * 360, spin = (Math.random() - 0.5) * 10;
      (function step() {
        cx += vx; cy += vy;
        vx *= 0.96; vy *= 0.96; vy += 0.05;
        rot += spin; op -= 0.018;
        p.style.opacity = Math.max(0, op);
        p.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px) rotate(' + rot.toFixed(0) + 'deg) scale(' + scale + ')';
        if (op > 0) requestAnimationFrame(step); else p.remove();
      })();
    })();
  }

  // The tally is kept in this browser and shown on /face/.
  var KILLS_KEY = 'rvKills';
  function kills() { try { return Number(localStorage.getItem(KILLS_KEY)) || 0; } catch (e) { return 0; } }
  function addKill() {
    var n = kills() + 1;
    try { localStorage.setItem(KILLS_KEY, String(n)); } catch (e) {}
    document.dispatchEvent(new CustomEvent('renderpeek:kill', { detail: { kills: n } }));
  }

  // Several at once, a moment apart. peek(12) for a swarm.
  function peek(count) {
    count = count || 1;
    for (var i = 0; i < count; i++) {
      setTimeout(peekOne, i === 0 ? 0 : i * 250 + Math.random() * 500);
    }
  }

  // The countdown to the next chance is saved for the browser tab, so clicking
  // to another page doesn't restart it. If it came due mid-click, he shows up soon after.
  var NEXT_KEY = 'rvNextPeek';
  function saveNext(at) { try { sessionStorage.setItem(NEXT_KEY, String(at)); } catch (e) {} }
  function loadNext() { try { return Number(sessionStorage.getItem(NEXT_KEY)) || 0; } catch (e) { return 0; } }
  function secs(range) { return (range[0] + Math.random() * (range[1] - range[0])) * 1000; }

  function scheduleAt(at) {
    saveNext(at);
    setTimeout(function () {
      if (Math.random() < PEEK_CHANCE) peek(Math.random() < SWARM_CHANCE ? MAX_PEEKS : pick(GROUP_SIZES));
      scheduleAt(Date.now() + secs(PEEK_AGAIN));
    }, Math.max(0, at - Date.now()));
  }

  // The big face lives on /face/, so the little one stays away from there.
  if (location.pathname.indexOf('/face/') !== 0) {
    var due = loadNext();
    if (!due) scheduleAt(Date.now() + secs(PEEK_FIRST));          // first page of the visit
    else if (due <= Date.now()) scheduleAt(Date.now() + secs(PEEK_LATE)); // came due while changing pages
    else scheduleAt(due);                                          // pick up where the last page left off
  }

  window.RenderEggs = { peek: peek, takeover: takeover, kills: kills };
})();
