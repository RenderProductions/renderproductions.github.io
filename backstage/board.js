// Backstage board: red yarn between pins, plus the desk lamp / flashlight.
(function () {
  var NS = 'http://www.w3.org/2000/svg';
  var board = document.querySelector('.board');

  function yarn() {
    if (!board) return;
    var svg = board.querySelector('.yarn');
    if (!svg) { svg = document.createElementNS(NS, 'svg'); svg.setAttribute('class', 'yarn'); svg.setAttribute('aria-hidden', 'true'); board.appendChild(svg); }
    svg.innerHTML = '';
    var b = board.getBoundingClientRect(), pins = board.querySelectorAll('.pin'), pts = [];
    pins.forEach(function (p) { var r = p.getBoundingClientRect(); pts.push([r.left + r.width / 2 - b.left, r.top + r.height / 2 - b.top]); });
    for (var i = 1; i < pts.length; i++) {
      var a = pts[i - 1], c = pts[i], sag = 30 + Math.hypot(c[0] - a[0], c[1] - a[1]) * 0.12;
      var d = 'M' + a[0] + ' ' + a[1] + ' Q' + (a[0] + c[0]) / 2 + ' ' + ((a[1] + c[1]) / 2 + sag) + ' ' + c[0] + ' ' + c[1];
      [['rgba(0,0,0,.35)', 3, 3], ['#c0392b', 2.5, 0]].forEach(function (s) {
        var p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d); p.setAttribute('fill', 'none'); p.setAttribute('stroke', s[0]);
        p.setAttribute('stroke-width', s[1]); p.setAttribute('stroke-linecap', 'round');
        if (s[2]) p.setAttribute('transform', 'translate(0 ' + s[2] + ')');
        svg.appendChild(p);
      });
    }
  }
  window.addEventListener('resize', yarn);
  window.addEventListener('load', yarn);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(yarn);
  yarn();

  // Notes spring on hover, so redraw the yarn every frame while they move.
  var follow = 0;
  function track() {
    var end = performance.now() + 650;
    if (follow) { follow = end; return; }
    follow = end;
    (function loop(now) { yarn(); if (now < follow) requestAnimationFrame(loop); else follow = 0; })(0);
  }
  if (board && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    board.querySelectorAll('.note').forEach(function (n) {
      ['pointerenter', 'pointerleave', 'focus', 'blur', 'focusin', 'focusout'].forEach(function (ev) { n.addEventListener(ev, track); });
    });
  }

  // Access codes notepad: whatever a visitor writes is kept in their own browser (never uploaded).
  var pad = document.getElementById('codes-pad');
  if (pad) {
    var KEY = 'rvAccessCodes', saved = document.getElementById('codes-saved'), t = 0, hide = 0;
    try { pad.value = localStorage.getItem(KEY) || ''; } catch (e) {}
    pad.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        try {
          localStorage.setItem(KEY, pad.value);
          if (saved) { saved.textContent = 'saved'; saved.classList.add('on'); clearTimeout(hide); hide = setTimeout(function () { saved.classList.remove('on'); }, 1200); }
        } catch (e) {
          if (saved) { saved.textContent = "can't save in this browser"; saved.classList.add('on'); }
        }
      }, 400);
    });
    // Typing shouldn't trigger the desk's arrow-key shortcuts or Escape-to-look-up.
    pad.addEventListener('keydown', function (e) { e.stopPropagation(); });
  }

  // Look down at the desk (drawers come into view) and back up at the board.
  var look = document.getElementById('look-btn');
  if (look) {
    var text = look.querySelector('.look-text');
    var setLook = function (down) {
      document.body.classList.toggle('looking-down', down);
      look.setAttribute('aria-pressed', down ? 'true' : 'false');
      look.setAttribute('aria-label', down ? 'Look back up at the board' : 'Look down at the desk');
      if (text) text.textContent = down ? 'LOOK UP' : 'LOOK DOWN';
      var dl = document.getElementById('drawer-link');
      if (dl) dl.tabIndex = down ? 0 : -1;   // the drawer is only on screen while looking down
    };
    // Coming back from the drawer (/backstage/#desk): still looking down at the desk.
    if (location.hash === '#desk') {
      setLook(true);
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
    }
    look.addEventListener('click', function () { setLook(!document.body.classList.contains('looking-down')); });
    document.addEventListener('keydown', function (e) {
      if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable]')) return;
      var down = document.body.classList.contains('looking-down');
      var atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      if (e.key === 'Escape' && down) { setLook(false); }
      else if (e.key === 'ArrowUp' && down) { e.preventDefault(); setLook(false); }
      else if (e.key === 'ArrowDown' && !down && atBottom) { e.preventDefault(); setLook(true); }
    });
  }

  // Take a sip: the desk mug lifts away while the first-person mug rises and tips. Just for fun.
  var mug = document.getElementById('mug-btn');
  var sip = document.getElementById('sip');
  if (mug && sip) {
    // Sip and swallow sound (owlstorm on Freesound). The swallow lands right after the mug tips.
    var gulp = new Audio('/backstage/media/sip.mp3');
    gulp.preload = 'auto';
    gulp.volume = 0.8;
    mug.addEventListener('click', function () {
      if (document.body.classList.contains('sipping')) return;
      document.body.classList.add('sipping');
      setTimeout(function () {   // a beat later, so the sound matches the mug reaching your mouth
        try { gulp.currentTime = 0; var p = gulp.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }, 500);
    });
    sip.addEventListener('animationend', function () {
      document.body.classList.remove('sipping');
      mug.focus({ preventScroll: true });
    });
  }

  var btn = document.getElementById('lamp-btn');
  if (btn) {
    btn.addEventListener('click', function () {
      var off = document.body.classList.toggle('lights-off');
      btn.setAttribute('aria-pressed', off ? 'true' : 'false');
    });
    window.addEventListener('pointermove', function (e) {
      document.body.style.setProperty('--mx', e.clientX + 'px');
      document.body.style.setProperty('--my', e.clientY + 'px');
    });
  }

  // The door to Marquez. "Try and find the door... It moves a lot!" So it does:
  // a new spot along the wall every visit. Clicking swings it open first, then goes through
  // (on touch screens there's no hover, so this is the only way to see it open).
  var door = document.getElementById('door');
  if (door) {
    // Each visit it turns up somewhere different: set into the corkboard among the notes,
    // on the wall above or below the board, or (on wide screens) in the gap beside the board.
    // Add ?door=board / above / below / side to the URL to force a spot while testing.
    var wallRow = door.parentNode, wrap = wallRow.parentNode, corkboard = document.querySelector('.corkboard');
    var DOOR_W = 160, GAP = 28;   // px: the door's width (10rem) and breathing room
    function rnd(n) { return Math.floor(Math.random() * n); }
    function sideRoom() { return wrap.getBoundingClientRect().left; }   // wall showing left of the page
    function reset() {
      door.classList.remove('on-board', 'on-side');
      door.style.removeProperty('top'); door.style.removeProperty('left'); door.style.removeProperty('right');
      door.style.removeProperty('--r');
      if (door.parentNode !== wallRow) wallRow.appendChild(door);
      wallRow.hidden = false;
    }
    function placeDoor(spot) {
      reset();
      if (spot === 'board' && board) {
        // a random slot among the notes (never ahead of the poster)
        var kids = [].filter.call(board.children, function (el) { return !el.classList.contains('yarn'); });
        var at = kids[1 + rnd(Math.max(1, kids.length - 1))] || null;
        board.insertBefore(door, at);
        door.classList.add('on-board');
        door.style.setProperty('--r', (rnd(7) - 3) + 'deg');
        wallRow.hidden = true;
      } else if (spot === 'side' && corkboard && sideRoom() >= DOOR_W + GAP * 2) {
        var cb = corkboard.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
        var top = cb.top - wr.top, room = Math.max(0, cb.height - DOOR_W * 1.5);
        door.classList.add('on-side');
        door.style.top = Math.round(top + Math.random() * room) + 'px';
        if (Math.random() < 0.5) door.style.left = -(DOOR_W + GAP) + 'px';
        else door.style.left = 'calc(100% + ' + GAP + 'px)';
        wrap.appendChild(door);
        wallRow.hidden = true;
      } else {
        if (spot === 'above' && corkboard) corkboard.parentNode.insertBefore(wallRow, corkboard);
        else if (corkboard && wallRow.previousElementSibling !== corkboard) corkboard.parentNode.insertBefore(wallRow, corkboard.nextSibling);
        door.style.setProperty('--x', [10, 26, 50, 74, 90][rnd(5)] + '%');
        spot = spot === 'above' ? 'above' : 'below';
      }
      door.dataset.spot = door.classList.contains('on-board') ? 'board' : door.classList.contains('on-side') ? 'side' : spot;
      yarn();
    }
    var forced = (/[?&]door=(board|above|below|side)\b/.exec(location.search) || [])[1];
    var pickSpot = forced || (function () {
      var r = Math.random();
      if (r < 0.4) return 'board';
      if (r < 0.65 && sideRoom() >= DOOR_W + GAP * 2) return 'side';
      return r < 0.82 ? 'above' : 'below';
    })();
    placeDoor(pickSpot);
    // If the window gets too narrow for the side gap, move it back onto the wall.
    window.addEventListener('resize', function () {
      if (door.dataset.spot === 'side' && sideRoom() < DOOR_W + GAP * 2) placeDoor('below');
    });
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    door.addEventListener('click', function (e) {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;   // let "open in new tab" work normally
      e.preventDefault();
      var wasOpen = door.matches(':hover') || door.classList.contains('open');
      door.classList.add('open');
      setTimeout(function () { location.href = door.href; }, still ? 0 : (wasOpen ? 150 : 520));
    });
    // Coming back with the browser's back button: shut it again.
    window.addEventListener('pageshow', function () { door.classList.remove('open'); if (door.tween) door.tween(); });

    // ---- Tween between the two drawings ----
    // Reads m-door.svg (shut) and m-door-open.svg (open) and slides every point of each shape
    // from one to the other. Shapes are paired by colour and point count, in order. Anything
    // in the open drawing with no partner (the black doorway) just sits behind the door.
    // If the drawings ever stop matching, it quietly keeps the instant image swap instead.
    var SHUT_SRC = '/backstage/media/m-door.svg', OPEN_SRC = '/backstage/media/m-door-open.svg';
    var NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
    function grab(url) { return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.text(); }); }
    function shift(svg) {   // the drawing's own translate(x,y) on its first group
      var g = svg.querySelector('g[transform]'), m = g && /translate\(\s*([-\d.e]+)[ ,]+([-\d.e]+)/i.exec(g.getAttribute('transform'));
      return m ? [+m[1], +m[2]] : [0, 0];
    }
    function shapes(svg) {
      return [].map.call(svg.querySelectorAll('path'), function (el) {
        var d = el.getAttribute('d') || '';
        return { el: el, d: d, nums: (d.match(NUM) || []).map(Number), key: (el.getAttribute('fill') || '') + '|' + (el.getAttribute('stroke') || '') };
      });
    }
    // Only the opening M is absolute in these drawings; everything after it is relative.
    function simple(d) { return /^\s*M/.test(d) && !/[A-LN-Z]/.test(d.replace(/^\s*M/, '')); }

    Promise.all([grab(SHUT_SRC), grab(OPEN_SRC)]).then(function (txt) {
      var parser = new DOMParser();
      var shutDoc = parser.parseFromString(txt[0], 'image/svg+xml').documentElement;
      var openDoc = parser.parseFromString(txt[1], 'image/svg+xml').documentElement;
      if (shutDoc.nodeName !== 'svg' || openDoc.nodeName !== 'svg') return;
      var a = shift(shutDoc), b = shift(openDoc), dx = b[0] - a[0], dy = b[1] - a[1];   // open coords -> shut coords

      var shut = shapes(shutDoc), open = shapes(openDoc), used = {}, pairs = [], extras = [];
      open.forEach(function (o) {
        var match = -1;
        for (var i = 0; i < shut.length; i++) {
          if (!used[i] && shut[i].key === o.key && shut[i].nums.length === o.nums.length) { match = i; break; }
        }
        var nums = o.nums.slice();
        if (!simple(o.d)) throw new Error('door: unsupported path');
        nums[0] += dx; nums[1] += dy;
        if (match < 0) { extras.push({ o: o, nums: nums }); return; }
        if (!simple(shut[match].d)) throw new Error('door: unsupported path');
        used[match] = 1;
        pairs.push({ s: shut[match], from: shut[match].nums, to: nums, parts: shut[match].d.split(NUM) });
      });
      if (Object.keys(used).length !== shut.length) return;   // something in the shut door has no partner

      // Build one live SVG from the shut drawing: doorway extras go right after the frame.
      var live = shutDoc;
      live.removeAttribute('width'); live.removeAttribute('height');
      live.setAttribute('class', 'door-live'); live.setAttribute('aria-hidden', 'true');
      var first = pairs.length ? pairs[0].s.el : null;
      extras.forEach(function (x) {
        var el = document.importNode(x.o.el, true);
        el.setAttribute('d', x.o.d.split(NUM).reduce(function (out, part, i) { return out + part + (i < x.nums.length ? +x.nums[i].toFixed(3) : ''); }, ''));
        if (first && first.parentNode) first.parentNode.insertBefore(el, first.nextSibling);
      });
      live = document.importNode(live, true);
      // importNode copied the paths, so find them again inside the copy, in the same order.
      var copies = live.querySelectorAll('path'), k = 0;
      pairs.forEach(function (p) {
        while (k < copies.length && copies[k].getAttribute('d') !== p.s.d) k++;
        p.el = copies[k++];
      });
      if (pairs.some(function (p) { return !p.el; })) return;

      door.insertBefore(live, door.firstChild);
      door.classList.add('tweened');

      var t = 0, goal = 0, raf = 0, last = 0;
      function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
      function draw() {
        var e = ease(t);
        pairs.forEach(function (p) {
          var d = '';
          for (var i = 0; i < p.parts.length; i++) {
            d += p.parts[i];
            if (i < p.from.length) d += +(p.from[i] + (p.to[i] - p.from[i]) * e).toFixed(3);
          }
          p.el.setAttribute('d', d);
        });
      }
      function step(now) {
        var dt = Math.min(64, now - (last || now)); last = now;
        var speed = goal ? 1 / 420 : 1 / 340;   // ms: opening is a touch slower than shutting
        t = goal > t ? Math.min(goal, t + dt * speed) : Math.max(goal, t - dt * speed);
        draw();
        if (t !== goal) raf = requestAnimationFrame(step); else { raf = 0; last = 0; }
      }
      door.tween = function () {
        goal = (door.matches(':hover') || door.matches(':focus-visible') || door.classList.contains('open')) ? 1 : 0;
        if (still) { t = goal; draw(); return; }
        if (!raf && t !== goal) { last = 0; raf = requestAnimationFrame(step); }
      };
      ['pointerenter', 'pointerleave', 'focus', 'blur'].forEach(function (ev) { door.addEventListener(ev, function () { setTimeout(door.tween, 0); }); });
      door.addEventListener('click', function () { setTimeout(door.tween, 0); });
      draw();
    }).catch(function (err) { console.warn('[door] kept the plain swap:', err); });
  }
})();