// TODD, standing in the void, looking around.
// The model is todd.gltf (Blockbench). His face is a little screen on his texture: an 18 x 14 patch
// at x 1, y 145 of the 256 x 256 texture. faces.png holds his expressions, 18 x 14 pixels each,
// side by side in the order of FACES below (the first one is the face the model was made with).
// Every so often the screen fizzles with static and comes back as a different face.
//
// He wanders the void: picks a spot, turns toward it, walks there (leaving footprints that fade), stops,
// looks around. Move the cursor (or touch) and now and then he notices: he stops, turns to face you and
// watches the cursor until he gets bored.
import * as THREE from './vendor/three-gltf.min.js';

const FACES = ['smile', 'neutral', 'happy', 'angry', 'surprised', 'sly', 'sad', 'error', 'loading'];
// how often each face comes up on its own (higher = more often)
const MOODS = { smile: 5, neutral: 6, happy: 2, angry: 1.5, surprised: 0, sly: 3, sad: 1.5, error: 0.6, loading: 0.6 };
const FACE = { x: 1, y: 145, w: 18, h: 14 };
const STATIC = [[0, 255, 250], [255, 255, 255], [8, 40, 42], [0, 150, 150], [180, 255, 252]];

const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('stage');
const boot = document.getElementById('boot');

// ---- the scene ----
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x030506, 9, 22);
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);

scene.add(new THREE.HemisphereLight(0xd6f4f4, 0x081214, 1.05));
const key = new THREE.DirectionalLight(0xffffff, 0.75);
key.position.set(-2, 4, 5);
scene.add(key);
const rim = new THREE.DirectionalLight(0x00fffa, 0.9);   // his own colour, from behind, so he stands out of the dark
rim.position.set(1.5, 3, -5);
scene.add(rim);

// a soft pool of cyan under his feet
function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d'), r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(0,255,250,.55)'); r.addColorStop(0.4, 'rgba(0,255,250,.16)'); r.addColorStop(1, 'rgba(0,255,250,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
pool.rotation.x = -Math.PI / 2;
scene.add(pool);

// dust hanging in the dark
const DUST = 420;
const dustGeo = new THREE.BufferGeometry();
const dustPos = new Float32Array(DUST * 3), dustSeed = new Float32Array(DUST);
for (let i = 0; i < DUST; i++) {
  dustPos[i * 3] = (Math.random() - 0.5) * 36; dustPos[i * 3 + 1] = Math.random() * 7; dustPos[i * 3 + 2] = (Math.random() - 0.5) * 36;
  dustSeed[i] = Math.random() * 100;
}
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x00fffa, size: 0.03, transparent: true, opacity: 0.35, depthWrite: false }));
scene.add(dust);

// ---- his face: a canvas copy of his texture, so the screen can change ----
const skin = document.createElement('canvas'); skin.width = skin.height = 256;
const skinCtx = skin.getContext('2d', { willReadFrequently: true });
const glow = document.createElement('canvas'); glow.width = glow.height = 256;   // only the screen, for it to glow
const glowCtx = glow.getContext('2d');
let skinTex = null, glowTex = null;
let faceData = [];          // each face as RGBA pixels
let shownFace = 0;
const faceImg = glowCtx.createImageData(FACE.w, FACE.h);

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.encoding = THREE.sRGBEncoding;
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
function putFace(pixels) {
  faceImg.data.set(pixels);
  skinCtx.putImageData(faceImg, FACE.x, FACE.y);
  glowCtx.putImageData(faceImg, FACE.x, FACE.y);
  if (skinTex) { skinTex.needsUpdate = true; glowTex.needsUpdate = true; }
}
function loadFaces() {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
      faceData = FACES.map((_, i) => i * FACE.w + FACE.w <= img.width ? g.getImageData(i * FACE.w, 0, FACE.w, FACE.h).data : null);
      ok();
    };
    img.onerror = () => { console.warn('[todd] faces.png did not load'); ok(); };
    img.src = 'faces.png?v=1';
  });
}

