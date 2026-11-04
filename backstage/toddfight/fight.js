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
// ---- his face: the same 18 x 14 faces as the void (toddguts/faces.png), on a panel over his screen ----
const FACES = ['smile', 'neutral', 'happy', 'angry', 'surprised', 'sly', 'sad', 'error', 'loading', 'agony'];
const FACE = { x: 1, y: 145, w: 18, h: 14 };      // where the screen is on his texture (256 x 256 units)
const STATIC = [[0, 255, 250], [255, 255, 255], [10, 40, 44], [0, 120, 118], [200, 255, 255]];
const RED = [255, 34, 46];
const facePix = document.createElement('canvas'); facePix.width = FACE.w; facePix.height = FACE.h;
const faceCtx = facePix.getContext('2d'), faceImg = faceCtx.createImageData(FACE.w, FACE.h);
const faceTex = new THREE.CanvasTexture(facePix);
faceTex.encoding = THREE.sRGBEncoding; faceTex.magFilter = faceTex.minFilter = THREE.NearestFilter; faceTex.generateMipmaps = false;
let faceData = [], shown = 1, fizz = null, red = 0, redShown = -1;
const faceAt = (name) => Math.max(0, FACES.indexOf(name));
function loadFaces() {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      faceData = FACES.map((_, i) => (i + 1) * FACE.w <= img.width ? g.getImageData(i * FACE.w, 0, FACE.w, FACE.h).data : null);
      ok();
    };
    img.onerror = () => ok();
    img.src = '../toddguts/faces.png?v=1';
  });
}
function putFace(px) {
  faceImg.data.set(px);
  if (red > 0.02) {
    // his screen goes red: the cyan turns red, the white stays white
    const d = faceImg.data;
    for (let i = 0; i < d.length; i += 4) {
      if (!(d[i + 1] > 120 && d[i + 2] > 120 && d[i] < d[i + 1] - 60)) continue;
      const k = red * (d[i + 1] / 255);
      d[i] += (RED[0] - d[i]) * k; d[i + 1] += (RED[1] - d[i + 1]) * k; d[i + 2] += (RED[2] - d[i + 2]) * k;
    }
  }
  faceCtx.putImageData(faceImg, 0, 0); faceTex.needsUpdate = true;
}
// a new face comes in through a burst of static
function face(name, dur = 420) { const to = faceAt(name); if (!faceData[to]) return; fizz = { from: shown, to, t0: performance.now(), dur, last: 0 }; }
function faceStep(now) {
  if (!fizz) { if (Math.abs(red - redShown) > 0.03 && faceData[shown]) { redShown = red; putFace(faceData[shown]); } return; }
  if (now - fizz.last < 45) return;
  fizz.last = now;
  const p = Math.min(1, (now - fizz.t0) / fizz.dur), noise = Math.sin(p * Math.PI) * 0.95;
  const src = faceData[p < 0.5 ? fizz.from : fizz.to] || faceData[fizz.to], out = new Uint8ClampedArray(FACE.w * FACE.h * 4);
  for (let y = 0; y < FACE.h; y++) {
    const tear = Math.random() < noise * 0.7 ? Math.round((Math.random() - 0.5) * 8 * (noise + 0.2)) : 0;
    for (let x = 0; x < FACE.w; x++) {
      const o = (y * FACE.w + x) * 4;
      if (Math.random() < noise) { const c = STATIC[(Math.random() * STATIC.length) | 0]; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; }
      else { const so = (y * FACE.w + Math.min(FACE.w - 1, Math.max(0, x + tear))) * 4; out[o] = src[so]; out[o + 1] = src[so + 1]; out[o + 2] = src[so + 2]; }
      out[o + 3] = 255;
    }
  }
  putFace(out); redShown = red;
  if (p >= 1) { shown = fizz.to; fizz = null; putFace(faceData[shown]); }
}
// lay the face panel exactly over the monitor's screen (found by its texture coordinates)
function buildScreen() {
  const head = bones.fat_fucking_dome; let mesh = null;
  todd.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!head || !mesh) return;
  const uv = mesh.geometry.attributes.uv, pos = mesh.geometry.attributes.position, v = new THREE.Vector3(), pts = [];
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * 256, w = uv.getY(i) * 256;
    if (u < FACE.x - 0.5 || u > FACE.x + FACE.w + 0.5 || w < FACE.y - 0.5 || w > FACE.y + FACE.h + 0.5) continue;
    mesh.boneTransform(i, v.fromBufferAttribute(pos, i)); mesh.localToWorld(v); pts.push(v.clone());
  }
  if (pts.length < 4) return;
  const front = Math.max(...pts.map((p) => p.z));
  const box = new THREE.Box3().setFromPoints(pts.filter((p) => p.z > front - 0.002)), size = new THREE.Vector3(), mid = new THREE.Vector3();
  box.getSize(size); box.getCenter(mid);
  const q = new THREE.Quaternion(); head.getWorldQuaternion(q); q.invert();
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y),
    new THREE.MeshBasicMaterial({ map: faceTex, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  panel.position.copy(head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0, 0.003))));
  panel.quaternion.copy(q); panel.renderOrder = 1;
  head.add(panel);
  if (faceData[shown]) putFace(faceData[shown]);
}

