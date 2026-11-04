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
  gold: 0.45                         // how long a successful parry makes you untouchable (you glow gold)    // how long a mid-air jump press can parry for, and how high a parry bounces you
};

// ---------------- input ----------------
const keys = { left: false, right: false, jump: false, parry: false };
let jumpPressed = false, parryPressed = false;
const MAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  KeyX: 'parry', KeyK: 'parry', ShiftLeft: 'parry', ShiftRight: 'parry', ArrowDown: 'parry', KeyS: 'parry' };
addEventListener('keydown', (e) => {
  const k = MAP[e.code]; if (!k) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.card')) return;   // a menu has the keys
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
  // the picture panel: what his screen shows while he monologues (pictures from Wikimedia, or his fire)
  picAspect = size.x / size.y;
  picPanel = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.97, size.y * 0.97),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1.5, polygonOffsetUnits: -1.5 }));
  picPanel.position.copy(head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0, 0.0045))));
  picPanel.quaternion.copy(q); picPanel.renderOrder = 2; picPanel.visible = false;
  head.add(picPanel);
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
  facesReady.then(() => { buildScreen(); return monoReady; }).then(() => showTitle());
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
    bot.obj = holder; bot.size = toddH; bot.k0 = k; bot.rawH = h;
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
  if (stomp.on) return stepStomp(dt, now);   // he's busy: in the fight
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
// ---- the TV robot joins in (phase 2 on) ----
// He jumps down off his ledge, out of sight to one side of the stage. A red "?!?" flashes at the edge he's
// about to come from, then he charges across the stage on his own legs and off the other side; then again,
// from either side, until you parry him three times. A parry knocks him tumbling back off the stage; the third
// sends him spinning home to his ledge. His parries don't hurt TODD, but they count toward your heal streak.
const stomp = { on: false, state: '', t0: 0, x: W / 2, dir: 1, hits: 0, next: 0, from: null, k: 1, ledgeX: 0 };
const STOMP_PX = 250;       // how tall he stands on the stage, in stage units (the player is about 84)
function stompScale() {
  const a = fromStage(0, FLOOR, PLANE * toddH), b = fromStage(100, FLOOR, PLANE * toddH);
  return STOMP_PX * (a.distanceTo(b) / 100) / bot.rawH;
}
function stageToWorld(x, y) { return fromStage(x, y, PLANE * toddH); }
const OFF = 170;            // how far past the edge of the screen he waits
function startStomp(now) {
  if (!bot.obj || stomp.on) return;
  stomp.dir = Math.random() < 0.5 ? 1 : -1;
  Object.assign(stomp, { on: true, state: 'leap', t0: now, hits: 0, k: stompScale() });
  stomp.from = bot.obj.position.clone(); stomp.k0 = bot.obj.scale.x;
  setBotMode('run');
}
function endStomp(now, flung) {
  if (!stomp.on) return;
  stomp.state = 'fling'; stomp.t0 = now; stomp.from = bot.obj.position.clone(); stomp.k0 = bot.obj.scale.x;
  stomp.ledgeX = (Math.random() - 0.5) * LEDGE.half * toddH; stomp.flung = flung;
}
function stompBox() { const c = toStage(bot.obj.position); return { x: c.x, y: c.y - STOMP_PX * 0.4, w: 92, h: STOMP_PX * 0.78 }; }
function chargeSpeed() { return [0, 720, 800, 900][phase()]; }
function nextCharge(now) {
  // off to one side, out of sight; the warning comes up at that edge
  stomp.dir = Math.random() < 0.5 ? 1 : -1; stomp.x = stomp.dir > 0 ? -OFF : W + OFF;
  stomp.state = 'warn'; stomp.t0 = now;
}
function stepStomp(dt, now) {
  const T = (now - stomp.t0) / 1000, ph = phase(), o = bot.obj;
  const turn = (yaw, k = 12) => { const d = Math.atan2(Math.sin(yaw - o.rotation.y), Math.cos(yaw - o.rotation.y)); o.rotation.y += d * Math.min(1, dt * k); };
  const arc = (a, b, p, lift) => a.clone().lerp(b, p).add(new THREE.Vector3(0, Math.sin(p * Math.PI) * lift, 0));
  bot.mixer.timeScale = stomp.state === 'charge' ? 1.9 : 1;
  if (stomp.state === 'leap') {
    // off the ledge and down out of sight beside the stage
    const to = stageToWorld(stomp.dir > 0 ? -OFF : W + OFF, FLOOR);
    const p = Math.min(1, T / 0.9), e = p * p * (3 - 2 * p);
    o.position.copy(arc(stomp.from, to, e, toddH * 0.45)); o.scale.setScalar(stomp.k0 + (stomp.k - stomp.k0) * e);
    turn(-stomp.dir * Math.PI / 2, 6);
    if (p >= 1) { stomp.x = stomp.dir > 0 ? -OFF : W + OFF; stomp.state = 'warn'; stomp.t0 = now; }
  } else if (stomp.state === 'warn') {
    o.position.copy(stageToWorld(stomp.x, FLOOR)); o.rotation.y = -stomp.dir * Math.PI / 2;
    if (T > [0, 0.95, 0.8, 0.65][ph]) { stomp.state = 'charge'; stomp.t0 = now; }
  } else if (stomp.state === 'charge') {
    // straight across, fast, feet pounding the floor
    stomp.x += stomp.dir * chargeSpeed() * dt;
    o.position.copy(stageToWorld(stomp.x, FLOOR)); o.rotation.y = -stomp.dir * Math.PI / 2; o.rotation.z = 0;
    if (Math.random() < dt * 9) { ripple(Math.max(0, Math.min(W, stomp.x)), 0.9); fight.shake = Math.max(fight.shake, 0.12); }
    if ((stomp.dir > 0 && stomp.x > W + OFF) || (stomp.dir < 0 && stomp.x < -OFF)) nextCharge(now + 250 + Math.random() * 500);
  } else if (stomp.state === 'bounced') {
    // parried: knocked back the way he came, tumbling, and off the stage
    const p = Math.min(1, T / 0.7);
    stomp.x -= stomp.dir * 620 * dt * (1 - p * 0.5);
    o.position.copy(stageToWorld(stomp.x, FLOOR - Math.sin(p * Math.PI) * 170));
    o.rotation.z = -stomp.dir * p * Math.PI * 1.6;
    if (p >= 1 || stomp.x < -OFF || stomp.x > W + OFF) { o.rotation.z = 0; nextCharge(now + 400); }
  } else if (stomp.state === 'fling') {
    // sent flying back to his ledge, spinning, and he carries on like nothing happened
    const p = Math.min(1, T / 1.1), e = 1 - (1 - p) * (1 - p);
    const to = new THREE.Vector3(stomp.ledgeX, LEDGE.y * toddH, LEDGE.z * toddH);
    o.position.copy(arc(stomp.from, to, e, toddH * 0.5)); o.scale.setScalar(stomp.k0 + (bot.k0 - stomp.k0) * e);
    o.rotation.z = stomp.flung ? p * Math.PI * 4 : 0;
    if (p >= 1) {
      o.rotation.z = 0; stomp.on = false; bot.x = stomp.ledgeX; setBotMode('run'); bot.mode = 'turn'; bot.until = now + 900;
      stomp.next = now + [0, 22000, 22000, 15000][phase()] + Math.random() * 8000;
    }
  }
  // running into you hurts, unless you parry him
  if (stomp.state === 'charge') {
    const b = stompBox();
    if (touchesRect(b.x, b.y, b.w, b.h)) {
      if (P.parryT > 0) {
        parried(b.x - stomp.dir * b.w / 2, Math.min(P.y - 40, b.y));
        stomp.hits++;
        if (stomp.hits >= 3) endStomp(now, true);
        else { stomp.state = 'bounced'; stomp.t0 = now; fight.shake = Math.max(fight.shake, 0.5); }
      } else hurt(1);
    }
  }
}
// the "?!?" where he's coming from, and how many more parries he takes
function drawStomp(t) {
  if (!stomp.on || !bot.obj) return;
  if (stomp.state === 'warn') {
    const x = stomp.dir > 0 ? 58 : W - 58, y = FLOOR - 150, pulse = 1 + Math.abs(Math.sin(t * 12)) * 0.18;
    ctx.save(); ctx.translate(x, y); ctx.scale(pulse, pulse);
    ctx.font = 'bold 54px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = '#ff2a3a'; ctx.shadowBlur = 22; ctx.fillStyle = '#ff3b4e'; ctx.fillText('?!?', 0, 0);
    ctx.shadowBlur = 0; ctx.lineWidth = 2; ctx.strokeStyle = '#2a0006'; ctx.strokeText('?!?', 0, 0);
    ctx.restore();
    // and a streak along the floor, the way he'll come
    const g = ctx.createLinearGradient(stomp.dir > 0 ? 0 : W, 0, stomp.dir > 0 ? 300 : W - 300, 0);
    g.addColorStop(0, `rgba(255,40,60,${0.22 + Math.abs(Math.sin(t * 12)) * 0.18})`); g.addColorStop(1, 'rgba(255,40,60,0)');
    ctx.fillStyle = g; ctx.fillRect(stomp.dir > 0 ? 0 : W - 300, FLOOR - 190, 300, 190);
  }
  const showPips = stomp.state === 'warn' || stomp.state === 'charge' || stomp.state === 'bounced';
  if (showPips) {
    const b = stompBox(), px = stomp.state === 'warn' ? (stomp.dir > 0 ? 58 : W - 58) : Math.max(30, Math.min(W - 30, b.x));
    const py = stomp.state === 'warn' ? FLOOR - 205 : Math.max(16, b.y - b.h / 2 - 16);
    for (let i = 0; i < 3; i++) {
      const on = i >= stomp.hits;
      ctx.save(); ctx.translate(px - 18 + i * 18, py); ctx.rotate(Math.PI / 4);
      ctx.fillStyle = on ? '#ff5260' : 'rgba(255,82,96,.15)'; ctx.strokeStyle = '#ff5260'; ctx.lineWidth = 1.5;
      ctx.fillRect(-4, -4, 8, 8); ctx.strokeRect(-4, -4, 8, 8); ctx.restore();
    }
  }
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

// ---- damage you can see: smoke and a failing body ----
// How hurt he is, 0 (fresh) .. 1 (one hit left)
function wear() { return Math.max(0, Math.min(1, 1 - boss.hp / TODD_HP)); }
// Grey, see-through cubes of smoke billowing off him: wisps from his shoulders early on, pouring out of his
// monitor and chest by the end. Each one rises, swells, tumbles and fades.
const SMOKE_N = 90;
const smokeGeo = new THREE.BoxGeometry(1, 1, 1);
const smoke = Array.from({ length: SMOKE_N }, () => {
  const m = new THREE.Mesh(smokeGeo, new THREE.MeshLambertMaterial({ color: 0x8e979c, transparent: true, opacity: 0, depthWrite: false }));
  m.visible = false; m.userData = { life: 0, age: 0, vel: new THREE.Vector3(), spin: new THREE.Vector3(), s0: 1, s1: 1, a: 0 };
  return m;
});
let smokeI = 0, smokeAcc = 0;
// where it comes from: [bone, offset in TODD-heights] (unlocked as he wears down)
const VENTS = [
  { at: 0.1, bone: 'Right_Arm', off: [0, 0.03, -0.02] }, { at: 0.1, bone: 'Left_Arm', off: [0, 0.03, -0.02] },
  { at: 0.35, bone: 'fat_fucking_dome', off: [0, 0.16, -0.06] }, { at: 0.45, bone: 'neck', off: [0, 0.0, 0.02] },
  { at: 0.6, bone: 'chest', off: [0.05, 0.02, 0.07] }, { at: 0.75, bone: 'fat_fucking_dome', off: [0.1, 0.08, -0.1] }
];
function puff(pos, big) {
  const m = smoke[smokeI++ % SMOKE_N], u = m.userData, H = toddH;
  if (!m.parent) scene.add(m);
  m.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.04 * H, (Math.random() - 0.5) * 0.03 * H, (Math.random() - 0.5) * 0.04 * H));
  u.age = 0; u.life = 1.4 + Math.random() * 1.2;
  u.vel.set((Math.random() - 0.5) * 0.06 * H + 0.02 * H, (0.12 + Math.random() * 0.1) * H, (Math.random() - 0.5) * 0.04 * H);
  u.spin.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2);
  u.s0 = (0.02 + Math.random() * 0.02) * H * (big ? 1.4 : 1); u.s1 = u.s0 * (2.2 + Math.random());
  u.a = (0.28 + Math.random() * 0.22) * (big ? 1.2 : 1);
  m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
  m.material.color.setScalar(0.45 + Math.random() * 0.25);
  m.visible = true;
}
const ventPos = new THREE.Vector3();
function ventAt(v) { const b = bones[v.bone]; b.getWorldPosition(ventPos); return ventPos.add(new THREE.Vector3(v.off[0] * toddH, v.off[1] * toddH, v.off[2] * toddH)); }
function stepSmoke(dt) {
  if (!todd) return;
  const w = boss.down ? 1.2 : wear();
  const open = VENTS.filter((v) => w >= v.at);
  smokeAcc += dt * (open.length ? Math.pow(w, 1.4) * 22 : 0);
  while (smokeAcc > 1) { smokeAcc--; puff(ventAt(open[(Math.random() * open.length) | 0])); }
  for (const m of smoke) {
    if (!m.visible) continue;
    const u = m.userData; u.age += dt;
    const p = u.age / u.life; if (p >= 1) { m.visible = false; continue; }
    m.position.addScaledVector(u.vel, dt); u.vel.multiplyScalar(1 - dt * 0.4);
    m.rotation.x += u.spin.x * dt; m.rotation.y += u.spin.y * dt; m.rotation.z += u.spin.z * dt;
    m.scale.setScalar(u.s0 + (u.s1 - u.s0) * Math.sqrt(p));
    m.material.opacity = u.a * Math.min(1, p * 6) * (1 - p);
  }
}
// a burst of it when you land a hit (from his screen)
function smokeBurst(n) { if (!screenPanel) return; screenPanel.getWorldPosition(ventPos); for (let i = 0; i < n; i++) puff(ventPos.clone().add(new THREE.Vector3(0, 0.08 * toddH, -0.05 * toddH)), true); }