// ---- the fizzle: tearing, static, then the new face settling in ----
let fizz = null;   // { from, to, t0, dur }
function fizzle(to, dur) {
  if (to === shownFace && !dur) return;
  if (!faceData[to]) return;
  if (reduce) { shownFace = to; putFace(faceData[to]); return; }
  fizz = { from: shownFace, to, t0: performance.now(), dur: dur || 520 + Math.random() * 260, last: 0 };
}
function glitch() { fizz = { from: shownFace, to: shownFace, t0: performance.now(), dur: 160, last: 0, light: true }; }
function fizzStep(now) {
  if (!fizz) return;
  if (now - fizz.last < 45) return;     // chunky, like an old screen
  fizz.last = now;
  const p = Math.min(1, (now - fizz.t0) / fizz.dur);
  const A = faceData[fizz.from], B = faceData[fizz.to], out = new Uint8ClampedArray(FACE.w * FACE.h * 4);
  // how much is noise: rises, peaks in the middle, falls away (a light glitch barely has any)
  const noise = fizz.light ? 0.08 : Math.sin(p * Math.PI) * 0.95;
  const src = p < 0.5 ? A : B;
  for (let y = 0; y < FACE.h; y++) {
    const tear = Math.random() < noise * 0.7 ? Math.round((Math.random() - 0.5) * 8 * (noise + 0.2)) : 0;
    const dim = Math.random() < noise * 0.25 ? 0.35 : 1;   // a dark band rolling through
    for (let x = 0; x < FACE.w; x++) {
      const o = (y * FACE.w + x) * 4;
      if (Math.random() < noise) {
        const c = STATIC[(Math.random() * STATIC.length) | 0];
        out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      } else {
        const sx = Math.min(FACE.w - 1, Math.max(0, x + tear)), so = (y * FACE.w + sx) * 4;
        out[o] = src[so] * dim; out[o + 1] = src[so + 1] * dim; out[o + 2] = src[so + 2] * dim; out[o + 3] = 255;
      }
    }
  }
  putFace(out);
  if (p >= 1) { shownFace = fizz.to; putFace(faceData[fizz.to]); fizz = null; }
}

function pickMood(not) {
  let total = 0;
  const pool = FACES.map((n, i) => { const w = i === not || !faceData[i] ? 0 : (MOODS[n] || 0); total += w; return w; });
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i++) { r -= pool[i]; if (r < 0) return i; }
  return 0;
}
const faceIndex = (name) => FACES.indexOf(name);

// ---- him ----
let todd = null, bones = {}, rest = {}, height = 4, floorY = 0, centre = new THREE.Vector3(), hipH = 2;
const body = new THREE.Group();   // moves and turns him around the void
scene.add(body);

const loader = new THREE.GLTFLoader();
Promise.all([loadFaces(), new Promise((ok, no) => loader.load('todd.gltf?v=1', ok, undefined, no))])
  .then(([, gltf]) => {
    todd = gltf.scene;
    todd.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;   // skinned: his bounds move with his bones
        const m = o.material, img = m.map && m.map.image;
        if (img) {
          skinCtx.drawImage(img, 0, 0, 256, 256);
          glowCtx.fillStyle = '#000'; glowCtx.fillRect(0, 0, 256, 256);
          skinTex = canvasTex(skin); glowTex = canvasTex(glow);
          m.map = skinTex;
          m.emissiveMap = glowTex; m.emissive = new THREE.Color(0xffffff); m.emissiveIntensity = 0.85;
          m.needsUpdate = true;
        }
      }
      if (o.isBone || o.type === 'Bone') { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
    });
    // keep the face he was made with as his first face if faces.png is missing it
    if (!faceData[0]) faceData[0] = skinCtx.getImageData(FACE.x, FACE.y, FACE.w, FACE.h).data;
    putFace(faceData[0]);

    body.add(todd);
    todd.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(todd);
    height = box.max.y - box.min.y;
    box.getCenter(centre);
    // stand him with his feet on y = 0, centred on the body group
    todd.position.set(-centre.x, -box.min.y, -centre.z);
    floorY = 0; centre.set(0, height / 2, 0);
    todd.updateMatrixWorld(true);
    const hip = new THREE.Vector3();
    if (bones.Right_Leg) { bones.Right_Leg.getWorldPosition(hip); hipH = hip.y; }
    pool.position.y = 0.01;
    pool.scale.setScalar(height * 0.9);
    frame();
    boot.classList.add('gone');
    setTimeout(() => fizzle(pickMood(0)), 1800);
  })
  .catch((e) => { console.warn('[todd] todd.gltf did not load', e); boot.textContent = 'NO SIGNAL'; });