function pose(name, x, y, z, amt = 1) {
  const b = bones[name]; if (!b) return;
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(x * amt, y * amt, z * amt, 'YXZ'));
  b.quaternion.copy(rest[name]).multiply(q);
}
const facesReady = loadFaces();
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
  ledge.scale.set(LEDGE.half * 2 * toddH, toddH * 1.2, 1); ledge.position.set(0, LEDGE.y * toddH, LEDGE.z * toddH);
  ledge.material.uniforms.uCell.value = toddH * 0.09; ledge.material.uniforms.uHalf.value = LEDGE.half * toddH;
  scene.add(ledge);
  loadBot();
  facesReady.then(() => { buildScreen(); startIntro(); });
  document.getElementById('boot').classList.add('gone');
}, undefined, (e) => { console.warn('[fight] todd.gltf did not load', e); document.getElementById('boot').textContent = 'NO SIGNAL'; });

// ---- the background: a ledge far behind TODD, and the TV robot running back and forth along it ----
const LEDGE = { y: 0.78, z: -3.4, half: 2.0 };   // in TODD-heights: how high (about his shoulders), how far back, how wide (just past the screen's edges)
const ledge = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,   // seen from below
  uniforms: { uCell: { value: 0.2 }, uHalf: { value: 1 } },
  vertexShader: 'varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform float uCell; uniform float uHalf; varying vec2 vP;
    void main() {
      vec2 g = vP / uCell, f = abs(fract(g - 0.5) - 0.5) / fwidth(g);
      float line = 1.0 - min(min(f.x, f.y), 1.0);
      float fade = smoothstep(uHalf, uHalf * 0.55, abs(vP.x)) * 0.6;
      gl_FragColor = vec4(vec3(0.0, 1.0, 0.98) * line * fade * 0.5, 1.0);
    }`
}));
ledge.rotation.x = -Math.PI / 2;
const bot = { obj: null, mixer: null, acts: {}, x: 0, dir: 1, speed: 0, mode: 'run', until: 0, turn: 0, size: 1 };
function loadBot() {
  new THREE.GLTFLoader().load('bg/tvbot.gltf?v=1', (g) => {
    const o = g.scene;
    o.traverse((m) => {
      if (!m.isMesh || !m.material.map) return;
      m.material.map.magFilter = THREE.NearestFilter; m.material.map.needsUpdate = true;
      // lit a little from within, so he reads against the dark back there
      m.material.emissiveMap = m.material.map; m.material.emissive = new THREE.Color(0x777777);
    });
    const holder = new THREE.Group(); holder.add(o);
    const box = new THREE.Box3().setFromObject(o), c = new THREE.Vector3(); box.getCenter(c);
    const h = box.max.y - box.min.y, k = toddH * 0.5 / h;            // half TODD's height (he's far back, so he looks small)
    o.position.set(-c.x, -box.min.y, -c.z); holder.scale.setScalar(k);
    bot.obj = holder; bot.size = toddH;
    bot.mixer = new THREE.AnimationMixer(o);
    g.animations.forEach((a) => { bot.acts[a.name] = bot.mixer.clipAction(a); });
    if (bot.acts.run) bot.acts.run.play();
    bot.x = -LEDGE.half * toddH; bot.dir = 1;
    scene.add(holder);
  }, undefined, (e) => console.warn('[fight] tv robot did not load', e));
}
// runs to one end, sometimes stops for a breather (walking in place), turns round, runs back
function stepBot(dt, now) {
  if (!bot.obj) return;
  bot.mixer.update(dt);
  const end = LEDGE.half * toddH * 0.92;
  if (bot.mode === 'run' || bot.mode === 'walk') {
    const v = (bot.mode === 'run' ? 0.95 : 0.35) * toddH;
    bot.x += bot.dir * v * dt;
    if (Math.abs(bot.x) > end && Math.sign(bot.x) === bot.dir) { bot.mode = 'turn'; bot.turn = 0; bot.until = now + 450 + Math.random() * 1600; }
    else if (bot.mode === 'run' && Math.random() < dt * 0.08) setBotMode('walk', now + 1500 + Math.random() * 2000);
    else if (bot.mode === 'walk' && now > bot.until) setBotMode('run');
  } else if (bot.mode === 'turn' && now > bot.until) { bot.dir = -bot.dir; setBotMode(Math.random() < 0.75 ? 'run' : 'walk', now + 2000); }
  const wantRot = (bot.mode === 'turn' ? 0 : bot.dir) * Math.PI / 2;   // side-on while running, facing you while turning
  bot.obj.rotation.y += (wantRot - bot.obj.rotation.y) * Math.min(1, dt * 8);
  bot.obj.position.set(bot.x, LEDGE.y * toddH, LEDGE.z * toddH);
}
function setBotMode(m, until) {
  const from = bot.acts[bot.mode === 'walk' ? 'walk' : 'run'], to = bot.acts[m === 'walk' ? 'walk' : 'run'];
  if (to && from !== to) { to.reset().play(); from && from.crossFadeTo(to, 0.25, false); }
  bot.mode = m; if (until) bot.until = until;
}

// ---- how he moves ----
// Every frame he has a target pose (bone -> [x, y, z]), and each bone eases toward it at the current speed:
// slow and heavy normally, a snap when he's startled or throws his arms up.
const look = { yaw: 0, pitch: 0.3 };
const cur = {}, want = {};
let speed = 4;
function target(name, x, y, z) { want[name] = [x, y, z]; }
function settle(dt) {
  const k = Math.min(1, dt * speed);
  for (const name in want) {
    const c = cur[name] || (cur[name] = [0, 0, 0]), w = want[name];
    for (let i = 0; i < 3; i++) c[i] += (w[i] - c[i]) * k;
    pose(name, c[0], c[1], c[2]);
  }
}
// the opening: he sees you, he's shocked, then he throws his arms in the air and the fight is on
const fight = { phase: 'intro', t0: 0, shake: 0 };
const INTRO = { shock: 0.9, windup: 2.5, rage: 2.75, ready: 4.3 };
let introStep = 0;
function startIntro() { fight.phase = 'intro'; fight.t0 = performance.now(); introStep = 0; red = 0; face('neutral', 200); }
function banner(text) {
  const b = document.getElementById('banner'); if (!b) return;
  b.textContent = text; b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}

function animateTodd(t, dt) {
  if (!todd) return;
  const T = (performance.now() - fight.t0) / 1000;
  // where you are, from where he stands
  const youYaw = ((P.x / W) - 0.5) * 0.9, youPitch = 0.32 - (FLOOR - P.y) / H * 0.35;
  let yaw = youYaw, pitch = youPitch;
  const breathe = Math.sin(t * 1.3);
  speed = 4;
  // the default: standing over the stage, arms hanging, watching you
  let chest = [0.05 + breathe * 0.02, 0, 0];
  let armR = [breathe * 0.03, 0, 0.12], armL = [-breathe * 0.03, 0, -0.12], foreR = -0.25, foreL = -0.25;

  if (fight.phase === 'intro') {
    if (introStep === 0 && T > INTRO.shock) { introStep = 1; face('surprised', 220); fight.shake = 0.25; }
    if (introStep === 1 && T > INTRO.windup) { introStep = 2; }
    if (introStep === 2 && T > INTRO.rage) { introStep = 3; face('angry', 380); fight.shake = 1; }
    if (introStep === 3 && T > INTRO.ready) { introStep = 4; fight.phase = 'fight'; banner('FIGHT!'); }
    if (introStep === 0) {
      // not looking at you yet: idly glancing off to the side
      yaw = 0.35 + Math.sin(t * 0.6) * 0.08; pitch = 0.2;
      speed = 2.5;
    } else if (introStep === 1) {
      // !!: snaps to you, jerks back, hands up and out
      const tremble = Math.sin(t * 40) * 0.015;
      pitch = youPitch - 0.18; chest = [-0.14, 0, 0];
      armR = [-0.55 + tremble, 0.2, 0.55]; armL = [-0.55 - tremble, -0.2, -0.55]; foreR = foreL = -1.1;
      speed = T - INTRO.shock < 0.25 ? 14 : 5;
    } else if (introStep === 2) {
      // a breath in: hunched, fists down at his sides
      pitch = youPitch + 0.12; chest = [0.18, 0, 0];
      armR = [0.25, 0, 0.05]; armL = [0.25, 0, -0.05]; foreR = foreL = -0.5;
      speed = 9;
    } else if (introStep === 3) {
      // arms thrown in the air, shaking, his screen going red
      const shake = Math.sin(t * 34) * 0.06;
      pitch = youPitch - 0.25; chest = [-0.2, 0, Math.sin(t * 17) * 0.03];
      armR = [-2.75 + shake, 0, 0.5]; armL = [-2.75 - shake, 0, -0.5]; foreR = foreL = -0.35 + shake;
      speed = T - INTRO.rage < 0.3 ? 16 : 8;
      red = Math.min(1, (T - INTRO.rage) / 0.6);
    }
  } else if (fight.phase === 'fight') {
    // angry and ready: leaning in, fists up, breathing hard
    const huff = Math.sin(t * 3.2);
    chest = [0.12 + huff * 0.03, 0, 0];
    armR = [-0.9 + huff * 0.04, 0.1, 0.35]; armL = [-0.9 - huff * 0.04, -0.1, -0.35]; foreR = foreL = -1.3;
    speed = 5; red = 1;
  }

  look.yaw += (yaw - look.yaw) * Math.min(1, dt * (speed > 8 ? 12 : 3));
  look.pitch += (pitch - look.pitch) * Math.min(1, dt * (speed > 8 ? 12 : 3));
  target('chest', chest[0], chest[1] + look.yaw * 0.25, chest[2]);
  target('neck', look.pitch * 0.4, look.yaw * 0.35, 0);
  target('fat_fucking_dome', look.pitch * 0.6, look.yaw * 0.5, Math.sin(t * 0.7) * 0.03);
  target('Right_Arm', armR[0], armR[1], armR[2]); target('Left_Arm', armL[0], armL[1], armL[2]);
  target('forearm_R', foreR, 0, 0); target('forearm_L', foreL, 0, 0);
  settle(dt);
  // the screen shakes when he does something big
  fight.shake = Math.max(0, fight.shake - dt * 1.6);
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
  stepBot(dt, now);
  faceStep(now);
  const sh = fight.shake * fight.shake * 9, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  document.getElementById('arena').style.transform = sh > 0.05 ? `translate(${sx}px, ${sy}px)` : '';
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
window.FIGHT = { bot, LEDGE, P, TUNE, hurt, revive, look, bones, camera, fight, intro: startIntro, face, get todd() { return todd; } };

addEventListener('resize', fit);
fit(); paintHud();
Promise.all(FRAMES.map(loadFrame)).then(() => requestAnimationFrame(frame));