// Mechanical shaking: his servos stutter. Small stepped twitches (held a beat, then snapped to a new one,
// not a smooth wobble) laid over whatever he's doing, worse the more he's hurt; late on, a limb seizes.
const JIT = ['chest', 'neck', 'fat_fucking_dome', 'Right_Arm', 'Left_Arm', 'forearm_R', 'forearm_L'];
const jit = {}; let jitNext = 0, seize = null;
const jE = new THREE.Euler(), jQ = new THREE.Quaternion();
function shudder(now) {
  const w = boss.down ? 0.6 : wear(); if (w <= 0.05 && !seize) return;
  if (now > jitNext) {
    jitNext = now + 50 + Math.random() * 90;
    const a = Math.pow(w, 1.3) * 0.07;
    for (const n of JIT) if (Math.random() < 0.55) jit[n] = [(Math.random() - 0.5) * a, (Math.random() - 0.5) * a, (Math.random() - 0.5) * a];
    // a seize: one limb jerks hard and holds there for a moment
    if (!seize && w > 0.45 && Math.random() < 0.012 + w * 0.02) {
      const n = JIT[(Math.random() * JIT.length) | 0];
      seize = { n, until: now + 160 + Math.random() * 220, e: [(Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.5] };
      if (n === 'fat_fucking_dome' || n === 'neck') glitchFace();
      fight.shake = Math.max(fight.shake, 0.18);
    }
  }
  if (seize && now > seize.until) seize = null;
  for (const n of JIT) {
    const b = bones[n], j = jit[n]; if (!b || !j) continue;
    const e = seize && seize.n === n ? seize.e : j;
    jE.set(e[0], e[1], e[2], 'YXZ'); b.quaternion.multiply(jQ.setFromEuler(jE));
  }
}
function glitchFace() { if (!fizz) fizz = { from: shown, to: shown, t0: performance.now(), dur: 160, last: 0 }; }

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
// ---- his monologue (intro.json): lines typed out, his screen flipping through pictures ----
// The pictures load straight from Wikimedia while the page runs; nothing is copied into this site.
let picPanel = null, picAspect = 1.3, MONO = null;
const pics = {};                               // key -> THREE.Texture (or the fire)
const monoReady = fetch('intro.json?v=' + Date.now()).then((r) => r.json()).then((d) => { MONO = d; loadPictures(d.pictures || {}); }).catch(() => {});
function cover(tex, w, h, focus) {
  // fill the screen, cropping the picture to its shape, keeping 'focus' ([x, y] from the top left) in the middle
  const a = w / h, fx = focus ? focus[0] : 0.5, fy = focus ? focus[1] : 0.5;
  tex.repeat.set(1, 1); tex.offset.set(0, 0);
  const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
  if (a > picAspect) { tex.repeat.x = picAspect / a; tex.offset.x = clamp(fx - tex.repeat.x / 2, 1 - tex.repeat.x); }
  else { tex.repeat.y = a / picAspect; tex.offset.y = clamp(1 - fy - tex.repeat.y / 2, 1 - tex.repeat.y); }
}
function loadPictures(list) {
  for (const key in list) {
    const p = list[key];
    if (p.drawn === 'fire') { pics[key] = fire.tex; continue; }
    if (p.art) { drawArt(key, p.art); continue; }
    const urls = (p.urls || []).slice();
    const next = () => {
      const url = urls.shift(); if (!url) return;
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { const tex = new THREE.Texture(img); tex.encoding = THREE.sRGBEncoding; tex.needsUpdate = true; cover(tex, img.width, img.height, p.focus); pics[key] = tex; };
      img.onerror = next;                        // try the next address (or give up: he shows static instead)
      img.src = url;
    };
    next();
  }
}
// pictures made from the site's own art (Cedar and Wonder side by side; the player): drawn onto a little
// screen-shaped canvas, with scanlines so it looks like it's on his monitor
function drawArt(key, files) {
  Promise.all(files.map((f) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.onerror = () => ok(null); im.src = f; }))).then((ims) => {
    const Wc = 640, Hc = Math.round(640 / picAspect), c = document.createElement('canvas'); c.width = Wc; c.height = Hc;
    const g = c.getContext('2d');
    const bg = g.createRadialGradient(Wc / 2, Hc / 2, 20, Wc / 2, Hc / 2, Wc * 0.7); bg.addColorStop(0, '#1d3a40'); bg.addColorStop(1, '#050d10');
    g.fillStyle = bg; g.fillRect(0, 0, Wc, Hc);
    const got = ims.filter(Boolean), slot = Wc / Math.max(1, got.length);
    got.forEach((im, i) => {
      const k = Math.min((slot * 0.86) / im.width, (Hc * 0.82) / im.height), w = im.width * k, h = im.height * k;
      g.drawImage(im, slot * i + (slot - w) / 2, (Hc - h) / 2 + Hc * 0.03, w, h);
    });
    g.fillStyle = 'rgba(0,0,0,.22)'; for (let y = 0; y < Hc; y += 4) g.fillRect(0, y, Wc, 2);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; pics[key] = tex;
  });
}
// his fire: drawn in code, the old demo-scene way (heat rises and cools, row by row)
const fire = (() => {
  const w = 64, h = 50, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'), img = g.createImageData(w, h), heat = new Uint8Array(w * h);
  const pal = []; for (let i = 0; i < 37; i++) { const k = i / 36; pal.push([Math.min(255, k * 3 * 255), Math.max(0, Math.min(255, (k * 3 - 1) * 255)), Math.max(0, Math.min(255, (k * 3 - 2) * 255))]); }
  const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding; tex.magFilter = tex.minFilter = THREE.NearestFilter; tex.generateMipmaps = false;
  let last = 0, warm = false;
  return { tex, step(now) {
    if (!warm) { warm = true; for (let k = 0; k < 70; k++) { last = 0; this.step(1e9 + k * 100); } }   // already burning when it appears
    if (now - last < 40) return; last = now;
    for (let x = 0; x < w; x++) heat[(h - 1) * w + x] = 30 + Math.random() * 7;
    for (let y = 0; y < h - 1; y++) for (let x = 0; x < w; x++) {
      const src = (y + 1) * w + x, r = (Math.random() * 3) | 0, dst = y * w + Math.min(w - 1, Math.max(0, x - r + 1));
      heat[dst] = Math.max(0, heat[src] - (r & 1));
    }
    for (let i = 0; i < w * h; i++) { const col = pal[Math.min(36, heat[i])]; img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255; }
    g.putImageData(img, 0, 0); tex.needsUpdate = true;
  } };
})();
const mono = { on: false, t0: 0, line: -1, pic: null, cut: 0, arm: null };
const sayEl = document.getElementById('say');
function seenIntro() { try { return localStorage.getItem('rvFightIntroSeen') === '1'; } catch (e) { return false; } }
function startMonologue() {
  Object.assign(mono, { on: true, t0: performance.now(), line: -1, pic: null, cut: 0 });
  fight.phase = 'monologue'; red = 0; face('neutral', 200);
  // the hand he holds the world in: in front of him, at chest height, on the side away from you
  const chest = bonePos('chest'), side = P.x < W / 2 ? (rightArmOnLeft ? 'L' : 'R') : (rightArmOnLeft ? 'R' : 'L');
  const sx = Math.sign(bonePos(side === 'R' ? 'Right_Arm' : 'Left_Arm').x);
  mono.side = side; mono.arm = solveArm(side, chest.clone().add(new THREE.Vector3(sx * 0.12 * toddH, 0.02 * toddH, 0.3 * toddH)), 0.1);
  mono.handYaw = sx > 0 ? 0.25 : -0.25;
  if (sayEl) { sayEl.textContent = ''; sayEl.hidden = false; }
  if (seenIntro()) { const hint = document.getElementById('skip'); if (hint) hint.hidden = false; }
}
function endMonologue() {
  mono.on = false; if (picPanel) { picPanel.visible = false; picPanel.material.opacity = 0; }
  if (sayEl) { sayEl.hidden = true; sayEl.textContent = ''; }
  const hint = document.getElementById('skip'); if (hint) hint.hidden = true;
  try { localStorage.setItem('rvFightIntroSeen', '1'); } catch (e) {}
  // ...and straight into throwing his arms in the air
  fight.phase = 'intro'; introStep = 2; fight.t0 = performance.now() - INTRO.windup * 1000;
}
function lineAt(T) {
  let at = 0; const L = MONO.lines;
  for (let i = 0; i < L.length; i++) { if (T < at + L[i].secs) return { i, lt: T - at, L: L[i] }; at += L[i].secs; }
  return null;
}
function stepMonologue(now) {
  const T = (now - mono.t0) / 1000, cur = lineAt(T);
  if (!cur) return endMonologue();
  const { i, lt, L } = cur;
  if (i !== mono.line) { mono.line = i; mono.shook = false; }
  // the words, typed out
  const typed = L.text.slice(0, Math.floor(lt * 26));
  if (sayEl && sayEl.textContent !== typed) sayEl.textContent = typed;
  if (L.shake && !mono.shook && typed.includes(L.shake)) { mono.shook = true; fight.shake = Math.max(fight.shake, 1); glitchFace(); }
  // which picture: in order; on a line with several, once through each, then flicking through them fast
  const show = L.show || [], n = show.length;
  let key = show[0];
  if (n > 1) { const slow = L.secs * 0.55; key = lt < slow ? show[Math.min(n - 1, Math.floor(lt / (slow / n)))] : show[Math.floor((lt - slow) / 0.16) % n]; }
  const isFace = key && key.startsWith('face:');
  if (key !== mono.pic) { mono.pic = key; mono.cut = now + (n > 1 && lt > L.secs * 0.55 ? 40 : 130); if (isFace) face(key.slice(5), 260); else glitchFace(); }
  if (key === 'fire') fire.step(now);
  if (picPanel) {
    const tex = isFace ? null : pics[key], live = tex && now > mono.cut;
    if (live && picPanel.material.map !== tex) { picPanel.material.map = tex; picPanel.material.needsUpdate = true; }
    picPanel.visible = !!live;
    picPanel.material.opacity = live ? (Math.random() < 0.04 ? 0.35 : 0.92 + Math.random() * 0.08) : 0;
  }
  return cur;
}
// skipping it, after the first time (press jump or parry)
function skipMonologue() { if (mono.on && seenIntro()) endMonologue(); }