// ---- framing ----
function frame() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // fit his height (or his width on a narrow screen), with room around him
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const fitH = (height * 1.4) / 2 / Math.tan(fov / 2);
  const fitW = (height * 0.9) / 2 / Math.tan(fov / 2) / camera.aspect;
  camera.userData.dist = Math.max(fitH, fitW);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', frame);

// ---- where he looks ----
// yaw: + turns toward the right of the screen. pitch: + looks down. roll: a curious head tilt.
const look = { yaw: 0, pitch: 0, roll: 0, vy: 0, vp: 0, vr: 0 };
const goal = { yaw: 0, pitch: 0, roll: 0 };
const GLANCES = [[0, 0], [0.85, 0.05], [-0.85, 0.05], [0.5, -0.3], [-0.5, -0.3], [0.2, 0.42], [-0.3, 0.38], [0.95, -0.1], [-0.95, -0.1]];
let mode = 'glance', modeUntil = 0, nextGlance = 0, nextMood = 0, nextGlitch = 0, lastNotice = -1e9;
const mouse = { x: 0, y: 0, moved: -1e9 };

function onPoint(cx, cy) {
  mouse.x = (cx / innerWidth) * 2 - 1; mouse.y = -((cy / innerHeight) * 2 - 1);
  const now = performance.now();
  if (mode !== 'watch' && now - mouse.moved > 900 && now - lastNotice > 7000 && Math.random() < 0.6) {
    // he notices you
    mode = 'watch'; lastNotice = now; modeUntil = now + 2500 + Math.random() * 3500;
    stopAndFaceYou(now);
    fizzle(faceIndex('surprised'), 380);
    setTimeout(() => { if (mode === 'watch') fizzle(Math.random() < 0.6 ? faceIndex('sly') : faceIndex('neutral')); }, 1300);
    nextMood = now + 5000;
  }
  mouse.moved = now;
}
window.addEventListener('pointermove', (e) => onPoint(e.clientX, e.clientY));
window.addEventListener('pointerdown', (e) => onPoint(e.clientX, e.clientY));

// the angle from where he's facing to the camera (so he can look at you wherever he's turned)
function towardYou() { return wrap(Math.atan2(camera.position.x - body.position.x, camera.position.z - body.position.z) - walk.heading); }
function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }

function think(now) {
  stroll(now);
  if (mode === 'watch') {
    goal.yaw = THREE.MathUtils.clamp(towardYou() + mouse.x * 0.8, -1.1, 1.1);
    goal.pitch = THREE.MathUtils.clamp(-mouse.y * 0.45 + 0.1, -0.35, 0.45);
    goal.roll = 0;
    if (now > modeUntil || now - mouse.moved > 2600) { mode = 'glance'; nextGlance = now + 400; }
  } else if (now > nextGlance) {
    const g = GLANCES[(Math.random() * GLANCES.length) | 0];
    const busy = walk.state === 'walk' ? 0.45 : 1;   // walking: mostly eyes front
    goal.yaw = (g[0] + (Math.random() - 0.5) * 0.2) * busy; goal.pitch = g[1] * busy + (Math.random() - 0.5) * 0.1;
    goal.roll = Math.random() < 0.25 ? (Math.random() - 0.5) * 0.5 : 0;
    nextGlance = now + 1100 + Math.random() * 2600;
  }
  if (now > nextMood) { if (!fizz) fizzle(pickMood(shownFace)); nextMood = now + 3500 + Math.random() * 5000; }
  if (now > nextGlitch) { if (!fizz && Math.random() < 0.6) glitch(); nextGlitch = now + 2500 + Math.random() * 6000; }
}

