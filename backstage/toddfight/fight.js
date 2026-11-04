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
  hp: 3, dead: false, hurtT: 0, deadT: 0,
  parryT: 0, spin: 0, parryCool: 0, goldT: 0, streak: 0,   // goldT: untouchable after a parry; parryT: the parry window is open (jump pressed in mid-air); spin: the flip after a parry
};
const TUNE = {
  run: 300, accel: 2600, airAccel: 1700, friction: 3000,
  gravity: 2300, fall: 1100,       // max fall speed
  jump: 830, cut: 0.45,            // let go of jump early and he doesn't go as high
  slide: 150,                      // max speed sliding down a wall
  wallJumpX: 390, wallJumpY: 790, wallLock: 0.16,
  coyote: 0.09, buffer: 0.12,
  parry: 0.2, parryBounce: 760,
  spin: 0.34, parryCool: 0.22,      // the parry is its own button: a quick spin; after a miss, a moment before the next
  groundHop: 380, airPop: 220,      // a little hop on the ground, a little lift in the air
  gold: 0.6                         // how long a successful parry makes you untouchable (you glow gold)    // how long a mid-air jump press can parry for, and how high a parry bounces you
};

// ---------------- input ----------------
const keys = { left: false, right: false, jump: false, parry: false };
let jumpPressed = false, parryPressed = false;
const MAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  KeyX: 'parry', KeyK: 'parry', ShiftLeft: 'parry', ShiftRight: 'parry', ArrowDown: 'parry', KeyS: 'parry' };
addEventListener('keydown', (e) => {
  const k = MAP[e.code]; if (!k) return;
  e.preventDefault();
  if (k === 'jump' && !keys.jump) jumpPressed = true;
  if (k === 'parry' && !keys.parry) parryPressed = true;
  keys[k] = true;
});
addEventListener('keyup', (e) => { const k = MAP[e.code]; if (k) keys[k] = false; });
addEventListener('blur', () => { keys.left = keys.right = keys.jump = keys.parry = false; });
document.querySelectorAll('#pad button').forEach((b) => {
  const k = b.dataset.k;
  const on = (e) => { e.preventDefault(); if (k === 'jump' && !keys.jump) jumpPressed = true; if (k === 'parry' && !keys.parry) parryPressed = true; keys[k] = true; b.classList.add('on'); };
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
  P.goldT = Math.max(0, (P.goldT || 0) - dt);

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
  // the parry button: a quick spin, and for a moment anything he throws at you that you touch gets knocked
  // back at him instead of hurting you
  P.parryCool = Math.max(0, (P.parryCool || 0) - dt);
  if (parryPressed) {
    parryPressed = false;
    if (P.parryCool <= 0 && P.spin <= 0) {
      if (P.ground) { P.vy = -TUNE.groundHop; P.ground = false; P.cutReady = false; }
      else if (!P.wall) P.vy = Math.min(P.vy, -TUNE.airPop);
      P.parryT = TUNE.parry; P.spin = TUNE.spin; P.parryCool = TUNE.spin + TUNE.parryCool;
    }
  }
  P.parryT = Math.max(0, P.parryT - dt);
  P.spin = Math.max(0, P.spin - dt);

  // move, then keep him in the arena
  P.x += P.vx * dt; P.y += P.vy * dt;
  let touching = 0;
  if (P.x + BOX.l <= WALL_L) { P.x = WALL_L - BOX.l; if (P.vx < 0) P.vx = 0; touching = -1; }
  if (P.x + BOX.r >= WALL_R) { P.x = WALL_R - BOX.r; if (P.vx > 0) P.vx = 0; touching = 1; }
  const was = P.ground;
  if (P.y >= FLOOR) { if (!P.ground && P.vy > 300) ripple(P.x, 0.8); P.y = FLOOR; P.vy = 0; P.ground = true; } else P.ground = false;
  if (was && !P.ground) P.coyote = TUNE.coyote; else P.coyote = Math.max(0, P.coyote - dt);
  // he sticks to a wall while he's in the air, pushing into it, and on his way down
  P.wall = !P.ground && touching && dir === touching && P.vy > -60 ? touching : 0;
  if (P.wall) P.face = -P.wall;

  P.walkT = P.ground && Math.abs(P.vx) > 20 ? P.walkT + dt * Math.abs(P.vx) / TUNE.run : 0;
}

const WALK = ['Walk1', 'Walk2', 'Walk3', 'Idle', 'Walk4', 'Walk5', 'Walk6', 'Idle'];
function frameFor() {
  if (P.dead) return 'Die';
  if (P.spin > 0 || P.parryT > 0) return 'Jump';
  if (P.wall) return 'Wall_Slide';
  if (!P.ground) return P.vy < 0 ? 'Jump' : 'Fall';
  // the idle frame is the passing pose between each half of the step
  if (Math.abs(P.vx) > 20) return WALK[Math.floor(P.walkT * 14) % WALK.length];
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
  // a parry: a quick flip, and a flash around him while the window's open
  if (P.spin > 0) ctx.rotate((1 - P.spin / TUNE.spin) * Math.PI * 2 * P.face);
  if (P.goldT > 0) {
    // just parried: golden, and nothing can touch you
    const k = Math.min(1, P.goldT / 0.15);
    ctx.shadowColor = '#ffd23a'; ctx.shadowBlur = 26 * k;
    ctx.filter = `sepia(${k}) saturate(${1 + 5 * k}) hue-rotate(${-8 * k}deg) brightness(${1 + 0.15 * k})`;
  } else if (P.parryT > 0) { ctx.shadowColor = '#ff5cf0'; ctx.shadowBlur = 22; }
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
let faceData = [], shown = 1, fizz = null, red = 0, redShown = -1, agonyPanel = null, agonyAmt = 0;
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
  head.add(panel); screenPanel = panel;
  // the agony face: the big detailed picture, laid over the screen when he uses his worst attack
  const agonyAt = head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0, 0.006)));   // now, while his head is still at rest
  new THREE.TextureLoader().load('../toddguts/agony.jpg', (tex) => {
    tex.encoding = THREE.sRGBEncoding;
    const Z = 0.8, keep = Math.min(1, size.y / size.x) * Z;
    tex.repeat.set(Z, keep); tex.offset.set((1 - Z) / 2, (1 - keep) / 2);
    agonyPanel = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.97, size.y * 0.97),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    agonyPanel.position.copy(agonyAt);
    agonyPanel.quaternion.copy(q); agonyPanel.renderOrder = 2; agonyPanel.visible = false;
    head.add(agonyPanel);
  });
  const r = new THREE.Vector3(); bones.Right_Arm.getWorldPosition(r); rightArmOnLeft = toStage(r).x < W / 2;
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
  camera.updateMatrixWorld(true);
  buildFloor();
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
  // the model faces -z: side-on in the direction he's running, and turned to face you while he turns round
  const wantRot = bot.mode === 'turn' ? Math.PI : -bot.dir * Math.PI / 2;
  const diff = Math.atan2(Math.sin(wantRot - bot.obj.rotation.y), Math.cos(wantRot - bot.obj.rotation.y));   // the short way round
  bot.obj.rotation.y += diff * Math.min(1, dt * 8);
  bot.obj.position.set(bot.x, LEDGE.y * toddH, LEDGE.z * toddH);
}
function setBotMode(m, until) {
  const from = bot.acts[bot.mode === 'walk' ? 'walk' : 'run'], to = bot.acts[m === 'walk' ? 'walk' : 'run'];
  if (to && from !== to) { to.reset().play(); from && from.crossFadeTo(to, 0.25, false); }
  bot.mode = m; if (until) bot.until = until;
}

