// Wonder's void. Loaded before /backstage/marquez/marquez.js (the conversation engine).
//  1. The lock: he's only here for someone who has the rusted key, or who already
//     unlocked the CH 02 note with it (rp_flags.wonder_unlocked). Anyone else finds nothing.
//  2. Settings for the engine (window.TALK), so it speaks as Wonder, not Marquez.
//  3. The drift: he floats around the dark on his own, and stays above the dialogue box while he talks.
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
    canTalk: function () { return open; }
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
    requestAnimationFrame(frame);
  }

  if (reduce) {
    drifter.style.transform = 'translate(' + ((W - w) / 2) + 'px,' + Math.min(b0.y1, H * 0.18) + 'px)';
  } else {
    pickGoal(performance.now());
    requestAnimationFrame(frame);
  }
})();