function spring(k, d, dt) {
  // a quick, slightly snappy turn: he moves his head like he means it
  look.vy += ((goal.yaw - look.yaw) * k - look.vy * d) * dt; look.yaw += look.vy * dt;
  look.vp += ((goal.pitch - look.pitch) * k - look.vp * d) * dt; look.pitch += look.vp * dt;
  look.vr += ((goal.roll - look.roll) * k * 0.6 - look.vr * d) * dt; look.roll += look.vr * dt;
}

const e = new THREE.Euler(), q = new THREE.Quaternion();
function pose(name, x, y, z) {
  const b = bones[name];
  if (!b) return;
  e.set(x, y, z, 'YXZ'); q.setFromEuler(e);
  b.quaternion.copy(rest[name]).multiply(q);
}

// ---- walking around ----
// stand -> turn (stepping on the spot) -> walk -> stand. Heading 0 faces the camera.
const ROAM = 7;                       // how far from the middle of the void he wanders
const STRIDE = 0.4;                   // how far his legs swing (radians)
const CYCLE = 0.62;                   // steps per second, per leg
const walk = { state: 'stand', until: 0, heading: 0, aim: 0, to: new THREE.Vector2(), amp: 0, phase: 0, then: 'walk' };
const prints = [];
const printMat = new THREE.MeshBasicMaterial({ map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
function footprint(foot) {
  const b = bones[foot];
  if (!b) return;
  const p = new THREE.Vector3(); b.getWorldPosition(p);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), printMat.clone());
  m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.008, p.z); m.scale.setScalar(height * 0.16);
  m.userData.born = performance.now();
  scene.add(m); prints.push(m);
}
function fadePrints(now) {
  for (let i = prints.length - 1; i >= 0; i--) {
    const m = prints[i], age = (now - m.userData.born) / 5000;
    if (age >= 1) { scene.remove(m); m.geometry.dispose(); m.material.dispose(); prints.splice(i, 1); }
    else m.material.opacity = 0.8 * (1 - age);
  }
}
function stopAndFaceYou(now) {
  walk.aim = wrap(walk.heading + towardYou());
  walk.state = Math.abs(towardYou()) > 0.5 ? 'turn' : 'stand';
  walk.then = 'stand';
  walk.until = now + 3000 + Math.random() * 3000;
}
function stroll(now) {
  if (walk.state === 'stand' && now > walk.until && mode !== 'watch') {
    // somewhere else in the void, not too close
    const here = new THREE.Vector2(body.position.x, body.position.z);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * ROAM;
      walk.to.set(Math.cos(a) * r, Math.sin(a) * r);
      if (walk.to.distanceTo(here) > height * 0.8) break;
    }
    walk.aim = Math.atan2(walk.to.x - here.x, walk.to.y - here.y);
    walk.state = 'turn'; walk.then = 'walk';
  }
}
// one step on the spot: lift (hip up, knee bends), turn by "by" while the foot's in the air, plant
const SHUFFLE_TIME = 0.5;   // seconds per step
const shuffle = { on: false, s: 0, side: 'R', from: 0, by: 0, next: 0, lift: 0 };
function startShuffle(by, side) {
  Object.assign(shuffle, { on: true, s: 0, side, from: walk.heading, by });
}
function stepShuffle(now, dt) {
  if (!shuffle.on) { shuffle.lift = 0; return; }
  shuffle.s = Math.min(1, shuffle.s + dt / SHUFFLE_TIME);
  const s = shuffle.s;
  shuffle.lift = Math.sin(Math.PI * Math.min(1, s * 1.08)) ** 0.7;   // up quick, a stiff hang, down
  const turn = s < 0.15 ? 0 : s > 0.85 ? 1 : (1 - Math.cos(Math.PI * (s - 0.15) / 0.7)) / 2;
  walk.heading = shuffle.from + shuffle.by * turn;
  if (s >= 1) {
    shuffle.on = false; shuffle.lift = 0;
    step(shuffle.side === 'R' ? 'foot_R' : 'foot_L', now);   // the thud of it landing
  }
}
let lastPhase = 0;
function move(now, dt) {
  const fwd = Math.PI * 2 * CYCLE;
  if (walk.state === 'turn') {
    // turns in real steps: lift a leg, pivot part of the way while it's up, plant it, then the other
    const d = wrap(walk.aim - walk.heading);
    if (!shuffle.on) {
      if (Math.abs(d) < 0.03) { walk.state = walk.then; if (walk.state === 'stand') walk.until = Math.max(walk.until, now + 2000); }
      // lead with the leg on the side he's turning toward
      else startShuffle(Math.sign(d) * Math.min(Math.abs(d), 0.55), d > 0 ? 'L' : 'R');
    }
  } else if (walk.state === 'stand' && !shuffle.on && now > shuffle.next) {
    // standing still, he shifts his footing now and then
    if (Math.random() < 0.5) startShuffle((Math.random() - 0.5) * 0.16, shuffle.side === 'R' ? 'L' : 'R');
    shuffle.next = now + 3500 + Math.random() * 5000;
  } else if (walk.state === 'walk') {
    const dx = walk.to.x - body.position.x, dz = walk.to.y - body.position.z, dist = Math.hypot(dx, dz);
    walk.heading += wrap(Math.atan2(dx, dz) - walk.heading) * Math.min(1, dt * 2);
    if (dist < 0.25 || mode === 'watch') { walk.state = 'stand'; walk.until = now + 3000 + Math.random() * 6000; }
  }
  stepShuffle(now, dt);
  const want = walk.state === 'walk' ? 1 : 0;
  walk.amp += (want - walk.amp) * Math.min(1, dt * (want ? 3 : 5));
  if (walk.amp > 0.01 || Math.sin(walk.phase) ** 2 > 0.01) walk.phase += fwd * dt * Math.max(walk.amp, 0.3);
  else walk.phase = Math.round(walk.phase / Math.PI) * Math.PI;   // settle with his feet together
  // how far a swing of the legs carries him, so his feet don't skate
  const speed = walk.state === 'walk' ? 4 * hipH * Math.sin(STRIDE) * CYCLE * walk.amp : 0;
  body.position.x += Math.sin(walk.heading) * speed * dt;
  body.position.z += Math.cos(walk.heading) * speed * dt;
  body.rotation.y = walk.heading;
  // a footfall each time a leg reaches the front of its swing
  const a = walk.phase % (Math.PI * 2), b = lastPhase % (Math.PI * 2);
  if (walk.amp > 0.25 && now - (walk.lastStep || 0) > 200) {
    if (b < Math.PI / 2 && a >= Math.PI / 2) step('foot_R', now);
    if (b < Math.PI * 1.5 && a >= Math.PI * 1.5) step('foot_L', now);
  }
  lastPhase = walk.phase;
  pool.position.x = body.position.x; pool.position.z = body.position.z;
}
function step(foot, now) {
  walk.lastStep = now;
  footprint(foot);
  // the jolt of a heavy foot coming down
  if (servos.upX) servos.upX.v += 0.5 * walk.amp;
  if (servos.chZ) servos.chZ.v += (foot === 'foot_R' ? 0.3 : -0.3) * walk.amp;
}
function bump(p, at, w) { const d = wrap(p - at) / w; return Math.exp(-d * d); }
function legs() {
  const A = STRIDE * walk.amp, ph = walk.phase;
  const leg = (side, p) => {
    const up = shuffle.side === side ? shuffle.lift : 0;    // stepping on the spot: this leg lifts
    const hip = -A * Math.sin(p) - up * 0.5;               // - swings forward
    const knee = A * 1.5 * Math.max(0, Math.cos(p)) + up * 0.95;   // bends while the leg swings through
    pose(side === 'R' ? 'Right_Leg' : 'Left_Leg', hip, 0, 0);
    pose('lowerleg_' + side, knee, 0, 0);
    // the foot rolls through each step: heel lands toes-up, rolls flat, then the heel lifts
    // and the toes bend as it pushes off; in the air it hangs a little, then flicks up to land
    const k = walk.amp;
    const strike = bump(p, Math.PI / 2, 0.42), push = bump(p, Math.PI * 1.5 - 0.3, 0.42), air = bump(p, 0, 0.6);
    const foot = -(hip + knee) * 0.9 - 0.6 * strike * k + 1.0 * push * k + 0.3 * air * k + up * 0.2;
    pose('foot_' + side, foot, 0, 0);
    pose('toe_' + side, -1.1 * push * k + 0.25 * strike * k, 0, 0);   // toes stay on the ground as the heel comes up
    return hip;
  };
  const hr = leg('R', ph), hl = leg('L', ph + Math.PI);
  // the body dips while the legs are spread, so his feet stay on the ground
  // (a lifted leg on the spot doesn't count: the other one's holding him up)
  const lifted = shuffle.lift * 0.5;
  const sr = shuffle.side === 'R' ? Math.abs(hr) - lifted : Math.abs(hr), sl = shuffle.side === 'L' ? Math.abs(hl) - lifted : Math.abs(hl);
  body.position.y = -hipH * (1 - Math.cos(Math.max(0, sr, sl)));
  // he leans his weight over the planted foot while the other is up
  shuffle.lean = (shuffle.side === 'R' ? 1 : -1) * shuffle.lift;
  return ph;
}