// ---- the floor: a 3D slab in front of him (in his realm everything is 3D; the player is the odd one out) ----
// Its top is lined up so that the line the player walks on (FLOOR, in stage units) sits on it at depth PLANE
// (in TODD-heights, toward you). His fist lands at that same depth, so it really hits the floor you're on.
const PLANE = 0.32;
const RIPPLES = 8;
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uCell: { value: 0.3 }, uTime: { value: 0 }, uRip: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector4(0, 0, -100, 0)) }, uHalf: { value: 10 } },
  vertexShader: 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `uniform float uCell; uniform float uTime; uniform vec4 uRip[${RIPPLES}]; uniform float uHalf; varying vec3 vW;
    void main() {
      vec2 p = vW.xz, g = p / uCell, f = abs(fract(g - 0.5) - 0.5) / fwidth(g);
      float line = 1.0 - min(min(f.x, f.y), 1.0);
      vec2 g4 = g / 4.0, f4 = abs(fract(g4 - 0.5) - 0.5) / fwidth(g4);
      float major = 1.0 - min(min(f4.x, f4.y), 1.0);
      float edge = smoothstep(uHalf, uHalf * 0.4, abs(p.x));
      float glow = (line * 0.28 + major * 0.3) * edge;
      for (int i = 0; i < ${RIPPLES}; i++) {
        float age = uTime - uRip[i].z; if (age < 0.0 || age > 1.4) continue;
        float r = age * uRip[i].w, d = distance(p, uRip[i].xy);
        glow += (line * 1.2 + 0.18) * smoothstep(uCell * 1.2, 0.0, abs(d - r)) * (1.0 - age / 1.4);
      }
      vec3 base = vec3(0.012, 0.04, 0.05);
      gl_FragColor = vec4(base + vec3(0.0, 1.0, 0.98) * glow, 1.0);
    }`
});
const slabFront = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x03090b).convertSRGBToLinear() });
const slab = new THREE.Group();
let floorY = 0, ripI = 0;
function buildFloor() {
  // how high the top must be for the player's line to sit on it
  floorY = fromStage(W / 2, FLOOR, PLANE * toddH).y;
  const front = (PLANE + 0.16) * toddH, back = 0.12 * toddH, wide = 4 * toddH;   // (back: stops just in front of him, so it doesn't cut through his waist)
  const top = new THREE.Mesh(new THREE.PlaneGeometry(wide, front - back), floorMat);
  top.rotation.x = -Math.PI / 2; top.position.set(0, floorY, (front + back) / 2);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(wide, toddH), slabFront);
  face.position.set(0, floorY - toddH / 2, front);
  // the lit front edge
  const lip = new THREE.Mesh(new THREE.BoxGeometry(wide, toddH * 0.0025, toddH * 0.0025), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x00c8c4).convertSRGBToLinear() }));
  lip.position.set(0, floorY, front);
  // and a dimmer one along the back edge, so it reads as the floor's end, in front of him
  const backLip = new THREE.Mesh(lip.geometry, new THREE.MeshBasicMaterial({ color: new THREE.Color(0x007a78).convertSRGBToLinear() }));
  backLip.position.set(0, floorY, back);
  slab.add(top, face, lip, backLip); scene.add(slab);
  floorMat.uniforms.uCell.value = toddH * 0.06; floorMat.uniforms.uHalf.value = toddH * 1.6;
}
// a ring of light spreading across the floor from a point on the stage
function ripple(stageX, speed = 1.2) {
  const p = fromStage(stageX, FLOOR, PLANE * toddH);
  floorMat.uniforms.uRip.value[ripI++ % RIPPLES].set(p.x, p.z, floorMat.uniforms.uTime.value, speed * toddH);
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
    if (atk && (atk.kind === 'slam' || atk.kind === 'sweep')) {
      const S = atk.side, T2 = (performance.now() - atk.t0) / 1000;
      let a = null, f = null;
      if (atk.state === 'raise' && atk.kind === 'sweep') { a = [-1.3, 0, S === 'R' ? 1.2 : -1.2]; f = -0.5; chest = [0.1, 0, 0]; speed = 6; pitch = 0.4; }
      else if (atk.state === 'raise') { a = [-2.7, 0, S === 'R' ? 0.25 : -0.25]; f = -0.4; chest = [-0.12, 0, 0]; speed = 7; pitch = youPitch + 0.1; }
      else if (atk.state === 'sweep') { a = atk.sol.c.slice(0, 3); f = atk.sol.c[3]; chest = [atk.lean, 0, 0]; speed = 30; pitch = 0.55; }
      else if (atk.state === 'down' || atk.state === 'rest') { a = atk.sol.c.slice(0, 3); f = atk.sol.c[3]; chest = [atk.lean, 0, 0]; speed = atk.state === 'down' ? 26 : 10; pitch = 0.55; }
      else if (atk.state === 'punch' && atk.punch) { a = atk.punch.c.slice(0, 3); f = atk.punch.c[3]; chest = [-0.1, 0, 0]; speed = 18; }
      else if (atk.state === 'lift') speed = 5;
      if (a) { if (S === 'R') { armR = a; foreR = f; } else { armL = a; foreL = f; } }
    } else if (atk && atk.kind === 'rain') {
      // arms up, pounding at the air, his terminal pouring out of the sky
      const pound = Math.sin(t * 9);
      armR = [-2.5 + pound * 0.25, 0, 0.35]; armL = [-2.5 - pound * 0.25, 0, -0.35]; foreR = foreL = -0.9;
      chest = [-0.18, 0, 0]; pitch = -0.35; speed = 9;
    } else if (atk && atk.kind === 'agony') {
      // arms flung wide, leaning back, the face burning through his screen
      const tr = Math.sin(t * 45) * 0.04;
      armR = [-0.4 + tr, 0, 1.45]; armL = [-0.4 - tr, 0, -1.45]; foreR = foreL = -0.15;
      chest = [-0.3, 0, tr]; pitch = -0.1; speed = atk.state === 'charge' ? 6 : 12;
    } else if (atk && atk.kind === 'taunt') {
      const T2 = (performance.now() - atk.t0) / 1000, k = tauntFrame(T2);
      speed = 9;
      const put = (side, sol, extra) => {
        if (!sol) return;
        const a = sol.c.slice(0, 3), f = sol.c[3] + (extra || 0);
        if (side === 'R') { armR = a; foreR = f; } else { armL = a; foreL = f; }
      };
      const wig = k.wig ? Math.sin(t * 16) * 0.12 : 0, grind = k.grind ? Math.sin(t * 22) * 0.07 : 0;
      put('R', k.R, wig + grind); put('L', k.L, wig - grind);
      if (k.wig) { const sR = k.R ? armR : armL; sR[1] += Math.sin(t * 16) * 0.1; }
      if (atk.taunt === 'tie') { pitch = youPitch - 0.22; chest = [0.0, 0, Math.sin(t * 3) * 0.04]; }
      else if (atk.taunt === 'brush') { pitch = youPitch - 0.1; chest = [0.08, 0, 0]; }
      else { chest = [0.2, 0, 0]; pitch = youPitch + 0.1; if (k.grind) fight.shake = Math.max(fight.shake, 0.12); }
    } else if (atk && atk.kind === 'volley') {
      // leaning his screen at you to fire
      chest = [0.2 + (boss.recoil || 0) * -0.15, 0, 0]; pitch = youPitch + 0.15;
      boss.recoil = Math.max(0, (boss.recoil || 0) - dt * 4);
    }
  } else if (fight.phase === 'won' && fight.won) {
    const w = fight.won, W2 = (performance.now() - w.t0) / 1000;
    const put = (side, sol, extra) => { const a = sol.c.slice(0, 3), f = sol.c[3] + (extra || 0); if (side === 'R') { armR = a; foreR = f; } else { armL = a; foreL = f; } };
    if (W2 < 0.8) {
      // ...wait. did that just happen?
      pitch = youPitch + 0.15; chest = [0.15, 0, 0]; speed = 4;
    } else if (W2 < 3.2) {
      // laughing: hands on his belly, shoulders bouncing, head thrown back
      const ha = Math.abs(Math.sin(t * 17));
      put('R', w.bellyR, ha * 0.12); put('L', w.bellyL, ha * 0.12);
      chest = [-0.22 - ha * 0.07, 0, Math.sin(t * 5) * 0.05]; pitch = -0.45 - ha * 0.12; yaw = Math.sin(t * 2.5) * 0.15;
      speed = 12;
    } else if (W2 < 4.9) {
      // straightening the tie he doesn't have
      put(w.hand, W2 < 4.3 ? w.knot : w.low, W2 < 4.3 ? Math.sin(t * 16) * 0.12 : 0);
      pitch = youPitch - 0.2; chest = [0.05, 0, 0]; speed = 8;
    } else {
      // leaning over the stage to look at what's left of you
      chest = [0.38 + Math.sin(t * 1.2) * 0.02, 0, 0.06]; pitch = youPitch + 0.2;
      armR = [0.2, 0, 0.1]; armL = [0.2, 0, -0.1]; foreR = foreL = -0.3; speed = 3;
    }
    red = Math.max(0, red - dt * 0.6);   // cooling off: the red drains out of his screen
  } else if (fight.phase === 'down') {
    // knocked out: slumped, arms hanging, his screen showing an error
    chest = [0.5, 0, 0.1]; armR = [0.1, 0, 0.05]; armL = [0.1, 0, -0.05]; foreR = foreL = -0.1;
    yaw = 0.15; pitch = 0.9; speed = 3; red = Math.max(0, red - dt * 0.5);
  }
  // when he gets hit, he reels
  if (boss.flinch > 0) { chest = [chest[0] - boss.flinch * 0.35, chest[1], chest[2] + boss.flinch * 0.08]; pitch -= boss.flinch * 0.5; boss.flinch = Math.max(0, boss.flinch - dt * 2.5); }

  look.yaw += (yaw - look.yaw) * Math.min(1, dt * (speed > 8 ? 12 : 3));
  look.pitch += (pitch - look.pitch) * Math.min(1, dt * (speed > 8 ? 12 : 3));
  const slamming = (atk && ((atk.fist && atk.state !== 'raise' && atk.state !== 'lift') || atk.kind === 'taunt')) || fight.phase === 'won';
  target('chest', chest[0], chest[1] + (slamming ? 0 : look.yaw * 0.25), chest[2]);   // (no turning while his fist is out: it was aimed without it)
  target('neck', look.pitch * 0.4, look.yaw * 0.35, 0);
  target('fat_fucking_dome', look.pitch * 0.6, look.yaw * 0.5, Math.sin(t * 0.7) * 0.03);
  target('Right_Arm', armR[0], armR[1], armR[2]); target('Left_Arm', armL[0], armL[1], armL[2]);
  target('forearm_R', foreR, 0, 0); target('forearm_L', foreL, 0, 0);
  settle(dt);
  // the screen shakes when he does something big
  fight.shake = Math.max(0, fight.shake - dt * 1.6);
}

