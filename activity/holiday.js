// Polygon Holidays on the site: a string of lights along the top and gentle snow, in December only
// (Eastern time, like the bot). Reduced motion gets the lights without the snow or the twinkle.
// Preview any time with ?holiday=1. (A copy lives in activity/holiday.js for the Trading Floor.)
(function () {
  try {
    var month = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'numeric' }).format(new Date());
    if (month !== '12' && !/[?&]holiday=1\b/.test(location.search)) return;
  } catch (e) { return; }
  var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- the lights ----
  var css = document.createElement('style');
  css.textContent =
    '.rp-lights{position:fixed;left:0;right:0;top:0;height:22px;pointer-events:none;z-index:9998;display:flex;justify-content:space-around;overflow:hidden}' +
    '.rp-lights:before{content:"";position:absolute;left:0;right:0;top:5px;border-top:1.5px solid rgba(20,40,20,.85)}' +
    '.rp-lights i{position:relative;top:6px;width:7px;height:11px;border-radius:50% 50% 45% 45%;background:var(--c);box-shadow:0 2px 9px 1px var(--c);opacity:.95}' +
    '.rp-lights i:before{content:"";position:absolute;left:1px;top:-3px;width:5px;height:4px;background:#2b3a2b;border-radius:1px}' +
    (still ? '' : '.rp-lights i{animation:rp-tw 2.4s ease-in-out infinite}@keyframes rp-tw{0%,100%{opacity:.95}50%{opacity:.35;box-shadow:0 2px 4px 0 var(--c)}}') +
    '.rp-snow{position:fixed;inset:0;pointer-events:none;z-index:9997}';
  document.head.appendChild(css);
  var lights = document.createElement('div');
  lights.className = 'rp-lights';
  lights.setAttribute('aria-hidden', 'true');
  var colors = ['#ff4d5e', '#ffe600', '#3ddc84', '#4da3ff', '#ff9f1c'];
  var n = Math.max(10, Math.round(innerWidth / 46));
  for (var i = 0; i < n; i++) {
    var b = document.createElement('i');
    b.style.setProperty('--c', colors[i % colors.length]);
    b.style.animationDelay = (i % 5) * 0.45 + 's';
    lights.appendChild(b);
  }
  document.body.appendChild(lights);
  if (still) return;

  // ---- the snow ----
  var cv = document.createElement('canvas');
  cv.className = 'rp-snow';
  cv.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cv);
  var ctx = cv.getContext('2d'), flakes = [], W = 0, H = 0, dpr = Math.min(2, window.devicePixelRatio || 1);
  function size() {
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var want = Math.round(Math.min(90, W * H / 16000));
    while (flakes.length < want) flakes.push(flake(true));
    flakes.length = want;
  }
  function flake(anywhere) {
    return { x: Math.random() * W, y: anywhere ? Math.random() * H : -6, r: 0.8 + Math.random() * 2.2, s: 0.3 + Math.random() * 0.9, w: Math.random() * 6.28, a: 0.35 + Math.random() * 0.5 };
  }
  addEventListener('resize', size);
  size();
  var last = 0;
  (function frame(t) {
    requestAnimationFrame(frame);
    if (document.hidden || t - last < 33) return;   // about 30 frames a second is plenty for snow
    last = t;
    ctx.clearRect(0, 0, W, H);
    for (var i = 0; i < flakes.length; i++) {
      var f = flakes[i];
      f.y += f.s; f.w += 0.012; f.x += Math.sin(f.w) * 0.35;
      if (f.y > H + 6) flakes[i] = f = flake(false);
      ctx.globalAlpha = f.a;
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 6.283); ctx.fill();
    }
  })(0);
})();