// the opening: he sees you, he's shocked, then he throws his arms in the air and the fight is on
const fight = { phase: 'wait', t0: 0, shake: 0 };   // (waiting for him to load)
const INTRO = { shock: 0.9, windup: 2.5, rage: 2.75, ready: 4.3 };
let introStep = 0;
function startIntro(skipMono) {
  if (!skipMono && MONO && MONO.lines && MONO.lines.length && picPanel) return startMonologue();
  fight.phase = 'intro'; fight.t0 = performance.now(); introStep = 0; red = 0; face('neutral', 200);
}
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

  if (fight.phase === 'monologue' && mono.on) {
    const cur = stepMonologue(performance.now());
    const away = P.x < W / 2 ? 0.35 : -0.35;     // talking to himself, not to you (yet)
    yaw = away; pitch = 0.1; speed = 4;
    if (cur) {
      const pose = cur.L.pose, lt = cur.lt;
      if (pose === 'palm') {
        // holding the world: one hand out in front, looking down at it
        const c = mono.arm.c; if (mono.side === 'R') { armR = c.slice(0, 3); foreR = c[3]; } else { armL = c.slice(0, 3); foreL = c[3]; }
        yaw = mono.handYaw; pitch = 0.45; chest = [0.08, 0, 0]; speed = 3;
      } else if (pose === 'rage') {
        // fists clenched, shaking
        const k = Math.sin(t * 30) * 0.07 * Math.min(1, lt);
        armR = [-0.75 + k, 0, 0.5]; armL = [-0.75 - k, 0, -0.5]; foreR = foreL = -1.75;
        chest = [0.18, 0, k * 0.3]; yaw = youYaw; pitch = youPitch; speed = 8; red = Math.min(1, red + dt * 0.8);
      } else if (pose === 'preach') {
        // arms flung wide, head back
        const k = Math.sin(t * 3) * 0.05;
        armR = [-1.5 + k, 0, 1.05]; armL = [-1.5 - k, 0, -1.05]; foreR = foreL = -0.35;
        chest = [-0.16, 0, 0]; pitch = -0.35; yaw = away * 0.4; speed = 5; red = Math.max(0, red - dt);
      } else if (pose === 'lean') {
        // he's been waiting: leaning over the stage at you, unimpressed
        yaw = youYaw; pitch = youPitch + 0.1; chest = [0.28, 0, 0.06];
        armR = [0.15, 0, 0.25]; armL = [0.15, 0, -0.25]; foreR = foreL = -0.6; speed = 3;
      } else if (pose === 'slump') {
        // shoulders down, head hung
        yaw = away * 0.5; pitch = 0.75; chest = [0.32, 0, 0.04];
        armR = [0.2, 0, 0.04]; armL = [0.2, 0, -0.04]; foreR = foreL = -0.1; speed = 2.5; red = 0;
      } else if (pose === 'point') {
        // a thumb back over his shoulder, at the ledge behind him
        const sd = mono.side, a = [-2.0, sd === 'R' ? -0.9 : 0.9, sd === 'R' ? 1.3 : -1.3];
        if (sd === 'R') { armR = a; foreR = -1.2; } else { armL = a; foreL = -1.2; }
        yaw = -away * 0.9; pitch = -0.05; chest = [0.0, 0, 0]; speed = 4;
      } else if (pose === 'peer') {
        // leaning right down to get a good look at you
        const p = Math.min(1, lt / 1.2);
        yaw = youYaw; pitch = youPitch + 0.25 * p; chest = [0.15 + 0.3 * p, 0, 0];
        armR = [0.05, 0, 0.3]; armL = [0.05, 0, -0.3]; foreR = foreL = -0.4; speed = 3; red = 0;
      } else if (pose === 'look') {
        // slowly turning to look at you
        const p = Math.min(1, lt / (cur.L.secs * 0.8));
        yaw = away + (youYaw - away) * p * p; pitch = 0.1 + (youPitch - 0.1) * p; speed = 2.5; red = 0;
        chest = [0.06, 0, 0];
      }
    }
  } else if (fight.phase === 'intro') {
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
    } else if (atk && (atk.kind === 'pound' || atk.kind === 'clap')) {
      const st = atk.state, put = (sd, a, f) => { if (sd === 'R') { armR = a; foreR = f; } else { armL = a; foreL = f; } };
      if (st === 'raise') {
        speed = 7; pitch = youPitch + 0.1;
        if (atk.kind === 'pound') { chest = [-0.16, 0, 0]; put('R', [-2.8, 0, 0.2], -0.5); put('L', [-2.8, 0, -0.2], -0.5); }
        else { chest = [0.1, 0, 0]; put('R', [-1.2, 0, 1.25], -0.4); put('L', [-1.2, 0, -1.25], -0.4); pitch = 0.4; }
      } else if (st === 'down' || st === 'sweep' || st === 'rest') {
        for (const sd of atk.sides) { const c = atk.sol2[sd].c; put(sd, c.slice(0, 3), c[3]); }
        chest = [atk.lean, 0, 0]; pitch = 0.6; speed = st === 'down' ? 26 : st === 'sweep' ? 30 : 10;
      } else if (st === 'punch' && atk.punch) { put(atk.side, atk.punch.c.slice(0, 3), atk.punch.c[3]); chest = [-0.1, 0, 0]; speed = 18; }
      else speed = 5;
    } else if (atk && (atk.kind === 'cursors' || atk.kind === 'popups')) {
      // pointing his screen at you, a twitch with each one
      chest = [0.18 - (boss.recoil || 0) * 0.12, 0, 0]; pitch = youPitch + (atk.kind === 'popups' ? -0.25 : 0.12);
      boss.recoil = Math.max(0, (boss.recoil || 0) - dt * 4);
      if (atk.kind === 'popups') { const k = Math.sin(t * 20) * 0.08; armR = [-1.6 + k, 0, 0.5]; armL = [-1.6 - k, 0, -0.5]; foreR = foreL = -1.0; speed = 9; }
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
  shudder(performance.now());
  // the screen shakes when he does something big
  fight.shake = Math.max(0, fight.shake - dt * 1.6);
}