// ---------------- the fight: his attacks, and parrying them back at him ----------------
// Everything he throws at you hurts if it touches you, unless you parry it: jump, then press jump again in
// mid-air as you meet it. A parried attack flies back and hits him. That's the only way to hurt him.
const TODD_HP = 20;   // parries it takes to beat him
const boss = { hp: TODD_HP, flinch: 0, down: false };
const threats = [];              // faces in the air
const fx = [];                   // sparks, rings, the slam target glow
let atk = null, nextAtk = 0, hitstop = 0;

// --- between his world (3D) and the stage (2D) ---
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
function toStage(v) { _v.copy(v).project(camera); return { x: (_v.x + 1) / 2 * W, y: (1 - _v.y) / 2 * H }; }
function fromStage(x, y, z) {
  _ndc.set(x / W * 2 - 1, 1 - y / H * 2); _ray.setFromCamera(_ndc, camera);
  const d = _ray.ray.direction, o = _ray.ray.origin, t = (z - o.z) / d.z;
  return new THREE.Vector3().copy(o).addScaledVector(d, t);
}
// the middle of his screen (where faces come out, and where parried things land)
let screenPanel = null;
function screenAt() { if (!screenPanel) return { x: W / 2, y: 120 }; screenPanel.getWorldPosition(_v2); return toStage(_v2); }
// his fist: a little past the wrist, along the forearm; on the stage it's a circle this big
const ARM = { R: ['Right_Arm', 'forearm_R', 'hand_R'], L: ['Left_Arm', 'forearm_L', 'hand_L'] };
const fA = new THREE.Vector3(), fB = new THREE.Vector3(), fD = new THREE.Vector3(), palm = new THREE.Vector3();
function palmOf(side) {
  const [, fore, hand] = ARM[side];
  bones[fore].getWorldPosition(fA); bones[hand].getWorldPosition(fB);
  fD.copy(fB).sub(fA).normalize();
  return palm.copy(fB).addScaledVector(fD, toddH * 0.03);
}
function fistOnStage(side) {
  const p = palmOf(side), c = toStage(p);
  _v2.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(toddH * 0.07).add(p);   // a fist-width to the side
  const e = toStage(_v2);
  return { x: c.x, y: c.y, r: Math.hypot(e.x - c.x, e.y - c.y) };
}
// Reach: search his arm's angles (and how far he leans in) for the pose that puts his fist on a point.
function solveArm(side, goal, lean) {
  const [arm, fore] = ARM[side], A = bones[arm], F = bones[fore], C = bones.chest;
  const keep = [A.quaternion.clone(), F.quaternion.clone(), C.quaternion.clone()];
  const m = side === 'R' ? 1 : -1, e = new THREE.Euler(), q = new THREE.Quaternion();
  const set = (c) => {
    e.set(lean, 0, 0, 'YXZ'); C.quaternion.copy(rest.chest).multiply(q.setFromEuler(e));
    e.set(c[0], c[1], c[2], 'YXZ'); A.quaternion.copy(rest[arm]).multiply(q.setFromEuler(e));
    e.set(c[3], 0, 0, 'YXZ'); F.quaternion.copy(rest[fore]).multiply(q.setFromEuler(e));
    C.updateMatrixWorld(true);
    return palmOf(side).distanceTo(goal);
  };
  let best = null;
  for (let i = 0; i < 500; i++) {
    const c = [-2.8 + Math.random() * 3.2, -1.6 + Math.random() * 3.2, m * (-1.2 + Math.random() * 2.4), -2.2 + Math.random() * 2.2];
    const k = set(c); if (!best || k < best.cost) best = { c, cost: k };
  }
  for (let i = 0; i < 300; i++) {
    const c = best.c.map((v) => v + (Math.random() - 0.5) * (0.4 * (1 - i / 300) + 0.02));
    const k = set(c); if (k < best.cost) best = { c, cost: k };
  }
  A.quaternion.copy(keep[0]); F.quaternion.copy(keep[1]); C.quaternion.copy(keep[2]); C.updateMatrixWorld(true);
  return best;
}
// the same, but starting from a nearby solution (cheap: for a path of points)
function solveArmFrom(side, goal, lean, seed) {
  const [arm, fore] = ARM[side], A = bones[arm], F = bones[fore], C = bones.chest;
  const keep = [A.quaternion.clone(), F.quaternion.clone(), C.quaternion.clone()];
  const e = new THREE.Euler(), q = new THREE.Quaternion();
  const set = (c) => {
    e.set(lean, 0, 0, 'YXZ'); C.quaternion.copy(rest.chest).multiply(q.setFromEuler(e));
    e.set(c[0], c[1], c[2], 'YXZ'); A.quaternion.copy(rest[arm]).multiply(q.setFromEuler(e));
    e.set(c[3], 0, 0, 'YXZ'); F.quaternion.copy(rest[fore]).multiply(q.setFromEuler(e));
    C.updateMatrixWorld(true);
    return palmOf(side).distanceTo(goal);
  };
  let best = { c: seed.slice(), cost: set(seed) };
  for (let i = 0; i < 160; i++) {
    const c = best.c.map((v) => v + (Math.random() - 0.5) * (0.25 * (1 - i / 160) + 0.02));
    const k = set(c); if (k < best.cost) best = { c, cost: k };
  }
  A.quaternion.copy(keep[0]); F.quaternion.copy(keep[1]); C.quaternion.copy(keep[2]); C.updateMatrixWorld(true);
  return best;
}
// which of his arms is on which side of the screen (he faces you, so his right is on your left)
let rightArmOnLeft = true;

