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
      ['pointerenter', 'pointerleave', 'focus', 'blur'].forEach(function (ev) { n.addEventListener(ev, track); });
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