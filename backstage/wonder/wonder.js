// Wonder's void. Loaded before /backstage/marquez/marquez.js (the conversation engine).
//  1. The lock: he's only here for someone who has the rusted key, or who already
//     unlocked the CH 02 note with it (rp_flags.wonder_unlocked). Anyone else finds nothing.
//  2. Settings for the engine (window.TALK), so it speaks as Wonder, not Marquez.
//  3. The drift: he floats around the dark on his own, and stays above the dialogue box while he talks.
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
    nextGoal = now + rand(3500, 8000);
    spinVel += rand(-0.012, 0.012);   // a lazy push into a slow turn now and then
  }

  function frame(now) {
    var dt = Math.min(64, now - last) / 16.67; last = now;
    var talking = !box.hidden;
    var b = bounds();
    if (now > nextGoal) pickGoal(now);
    // While talking he hangs above the box, near the middle, so you can see who's speaking.
    if (talking) { goal.x = (W - w) / 2 + Math.sin(now / 2300) * Math.min(120, W * 0.15); goal.y = Math.min(b.y1, Math.max(b.y0, b.y1 * 0.35)); }
    goal.x = Math.min(b.x1, Math.max(b.x0, goal.x));
    goal.y = Math.min(b.y1, Math.max(b.y0, goal.y));

    // Floaty spring toward the goal, heavily damped: drifting, never darting.
    var k = talking ? 0.0009 : 0.00035, damp = talking ? 0.94 : 0.975;
    vel.x = (vel.x + (goal.x - pos.x) * k * dt) * Math.pow(damp, dt);
    vel.y = (vel.y + (goal.y - pos.y) * k * dt) * Math.pow(damp, dt);
    pos.x += vel.x * dt; pos.y += vel.y * dt;
    pos.x = Math.min(b.x1, Math.max(b.x0, pos.x));
    pos.y = Math.min(Math.max(b.y1, b.y0), Math.max(b.y0, pos.y));

    // A slow tumble that settles upright while he talks, plus a gentle bob.
    spinVel *= Math.pow(0.995, dt);
    spin += spinVel * dt;
    var tilt = talking ? Math.sin((now - t0) / 900) * 4 : Math.sin((now - t0) / 2600) * 14 + spin * 57.3;
    if (talking) spin *= Math.pow(0.9, dt);
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
