// The TODD fight. A fixed camera, TODD towering behind the stage (3D, three.js), and the player in front of
// him (2D, drawn from the player's SVG frames). The stage is 960 x 540 "stage units"; everything in the
// game (the player, the floor, the walls) lives in those units and the canvas is scaled to fit.
import * as THREE from '../toddguts/vendor/three-gltf.min.js';

const W = 960, H = 540;
const FLOOR = 472;                 // top of the floor
const WALL_L = 0, WALL_R = W;      // he can slide down the edges of the screen

// ---------------- the player's frames ----------------
// They're Scratch costumes: every frame shares one rotation centre at (240, 180) in the costume's own
// coordinates, so reading each SVG's translate() tells us where to draw it relative to the player.
const ORIGIN = { x: 240, y: 180 };
const FRAMES = ['Idle', 'Walk1', 'Walk2', 'Walk3', 'Walk4', 'Walk5', 'Walk6', 'Jump', 'Fall', 'Wall_Slide', 'Die'];
const art = {};
function loadFrame(name) {
  return fetch('player/' + name + '.svg').then((r) => r.text()).then((txt) => new Promise((ok) => {
    const w = parseFloat(/width="([\d.]+)"/.exec(txt)[1]), h = parseFloat(/height="([\d.]+)"/.exec(txt)[1]);
    const t = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(txt);
    const img = new Image();
    img.onload = () => ok();
    img.onerror = () => ok();
    img.src = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
    // the frame's top-left corner, relative to the shared centre
    art[name] = { img, w, h, ox: -parseFloat(t[1]) - ORIGIN.x, oy: -parseFloat(t[2]) - ORIGIN.y };
  }));
}
// The hitbox costume spans x 216..264, y 137..221 around the centre: so the feet are 41 below it.
const BOX = { l: -22, r: 22, t: -43, b: 41 };

// ---------------- the player ----------------
const P = {
  x: 200, y: FLOOR,           // y is the bottom of the hitbox (his feet), x is the centre
  vx: 0, vy: 0, face: 1,
  ground: true, wall: 0,      // wall: -1 sliding down the left wall, 1 the right, 0 none
  coyote: 0, buffer: 0, lock: 0, walkT: 0,
  hp: 3, dead: false, hurtT: 0, deadT: 0
};
const TUNE = {
  run: 300, accel: 2600, airAccel: 1700, friction: 3000,
  gravity: 2300, fall: 1100,       // max fall speed
  jump: 830, cut: 0.45,            // let go of jump early and he doesn't go as high
  slide: 150,                      // max speed sliding down a wall
  wallJumpX: 390, wallJumpY: 790, wallLock: 0.16,
  coyote: 0.09, buffer: 0.12
};

// ---------------- input ----------------
const keys = { left: false, right: false, jump: false };
let jumpPressed = false;
const MAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump' };
addEventListener('keydown', (e) => {
  const k = MAP[e.code]; if (!k) return;
  e.preventDefault();
  if (k === 'jump' && !keys.jump) jumpPressed = true;
  keys[k] = true;
});
addEventListener('keyup', (e) => { const k = MAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { keys.left = keys.right = keys.jump = false; });
document.querySelectorAll('#pad button').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); if (k === 'jump' && !keys.jump) jumpPressed = true; keys[k] = true; b.classList.add('on'); };
  const off = (e) => { e.preventDefault(); keys[k] = false; b.classList.remove('on'); };
  b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off); b.addEventListener('pointercancel', off); b.addEventListener('pointerleave', off);
});