// ---------------- the fight: his attacks, and parrying them back at him ----------------
// Everything he throws at you hurts if it touches you, unless you parry it: jump, then press jump again in
// mid-air as you meet it. A parried attack flies back and hits him. That's the only way to hurt him.
const TODD_HP = 26;   // parries it takes to beat him
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

// --- shockwaves: low, fast, along the floor (from the double pound) ---
function shock(x, dir, speed) { threats.push({ kind: 'shock', x, y: FLOOR - 20, w: 30, h: 40, vx: dir * speed, state: 'fly', t: 0, rot: 0 }); }
// --- cursors: little pointers from his screen that chase you for a moment, then dive ---
function fireCursor(i) {
  const s = screenAt(), a = -Math.PI / 2 + (i - 1) * 0.9;
  threats.push({ kind: 'cursor', x: s.x, y: s.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, r: 20, home: 1.6 + i * 0.25, state: 'fly', t: 0, rot: 0 });
}
// --- error popups: a window locks on above you, then slams down ---
const POPUP_TEXT = ['ERROR', 'GET OUT', 'NO', 'DENIED', 'FATAL', '404'];
function popup(x) {
  x = Math.max(60, Math.min(W - 60, x));
  threats.push({ kind: 'drop', x, y: -60, w: 116, h: 84, vy: 0, text: POPUP_TEXT[(Math.random() * POPUP_TEXT.length) | 0], state: 'warn', warn: 0.55, t: 0, rot: 0 });
}

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
  smokeBurst(3 + Math.round(wear() * 6));
  face(Math.random() < 0.5 ? 'surprised' : 'sad', 180);
  clearTimeout(hitTodd.back);
  hitTodd.back = setTimeout(() => { if (!boss.down) face('angry', 300); }, 700);
  if (boss.hp <= 0) knockout();
}
function knockout() {
  boss.down = true; atk = null; threats.length = 0;
  fight.phase = 'down'; face('error', 500); fight.shake = 1.2;
  // his screen goes to the skull
  setTimeout(() => { if (pics.death && picPanel) { picPanel.material.map = pics.death; picPanel.material.needsUpdate = true; picPanel.visible = true; picPanel.material.opacity = 1; } }, 700);
  setTimeout(() => banner((MONO && MONO.win) || 'WIN!'), 600);
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
  setTimeout(() => { showDeathCard(); fight.retry = true; }, 2600);
}
// ---- the cards ----
// Before the fight: his title and a menu (START / SETTINGS / CREDITS). START begins the cutscene.
const OPT = { shake: true, skip: false };
try { Object.assign(OPT, JSON.parse(localStorage.getItem('rvFightOpts')) || {}); } catch (e) {}
function saveOpts() { try { localStorage.setItem('rvFightOpts', JSON.stringify(OPT)); } catch (e) {} }
function showScreen(id) {
  for (const k of ['title', 'settings', 'credits']) document.getElementById(k).hidden = k !== id;
  const first = document.querySelector('#' + id + ' button'); if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
}
function showTitle() {
  const T = (MONO && MONO.title) || {};
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v || ''; };
  set('t-name', T.name || 'TODD.EXE'); set('t-kicker', T.kicker); set('t-tag', T.tagline);
  fight.phase = 'title'; showScreen('title');
}
document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
  const go = b.dataset.go;
  if (go === 'start') {
    if (fight.phase !== 'title') return;
    for (const k of ['title', 'settings', 'credits']) document.getElementById(k).hidden = true;
    jumpPressed = parryPressed = false; b.blur();
    startIntro(OPT.skip);
  } else showScreen(go === 'menu' ? 'title' : go);
}));
const optShake = document.getElementById('opt-shake'), optSkip = document.getElementById('opt-skip');
optShake.checked = OPT.shake; optSkip.checked = OPT.skip;
optShake.addEventListener('change', () => { OPT.shake = optShake.checked; saveOpts(); });
optSkip.addEventListener('change', () => { OPT.skip = optSkip.checked; saveOpts(); });
addEventListener('keydown', (e) => { if (e.key === 'Escape' && fight.phase === 'title') showScreen('title'); });
// When you die: Cuphead style, how far you got (a bar with his phases marked), a line from him, retry or exit.
function showDeathCard() {
  const D = (MONO && MONO.death) || {}, el = document.getElementById('death');
  const q = D.quotes && D.quotes.length ? D.quotes[(Math.random() * D.quotes.length) | 0] : '';
  document.getElementById('d-head').textContent = D.heading || 'YOU DIED';
  document.getElementById('d-quote').textContent = q; document.getElementById('d-quote').hidden = !q;
  const far = Math.max(0, Math.min(1, (TODD_HP - boss.hp) / TODD_HP));
  // his phases, marked where they start
  const marks = el.querySelectorAll('.d-mark'); marks[0].style.left = ((TODD_HP - 18) / TODD_HP * 100) + '%'; marks[1].style.left = ((TODD_HP - 9) / TODD_HP * 100) + '%';
  const you = document.getElementById('d-you'); you.style.left = '0%';
  document.getElementById('d-far').textContent = Math.round(far * 100) + '% OF THE WAY THROUGH HIM';
  // his face, angry, at the end of the bar
  const c = document.getElementById('d-todd').getContext('2d'), fd = faceData[faceAt('angry')];
  if (fd) { const im = c.createImageData(FACE.w, FACE.h); im.data.set(fd); for (let i = 0; i < im.data.length; i += 4) if (im.data[i + 1] > 120 && im.data[i + 2] > 120 && im.data[i] < im.data[i + 1] - 60) { im.data[i] = 255; im.data[i + 1] = 34; im.data[i + 2] = 46; } c.putImageData(im, 0, 0); }
  el.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => { you.style.left = (far * 100) + '%'; }));
  setTimeout(() => { const b = document.getElementById('d-retry'); if (b) b.focus({ preventScroll: true }); }, 400);
}
function hideDeathCard() { document.getElementById('death').hidden = true; }
document.getElementById('d-retry').addEventListener('click', () => { if (fight.retry) restart(); });