// ---- balance: his body keeps itself upright under that head, like a robot ----
// Each joint is a servo: it gets a new target only every so often, rounded to small steps,
// and snaps to it a little too hard (overshoot, then settle). The targets lean against
// whatever the head is doing: tilt the head and the torso tilts back the other way;
// whip it around and the arms come out to steady him; look down and he rocks back.
const SERVO_STEP = 0.018;
const servos = {};
function servo(name, target, now, dt, every) {
  let s = servos[name];
  if (!s) s = servos[name] = { x: target, v: 0, aim: target, next: 0 };
  if (now >= s.next) {
    s.aim = Math.round(target / SERVO_STEP) * SERVO_STEP;
    s.next = now + (every || 170) * (0.7 + Math.random() * 0.6);
  }
  const k = reduce ? 60 : 260, d = reduce ? 16 : 15;   // stiff and a little underdamped
  s.v += ((s.aim - s.x) * k - s.v * d) * dt; s.x += s.v * dt;
  return s.x;
}
let shift = 0, shiftGoal = 0, nextShift = 0;
function balance(now, dt, t) {
  const S = (n, v, every) => servo(n, v, now, dt, every);
  const speed = Math.min(1, Math.abs(look.vy) * 0.25 + Math.abs(look.vp) * 0.3 + Math.abs(look.vr) * 0.2);
  // now and then he shifts his weight from one side to the other
  if (now > nextShift) { shiftGoal = (Math.random() - 0.5) * 0.09; nextShift = now + 2500 + Math.random() * 4000; }
  shift += (shiftGoal - shift) * Math.min(1, dt * 1.5);
  const breathe = Math.sin(t * 1.7);

  const lean = -look.roll * 0.45 - look.vy * 0.012 + shift + (shuffle.lean || 0) * 0.06;   // torso tilts against the head
  const rock = -look.pitch * 0.2 - look.vp * 0.015 + walk.amp * 0.07;  // looks down: rocks back; walking: leans in
  pose('neck', look.pitch * 0.35, look.yaw * 0.4, look.roll * 0.3);
  pose('fat_fucking_dome', look.pitch * 0.65, look.yaw * 0.6, look.roll * 0.7);
  pose('hips', 0, S('hipsY', -look.yaw * 0.05), S('hipsZ', -lean * 0.45 - shift * 0.6 - (shuffle.lean || 0) * 0.07, 140));
  pose('upper_body', S('upX', rock * 0.6), S('upY', look.yaw * 0.07), S('upZ', lean * 0.7));
  pose('chest', S('chX', rock * 0.5) + breathe * 0.01, S('chY', look.yaw * 0.1), S('chZ', lean * 0.5));

  // arms: hang against the lean like pendulums, and come out to steady him when he moves fast
  const out = 0.04 + speed * 0.32 + Math.abs(lean) * 0.6;
  const gait = STRIDE * walk.amp * 0.7 * Math.sin(walk.phase);   // arms swing against the legs
  const swing = -rock * 1.1;
  pose('Right_Arm', S('raX', swing + gait + speed * -0.12, 110), S('raY', look.yaw * -0.1), S('raZ', -lean * 0.9 + out - 0.07, 150));
  pose('Left_Arm', S('laX', swing - gait + speed * -0.12, 110), S('laY', look.yaw * -0.1), S('laZ', -lean * 0.9 - out + 0.07, 150));
  // elbows bend a little more the harder he's working to stay up
  const bend = -(0.06 + speed * 0.5 + Math.abs(lean) * 0.5);
  pose('forearm_R', S('frX', bend + Math.max(0, lean) * -0.4, 200), 0, 0);
  pose('forearm_L', S('flX', bend + Math.max(0, -lean) * -0.4, 200), 0, 0);
}