function step(dt) {
  if (P.dead) { P.deadT += dt; P.vy = Math.min(P.vy + TUNE.gravity * dt, TUNE.fall); P.y = Math.min(FLOOR, P.y + P.vy * dt); return; }
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (jumpPressed) { P.buffer = TUNE.buffer; jumpPressed = false; }
  P.buffer = Math.max(0, P.buffer - dt);
  P.lock = Math.max(0, P.lock - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);

  // run
  const want = P.lock > 0 ? P.vx : dir * TUNE.run;
  const acc = dir ? (P.ground ? TUNE.accel : TUNE.airAccel) : (P.ground ? TUNE.friction : TUNE.airAccel * 0.5);
  if (P.lock <= 0) P.vx += Math.max(-acc * dt, Math.min(acc * dt, want - P.vx));
  if (dir && P.lock <= 0) P.face = dir;

  // gravity, slower down a wall
  P.vy += TUNE.gravity * dt;
  const maxFall = P.wall && P.vy > 0 ? TUNE.slide : TUNE.fall;
  if (P.vy > maxFall) P.vy = maxFall;
  if (!keys.jump && P.vy < 0 && P.cutReady) { P.vy *= TUNE.cut; P.cutReady = false; }

  // jump: off the ground (or just after leaving it), or off a wall
  if (P.buffer > 0) {
    if (P.ground || P.coyote > 0) {
      P.vy = -TUNE.jump; P.ground = false; P.coyote = 0; P.buffer = 0; P.cutReady = true;
    } else if (P.wall) {
      P.vy = -TUNE.wallJumpY; P.vx = -P.wall * TUNE.wallJumpX; P.face = -P.wall;
      P.lock = TUNE.wallLock; P.wall = 0; P.buffer = 0; P.cutReady = true;
    }
  }

  // move, then keep him in the arena
  P.x += P.vx * dt; P.y += P.vy * dt;
  let touching = 0;
  if (P.x + BOX.l <= WALL_L) { P.x = WALL_L - BOX.l; if (P.vx < 0) P.vx = 0; touching = -1; }
  if (P.x + BOX.r >= WALL_R) { P.x = WALL_R - BOX.r; if (P.vx > 0) P.vx = 0; touching = 1; }
  const was = P.ground;
  if (P.y >= FLOOR) { P.y = FLOOR; P.vy = 0; P.ground = true; } else P.ground = false;
  if (was && !P.ground) P.coyote = TUNE.coyote; else P.coyote = Math.max(0, P.coyote - dt);
  // he sticks to a wall while he's in the air, pushing into it, and on his way down
  P.wall = !P.ground && touching && dir === touching && P.vy > -60 ? touching : 0;
  if (P.wall) P.face = -P.wall;

  P.walkT = P.ground && Math.abs(P.vx) > 20 ? P.walkT + dt * Math.abs(P.vx) / TUNE.run : 0;
}

function frameFor() {
  if (P.dead) return 'Die';
  if (P.wall) return 'Wall_Slide';
  if (!P.ground) return P.vy < 0 ? 'Jump' : 'Fall';
  if (Math.abs(P.vx) > 20) return 'Walk' + (1 + Math.floor(P.walkT * 11) % 6);
  return 'Idle';
}

// ---------------- the stage (2D) ----------------
const stage = document.getElementById('stage'), ctx = stage.getContext('2d');
let scale = 1, dpr = 1;
function fit() {
  const r = stage.getBoundingClientRect();
  dpr = Math.min(2, devicePixelRatio || 1);
  stage.width = Math.round(r.width * dpr); stage.height = Math.round(r.height * dpr);
  scale = stage.width / W;
  sizeTodd(r.width, r.height);
}

function drawFloor(t) {
  // the floor he's standing on: a lit edge, and a grid running back under TODD
  const g = ctx.createLinearGradient(0, FLOOR, 0, H);
  g.addColorStop(0, '#0a2a30'); g.addColorStop(1, '#020607');
  ctx.fillStyle = g; ctx.fillRect(0, FLOOR, W, H - FLOOR);
  ctx.strokeStyle = 'rgba(0,255,250,.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = -12; i <= 12; i++) { const x = W / 2 + i * 80; ctx.moveTo(W / 2 + i * 60, FLOOR); ctx.lineTo(x * 1 + i * 40, H); }
  for (let j = 1; j < 4; j++) { const y = FLOOR + (H - FLOOR) * (j / 4) ** 1.6; ctx.moveTo(0, y); ctx.lineTo(W, y); }
  ctx.stroke();
  ctx.fillStyle = '#00fffa'; ctx.globalAlpha = 0.85 + Math.sin(t * 2) * 0.1;
  ctx.fillRect(0, FLOOR - 1, W, 2); ctx.globalAlpha = 1;
}

function drawPlayer() {
  const a = art[frameFor()]; if (!a || !a.img.complete) return;
  const cx = P.x, cy = P.y - BOX.b;         // the costume's centre
  ctx.save();
  ctx.translate(cx, cy);
  if (P.face < 0 && !P.wall) ctx.scale(-1, 1);
  if (P.wall < 0) ctx.scale(-1, 1);         // the wall-slide frame has his feet on a wall to his right
  if (P.hurtT > 0 && Math.floor(P.hurtT * 20) % 2) ctx.globalAlpha = 0.35;
  ctx.drawImage(a.img, a.ox, a.oy, a.w, a.h);
  ctx.restore();
}