// --- his face shots: little screens with his faces on them ---
const shotArt = {};
function shotImage(name) {
  if (shotArt[name]) return shotArt[name];
  const d = faceData[faceAt(name)]; if (!d) return null;
  const px = document.createElement('canvas'); px.width = FACE.w; px.height = FACE.h;
  const img = px.getContext('2d').createImageData(FACE.w, FACE.h); img.data.set(d);
  if (name !== 'happy') for (let i = 0; i < img.data.length; i += 4) {   // red, like his screen
    const D = img.data; if (D[i + 1] > 120 && D[i + 2] > 120 && D[i] < D[i + 1] - 60) { D[i] = 255; D[i + 1] = 34; D[i + 2] = 46; }
  }
  px.getContext('2d').putImageData(img, 0, 0);
  const S = 3, c = document.createElement('canvas'); c.width = FACE.w * S + 12; c.height = FACE.h * S + 12;
  const g = c.getContext('2d');
  g.fillStyle = '#2b3338'; g.fillRect(0, 0, c.width, c.height);                // the bezel
  g.fillStyle = '#11181c'; g.fillRect(3, 3, c.width - 6, c.height - 6);
  g.imageSmoothingEnabled = false; g.drawImage(px, 6, 6, FACE.w * S, FACE.h * S);
  return (shotArt[name] = c);
}
function fireFace(name, speed) {
  const s = screenAt();
  const lead = 0.25, tx = P.x + P.vx * lead, ty = P.y - 40;
  const dx = tx - s.x, dy = ty - s.y, d = Math.hypot(dx, dy) || 1;
  threats.push({ kind: 'face', name, x: s.x, y: s.y, vx: dx / d * speed, vy: dy / d * speed, r: 28, rot: 0, state: 'fly', t: 0 });
  fx.push({ kind: 'ring', x: s.x, y: s.y, t: 0, life: 0.3, color: '#ff2a3a' });
}

// --- his terminal, falling: the lines from the void's terminal.json ('rage') ---
let RAIN_LINES = ['GET OUT', 'STOP', 'ERROR ERROR ERROR', 'SEGFAULT', 'KILL -9', 'I SEE YOU'];
fetch('../toddguts/terminal.json?v=' + Date.now()).then((r) => r.json()).then((d) => { if (d.rage && d.rage.length) RAIN_LINES = d.rage.filter((l) => l.length <= 22); }).catch(() => {});
const BAR_H = 30;
function barWidth(text) { ctx.save(); ctx.font = 'bold 17px "Courier New", monospace'; const w = ctx.measureText('> ' + text).width + 26; ctx.restore(); return Math.min(320, Math.max(110, w)); }
function rainWave(speed, lastGap, gapW = 150) {
  // a row of falling lines across the stage, with one gap to slip through
  let gap;
  do { gap = 60 + Math.random() * (W - 120 - gapW); } while (lastGap != null && Math.abs(gap - lastGap) < 180);
  let x = 0;
  while (x < W) {
    const text = RAIN_LINES[(Math.random() * RAIN_LINES.length) | 0], w = barWidth(text);
    let x0 = x, x1 = x + w;
    if (x1 > gap && x0 < gap + gapW) { x = gap + gapW; continue; }    // leave the gap clear
    if (x1 > W) x1 = W;
    if (x1 - x0 > 60) threats.push({ kind: 'bar', text, x: (x0 + x1) / 2, y: -BAR_H - Math.random() * 30, w: x1 - x0 - 8, h: BAR_H, vy: speed, state: 'fly', t: 0, rot: 0 });
    x = x1;
  }
  return gap;
}
// --- the static wave: along the floor, from under him outward ---
function staticWave(dir, speed) { threats.push({ kind: 'wave', x: W / 2, y: FLOOR - 45, w: 38, h: 90, vx: dir * speed, state: 'fly', t: 0, rot: 0 }); }