// ---- every frame ----
let then = performance.now();
const follow = { x: 0, z: 0 }, pan = { x: 0, z: 0 };
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - then) / 1000); then = now;
  const t = now / 1000;
  if (todd) {
    think(now);
    spring(reduce ? 18 : 60, reduce ? 9 : 13, dt);
    move(now, dt);
    legs();
    balance(now, dt, t);
    fadePrints(now);
    fizzStep(now);
    // the camera sways a little, so the void doesn't feel like a photo
    const d = camera.userData.dist || 10, aimY = floorY + height * 0.5;
    // the camera lags behind him like someone operating it: it turns to keep him in view first,
    // and only drifts after him once he's wandered a fair way off (then takes its time catching up)
    const ox = body.position.x - follow.x, oz = body.position.z - follow.z, off = Math.hypot(ox, oz);
    const slack = height * 0.45;
    if (off > slack) {
      const pull = (off - slack) / off * Math.min(1, dt * 0.55);
      follow.x += ox * pull; follow.z += oz * pull;
    }
    pan.x += (body.position.x - pan.x) * Math.min(1, dt * 1.6);
    pan.z += (body.position.z - pan.z) * Math.min(1, dt * 1.6);
    camera.position.set(follow.x + Math.sin(t * 0.21) * d * 0.06, aimY + height * 0.08 + Math.sin(t * 0.17) * height * 0.03, follow.z + d);
    camera.lookAt(follow.x + (pan.x - follow.x) * 0.75, aimY, follow.z + (pan.z - follow.z) * 0.75);
  }
  // dust drifts up and around
  const p = dustGeo.attributes.position.array;
  for (let i = 0; i < DUST; i++) {
    p[i * 3 + 1] += dt * 0.05 * (0.5 + (dustSeed[i] % 1));
    p[i * 3] += Math.sin(t * 0.3 + dustSeed[i]) * dt * 0.03;
    if (p[i * 3 + 1] > 7) p[i * 3 + 1] = 0;
  }
  dustGeo.attributes.position.needsUpdate = true;
  renderer.render(scene, camera);
}
requestAnimationFrame(tick);

// a peek for testing in the console: TODD.face('angry')
window.TODD = { face: (n) => fizzle(typeof n === 'number' ? n : faceIndex(n)), faces: FACES, screen: skin, goal, look, walk, body, shuffle };
