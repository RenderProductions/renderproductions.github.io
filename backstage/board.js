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
    };
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
      try { gulp.currentTime = 0; var p = gulp.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
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
})();