// --- hitting him ---
function hitTodd(x, y) {
  if (boss.down) return;
  const before = phase();
  boss.hp--; boss.flinch = 1;
  if (boss.hp > 0 && phase() !== before) {
    // a new phase: he glitches out, then comes back angrier
    setTimeout(() => { if (!boss.down) { face('error', 300); fight.shake = 1.3; } }, 750);
    setTimeout(() => { if (!boss.down) face('angry', 400); }, 1500);
    nextAtk = performance.now() + 2200;
  }
  fight.shake = Math.max(fight.shake, 0.8);
  fx.push({ kind: 'burst', x, y, t: 0, life: 0.5 });
  face(Math.random() < 0.5 ? 'surprised' : 'sad', 180);
  clearTimeout(hitTodd.back);
  hitTodd.back = setTimeout(() => { if (!boss.down) face('angry', 300); }, 700);
  if (boss.hp <= 0) knockout();
}
function knockout() {
  boss.down = true; atk = null; threats.length = 0;
  fight.phase = 'down'; face('error', 500); fight.shake = 1.2;
  setTimeout(() => banner('WHAT??!'), 600);
}
// When he kills you: a moment of disbelief, then he laughs (hands on his belly, shaking, head back) while
// his screen cools from red back to cyan; then he fixes his tie, very pleased, and leans over to look at you.
function youDied() {
  atk = null; tauntSoon = false;
  setTimeout(() => { for (const o of threats) if (o.state === 'fly') fx.push({ kind: 'ring', x: o.x, y: o.y, t: 0, life: 0.3, color: '#ff2a3a' }); threats.length = 0; }, 400);
  const H = toddH, at = (v, dx, dy, dz) => v.clone().add(new THREE.Vector3(dx * H, dy * H, dz * H));
  const chest = bonePos('chest'), neck = bonePos('neck'), sR = Math.sign(bonePos('Right_Arm').x), sL = -sR;
  const hand = rightArmOnLeft === (P.x < W / 2) ? 'R' : 'L';
  fight.won = {
    t0: performance.now(),
    bellyR: solveArm('R', at(chest, sR * 0.07, -0.06, 0.12), 0),
    bellyL: solveArm('L', at(chest, sL * 0.07, -0.06, 0.12), 0),
    hand, knot: solveArm(hand, at(neck, 0, -0.03, 0.11), 0.1), low: solveArm(hand, at(chest, 0, -0.1, 0.12), 0.1)
  };
  fight.phase = 'won';
  setTimeout(() => face('surprised', 200), 250);
  setTimeout(() => face('happy', 300), 800);
  setTimeout(() => face('sly', 300), 3300);
  setTimeout(() => face('smile', 400), 5000);
  setTimeout(() => { banner('YOU DIED'); fight.retry = true; }, 2600);
}
function restart() {
  fight.retry = false; boss.hp = TODD_HP; boss.down = false; boss.flinch = 0;
  threats.length = 0; fx.length = 0; atk = null; nextAtk = 0;
  revive(); startIntro();
}

