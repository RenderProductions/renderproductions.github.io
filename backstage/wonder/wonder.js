// Wonder's void. Loaded before /backstage/marquez/marquez.js (the conversation engine).
//  1. The lock: he's only here for someone who has the rusted key, or who already
//     unlocked the CH 02 note with it (rp_flags.wonder_unlocked). Anyone else finds nothing.
//  2. Settings for the engine (window.TALK), so it speaks as Wonder, not Marquez.
//  3. The drift: he floats, bounces and tumbles around the dark the whole time, talking or not,
//     and he never holds still: he hates standing still.
//     While the dialogue box is open he just keeps to the space above it.
//  4. The limbs: art/wonder.svg is put in the page inline, and each limb (tagged data-part="arm-l",
//     "arm-r", "leg-l", "leg-r") swings on its shoulder or hip, trailing behind wherever he drifts.
(function () {
  'use strict';
  var room = document.getElementById('room');
  var drifter = document.getElementById('drifter');
  var box = document.getElementById('box');
  var prompt = document.getElementById('prompt');

  // ---- 1. the lock ----
  function flags() { try { return JSON.parse(localStorage.getItem('rp_flags')) || {}; } catch (e) { return {}; } }
  function unlocked() {
    var hasKey = !!(window.RPInventory && RPInventory.has('rusted_key'));
    return hasKey || !!flags().wonder_unlocked;
  }
  var open = unlocked();
  if (open) {
    // Remember it, so the void stays open even if the key is ever traded away.
    try { var f = flags(); if (!f.wonder_unlocked) { f.wonder_unlocked = Date.now(); localStorage.setItem('rp_flags', JSON.stringify(f)); } } catch (e) {}
  } else {
    room.classList.add('empty');
    prompt.textContent = '(Nothing. Not even an echo.)';
  }

  // The split nameplate draws its name twice (see .plate::after in wonder.css), so keep a copy in data-name.
  var plate = document.getElementById('plate');
  function syncPlate() { if (plate.getAttribute('data-name') !== plate.textContent) plate.setAttribute('data-name', plate.textContent); }
  syncPlate();
  new MutationObserver(syncPlate).observe(plate, { childList: true, characterData: true, subtree: true });

  // ---- 2. the engine, set up for Wonder ----
  window.TALK = {
    name: 'WONDER',
    art: 'art/wonder',
    faces: [],          // one drawing for now; add art/wonder-<face>.svg files and list them here for expressions
    talkFrames: false,  // no mouth-flap frames yet
    seenKey: 'rvWonderSeen',
    muteKey: 'rvWonderMute',
    canTalk: function () { return open; },
    autoStart: 1400     // the first time you arrive, he notices you before you say a word
  };
  if (!open) return;

  // ---- effects asked for by his lines ("fx" in dialogue.json) ----
  // "stars": the void lights up. Stars pop in all over (a few burst close around him), twinkle, and fade.
  var STAR = '<svg viewBox="-10 -10 20 20" aria-hidden="true"><path d="M0,-10 C1,-2 2,-1 10,0 C2,1 1,2 0,10 C-1,2 -2,1 -10,0 C-2,-1 -1,-2 0,-10Z"/></svg>';
  function stars() {
    if (!open) return;
    var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    var W = room.clientWidth, H = room.clientHeight;
    var d = drifter.getBoundingClientRect(), r = room.getBoundingClientRect();
    var cx = d.left - r.left + d.width / 2, cy = d.top - r.top + d.height / 2;
    var count = still ? 14 : 34;
    for (var i = 0; i < count; i++) {
      var near = i < 9;   // the first few burst out around him
      var el = document.createElement('span');
      el.className = 'star' + (Math.random() < 0.3 ? ' big' : '');
      el.innerHTML = STAR;
      var x, y;
      if (near) { var a = Math.random() * Math.PI * 2, dist = d.width * (0.5 + Math.random() * 0.9); x = cx + Math.cos(a) * dist; y = cy + Math.sin(a) * dist; }
      else { x = Math.random() * W; y = Math.random() * H * 0.8; }
      el.style.left = x.toFixed(0) + 'px';
      el.style.top = y.toFixed(0) + 'px';
      el.style.setProperty('--s', (0.5 + Math.random() * 1.1).toFixed(2));
      el.style.setProperty('--spin', (Math.random() < 0.5 ? -1 : 1) * (20 + Math.random() * 70) + 'deg');
      el.style.animationDelay = (still ? 0 : (near ? i * 60 : 300 + Math.random() * 1400)) + 'ms';
      el.style.animationDuration = (2.2 + Math.random() * 1.6).toFixed(2) + 's';
      room.appendChild(el);
      el.addEventListener('animationend', function () { this.remove(); });
    }
  }
  document.addEventListener('talk:fx', function (e) { if (e.detail && e.detail.fx === 'stars') stars(); });

  // ---- 3. the drift ----
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var W = 0, H = 0, w = 0, h = 0;
  function measure() {
    W = room.clientWidth; H = room.clientHeight;
    w = drifter.offsetWidth; h = drifter.offsetHeight;
  }
  measure();
  window.addEventListener('resize', measure);

  // Where he's allowed to float: anywhere, but while the box is open, only the part above it.
  function bounds() {
    var bottom = H;
    if (!box.hidden) bottom = Math.max(h + 20, box.getBoundingClientRect().top - room.getBoundingClientRect().top - 12);
    return { x0: 8, x1: Math.max(8, W - w - 8), y0: 8, y1: Math.max(8, bottom - h) };
  }
  function rand(a, b) { return a + Math.random() * (b - a); }

  // ---- 4. the limbs ----
  // Shoulders and hips, in the drawing's own coordinates (art/wonder.svg). Move these if he's redrawn.
  // out = which way a limb rotates to swing outward (+ = clockwise). max = furthest outward swing,
  // inMax = furthest inward swing. Limbs never fold in across his body: a swing that would go inward
  // is flipped to go outward instead, and inMax is only a few degrees of give for the idle sway.
  var PIVOTS = {
    'arm-l': { x: 214, y: 124, out: 1,  reach: 1,    max: 55, inMax: 6, phase: 0,   tip: [160, 224] },
    'arm-r': { x: 311, y: 124, out: -1, reach: 1,    max: 55, inMax: 6, phase: 1.7, tip: [370, 224] },
    'leg-l': { x: 244, y: 181, out: 1,  reach: 0.55, max: 30, inMax: 4, phase: 3.1 },
    'leg-r': { x: 283, y: 181, out: -1, reach: 0.55, max: 30, inMax: 4, phase: 4.6 }
  };
  // Arms (anything with a tip) also roll over when raised high: the drawing mirrors along the arm,
  // so the glove bends down naturally instead of kinking upward. It flips past FLIP_AT degrees
  // outward and back below FLIP_BACK, and turns through edge-on on the way, like an arm rolling.
  var FLIP_AT = 28, FLIP_BACK = 20;
  var limbs = [];
  var img = document.getElementById('him');
  fetch(img.getAttribute('src') + '?v=2')
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
    .then(function (text) {
      var svg = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      if (svg.nodeName !== 'svg') return;
      svg.removeAttribute('width'); svg.removeAttribute('height');
      svg.setAttribute('class', 'body'); svg.setAttribute('aria-hidden', 'true');
      svg = document.importNode(svg, true);
      Object.keys(PIVOTS).forEach(function (part) {
        var els = svg.querySelectorAll('[data-part="' + part + '"]');
        var pv = PIVOTS[part];
        // the arm's own direction at rest (shoulder to hand), for mirroring along it
        var axis = pv.tip ? Math.atan2(pv.tip[1] - pv.y, pv.tip[0] - pv.x) * 180 / Math.PI : 0;
        if (els.length) limbs.push({ els: els, p: pv, a: 0, v: 0, roll: 1, flipped: false, axis: axis });
      });
      drifter.insertBefore(svg, img);
      img.classList.add('swapped');   // the plain picture stays in the page (the talk engine uses it), just hidden
    })
    .catch(function (e) { console.warn('[wonder] limbs not loaded, using the still picture', e); });

  var lastTilt = 0;
  function swingLimbs(now, dt, tilt) {
    if (!limbs.length) return;
    // His drift, turned into his own frame of reference (he may be upside down).
    var r = -tilt * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    var vx = vel.x * c - vel.y * s, vy = vel.x * s + vel.y * c;
    var turn = (tilt - lastTilt) / Math.max(dt, 0.001);   // degrees per frame
    lastTilt = tilt;
    limbs.forEach(function (L) {
      var p = L.p;
      var target = vx * 10 * p.reach                  // trail behind sideways motion
                 + vy * 7 * p.reach * p.out          // drag lifts them outward when he sinks
                 - turn * 4 * p.reach                // lag behind his tumble
                 + Math.sin(now / 1700 + p.phase) * 7 * p.reach;   // a little idle sway
      // Work in outward terms. A pull inward (beyond the idle give) flips to a pull outward.
      var outward = target * p.out;
      if (outward < -p.inMax) outward = -outward * 0.7;
      outward = Math.max(-p.inMax, Math.min(p.max, outward));
      target = outward * p.out;
      // A loose spring: swings past, comes back, settles. Floaty, like underwater.
      L.v = (L.v + (target - L.a) * 0.018 * dt) * Math.pow(0.9, dt);
      L.a += L.v * dt;
      // Hard stop: even an overshooting swing can't carry a limb into his body.
      var now_out = L.a * p.out;
      if (now_out < -p.inMax) { L.a = -p.inMax * p.out; L.v *= -0.3; }
      else if (now_out > p.max) { L.a = p.max * p.out; L.v *= -0.3; }
      var tf = 'rotate(' + L.a.toFixed(2) + ' ' + p.x + ' ' + p.y + ')';
      if (p.tip) {
        var lifted = L.a * p.out;
        if (!L.flipped && lifted > FLIP_AT) L.flipped = true;
        else if (L.flipped && lifted < FLIP_BACK) L.flipped = false;
        // Quick roll (about a tenth of a second), so the arm is only edge-on for a blink.
        var want = L.flipped ? -1 : 1, stepBy = 0.3 * dt;
        L.roll = Math.abs(want - L.roll) <= stepBy ? want : L.roll + (want > L.roll ? stepBy : -stepBy);
        if (L.roll < 1) {   // any amount of flip (including fully flipped) needs the mirror
          var sy = Math.abs(L.roll) < 0.06 ? (L.roll < 0 ? -0.06 : 0.06) : L.roll;   // never fully paper-thin
          tf += ' translate(' + p.x + ' ' + p.y + ') rotate(' + L.axis.toFixed(2) + ') scale(1 ' + sy.toFixed(3) +
                ') rotate(' + (-L.axis).toFixed(2) + ') translate(' + (-p.x) + ' ' + (-p.y) + ')';
        }
      }
      for (var i = 0; i < L.els.length; i++) L.els[i].setAttribute('transform', tf);
    });
  }

  var b0 = bounds();
  var pos = { x: (W - w) / 2, y: Math.min(b0.y1, H * 0.18) };
  var vel = { x: 0, y: 0 };
  var goal = { x: pos.x, y: pos.y };
  var nextGoal = 0, spin = 0, spinVel = 0, t0 = performance.now(), last = t0;

  function pickGoal(now) {
    var b = bounds();
    goal.x = rand(b.x0, b.x1);
    goal.y = rand(b.y0, b.y1);
    nextGoal = now + rand(1500, 3500);
    spinVel += rand(-0.02, 0.02);     // and a push into a turn every time
  }

  function frame(now) {
    var dt = Math.min(64, now - last) / 16.67; last = now;
    var talking = !box.hidden;
    var b = bounds();
    // A new spot every couple of seconds, or as soon as he's nearly there: he never arrives anywhere.
    if (now > nextGoal || Math.hypot(goal.x - pos.x, goal.y - pos.y) < Math.max(60, w * 0.5)) pickGoal(now);
    // He picks his own spots the whole time; while the box is open they just have to be above it.
    goal.x = Math.min(b.x1, Math.max(b.x0, goal.x));
    goal.y = Math.min(b.y1, Math.max(b.y0, goal.y));

    // Floaty spring toward the goal, heavily damped: drifting, never darting.
    var k = 0.0005, damp = 0.972;
    vel.x = (vel.x + (goal.x - pos.x) * k * dt) * Math.pow(damp, dt);
    vel.y = (vel.y + (goal.y - pos.y) * k * dt) * Math.pow(damp, dt);
    // Never still: if he slows down too much, he gets a shove toward wherever he's headed.
    var speed = Math.hypot(vel.x, vel.y), MIN_SPEED = 1.1;
    if (speed < MIN_SPEED) {
      var gx = goal.x - pos.x, gy = goal.y - pos.y, gl = Math.hypot(gx, gy) || 1;
      vel.x += (gx / gl) * 0.12 * dt; vel.y += (gy / gl) * 0.12 * dt;
    }
    // Bounce off the edges of the dark instead of sticking to them.
    if ((pos.x <= b.x0 && vel.x < 0) || (pos.x >= b.x1 && vel.x > 0)) vel.x *= -0.7;
    if ((pos.y <= b.y0 && vel.y < 0)) vel.y *= -0.7;
    // When the box opens under him, he floats up out of its way instead of snapping there.
    if (pos.y > b.y1) vel.y -= Math.min(4, (pos.y - b.y1) * 0.01) * dt;
    pos.x += vel.x * dt; pos.y += vel.y * dt;
    pos.x = Math.min(b.x1, Math.max(b.x0, pos.x));
    pos.y = Math.max(b.y0, Math.min(pos.y, Math.max(b.y1, b.y0) + (talking ? h * 0.6 : 0)));   // never more than a little behind the box

    // A slow tumble and a gentle bob, talking or not.
    spinVel *= Math.pow(0.996, dt);
    spin += spinVel * dt;
    var tilt = Math.sin((now - t0) / 2600) * 14 + spin * 57.3;
    var bob = Math.sin((now - t0) / 1300) * 6;
    drifter.style.transform = 'translate(' + pos.x.toFixed(1) + 'px,' + (pos.y + bob).toFixed(1) + 'px) rotate(' + tilt.toFixed(2) + 'deg)';
    swingLimbs(now, dt, tilt);
    requestAnimationFrame(frame);
  }

  if (reduce) {
    drifter.style.transform = 'translate(' + ((W - w) / 2) + 'px,' + Math.min(b0.y1, H * 0.18) + 'px)';
  } else {
    pickGoal(performance.now());
    requestAnimationFrame(frame);
  }
})();