function restart() {
  hideDeathCard();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // give the keys back to the game
  if (picPanel) { picPanel.visible = false; picPanel.material.opacity = 0; }
  fight.retry = false; boss.hp = TODD_HP; boss.down = false; boss.flinch = 0;
  threats.length = 0; fx.length = 0; atk = null; nextAtk = 0; stomp.next = 0;
  revive(); startIntro(true);   // (no monologue on a retry)
}

// --- picking and running his attacks ---
// He gets worse as he takes damage: three phases, each faster, each adding attacks.
function phase() { return boss.hp > 18 ? 1 : boss.hp > 9 ? 2 : 3; }
const MOVES = {
  1: ['slam', 'slam', 'volley', 'cursors'],
  2: ['slam', 'volley', 'sweep', 'rain', 'popups', 'pound', 'cursors'],
  3: ['slam', 'volley', 'sweep', 'rain', 'popups', 'pound', 'clap', 'clap', 'cursors', 'agony', 'agony']
};
let lastMove = null;
function pace() { return [1, 0.8, 0.6, 0.42][phase()]; }   // how long he rests between attacks
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
  if (kind === 'cursors') { atk = { kind, t0: now, shots: 0, next: now + 500 }; face('sly', 200); return; }
  if (kind === 'popups') { atk = { kind, t0: now, shots: 0, next: now + 450 }; face('error', 250); return; }
  const leftSide = rightArmOnLeft ? 'R' : 'L', rightSide = leftSide === 'R' ? 'L' : 'R';
  if (kind === 'pound') {
    // both fists, side by side in front of him; the floor shakes and shockwaves run out both ways
    const lean = 0.5, sol = {};
    sol[leftSide] = solveArm(leftSide, fromStage(W / 2 - 85, FLOOR, PLANE * toddH).add(new THREE.Vector3(0, toddH * 0.055, 0)), lean);
    sol[rightSide] = solveArm(rightSide, fromStage(W / 2 + 85, FLOOR, PLANE * toddH).add(new THREE.Vector3(0, toddH * 0.055, 0)), lean);
    atk = { kind, fist: true, sides: [leftSide, rightSide], sol2: sol, lean, state: 'raise', t0: now };
    return;
  }
  if (kind === 'clap') {
    // both fists on the stage at the edges of his reach, dragged in to meet in the middle
    const lean = 0.45, paths = {};
    const build = (side, from, to) => {
      const path = []; let seed = null;
      for (let i = 0; i <= 5; i++) {
        const x = from + (to - from) * i / 5, goal = fromStage(x, FLOOR, PLANE * toddH); goal.y += toddH * 0.055;
        const sol = seed ? solveArmFrom(side, goal, lean, seed) : solveArm(side, goal, lean);
        path.push(sol); seed = sol.c;
      }
      return path;
    };
    paths[leftSide] = build(leftSide, 210, W / 2 - 50); paths[rightSide] = build(rightSide, W - 210, W / 2 + 50);
    atk = { kind, fist: true, sides: [leftSide, rightSide], paths, lean, state: 'raise', t0: now, sol2: { [leftSide]: paths[leftSide][0], [rightSide]: paths[rightSide][0] } };
    return;
  }
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
  if (fight.phase !== 'fight' || P.dead) { if (stomp.on && stomp.state !== 'fling') endStomp(now, false); return; }
  if (!stomp.on && phase() >= 2 && bot.obj) {
    if (!stomp.next) stomp.next = now + 3500;          // the first time: soon after phase 2 starts
    if (now > stomp.next && (!atk || atk.kind !== 'agony')) startStomp(now);
  }
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
    else if (atk.state === 'down' && T > 0.15) { atk.state = 'sweep'; atk.t0 = now; fight.shake = 0.7; const f = fistOnStage(atk.side); ripple(f.x, 1.6); if (phase() === 3) fireFace('angry', 400); }
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
  } else if (atk.kind === 'pound' || atk.kind === 'clap') {
    const ph = phase();
    if (atk.state === 'raise' && T > (atk.kind === 'clap' ? [0, 0.9, 0.8, 0.7][ph] : [0, 0.8, 0.65, 0.55][ph])) { atk.state = 'down'; atk.t0 = now; }
    else if (atk.state === 'down' && T > 0.14) {
      fight.shake = 1.1;
      for (const sd of atk.sides) { const f = fistOnStage(sd); ripple(f.x, 2.4); for (let k = 0; k < 6; k++) fx.push({ kind: 'spark', x: f.x + (Math.random() - 0.5) * f.r * 2, y: FLOOR, vx: (Math.random() - 0.5) * 400, vy: -Math.random() * 300, t: 0, life: 0.5 }); }
      if (atk.kind === 'pound') {
        const sp = 480 + ph * 50; shock(W / 2 - 150, -1, sp); shock(W / 2 + 150, 1, sp);
        if (ph === 3) setTimeout(() => { if (atk && atk.kind === 'pound') { shock(W / 2 - 150, -1, sp * 0.7); shock(W / 2 + 150, 1, sp * 0.7); } }, 380);
        atk.state = 'rest';
      } else atk.state = 'sweep';
      atk.t0 = now;
      if (ph === 3) fireFace('angry', 420);   // and a face at you while his hands are busy
    }
    else if (atk.state === 'sweep') {
      const n = atk.paths[atk.sides[0]].length, dur = 0.13 * n * (ph === 3 ? 0.75 : 1), p = Math.min(1, T / dur);
      const at = p * (n - 1), i = Math.min(n - 2, Math.floor(at)), k = at - i;
      for (const sd of atk.sides) { const A = atk.paths[sd][i].c, B = atk.paths[sd][i + 1].c; atk.sol2[sd] = { c: A.map((v, j) => v + (B[j] - v) * k) }; }
      if (p >= 1) { atk.state = 'rest'; atk.t0 = now; fight.shake = 0.8; ripple(W / 2, 2); }
    }
    else if (atk.state === 'rest' && T > (atk.kind === 'pound' ? 0.7 : 0.4)) { atk.state = 'lift'; atk.t0 = now; }
    else if (atk.state === 'lift' && T > 0.45) { atk = null; nextAtk = now + (800 + Math.random() * 500) * pace(); }
    else if (atk.state === 'punch' && T > 0.32) { const s = screenAt(); hitTodd(s.x, s.y); atk.state = 'lift'; atk.t0 = now; }
    if (atk && (atk.state === 'down' || atk.state === 'sweep' || atk.state === 'rest')) for (const sd of atk.sides) { if (atk.state === 'punch') break; fistContact(now, sd); }
  } else if (atk.kind === 'cursors') {
    const n = 1 + phase();
    if (atk.shots < n && now > atk.next) { fireCursor(atk.shots % 3); atk.shots++; atk.next = now + 330; boss.recoil = 1; }
    if (atk.shots >= n && now > atk.next + 900) { atk = null; nextAtk = now + (700 + Math.random() * 500) * pace(); }
  } else if (atk.kind === 'popups') {
    const n = 2 + phase();
    if (atk.shots < n && now > atk.next) { popup(P.x + P.vx * 0.2); atk.shots++; atk.next = now + [0, 600, 500, 400][phase()]; }
    if (atk.shots >= n && now > atk.next + 900) { atk = null; face('angry', 250); nextAtk = now + (700 + Math.random() * 500) * pace(); }
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
function fistContact(now, side) {
  side = side || atk.side;
  const f = fistOnStage(side);
  if (!touches(f.x, f.y, f.r)) return;
  if (P.parryT > 0) {
    parried(f.x, f.y);
    atk.side = side;                 // that's the fist that goes back into his face
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
    if (o.state === 'warn') { if (o.t > o.warn) { o.state = 'fly'; o.t = 0; o.vy = 950; } continue; }
    if (o.state === 'fly' && (o.kind === 'bar' || o.kind === 'wave' || o.kind === 'shock' || o.kind === 'drop')) {
      if (o.kind === 'bar' || o.kind === 'drop') o.y += o.vy * dt; else o.x += o.vx * dt;
      if (touchesRect(o.x, o.y, o.w, o.h)) {
        if (P.parryT > 0) { parried(Math.max(o.x - o.w / 2, Math.min(P.x, o.x + o.w / 2)), o.y); o.state = 'back'; o.t = 0; o.fromX = Math.max(o.x - o.w / 2, Math.min(P.x, o.x + o.w / 2)); o.fromY = o.y; o.x = o.fromX; continue; }
        hurt(1);
      }
      const gone = (o.kind === 'bar' || o.kind === 'drop') ? o.y > FLOOR - o.h / 2 : (o.x < -o.w || o.x > W + o.w);
      if (gone) {
        threats.splice(i, 1);
        if (o.kind === 'drop') { ripple(o.x, 1.4); fight.shake = Math.max(fight.shake, 0.35); for (let k = 0; k < 8; k++) fx.push({ kind: 'spark', x: o.x + (Math.random() - 0.5) * o.w, y: FLOOR, vx: (Math.random() - 0.5) * 360, vy: -Math.random() * 260, t: 0, life: 0.45 }); }
        if (o.kind === 'bar') { ripple(o.x, 1.0); for (let k = 0; k < 5; k++) fx.push({ kind: 'spark', x: o.x + (Math.random() - 0.5) * o.w, y: FLOOR, vx: (Math.random() - 0.5) * 200, vy: -Math.random() * 200, t: 0, life: 0.35 }); }
      }
      continue;
    }
    if (o.state === 'fly') {
      o.x += o.vx * dt; o.y += o.vy * dt;
      if (o.name === 'sad') o.vy += 500 * dt;       // the sad ones droop
      if (o.kind === 'cursor') {
        // chasing you (it can only turn so fast), then it commits and dives
        const sp = Math.hypot(o.vx, o.vy) || 1;
        if (o.t < o.home) {
          const want = Math.atan2(P.y - 40 - o.y, P.x - o.x), cur = Math.atan2(o.vy, o.vx);
          const d = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)), turn = Math.max(-3.2 * dt, Math.min(3.2 * dt, d));
          const ns = Math.min(380, sp + 60 * dt);
          o.vx = Math.cos(cur + turn) * ns; o.vy = Math.sin(cur + turn) * ns;
        } else { const ns = Math.min(900, sp + 1400 * dt); o.vx = o.vx / sp * ns; o.vy = o.vy / sp * ns; }
      }
      if (touches(o.x, o.y, o.r)) {
        if (P.parryT > 0) { parried(o.x, o.y); o.state = 'back'; o.t = 0; o.fromX = o.x; o.fromY = o.y; }
        else { hurt(1); threats.splice(i, 1); fx.push({ kind: 'ring', x: o.x, y: o.y, t: 0, life: 0.3, color: '#ff2a3a' }); continue; }
      }
      if (o.y > FLOOR - 10 || o.x < -60 || o.x > W + 60 || o.y < (o.kind === 'cursor' ? -400 : -80)) {
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
function drawShock(o) {
  const k = o.scale || 1, d = Math.sign(o.vx || 1);
  ctx.save(); ctx.translate(o.x, o.y); ctx.scale(k * d, k);
  ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.shadowBlur = 18;
  ctx.fillStyle = o.state === 'back' ? '#ff9bf5' : '#ff5260';
  for (let j = 0; j < 3; j++) { const x = -j * 12; ctx.globalAlpha = 1 - j * 0.3; ctx.beginPath(); ctx.moveTo(x + 14, 20); ctx.lineTo(x - 2, -20 + j * 8); ctx.lineTo(x - 8, 20); ctx.fill(); }
  ctx.restore(); ctx.globalAlpha = 1;
}
function drawCursor(o) {
  const k = o.scale || 1;
  ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(Math.atan2(o.vy, o.vx) + Math.PI * 0.75 + (o.state === 'back' ? o.rot : 0)); ctx.scale(2.1 * k, 2.1 * k);
  ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 7); ctx.lineTo(4.5, 3); ctx.lineTo(8, 10); ctx.lineTo(10.5, 9); ctx.lineTo(7, 2); ctx.lineTo(13, 2); ctx.closePath();
  ctx.translate(-5, 0);
  ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = '#111'; ctx.stroke();
  ctx.restore();
}
function drawDrop(o, t) {
  if (o.state === 'warn') {
    // where it's about to land: a flickering outline and a line down to the floor
    if (Math.floor(t * 16) % 2) return;
    ctx.save(); ctx.strokeStyle = 'rgba(255,60,80,.85)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 2;
    ctx.strokeRect(o.x - o.w / 2, 14, o.w, o.h); ctx.beginPath(); ctx.moveTo(o.x, 14 + o.h); ctx.lineTo(o.x, FLOOR); ctx.stroke();
    ctx.restore(); return;
  }
  const k = o.scale || 1;
  ctx.save(); ctx.translate(o.x, o.y); if (o.state === 'back') ctx.rotate(o.rot * 0.3); ctx.scale(k, k);
  const x = -o.w / 2, y = -o.h / 2;
  ctx.shadowColor = o.state === 'back' ? '#ff5cf0' : '#ff2a3a'; ctx.shadowBlur = 16;
  ctx.fillStyle = '#d8dde0'; ctx.fillRect(x, y, o.w, o.h); ctx.shadowBlur = 0;
  ctx.fillStyle = o.state === 'back' ? '#a0279a' : '#a3121f'; ctx.fillRect(x, y, o.w, 18);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 11px "Courier New", monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('TODD.EXE', x + 5, y + 9.5);
  ctx.fillStyle = '#ff4757'; ctx.fillRect(x + o.w - 16, y + 3, 12, 12); ctx.fillStyle = '#fff'; ctx.fillText('x', x + o.w - 13, y + 9);
  ctx.fillStyle = '#111'; ctx.font = 'bold 18px "Courier New", monospace'; ctx.textAlign = 'center'; ctx.fillText(o.text, 0, 10);
  ctx.strokeStyle = '#2b3338'; ctx.lineWidth = 2; ctx.strokeRect(x, y, o.w, o.h);
  ctx.restore();
}
function drawThreats(t) {
  for (const o of threats) {
    if (o.kind === 'shock') { drawShock(o); continue; }
    if (o.kind === 'cursor') { drawCursor(o); continue; }
    if (o.kind === 'drop') { drawDrop(o, t); continue; }
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
  if (fight.phase === 'title') { jumpPressed = parryPressed = false; }   // the title card waits for a click, not a key
  // a parry freezes everything for a split second
  if (hitstop > 0) { hitstop -= dt; acc = 0; }
  else { acc += dt; while (acc >= STEP) { step(STEP); stepThreats(STEP); acc -= STEP; } }
  if (fight.retry && jumpPressed) { jumpPressed = false; restart(); }

  if (mono.on && (keys.jump || keys.parry) && seenIntro()) skipMonologue();
  const t = now / 1000;
  animateTodd(t, dt);
  stepAttack(now, dt);
  stepSmoke(dt);
  stepAgony();
  stepFx(dt);
  stepBot(dt, now);
  faceStep(now);
  const sh = OPT.shake ? fight.shake * fight.shake * 9 : 0, sx = (Math.random() - 0.5) * sh, sy = (Math.random() - 0.5) * sh;
  document.getElementById('arena').style.transform = sh > 0.05 ? `translate(${sx}px, ${sy}px)` : '';
  if (todd) renderer.render(scene, camera);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  floorMat.uniforms.uTime.value = t;
  drawFx(t);
  drawStomp(t);
  drawPlayer();
  drawThreats(t);
}

// for testing from the console
function hurt(n = 1) {
  if (P.dead || P.hurtT > 0 || P.goldT > 0) return;
  P.hp = Math.max(0, P.hp - n); P.hurtT = 0.9; P.streak = 0;
  if (Math.random() < 0.6) tauntSoon = true;   // got you
  fight.shake = Math.max(fight.shake, 0.5);
  if (P.hp === 0) { P.dead = true; P.vx = 0; P.vy = -500; P.wall = 0; P.parryT = 0; P.spin = 0; youDied(); }
  paintHud();
}
function revive() { Object.assign(P, { hp: HP_START, dead: false, deadT: 0, hurtT: 0, goldT: 0, streak: 0, x: 200, y: FLOOR, vx: 0, vy: 0, parryT: 0, spin: 0 }); paintHud(); }
window.FIGHT = { mono, pics, startMonologue, stomp, startStomp: () => startStomp(performance.now()), wear, attack: (k) => startAttack(performance.now(), k), phase, taunt: () => startTaunt(performance.now()), boss, threats, get atk() { return atk; }, startAttack: () => startAttack(performance.now()), fireFace, solveArm, fromStage, toStage, fistOnStage, restart, bot, LEDGE, P, TUNE, hurt, revive, look, bones, camera, fight, intro: startIntro, face, get todd() { return todd; } };

addEventListener('resize', fit);
fit(); paintHud();
Promise.all(FRAMES.map(loadFrame)).then(() => requestAnimationFrame(frame));