// ---------------- TODD (3D, behind) ----------------
const toddCanvas = document.getElementById('todd');
const renderer = new THREE.WebGLRenderer({ canvas: toddCanvas, antialias: true, alpha: true });
renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 200);
scene.add(new THREE.HemisphereLight(0xcfefff, 0x0a1a20, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(3, 6, 8); scene.add(key);
const rim = new THREE.DirectionalLight(0x00fffa, 0.7); rim.position.set(-6, 4, -5); scene.add(rim);
let todd = null, toddH = 1;
const bones = {}, rest = {};
function sizeTodd(w, h) {
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.setSize(w, h, false);
}
function pose(name, x, y, z, amt = 1) {
  const b = bones[name]; if (!b) return;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * amt, y * amt, z * amt, 'YXZ'));
  b.quaternion.copy(rest[name]).multiply(q);
}
new THREE.GLTFLoader().load('../toddguts/todd.gltf?v=2', (gltf) => {
  todd = gltf.scene;
  todd.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      if (o.material.map) { o.material.map.magFilter = THREE.NearestFilter; o.material.map.needsUpdate = true; }
    }
    if (o.isBone) { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
  });
  scene.add(todd);
  todd.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(todd), c = new THREE.Vector3();
  box.getCenter(c); toddH = box.max.y - box.min.y;
  todd.position.set(-c.x, -box.min.y, -c.z);
  // Fixed camera, low and in front of him: he fills the screen from the waist up, looking down at the stage.
  // (like Saltbaker: his belt at the stage's edge, his screen up near the top, much bigger than you)
  camera.position.set(0, toddH * 0.6, toddH * 1.2);
  camera.lookAt(0, toddH * 0.74, 0);
  document.getElementById('boot').classList.add('gone');
}, undefined, (e) => { console.warn('[fight] todd.gltf did not load', e); document.getElementById('boot').textContent = 'NO SIGNAL'; });

// he watches the player: his head follows them across the stage
const look = { yaw: 0, pitch: 0.3 };
function animateTodd(t, dt) {
  if (!todd) return;
  const wantYaw = -((P.x / W) - 0.5) * 0.9;          // player on your right = his left
  const wantPitch = 0.32 + (FLOOR - P.y) / H * -0.35;  // looks up a little as they jump
  look.yaw += (wantYaw - look.yaw) * Math.min(1, dt * 3);
  look.pitch += (wantPitch - look.pitch) * Math.min(1, dt * 3);
  const breathe = Math.sin(t * 1.3);
  pose('chest', 0.05 + breathe * 0.02, look.yaw * 0.25, 0);
  pose('neck', look.pitch * 0.4, look.yaw * 0.35, 0);
  pose('fat_fucking_dome', look.pitch * 0.6, look.yaw * 0.5, Math.sin(t * 0.7) * 0.03);
  // arms hanging, a slow sway
  pose('Right_Arm', breathe * 0.03, 0, 0.12);
  pose('Left_Arm', -breathe * 0.03, 0, -0.12);
  pose('forearm_R', -0.25, 0, 0);
  pose('forearm_L', -0.25, 0, 0);
}

// ---------------- the loop ----------------
const hud = document.getElementById('hud');
function paintHud() { hud.textContent = P.dead ? 'DEAD' : 'HP. ' + P.hp; hud.classList.toggle('low', P.hp <= 1); }
let then = performance.now(), acc = 0;
const STEP = 1 / 120;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - then) / 1000); then = now;
  acc += dt;
  while (acc >= STEP) { step(STEP); acc -= STEP; }
  const t = now / 1000;
  animateTodd(t, dt);
  if (todd) renderer.render(scene, camera);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  drawFloor(t);
  drawPlayer();
}

// for testing from the console
function hurt(n = 1) {
  if (P.dead || P.hurtT > 0) return;
  P.hp = Math.max(0, P.hp - n); P.hurtT = 1.2;
  if (P.hp === 0) { P.dead = true; P.vx = 0; P.vy = -500; P.wall = 0; }
  paintHud();
}
function revive() { Object.assign(P, { hp: 3, dead: false, deadT: 0, hurtT: 0, x: 200, y: FLOOR, vx: 0, vy: 0 }); paintHud(); }
window.FIGHT = { P, TUNE, hurt, revive, look, bones, camera, get todd() { return todd; } };

addEventListener('resize', fit);
fit(); paintHud();
Promise.all(FRAMES.map(loadFrame)).then(() => requestAnimationFrame(frame));