// --- picking and running his attacks ---
// He gets worse as he takes damage: three phases, each faster, each adding attacks.
function phase() { return boss.hp > 13 ? 1 : boss.hp > 6 ? 2 : 3; }
const MOVES = { 1: ['slam', 'slam', 'volley'], 2: ['slam', 'volley', 'sweep', 'sweep', 'rain', 'rain'], 3: ['slam', 'volley', 'sweep', 'rain', 'agony', 'agony'] };
let lastMove = null;
function pace() { return [1, 0.9, 0.7, 0.5][phase()]; }   // how long he rests between attacks
function startAttack(now, force) {
  let kind = force;
  if (!kind) { const pool = MOVES[phase()]; do { kind = pool[(Math.random() * pool.length) | 0]; } while (kind === lastMove && pool.length > 1 && Math.random() < 0.7); }
  lastMove = kind;
  if (kind === 'sweep') {
    // he lays his fist on the stage at one end and drags it across
    const fromLeft = Math.random() < 0.5, side = fromLeft === rightArmOnLeft ? 'R' : 'L', lean = 0.45;
    const xs = []; for (let x = fromLeft ? 150 : W - 150; fromLeft ? x <= W - 260 : x >= 260; x += fromLeft ? 70 : -70) xs.push(x);
    const path = []; let seed = null;
    for (const x of xs) {
      const goal = fromStage(x, FLOOR, PLANE * toddH); goal.y += toddH * 0.055;
      const sol = seed ? solveArmFrom(side, goal, lean, seed) : solveArm(side, goal, lean);
      if (sol.cost > toddH * 0.06 && path.length > 3) break;          // as far as he can reach
      path.push(sol); seed = sol.c;
    }
    atk = { kind, fist: true, side, lean, path, fromLeft, state: 'raise', t0: now, sol: path[0] };
    return;
  }
  if (kind === 'rain') { atk = { kind, state: 'cast', t0: now, waves: 0, next: now + 900, gap: null }; face('error', 300); return; }
  if (kind === 'agony') { atk = { kind, state: 'charge', t0: now, waves: 0, next: 0 }; face('agony', 700); return; }
  if (kind === 'slam') {
    const tx = Math.max(190, Math.min(W - 190, P.x + P.vx * 0.3));   // (his reach: right by the walls is out of it)
    const onLeft = tx < W / 2, side = onLeft === rightArmOnLeft ? 'R' : 'L';
    const lean = 0.45;
    // the fist lands on the stage, its bottom on the floor line, a little in front of him
    const goal = fromStage(tx, FLOOR, PLANE * toddH); goal.y += toddH * 0.055;   // his fist's knuckles on the floor
    const sol = solveArm(side, goal, lean);
    atk = { kind, fist: true, side, tx, lean, sol, state: 'raise', t0: now };
    fx.push({ kind: 'target', x: tx, t: 0, life: 0.95 });
  } else {
    atk = { kind, state: 'aim', t0: now, shots: 0, next: now + 600 };
    face('angry', 120);
  }
}
// --- taunts: a bit of personality between attacks (more likely right after he's hit you) ---
let tauntSoon = false;
function bonePos(name) { return bones[name].getWorldPosition(new THREE.Vector3()); }
function startTaunt(now) {
  const kinds = ['tie', 'brush', 'knuckles'];
  const kind = kinds[(Math.random() * kinds.length) | 0], H = toddH, lean = 0.12;
  const neck = bonePos('neck'), chest = bonePos('chest');
  const shR = bonePos('Right_Arm'), shL = bonePos('Left_Arm');
  // his nearer hand (to you) does the one-handed ones
  const hand = rightArmOnLeft === (P.x < W / 2) ? 'R' : 'L', other = hand === 'R' ? 'L' : 'R';
  const at = (v, dx, dy, dz) => v.clone().add(new THREE.Vector3(dx * H, dy * H, dz * H));
  let frames, mood;
  if (kind === 'tie') {
    // straightening a tie he doesn't have: a fiddle at the collar, then smoothing it down his front
    const knot = at(neck, 0, -0.03, 0.11), low = at(chest, 0, -0.1, 0.12);
    frames = [{ t: 0, [hand]: solveArm(hand, knot, lean), wig: 1 }, { t: 1.2, [hand]: solveArm(hand, low, lean) }, { t: 1.65 }];
    mood = 'sly';
  } else if (kind === 'brush') {
    // brushing something off his shoulder, with the other hand
    const sh = other === 'R' ? shR : shL, out = Math.sign(sh.x) || 1;
    const on = at(sh, 0, 0.03, 0.08), off = at(sh, out * 0.1, 0.07, 0.1);
    const A = solveArm(hand, on, lean), B = solveArm(hand, off, lean);
    frames = [{ t: 0, [hand]: A }, { t: 0.35, [hand]: B }, { t: 0.55, [hand]: A }, { t: 0.9, [hand]: B }, { t: 1.1, [hand]: A }, { t: 1.45, [hand]: B }, { t: 1.8 }];
    mood = 'sly';
  } else {
    // cracking his knuckles: fists together in front of him, a grind, a shake
    const mid = at(chest, 0, 0.02, 0.3);
    const fR = solveArm('R', at(mid, Math.sign(shR.x) * 0.05, 0, 0), lean), fL = solveArm('L', at(mid, Math.sign(shL.x) * 0.05, 0, 0), lean);
    frames = [{ t: 0, R: fR, L: fL, grind: 1 }, { t: 1.4 }];
    mood = 'angry';
  }
  atk = { kind: 'taunt', taunt: kind, frames, t0: now };
  face(mood, 260);
}
function tauntFrame(T) { let f = atk.frames[0]; for (const k of atk.frames) if (k.t <= T) f = k; return f; }
const PUNCH = { goal: null };
function stepAttack(now, dt) {
  if (fight.phase !== 'fight' || P.dead) return;
  if (!atk) {
    if (!nextAtk) nextAtk = now + 1200;
    if (now > nextAtk) { if (tauntSoon || Math.random() < 0.18) { tauntSoon = false; startTaunt(now); } else startAttack(now); }
    return;
  }
  const T = (now - atk.t0) / 1000;
  if (atk.kind === 'taunt') {
    if (T > atk.frames[atk.frames.length - 1].t) { atk = null; face('angry', 250); nextAtk = now + 500 + Math.random() * 400; }
    return;
  }
  if (atk.kind === 'slam') {
    if (atk.state === 'raise' && T > [0, 0.8, 0.65, 0.5][phase()]) { atk.state = 'down'; atk.t0 = now; }
    else if (atk.state === 'down' && T > 0.14) {
      atk.state = 'rest'; atk.t0 = now; fight.shake = 1; ripple(atk.tx, 2.2);
      const f = fistOnStage(atk.side);
      for (let i = 0; i < 10; i++) fx.push({ kind: 'spark', x: f.x + (Math.random() - 0.5) * f.r * 2, y: FLOOR, vx: (Math.random() - 0.5) * 400, vy: -Math.random() * 300, t: 0, life: 0.5 });
    }
    else if (atk.state === 'rest' && T > [0, 1.1, 0.9, 0.75][phase()]) { atk.state = 'lift'; atk.t0 = now; }
    else if (atk.state === 'lift' && T > 0.4) {
      // later on, he follows a slam straight up with another (the other fist, wherever you are now)
      const again = !atk.punch && atk.chain == null && phase() >= 2 && Math.random() < (phase() === 3 ? 0.7 : 0.35);
      atk = null; nextAtk = now + (700 + Math.random() * 700) * pace();
      if (again) { startAttack(now, 'slam'); atk.chain = 1; }
    }
    else if (atk.state === 'punch' && T > 0.32) {
      const s = screenAt(); hitTodd(s.x, s.y);
      atk.state = 'lift'; atk.t0 = now;
    }
    // his fist hurts on the way down and while it's on the stage, unless you parry it
    if (atk && (atk.state === 'down' || atk.state === 'rest')) fistContact(now);
  } else if (atk.kind === 'volley') {
    const n = 2 + phase();
    if (atk.shots < n && now > atk.next) {
      fireFace(Math.random() < 0.35 ? 'sad' : 'angry', 330 + phase() * 45 + atk.shots * 20);
      atk.shots++; atk.next = now + [0, 520, 430, 340][phase()]; boss.recoil = 1;
    }
    if (atk.shots >= n && now > atk.next + 300) { atk = null; nextAtk = now + (900 + Math.random() * 700) * pace(); }
  } else if (atk.kind === 'sweep') {
    if (atk.state === 'raise' && T > (phase() === 3 ? 0.7 : 0.85)) { atk.state = 'down'; atk.t0 = now; }
    else if (atk.state === 'down' && T > 0.15) { atk.state = 'sweep'; atk.t0 = now; fight.shake = 0.7; const f = fistOnStage(atk.side); ripple(f.x, 1.6); }
    else if (atk.state === 'sweep') {
      const dur = 0.14 * atk.path.length * (phase() === 3 ? 0.7 : 1), p = Math.min(1, T / dur);
      const at = p * (atk.path.length - 1), i = Math.min(atk.path.length - 2, Math.floor(at)), k = at - i;
      const A = atk.path[i].c, B = atk.path[i + 1].c;
      atk.sol = { c: A.map((v, j) => v + (B[j] - v) * k) };
      if (Math.random() < dt * 14) { const f = fistOnStage(atk.side); fx.push({ kind: 'spark', x: f.x, y: FLOOR, vx: (atk.fromLeft ? -1 : 1) * Math.random() * 300, vy: -Math.random() * 200, t: 0, life: 0.4 }); }
      if (p >= 1) { atk.state = 'rest'; atk.t0 = now; }
    }
    else if (atk.state === 'rest' && T > 0.35) { atk.state = 'lift'; atk.t0 = now; }
    else if (atk.state === 'lift' && T > 0.45) { atk = null; nextAtk = now + (800 + Math.random() * 600) * pace(); }
    else if (atk.state === 'punch' && T > 0.32) { const s = screenAt(); hitTodd(s.x, s.y); atk.state = 'lift'; atk.t0 = now; }
    if (atk && (atk.state === 'down' || atk.state === 'sweep' || atk.state === 'rest')) fistContact(now);
  } else if (atk.kind === 'rain') {
    if (atk.waves < 2 + phase() && now > atk.next) {
      atk.gap = rainWave(250 + phase() * 50, atk.gap, phase() === 3 ? 125 : 145); atk.waves++; atk.next = now + 1000 * pace();
      fight.shake = Math.max(fight.shake, 0.2);
    }
    if (atk.waves >= 3 && now > atk.next + 600 && !threats.some((o) => o.kind === 'bar' && o.state === 'fly')) { atk = null; face('angry', 300); nextAtk = now + 800 * pace(); }
  } else if (atk.kind === 'agony') {
    // his worst: the agony face, and static rolling out along the floor
    agonyAmt = atk.state === 'charge' ? Math.min(1, T / 0.8) : 1;
    if (atk.state === 'charge') { fight.shake = Math.max(fight.shake, T * 0.5); if (T > 1.3) { atk.state = 'blast'; atk.t0 = now; atk.next = now; } }
    else if (atk.state === 'blast') {
      // waves out both ways, at uneven speeds and spacing so there's no rhythm to settle into
      if (atk.waves < 4 && now > atk.next) {
        const v = 400 + Math.random() * 160; staticWave(-1, v); staticWave(1, atk.waves % 2 ? v * 0.8 : v * 1.15);
        atk.waves++; atk.next = now + 700 + Math.random() * 350; fight.shake = 1; ripple(W / 2, 2.6);
      }
      if (atk.waves >= 4 && now > atk.next + 400) { atk = null; agonyAmt = 0; face('angry', 400); nextAtk = now + 1200 * pace(); }
    }
  }
}
// his fist against you: it hurts, unless you parry it, and then it's knocked back up into his own face
function fistContact(now) {
  const f = fistOnStage(atk.side);
  if (!touches(f.x, f.y, f.r)) return;
  if (P.parryT > 0) {
    parried(f.x, f.y);
    const s = screenPanel ? screenPanel.getWorldPosition(new THREE.Vector3()) : null;
    if (s) { const goal = s.clone(); goal.z += toddH * 0.12; atk.punch = solveArm(atk.side, goal, -0.1); }
    atk.state = 'punch'; atk.t0 = now;
  } else hurt(1);
}
// does a rectangle (centre x, y) touch the player?
function touchesRect(x, y, w, h) {
  if (P.dead) return false;
  return Math.abs(x - P.x) < w / 2 + (BOX.r - BOX.l) / 2 && y + h / 2 > P.y + BOX.t && y - h / 2 < P.y + BOX.b;
}
// does a circle touch the player?
function touches(x, y, r) {
  if (P.dead) return false;
  const nx = Math.max(P.x + BOX.l, Math.min(x, P.x + BOX.r)), ny = Math.max(P.y + BOX.t, Math.min(y, P.y + BOX.b));
  return (x - nx) ** 2 + (y - ny) ** 2 < r * r;
}
function parried(x, y) {
  P.vy = -TUNE.parryBounce; P.cutReady = false; P.parryT = 0; P.spin = TUNE.spin; P.parryCool = 0; P.goldT = TUNE.gold;   // (you can parry again straight away, and you're untouchable for a moment)
  P.streak = (P.streak || 0) + 1;
  if (P.streak >= STREAK) { P.streak = 0; heal(); }
  paintHud();
  hitstop = 0.07; fight.shake = Math.max(fight.shake, 0.45);
  fx.push({ kind: 'ring', x, y, t: 0, life: 0.35, color: '#ff5cf0' });
  fx.push({ kind: 'ring', x, y, t: -0.06, life: 0.4, color: '#ffffff' });
}
function stepThreats(dt) {
  for (let i = threats.length - 1; i >= 0; i--) {
    const o = threats[i]; o.t += dt; o.rot += dt * (o.state === 'back' ? 14 : 3);
    if (o.state === 'fly' && (o.kind === 'bar' || o.kind === 'wave')) {
      if (o.kind === 'bar') o.y += o.vy * dt; else o.x += o.vx * dt;
      if (touchesRect(o.x, o.y, o.w, o.h)) {
        if (P.parryT > 0) { parried(Math.max(o.x - o.w / 2, Math.min(P.x, o.x + o.w / 2)), o.y); o.state = 'back'; o.t = 0; o.fromX = Math.max(o.x - o.w / 2, Math.min(P.x, o.x + o.w / 2)); o.fromY = o.y; o.x = o.fromX; continue; }
        hurt(1);
      }
      const gone = o.kind === 'bar' ? o.y > FLOOR - o.h / 2 : (o.x < -o.w || o.x > W + o.w);
      if (gone) {
        threats.splice(i, 1);
        if (o.kind === 'bar') { ripple(o.x, 1.0); for (let k = 0; k < 5; k++) fx.push({ kind: 'spark', x: o.x + (Math.random() - 0.5) * o.w, y: FLOOR, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200, t: 0, life: 0.35 }); }
      }
      continue;
    }
    if (o.state === 'fly') {
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.name === 'sad') o.vy += 500 * dt;       // the sad ones droop
      if (touches(o.x, o.y, o.r)) {
        if (P.parryT > 0) { parried(o.x, o.y); o.state = 'back'; o.t = 0; o.fromX = o.x; o.fromY = o.y; }
        else { hurt(1); threats.splice(i, 1); fx.push({ kind: 'ring', x: o.x, y: o.y, t: 0, life: 0.3, color: '#ff2a3a' }); continue; }
      }
      if (o.y > FLOOR - 10 || o.x < -60 || o.x > W + 60 || o.y < -80) {
        threats.splice(i, 1);
        if (o.y > FLOOR - 10) ripple(o.x, 1.4);
        for (let k = 0; k < 6; k++) fx.push({ kind: 'spark', x: o.x, y: Math.min(o.y, FLOOR), vx: (Math.random() - 0.5) * 300, vy: -Math.random() * 250, t: 0, life: 0.4 });
      }
    } else if (o.state === 'back') {
      // straight back into his screen, in an arc
      const s = screenAt(), p = Math.min(1, o.t / 0.42), e = p * p * (3 - 2 * p);
      o.x = o.fromX + (s.x - o.fromX) * e; o.y = o.fromY + (s.y - o.fromY) * e - Math.sin(p * Math.PI) * 90;
      o.scale = 1 - p * 0.5;
      if (p >= 1) { hitTodd(s.x, s.y); threats.splice(i, 1); }
    }
  }
}
function drawBar(o) {
  const k = o.scale || 1;
  ctx.save(); ctx.translate(o.x, o.y); if (o.state === 'back') ctx.rotate(o.rot * 0.3); ctx.scale(k, k);
  ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.shadowBlur = 14;
  ctx.fillStyle = 'rgba(40,0,6,.92)'; ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
  ctx.shadowBlur = 0; ctx.strokeStyle = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.lineWidth = 2; ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let txt = '> ' + o.text; while (ctx.measureText(txt).width > o.w - 12 && txt.length > 4) txt = txt.slice(0, -2) + '_';
  ctx.fillText(txt, 0, 1);
  ctx.restore();
}
function drawWave(o) {
  // a column of static
  const k = o.scale || 1;
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(k, k);
  ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ffffff'; ctx.shadowBlur = 16;
  const cell = 6;
  for (let y = -o.h / 2; y < o.h / 2; y += cell) for (let x = -o.w / 2; x < o.w / 2; x += cell) {
    const edge = 1 - Math.abs(x) / (o.w / 2), top = (y + o.h / 2) / o.h;
    if (Math.random() > edge * (0.4 + top * 0.6)) continue;
    const c = STATIC[(Math.random() * STATIC.length) | 0];
    ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x, y, cell, cell);
  }
  ctx.restore();
}
function drawThreats() {
  for (const o of threats) {
    if (o.kind === 'bar') { drawBar(o); continue; }
    if (o.kind === 'wave') { drawWave(o); continue; }
    const img = shotImage(o.name); if (!img) continue;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.sin(o.rot) * 0.25 + (o.state === 'back' ? o.rot : 0));
    const k = (o.scale || 1);
    ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.shadowBlur = 18;
    ctx.drawImage(img, -img.width / 2 * k, -img.height / 2 * k, img.width * k, img.height * k);
    ctx.restore();
  }
}
function stepAgony() {
  if (!agonyPanel) return;
  if (!atk || atk.kind !== 'agony') agonyAmt = Math.max(0, agonyAmt - 0.08);
  const flick = Math.random() < 0.05 ? 0.2 : 0.85 + Math.random() * 0.15;
  agonyPanel.material.opacity = agonyAmt * flick; agonyPanel.visible = agonyAmt > 0.01;
  if (agonyAmt > 0) agonyPanel.material.map.offset.x = (1 - 0.8) / 2 + (Math.random() < 0.08 ? (Math.random() - 0.5) * 0.06 : 0);
}
function stepFx(dt) {
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt;
    if (f.kind === 'spark') { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 900 * dt; }
    if (f.t > f.life) fx.splice(i, 1);
  }
}
function drawFx(t) {
  // where his fist is about to come down
  if (atk && atk.kind === 'slam' && (atk.state === 'raise' || atk.state === 'down')) {
    const a = 0.35 + 0.35 * Math.abs(Math.sin(t * 14));
    const g = ctx.createRadialGradient(atk.tx, FLOOR, 4, atk.tx, FLOOR, 90);
    g.addColorStop(0, `rgba(255,40,60,${a})`); g.addColorStop(1, 'rgba(255,40,60,0)');
    ctx.fillStyle = g; ctx.fillRect(atk.tx - 90, FLOOR - 40, 180, 50);
    ctx.fillStyle = `rgba(255,60,80,${a + 0.2})`; ctx.fillRect(atk.tx - 70, FLOOR - 1, 140, 3);
  }
  // where the sweep starts, and which way it's coming
  if (atk && atk.kind === 'sweep' && atk.state === 'raise') {
    const a = 0.4 + 0.4 * Math.abs(Math.sin(t * 14)), d = atk.fromLeft ? 1 : -1, x0 = atk.fromLeft ? 0 : W;
    const g = ctx.createLinearGradient(x0, 0, x0 + d * 360, 0);
    g.addColorStop(0, `rgba(255,40,60,${a})`); g.addColorStop(1, 'rgba(255,40,60,0)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(x0, x0 + d * 360), FLOOR - 70, 360, 72);
    ctx.fillStyle = `rgba(255,90,100,${a + 0.2})`;
    for (let k = 0; k < 3; k++) { const x = x0 + d * (60 + k * 50 + ((t * 120) % 50)); ctx.beginPath(); ctx.moveTo(x, FLOOR - 50); ctx.lineTo(x + d * 22, FLOOR - 35); ctx.lineTo(x, FLOOR - 20); ctx.fill(); }
  }
  for (const f of fx) {
    const p = Math.max(0, f.t / f.life);
    if (f.t < 0) continue;
    if (f.kind === 'ring') { ctx.strokeStyle = f.color; ctx.globalAlpha = 1 - p; ctx.lineWidth = 4 * (1 - p) + 1; ctx.beginPath(); ctx.arc(f.x, f.y, 10 + p * 60, 0, Math.PI * 2); ctx.stroke(); }
    else if (f.kind === 'spark') { ctx.fillStyle = '#9ffffb'; ctx.globalAlpha = 1 - p; ctx.fillRect(f.x - 2, f.y - 2, 4, 4); }
    else if (f.kind === 'burst') {
      ctx.globalAlpha = 1 - p; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2, r0 = 20 + p * 40, r1 = 40 + p * 90; ctx.moveTo(f.x + Math.cos(a) * r0, f.y + Math.sin(a) * r0); ctx.lineTo(f.x + Math.cos(a) * r1, f.y + Math.sin(a) * r1); }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

// ---------------- the loop ----------------
const hud = document.getElementById('hud');
// Three parries in a row without getting hit gives you one health back, up to 4 (one more than you start with).
const HP_START = 3, HP_MAX = 4, STREAK = 3;
function paintHud() {
  if (P.dead) { hud.textContent = 'DEAD'; hud.className = 'hud low'; return; }
  hud.innerHTML = 'HP. ' + P.hp + ' <span class="pips">' + Array.from({ length: STREAK }, (_, i) => `<i class="${i < P.streak ? 'on' : ''}"></i>`).join('') + '</span>';
  hud.className = 'hud' + (P.hp <= 1 ? ' low' : '') + (P.hp > HP_START ? ' over' : '');
}
function heal() {
  if (P.hp >= HP_MAX) return;
  P.hp++;
  fx.push({ kind: 'ring', x: P.x, y: P.y - 40, t: 0, life: 0.5, color: '#ffd23a' });
  fx.push({ kind: 'ring', x: P.x, y: P.y - 40, t: -0.1, life: 0.55, color: '#fff3b0' });
  hud.classList.remove('healed'); void hud.offsetWidth; paintHud(); hud.classList.add('healed');
}
let then = performance.now(), acc = 0;
const STEP = 1 / 120;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - then) / 1000); then = now;
  // a parry freezes everything for a split second
  if (hitstop > 0) { hitstop -= dt; acc = 0; }
  else { acc += dt; while (acc >= STEP) { step(STEP); stepThreats(STEP); acc -= STEP; } }
  if (fight.retry && jumpPressed) { jumpPressed = false; restart(); }
  const t = now / 1000;
  animateTodd(t, dt);
  stepAttack(now, dt);
  stepAgony();
  stepFx(dt);
  stepBot(dt, now);
  faceStep(now);
  const sh = fight.shake * fight.shake * 9, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  document.getElementById('arena').style.transform = sh > 0.05 ? `translate(${sx}px, ${sy}px)` : '';
  if (todd) renderer.render(scene, camera);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  floorMat.uniforms.uTime.value = t;
  drawFx(t);
  drawPlayer();
  drawThreats();
}

// for testing from the console
function hurt(n = 1) {
  if (P.dead || P.hurtT > 0 || P.goldT > 0) return;
  P.hp = Math.max(0, P.hp - n); P.hurtT = 1.0; P.streak = 0;
  if (Math.random() < 0.6) tauntSoon = true;   // got you
  fight.shake = Math.max(fight.shake, 0.5);
  if (P.hp === 0) { P.dead = true; P.vx = 0; P.vy = -500; P.wall = 0; P.parryT = 0; P.spin = 0; youDied(); }
  paintHud();
}
function revive() { Object.assign(P, { hp: HP_START, dead: false, deadT: 0, hurtT: 0, goldT: 0, streak: 0, x: 200, y: FLOOR, vx: 0, vy: 0, parryT: 0, spin: 0 }); paintHud(); }
window.FIGHT = { attack: (k) => startAttack(performance.now(), k), phase, taunt: () => startTaunt(performance.now()), boss, threats, get atk() { return atk; }, startAttack: () => startAttack(performance.now()), fireFace, solveArm, fromStage, toStage, fistOnStage, restart, bot, LEDGE, P, TUNE, hurt, revive, look, bones, camera, fight, intro: startIntro, face, get todd() { return todd; } };

addEventListener('resize', fit);
fit(); paintHud();
Promise.all(FRAMES.map(loadFrame)).then(() => requestAnimationFrame(frame));
