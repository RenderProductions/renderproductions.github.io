// TODD, standing in the void, looking around.
// The model is todd.gltf (Blockbench). His face is a little screen on his texture: an 18 x 14 patch
// at x 1, y 145 of the 256 x 256 texture. faces.png holds his expressions, 18 x 14 pixels each,
// side by side in the order of FACES below (the first one is the face the model was made with).
// Every so often the screen fizzles with static and comes back as a different face.
//
// He wanders the void: picks a spot, turns toward it, walks there (leaving footprints that fade), stops,
// looks around. Move the cursor (or touch) and now and then he notices: he stops, turns to face you and
// watches the cursor until he gets bored.
//
// He grows aware of you over visits (counted in "rvToddVisits"): he notices sooner, watches longer,
// his faces sour, and from the 4th visit he walks toward the camera when he notices you.
// Lines of TODD.OS (terminal.json) flicker into the void now and then.
// And at random (more often the more aware he is) he has a tantrum: his screen and the void go red,
// he turns on the camera and charges it with his arms flailing, terminal text going wild, until he
// hits the screen in a burst of static. Try it in the console: TODD.rage()
//
// The floor is a grid that only lights up around him (and ripples where his feet land). Old monitors,
// a chair and a dead PC lie around the edges of the void; now and then he goes and stares at one.
// Between midnight and 5 AM (your time) he's asleep, sitting on the floor; poke him to wake him. TODD.sleep()
import * as THREE from './vendor/three-gltf.min.js';

const FACES = ['smile', 'neutral', 'happy', 'angry', 'surprised', 'sly', 'sad', 'error', 'loading', 'agony', 'sleep'];
// 'agony' isn't in faces.png: it's agony.jpg, a full 1024 x 1024 picture shown on a panel laid over his
// screen (the screen itself is far too small for it). It flashes up rarely, after he hits the screen in a
// tantrum, and if you ask him whether it hurts. Swap agony.jpg for any square picture to change it.
const AGONY_SRC = 'agony.jpg?v=1';
const AGONY_ZOOM = 0.8;   // how much of the picture's width fills the screen (1 = all of it)
// how often each face comes up on its own (higher = more often)
const MOODS = { smile: 5, neutral: 6, happy: 2, angry: 1.5, surprised: 0, sly: 3, sad: 1.5, error: 0.6, loading: 0.6, agony: 0, sleep: 0 };
const FACE = { x: 1, y: 145, w: 18, h: 14 };

// how aware of you he is: 0 on a first visit, up to 4 (visits 1, 2-3, 4-5, 6-7, 8+)
let visits = 1;
try { visits = (+localStorage.getItem('rvToddVisits') || 0) + 1; localStorage.setItem('rvToddVisits', String(visits)); } catch (e) {}
let level = Math.min(4, Math.floor((visits - 1) / 2));
function moodWeight(n) {
  const L = level, w = MOODS[n] || 0;
  if (n === 'smile' || n === 'happy') return w * Math.max(0.15, 1 - 0.2 * L);
  if (n === 'angry') return w + 0.7 * L;
  if (n === 'error') return w + 0.35 * L;
  if (n === 'sly') return w + 0.5 * L;
  return w;
}
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
  r.addColorStop(0, 'rgba(255,255,255,.55)'); r.addColorStop(0.4, 'rgba(255,255,255,.16)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
  new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x00fffa, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
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
// FACE is in the texture's original 256 x 256 units; the texture itself can be bigger (it's 1024 now),
// so the 18 x 14 face is drawn up to size, crisp, with TEX_SCALE.
let TEX_SCALE = 1;
const facePix = document.createElement('canvas'); facePix.width = FACE.w; facePix.height = FACE.h;
const facePixCtx = facePix.getContext('2d');

function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; t.encoding = THREE.sRGBEncoding;
  t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}
let lastFace = null, rageAmt = 0;
const RED = [255, 34, 46];
function putFace(pixels) {
  lastFace = pixels;
  faceImg.data.set(pixels);
  if (rageAmt > 0.02) {
    // his screen goes red: the cyan of it turns red, the white stays white
    const d = faceImg.data;
    for (let i = 0; i < d.length; i += 4) {
      const cyanish = d[i + 1] > 120 && d[i + 2] > 120 && d[i] < d[i + 1] - 60;
      if (!cyanish) continue;
      const k = rageAmt * (d[i + 1] / 255);
      d[i] = d[i] + (RED[0] - d[i]) * k; d[i + 1] = d[i + 1] + (RED[1] - d[i + 1]) * k; d[i + 2] = d[i + 2] + (RED[2] - d[i + 2]) * k;
    }
  }
  facePixCtx.putImageData(faceImg, 0, 0);
  faceTex.needsUpdate = true;   // only this tiny 18 x 14 texture changes; his big outfit texture never does
}
// his face lives on its own little panel laid over the monitor (built in buildScreen), so changing
// faces only re-sends 18 x 14 pixels to the graphics card instead of his whole 1024 x 1024 texture
const faceTex = new THREE.CanvasTexture(facePix);
faceTex.encoding = THREE.sRGBEncoding; faceTex.magFilter = faceTex.minFilter = THREE.NearestFilter; faceTex.generateMipmaps = false;
let screenPanel = null;
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
  }).then(() => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      agonyImg = img;
      // squeezed down to the screen's 18 x 14, cropped to its shape: a blur of the face, for the fizzle
      const c = document.createElement('canvas'); c.width = FACE.w; c.height = FACE.h;
      const g = c.getContext('2d', { willReadFrequently: true }), sw = img.width * AGONY_ZOOM, sh = sw * FACE.h / FACE.w;
      g.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, FACE.w, FACE.h);
      faceData[faceIndex('agony')] = g.getImageData(0, 0, FACE.w, FACE.h).data;
      ok();
    };
    img.onerror = () => { console.warn('[todd] agony.jpg did not load'); ok(); };
    img.src = AGONY_SRC;
  }));
}
let agonyImg = null, agonyPanel = null;
// asleep: a dark screen with a little standby light (and now and then a 'z'), made here rather than in faces.png
function sleepFace(led, z) {
  const d = new Uint8ClampedArray(FACE.w * FACE.h * 4);
  for (let i = 0; i < d.length; i += 4) { d[i] = 3; d[i + 1] = 22; d[i + 2] = 24; d[i + 3] = 255; }
  const px = (x, y, c) => { const o = (y * FACE.w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; };
  if (led) { px(15, 11, [0, 200, 196]); px(16, 11, [0, 200, 196]); }
  if (z) [[2, 2], [3, 2], [4, 2], [4, 3], [3, 4], [2, 5], [3, 5], [4, 5]].forEach(([x, y]) => px(x + z - 1, y, [0, 120, 118]));
  return d;
}
const SLEEP_FACES = [sleepFace(true, 0), sleepFace(false, 0), sleepFace(true, 1), sleepFace(true, 6)];

// ---- the fizzle: tearing, static, then the new face settling in ----
let fizz = null;   // { from, to, t0, dur }
const RAGE_FACES = ['angry', 'error', 'agony'];   // the only faces he'll show in a tantrum
function fizzle(to, dur) {
  // mid-tantrum, anything else that tries to change his face gets angry instead
  if (typeof rage !== 'undefined' && rage.on && RAGE_FACES.indexOf(FACES[to]) < 0) to = faceIndex('angry');
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
  const pool = FACES.map((n, i) => { const w = i === not || !faceData[i] ? 0 : moodWeight(n); total += w; return w; });
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
Promise.all([loadFaces(), new Promise((ok, no) => loader.load('todd.gltf?v=2', ok, undefined, no))])
  .then(([, gltf]) => {
    todd = gltf.scene;
    todd.traverse((o) => {
      if (o.isMesh) {
        o.frustumCulled = false;   // skinned: his bounds move with his bones
        const m = o.material, img = m.map && m.map.image;
        if (img) {
          TEX_SCALE = Math.max(1, Math.round((img.width || 256) / 256));
          skin.width = skin.height = 256 * TEX_SCALE;
          skinCtx.imageSmoothingEnabled = false;
          skinCtx.drawImage(img, 0, 0, skin.width, skin.height);
          skinTex = canvasTex(skin);
          m.map = skinTex;
          m.emissiveMap = null; m.emissive = new THREE.Color(0x000000);
          m.needsUpdate = true;
        }
      }
      if (o.isBone || o.type === 'Bone') { bones[o.name] = o; rest[o.name] = o.quaternion.clone(); }
    });
    faceData[faceIndex('sleep')] = SLEEP_FACES[0];
    // keep the face he was made with as his first face if faces.png is missing it
    if (!faceData[0]) {
      facePixCtx.drawImage(skin, FACE.x * TEX_SCALE, FACE.y * TEX_SCALE, FACE.w * TEX_SCALE, FACE.h * TEX_SCALE, 0, 0, FACE.w, FACE.h);
      faceData[0] = facePixCtx.getImageData(0, 0, FACE.w, FACE.h).data;
    }
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
    buildAgonyPanel();
    buildDebris();
    if (isNight()) fallAsleep(performance.now(), true);
    frame();
    boot.classList.add('gone');
    setTimeout(() => { if (!rage.on) fizzle(pickMood(0)); }, 1800);
  })
  .catch((e) => { console.warn('[todd] todd.gltf did not load', e); boot.textContent = 'NO SIGNAL'; });

// ---- his screen: a face panel and the agony panel, laid exactly over the monitor's screen ----
function buildAgonyPanel() {
  const head = bones.fat_fucking_dome;
  let mesh = null;
  todd.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!head || !mesh) return;
  // find the screen: the vertices whose texture coordinates are the face patch, at the very front
  const uv = mesh.geometry.attributes.uv, pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
  const pts = [];
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i) * 256, w = uv.getY(i) * 256;
    if (u < FACE.x - 0.5 || u > FACE.x + FACE.w + 0.5 || w < FACE.y - 0.5 || w > FACE.y + FACE.h + 0.5) continue;
    mesh.boneTransform(i, v.fromBufferAttribute(pos, i)); mesh.localToWorld(v);
    pts.push(v.clone());
  }
  if (pts.length < 4) return;
  const front = Math.max(...pts.map((p) => p.z));
  const face = pts.filter((p) => p.z > front - 0.002);
  const box = new THREE.Box3().setFromPoints(face), size = new THREE.Vector3(), mid = new THREE.Vector3();
  box.getSize(size); box.getCenter(mid);
  const q = new THREE.Quaternion(); head.getWorldQuaternion(q); q.invert();
  // the face panel: always there, glowing (unlit), showing whatever face he's making
  screenPanel = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y),
    new THREE.MeshBasicMaterial({ map: faceTex, fog: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  screenPanel.position.copy(head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0, 0.003))));
  screenPanel.quaternion.copy(q); screenPanel.renderOrder = 1;
  head.add(screenPanel);
  // and darken the screen patch on the body texture underneath, once
  skinCtx.fillStyle = '#041012'; skinCtx.fillRect(FACE.x * TEX_SCALE, FACE.y * TEX_SCALE, FACE.w * TEX_SCALE, FACE.h * TEX_SCALE);
  if (skinTex) skinTex.needsUpdate = true;
  if (!agonyImg) return;
  const tex = new THREE.Texture(agonyImg);
  tex.encoding = THREE.sRGBEncoding; tex.needsUpdate = true;
  // crop the square picture to the screen's shape
  const keep = Math.min(1, (size.y / size.x)) * AGONY_ZOOM;
  tex.repeat.set(AGONY_ZOOM, keep); tex.offset.set((1 - AGONY_ZOOM) / 2, (1 - keep) / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, fog: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  agonyPanel = new THREE.Mesh(new THREE.PlaneGeometry(size.x * 0.97, size.y * 0.97), mat);
  agonyPanel.position.copy(head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0, 0.006))));
  agonyPanel.quaternion.copy(q);
  agonyPanel.renderOrder = 2;
  head.add(agonyPanel);
}
function agonyStep(now) {
  if (!agonyPanel) return;
  const A = faceIndex('agony');
  let want = 0;
  if (shownFace === A && !fizz) want = 1;
  else if (fizz && fizz.to === A) want = Math.max(0, ((now - fizz.t0) / fizz.dur - 0.55) / 0.45);   // fades in out of the static
  // an old screen: it flickers, drops out for a frame now and then, and the picture slips sideways
  const flick = Math.random() < 0.04 ? 0.15 : 0.82 + Math.random() * 0.18;
  agonyPanel.material.opacity = want * flick;
  agonyPanel.visible = want > 0.01;
  if (want > 0) agonyPanel.material.map.offset.x = Math.random() < 0.08 ? (Math.random() - 0.5) * 0.06 : 0;
}
let nextAgony = performance.now() + 60000 + Math.random() * 120000;
function agonyFlash(ms, gentle) {
  if (!agonyPanel || (gentle && fizz)) return;   // a random flash waits its turn; asked-for ones cut in
  if (fizz) { shownFace = fizz.to; fizz = null; }
  const back = shownFace;
  fizzle(faceIndex('agony'), 420);
  setTimeout(() => { if (FACES[shownFace] === 'agony') fizzle(rage.on ? faceIndex('error') : (back === faceIndex('agony') ? 0 : back), 380); }, (ms || 1500) + 420);
}

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
  if (mode !== 'watch' && !rage.on && !sleep.on && !sleep.waking && now - mouse.moved > 900 && now - lastNotice > 8000 - 1300 * level && Math.random() < 0.45 + 0.12 * level) {
    // he notices you (sooner, and for longer, the more aware of you he is)
    mode = 'watch'; lastNotice = now; modeUntil = now + (2500 + Math.random() * 3500) * (1 + 0.35 * level);
    stopAndFaceYou(now);
    // and TODD.OS says so
    say(pick(level >= 1 && LINES.notice_aware.length ? LINES.notice_aware : (LINES.notice.length ? LINES.notice : LINES.idle)));
    nextLine = Math.max(nextLine, now + 5000);
    fizzle(faceIndex('surprised'), 380);
    setTimeout(() => { if (mode === 'watch' && !rage.on) fizzle(Math.random() < 0.4 + 0.12 * level ? faceIndex('sly') : faceIndex(level >= 3 ? 'angry' : 'neutral')); }, 1300);
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
  if (sleep.on || sleep.waking) return sleepThink(now);
  if (rage.on) return rageThink(now);
  if (bc.on) return broadcastThink(now);
  if (now > rage.next) return startRage(now);
  if (now > bc.next && !reach.on) return startBroadcast(now);
  if (now > echo.next && !reach.on) wonderEcho(now);
  stroll(now);
  reachThink(now);
  if (mode === 'watch') {
    if (!reach.on) approach(now);
    goal.yaw = THREE.MathUtils.clamp(towardYou() + mouse.x * 0.8, -1.1, 1.1);
    goal.pitch = THREE.MathUtils.clamp(-mouse.y * 0.45 + 0.1 - orbit.pitch * 0.7, -0.6, 0.45);   // and up at you, if you're above him
    if (reach.on) { goal.yaw = THREE.MathUtils.clamp(towardYou(), -0.6, 0.6); goal.pitch = -0.75; }   // head right back, looking up at you
    goal.roll = 0;
    if (!reach.on && (now > modeUntil || now - mouse.moved > 2600 + 800 * level)) { mode = 'glance'; nextGlance = now + 400; walk.approach = false; }
  } else if (now > nextGlance) {
    const g = GLANCES[(Math.random() * GLANCES.length) | 0];
    const busy = walk.state === 'walk' ? 0.45 : 1;   // walking: mostly eyes front
    goal.yaw = (g[0] + (Math.random() - 0.5) * 0.2) * busy; goal.pitch = g[1] * busy + (Math.random() - 0.5) * 0.1;
    goal.roll = Math.random() < 0.25 ? (Math.random() - 0.5) * 0.5 : 0;
    nextGlance = now + 1100 + Math.random() * 2600;
  }
  if (now > nextMood) { if (!fizz) fizzle(pickMood(shownFace)); nextMood = now + 3500 + Math.random() * 5000; }
  if (now > nextGlitch) { if (!fizz && Math.random() < 0.6) glitch(); nextGlitch = now + 2500 + Math.random() * 6000; }
  if (now > nextAgony) { agonyFlash(1100 + Math.random() * 1200, true); nextAgony = now + (90000 + Math.random() * 150000) / (1 + 0.5 * level); }
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
const walk = { state: 'stand', until: 0, heading: 0, aim: 0, to: new THREE.Vector2(), amp: 0, phase: 0, then: 'walk', pace: 1, approach: false, stopAt: 0, visit: null };
const prints = [];
const printMat = new THREE.MeshBasicMaterial({ map: glowTexture(), color: 0x00fffa, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
function footprint(foot) {
  const b = bones[foot];
  if (!b) return;
  const p = new THREE.Vector3(); b.getWorldPosition(p);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), printMat.clone());
  m.material.color.copy(tint);
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
    walk.visit = null;
    if (debris.length && Math.random() < 0.3) {
      // go and look at one of the old things lying in the dark
      const dbr = debris[(Math.random() * debris.length) | 0], dx = dbr.x - here.x, dz = dbr.z - here.y, dd = Math.hypot(dx, dz) || 1;
      walk.to.set(dbr.x - dx / dd * height * 0.42, dbr.z - dz / dd * height * 0.42);
      walk.visit = dbr;
    }
    walk.aim = Math.atan2(walk.to.x - here.x, walk.to.y - here.y);
    walk.state = 'turn'; walk.then = 'walk';
  }
  // arrived at a piece of debris: stand and stare down at it for a while
  if (walk.visit && walk.state === 'stand' && mode !== 'watch') {
    const v = walk.visit;
    if (!v.staring) {
      v.staring = now; walk.until = now + 5000 + Math.random() * 3000;
      if (LINES.debris && LINES.debris.length) say(pick(LINES.debris));
      if (Math.random() < 0.5) fizzle(faceIndex(Math.random() < 0.5 ? 'sad' : 'neutral'));
    }
    const a = wrap(Math.atan2(v.x - body.position.x, v.z - body.position.z) - walk.heading);
    goal.yaw = THREE.MathUtils.clamp(a, -1, 1); goal.pitch = 0.45; goal.roll = 0.12 * Math.sin(now / 1700);
    nextGlance = now + 500;
    if (now > walk.until - 100) { v.staring = 0; walk.visit = null; }
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
  shuffle.s = Math.min(1, shuffle.s + dt / (SHUFFLE_TIME / (rage.on ? 2.4 : 1)));
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
  if (Math.abs(shove.x) + Math.abs(shove.z) > 0.001) {
    body.position.x += shove.x * dt; body.position.z += shove.z * dt;
    const k = Math.exp(-dt * 7); shove.x *= k; shove.z *= k;
  }
  const fwd = Math.PI * 2 * CYCLE * walk.pace;
  if (walk.state === 'turn') {
    // turns in real steps: lift a leg, pivot part of the way while it's up, plant it, then the other
    const d = wrap(walk.aim - walk.heading);
    if (!shuffle.on) {
      if (Math.abs(d) < 0.03 && walk.spin > 0) { walk.spin--; walk.aim = wrap(walk.heading + Math.PI); }
      else if (Math.abs(d) < 0.03) { walk.state = walk.then; if (walk.state === 'stand') walk.until = Math.max(walk.until, now + 2000); }
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
    if (dist < 0.25 || (mode === 'watch' && !walk.approach) || (walk.stopAt && dist < walk.stopAt)) {
      walk.state = 'stand'; walk.until = now + 3000 + Math.random() * 6000; walk.approach = false; walk.stopAt = 0;
    }
  }
  stepShuffle(now, dt);
  const want = walk.state === 'walk' ? 1 : 0;
  walk.amp += (want - walk.amp) * Math.min(1, dt * (want ? 3 : 5));
  if (walk.amp > 0.01 || Math.sin(walk.phase) ** 2 > 0.01) walk.phase += fwd * dt * Math.max(walk.amp, 0.3);
  else walk.phase = Math.round(walk.phase / Math.PI) * Math.PI;   // settle with his feet together
  // how far a swing of the legs carries him, so his feet don't skate
  const stride = STRIDE * (walk.pace > 1 ? 1.45 : 1);
  const speed = walk.state === 'walk' ? 4 * hipH * Math.sin(stride) * CYCLE * walk.pace * walk.amp : 0;
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
  grid.material.uniforms.uCenter.value.set(body.position.x, body.position.z);
  grid.position.x = body.position.x; grid.position.z = body.position.z;
}
function step(foot, now) {
  walk.lastStep = now;
  footprint(foot);
  const fp = new THREE.Vector3(); if (bones[foot]) { bones[foot].getWorldPosition(fp); ripple(fp.x, fp.z, now); }
  // the jolt of a heavy foot coming down
  if (servos.upX) servos.upX.v += 0.5 * walk.amp * walk.pace;
  if (servos.chZ) servos.chZ.v += (foot === 'foot_R' ? 0.3 : -0.3) * walk.amp;
}
function bump(p, at, w) { const d = wrap(p - at) / w; return Math.exp(-d * d); }
function legs() {
  const A = STRIDE * (walk.pace > 1 ? 1.45 : 1) * walk.amp, ph = walk.phase;
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
    const foot = -(hip + knee) * 0.96 - 0.6 * strike * k + 0.62 * push * k + 0.2 * air * k + up * 0.2;
    pose('foot_' + side, foot, 0, 0);
    // (on this rig + tips the toes down, - lifts them) toes stay flat as the heel comes up, and lift as the heel lands
    pose('toe_' + side, -0.62 * push * k - 0.3 * strike * k, 0, 0);
    return hip;
  };
  const hr = leg('R', ph), hl = leg('L', ph + Math.PI);
  // the body dips while the legs are spread, so his feet stay on the ground
  // (a lifted leg on the spot doesn't count: the other one's holding him up)
  const lifted = shuffle.lift * 0.5;
  const sr = shuffle.side === 'R' ? Math.abs(hr) - lifted : Math.abs(hr), sl = shuffle.side === 'L' ? Math.abs(hl) - lifted : Math.abs(hl);
  body.position.y = -hipH * (1 - Math.cos(Math.max(0, sr, sl))) + reach.amt * height * 0.025;
  if (reach.amt > 0.01) ['R', 'L'].forEach((side) => { pose('foot_' + side, 0.45 * reach.amt, 0, 0); pose('toe_' + side, -0.45 * reach.amt, 0, 0); });   // up on his toes
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
  const gait = STRIDE * walk.amp * 0.9 * Math.sin(walk.phase);   // arms swing against the legs
  const swing = -rock * 1.1;
  // reaching up for you: arms up and forward toward the camera, trembling at full stretch
  const ra = reach.amt, tremble = (Math.sin(t * 23) * 0.03 + (Math.random() - 0.5) * 0.03) * ra;
  const mix = (a, b) => a * (1 - ra) + b * ra;
  pose('Right_Arm', mix(S('raX', swing + gait + speed * -0.12, 110), -2.55 + tremble), S('raY', look.yaw * -0.1), mix(S('raZ', -lean * 0.9 + out - 0.07, 150), 0.18 + tremble));
  pose('Left_Arm', mix(S('laX', swing - gait + speed * -0.12, 110), -2.45 - tremble), S('laY', look.yaw * -0.1), mix(S('laZ', -lean * 0.9 - out + 0.07, 150), -0.18 - tremble));
  if (rage.frenzy > 0.01) frenzy(t, rage.frenzy);
  // elbows bend a little more the harder he's working to stay up
  const bend = -(0.06 + speed * 0.5 + Math.abs(lean) * 0.5);
  // walking: elbows stay bent, and bend further as each arm swings forward (and he runs with them tucked)
  const w = walk.amp * (walk.pace > 1 ? 1.4 : 1), sw = Math.sin(walk.phase);
  const elbowR = -w * (0.38 + 0.4 * Math.max(0, -sw)), elbowL = -w * (0.38 + 0.4 * Math.max(0, sw));
  pose('forearm_R', S('frX', bend + Math.max(0, lean) * -0.4 + elbowR, 90) * (1 - ra) - 0.12 * ra, 0, 0);
  pose('forearm_L', S('flX', bend + Math.max(0, -lean) * -0.4 + elbowL, 90) * (1 - ra) - 0.12 * ra, 0, 0);
  if (rage.frenzy > 0.01) frenzyForearms(t, rage.frenzy);
}
// a tantrum: arms windmilling and slamming about, body shaking
function frenzy(t, k) {
  const j = () => (Math.random() - 0.5) * 0.25 * k;
  pose('Right_Arm', Math.sin(t * 13) * 1.4 * k + j(), 0, (0.45 + Math.sin(t * 9.3) * 0.55) * k + j());
  pose('Left_Arm', Math.sin(t * 13 + 2.6) * 1.4 * k + j(), 0, -(0.45 + Math.sin(t * 8.1 + 1) * 0.55) * k + j());
  pose('chest', j() * 1.5 + 0.06 * k, Math.sin(t * 11) * 0.12 * k, j() * 1.5);
}
function frenzyForearms(t, k) {
  pose('forearm_R', -(0.5 + Math.sin(t * 15) * 0.45) * k, 0, 0);
  pose('forearm_L', -(0.5 + Math.sin(t * 15 + 1.7) * 0.45) * k, 0, 0);
}

// ---- drag to move the camera around him; scroll or pinch to zoom ----
const orbit = { yaw: 0, pitch: 0.08, zoom: 1, vy: 0, vp: 0, drag: null };
const touches = new Map();
let pinchFrom = 0, zoomFrom = 1;
canvas.addEventListener('pointerdown', (e) => {
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
  if (touches.size === 2) { const [a, b] = [...touches.values()]; pinchFrom = Math.hypot(a.x - b.x, a.y - b.y); zoomFrom = orbit.zoom; }
  orbit.drag = { x: e.clientX, y: e.clientY, t: performance.now() };
  press = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  canvas.classList.add('grabbing');
});
canvas.addEventListener('pointermove', (e) => {
  if (!touches.has(e.pointerId)) return;
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    orbit.zoom = THREE.MathUtils.clamp(zoomFrom * pinchFrom / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), 0.45, 1.8);
    return;
  }
  const g = orbit.drag; if (!g) return;
  const now = performance.now(), dx = e.clientX - g.x, dy = e.clientY - g.y, ms = Math.max(8, now - g.t);
  orbit.yaw -= dx * 0.006; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + dy * 0.004, -0.05, 1.2);
  orbit.vy = -dx * 0.006 / ms * 1000; orbit.vp = dy * 0.004 / ms * 1000;   // for the glide after you let go
  Object.assign(g, { x: e.clientX, y: e.clientY, t: now });
});
let press = null;
function letGo(e) {
  // a quick tap that barely moved is a poke, not a drag
  if (press && press.id === e.pointerId && touches.size === 1 && performance.now() - press.t < 350 &&
      Math.hypot(e.clientX - press.x, e.clientY - press.y) < 7) poke(e.clientX, e.clientY);
  press = null;
  touches.delete(e.pointerId);
  if (!touches.size) { orbit.drag = null; canvas.classList.remove('grabbing'); }
}
canvas.addEventListener('pointerup', letGo);
canvas.addEventListener('pointercancel', letGo);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  orbit.zoom = THREE.MathUtils.clamp(orbit.zoom * Math.exp(e.deltaY * 0.001), 0.45, 1.8);
}, { passive: false });
function orbitStep(dt) {
  if (orbit.drag) return;
  // let go mid-swing and it keeps turning a little, then settles
  orbit.yaw += orbit.vy * dt; orbit.pitch = THREE.MathUtils.clamp(orbit.pitch + orbit.vp * dt, -0.05, 1.2);
  const f = Math.exp(-dt * 4); orbit.vy *= f; orbit.vp *= f;
}

// ---- awareness: walking up to you ----
function approach(now) {
  if (level < 2 || walk.approach || walk.state !== 'stand' || shuffle.on || now - lastNotice < 1600) return;
  const cx = camera.position.x, cz = camera.position.z, dx = cx - body.position.x, dz = cz - body.position.z, d = Math.hypot(dx, dz);
  const stop = height * (2.7 - 0.35 * level);
  if (d < stop + 0.8) return;
  walk.to.set(cx, cz); walk.stopAt = stop; walk.approach = true;
  if (LINES.approach.length) say(pick(LINES.approach));
  walk.aim = Math.atan2(dx, dz); walk.state = 'turn'; walk.then = 'walk';
}

// ---- colours: cyan normally, red in a tantrum ----
const CYAN = new THREE.Color(0x00fffa), REDC = new THREE.Color(0xff2230), tint = new THREE.Color(0x00fffa);
const voidEl = document.getElementById('void');
let lastTint = -1, tintAt = 0;
function colours(dt) {
  rageAmt += ((rage.on && rage.phase !== 'cool' ? 1 : 0) - rageAmt) * Math.min(1, dt * (rage.on && rage.phase !== 'cool' ? 3 : 0.5));
  tint.copy(CYAN).lerp(REDC, rageAmt);
  rim.color.copy(tint); pool.material.color.copy(tint); dust.material.color.copy(tint);
  gridMats.forEach((m) => m.uniforms.uColor.value.copy(tint));
  grid.material.uniforms.uStrength.value = 1 - 0.55 * sleep.amt;
  prints.forEach((m) => m.material.color.lerp(tint, Math.min(1, dt * 2)));
  voidEl.style.setProperty('--rage', rageAmt.toFixed(3));
  // re-tint his screen as it turns (a few times a second is plenty)
  const now = performance.now();
  if (lastFace && !fizz && Math.abs(rageAmt - lastTint) > 0.02 && now - tintAt > 60) { lastTint = rageAmt; tintAt = now; putFace(lastFace === faceData[shownFace] ? faceData[shownFace] : lastFace); }
}

// ---- reaching for you ----
// When you're well above him (the camera dragged up) and he's watching you, now and then he tips his
// head back and reaches up toward you, arms trembling at full stretch, up on his toes. Then lets them fall.
const ABOVE = 0.55;   // how high the camera has to be (orbit pitch) for him to reach
const reach = { on: false, t0: 0, until: 0, amt: 0, last: -1e9 };
function reachThink(now) {
  if (reach.on) {
    if (rage.on || mode !== 'watch' || now > reach.until || orbit.pitch < ABOVE - 0.2) {
      reach.on = false; reach.last = now;
      if (!rage.on && Math.random() < 0.5) fizzle(faceIndex(Math.random() < 0.5 ? 'sad' : 'neutral'));
    }
    return;
  }
  if (mode !== 'watch' || orbit.pitch < ABOVE || now - reach.last < 15000 || now - lastNotice < 1200) return;
  if (walk.state !== 'stand' || shuffle.on || walk.approach || Math.random() > 0.012) return;
  Object.assign(reach, { on: true, t0: now, until: now + 3200 + Math.random() * 2800 });
  modeUntil = Math.max(modeUntil, reach.until + 500);
  fizzle(faceIndex(Math.random() < 0.6 ? 'sad' : 'surprised'));
  if (LINES.reach && LINES.reach.length) setTimeout(() => { if (reach.on) say(pick(LINES.reach)); }, 700);
}
function reachStep(dt) {
  // arms come up slowly and stiffly, and fall a little faster
  reach.amt += ((reach.on ? 1 : 0) - reach.amt) * Math.min(1, dt * (reach.on ? 1.1 : 2.2));
}

// ---- the tantrum ----
// freeze -> turn on the camera -> charge it, flailing -> hit the screen (static) -> cool down
const rage = { on: false, phase: '', t0: 0, next: 0, lock: false, shake: 0, frenzy: 0, count: 0 };
function scheduleRage(now, first) {
  const gap = (60000 + Math.random() * 100000) / (1 + 0.6 * level);
  rage.next = now + (first ? Math.max(35000, gap * 0.6) : gap);
}
scheduleRage(performance.now(), true);
function startRage(now) {
  if (!todd) { rage.next = now + 5000; return; }
  Object.assign(rage, { on: true, phase: 'freeze', t0: now, lock: true, shake: 0, frenzy: 0 });
  rage.count++;
  mode = 'rage'; walk.approach = false; walk.stopAt = 0;
  walk.state = 'stand'; walk.until = 1e15;
  goal.yaw = 0; goal.pitch = 0.1; goal.roll = 0;
  fizzle(faceIndex('angry'), 300);
  flood(true);
}
function rageThink(now) {
  const t = now - rage.t0;
  if (rage.phase === 'freeze') {
    // locks up, shaking, twitching
    rage.shake = 0.03; rage.frenzy = Math.min(0.35, t / 2000);
    if (Math.random() < 0.15) { goal.yaw = (Math.random() - 0.5) * 0.5; goal.roll = (Math.random() - 0.5) * 0.4; }
    if (t > 900) {
      rage.phase = 'turn';
      walk.aim = wrap(walk.heading + towardYou()); walk.state = 'turn'; walk.then = 'stand';
    }
  } else if (rage.phase === 'turn') {
    rage.frenzy = 0.4;
    goal.yaw = towardYou() * 0.6;
    if (walk.state === 'stand' && !shuffle.on) {
      rage.phase = 'charge'; rage.t1 = now;
      walk.to.set(camera.position.x, camera.position.z); walk.stopAt = height * 0.55;
      walk.pace = 2.3; walk.state = 'walk'; walk.approach = true;
    }
  } else if (rage.phase === 'charge') {
    const d = Math.hypot(camera.position.x - body.position.x, camera.position.z - body.position.z);
    rage.frenzy = Math.min(1, rage.frenzy + 0.04);
    rage.shake = 0.03 + Math.max(0, 1 - d / 12) * 0.25;
    if (Math.random() < 0.3) { goal.yaw = (Math.random() - 0.5) * 0.7; goal.pitch = (Math.random() - 0.5) * 0.5; goal.roll = (Math.random() - 0.5) * 0.6; }
    if (Math.random() < 0.08 && !fizz) glitch();
    if (d < height * 0.75 || walk.state !== 'walk' || now - rage.t1 > 7000) impact(now);
  } else if (rage.phase === 'crash') {
    if (now - rage.t2 > 520) {
      // the static clears: he's a few steps back, dazed
      rage.phase = 'cool'; rage.t3 = now;
      const cx = camera.position.x, cz = camera.position.z, dx = body.position.x - cx, dz = body.position.z - cz, d = Math.hypot(dx, dz) || 1;
      const back = (camera.userData.dist || 10) * orbit.zoom * 0.55;
      body.position.x = cx + dx / d * back; body.position.z = cz + dz / d * back;
      walk.heading = Math.atan2(-dx, -dz); body.rotation.y = walk.heading;
      walk.pace = 1; walk.state = 'stand'; walk.amp = 0; walk.approach = false; walk.stopAt = 0;
      rage.lock = false; rage.shake = 0; rage.frenzy = 0;
      if (agonyPanel) { fizzle(faceIndex('agony'), 160); setTimeout(() => fizzle(faceIndex('error'), 300), 1500); }
      else fizzle(faceIndex('error'), 200);
      goal.yaw = 0; goal.pitch = 0.35; goal.roll = 0.3;
      flood(false);
      // something else answers: whatever holds him in
      if (LINES.held.length) { setTimeout(() => say(pick(LINES.held), 'held'), 700); if (Math.random() < 0.4) setTimeout(() => say(pick(LINES.held), 'held'), 2200); }
    }
  } else if (rage.phase === 'cool') {
    if (now - rage.t3 > 4200) {
      rage.on = false; rage.phase = ''; mode = 'glance'; nextGlance = now + 300; nextMood = now + 1500;
      walk.until = now + 3000; scheduleRage(now);
    }
  }
}
function impact(now) {
  rage.phase = 'crash'; rage.t2 = now; rage.shake = 0.6; rage.frenzy = 0;
  walk.state = 'stand'; walk.amp = 0; walk.pace = 1;
  crash.until = now + 520;
}

// full-screen static when he hits the screen
const crashCanvas = document.getElementById('crash');
const crashCtx = crashCanvas.getContext('2d');
const crash = { until: 0, img: crashCtx.createImageData(crashCanvas.width, crashCanvas.height) };
function crashStep(now) {
  const on = now < crash.until;
  crashCanvas.classList.toggle('on', on);
  if (!on) return;
  const d = crash.img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = Math.random(), red = Math.random() < 0.35;
    const v = r < 0.45 ? 0 : r < 0.8 ? 255 : 120;
    d[i] = red ? 255 : v; d[i + 1] = red ? 30 : v; d[i + 2] = red ? 40 : v; d[i + 3] = 255;
  }
  crashCtx.putImageData(crash.img, 0, 0);
}

// ---- TODD.OS: terminal lines that flicker into the void ----
const termEl = document.getElementById('term');
let LINES = { idle: [], aware: [], papa: [], disk: [], rage: [], notice: [], notice_aware: [], approach: [], held: [], reach: [], poke: [], poke_screen: [], poke_annoyed: [], poke_sore: [], poke_arm: [], poke_leg: [], poke_low: [], broadcast_after: [], wonder: [], wonder_reply: [], sleep: [], wake: [], sleep_talk: [], debris: [] }, nextLine = performance.now() + 6000, flooding = false;
fetch('terminal.json?v=' + Date.now()).then((r) => r.json()).then((d) => { LINES = Object.assign(LINES, d); }).catch(() => {});
const pick = (a) => a[(Math.random() * a.length) | 0];
function hasDisk() { try { return !!(JSON.parse(localStorage.getItem('rp_items')) || {}).todd_floppy; } catch (e) { return false; } }
function say(text, kind) {
  if (!text) return;
  const red = kind === true || kind === 'rage', held = kind === 'held', signal = kind === 'signal', wonder = /^wonder/.test(kind || '');
  const el = document.createElement('div');
  el.className = 'tline' + (red ? ' red' : held ? ' held' : signal ? ' signal' : wonder ? ' wonder' : '');
  const narrow = innerWidth < 600;
  if (red) { el.style.left = (Math.random() * (narrow ? 40 : 70)) + '%'; el.style.top = (4 + Math.random() * 88) + '%'; }
  else if (signal) { el.style.left = '50%'; el.style.top = (10 + (termEl.querySelectorAll('.signal').length % 5) * 6) + '%'; }
  else if (wonder) { el.style.top = (20 + Math.random() * 40) + '%'; if (kind === 'wonder-left') el.style.left = (2 + Math.random() * 6) + '%'; else el.style.right = (2 + Math.random() * 6) + '%'; }
  else if (held) { el.style.left = (narrow ? 8 : 38) + Math.random() * 10 + '%'; el.style.top = (14 + Math.random() * 10) + '%'; }
  else {
    // keeps to the edges, out of his way (and off the chat in the bottom-left)
    const top = narrow || Math.random() < 0.6;
    el.style.left = (top ? (Math.random() < 0.5 ? 3 + Math.random() * 12 : (narrow ? 20 : 55) + Math.random() * 20) : 58 + Math.random() * 16) + '%';
    el.style.top = (top ? 8 + Math.random() * 16 : 62 + Math.random() * 14) + '%';
  }
  termEl.appendChild(el);
  const full = text.replace('{visits}', visits);
  let n = 0;
  const typeIt = setInterval(() => {
    el.textContent = full.slice(0, ++n) + (n < full.length ? '_' : '');
    if (n >= full.length) {
      clearInterval(typeIt);
      setTimeout(() => breakUp(el), red ? 500 + Math.random() * 700 : signal ? 4200 : wonder ? 2400 : 2600 + Math.random() * 1500);
    }
  }, red ? 12 : held ? 55 : signal ? 70 : wonder ? 22 : 38);
}
function breakUp(el) {
  // the line glitches apart, then it's gone
  const junk = '#%&@$?!/\\|<>01';
  let k = 0;
  const g = setInterval(() => {
    el.textContent = el.textContent.split('').map((c) => (c !== ' ' && Math.random() < 0.35 ? junk[(Math.random() * junk.length) | 0] : c)).join('');
    el.style.transform = 'translateX(' + ((Math.random() - 0.5) * 8) + 'px)';
    if (++k > 6) { clearInterval(g); el.remove(); }
  }, 50);
}
function flood(on) { flooding = on; if (!on) [].forEach.call(termEl.querySelectorAll('.red'), breakUp); }
function terminal(now) {
  if (sleep.on) return;   // asleep: only his mumbles
  if (flooding) {
    if (Math.random() < 0.35 && termEl.childElementCount < 40) say(pick(LINES.rage.length ? LINES.rage : ['ERROR']), true);
    return;
  }
  if (now < nextLine || rage.on) return;
  nextLine = now + (14000 + Math.random() * 12000) / (1 + 0.4 * level);
  const r = Math.random();
  let pool = LINES.idle;
  if (hasDisk() && r < 0.15) pool = LINES.disk;
  else if (level >= 1 && r < 0.15 + 0.15 * level + 0.15) pool = LINES.aware;
  else if (r > 0.9) pool = LINES.papa;
  say(pick(pool.length ? pool : LINES.idle));
}

// ---- the Big Papa broadcast ----
// Now and then the void dims, the 75.40 signal crackles through (its words come from the frequency
// scanner's signals.json, so it always matches), and TODD stops dead and stares up, listening.
const bc = { on: false, next: performance.now() + 70000 + Math.random() * 80000, t0: 0, lines: [], i: 0, at: 0 };
let SIGNAL = null;
fetch('/backstage/frequency/signals.json?v=' + Date.now()).then((r) => r.json()).then((d) => {
  const c = (d.codes || d)['75.40'];
  if (c && c.actions) SIGNAL = c.actions.filter((a) => a.type === 'text').map((a) => a.text);
}).catch(() => {});
function startBroadcast(now) {
  if (!todd || !SIGNAL || !SIGNAL.length) { bc.next = now + 30000; return; }
  Object.assign(bc, { on: true, t0: now, lines: SIGNAL.slice(), i: 0, at: now + 1800 });
  mode = 'broadcast'; walk.approach = false; walk.stopAt = 0;
  if (walk.state === 'walk' || walk.state === 'turn') { walk.state = 'stand'; }
  walk.until = 1e15;
  voidEl.classList.add('broadcast');
  fizzle(faceIndex('loading'), 400);
}
function broadcastThink(now) {
  // he stares straight up, very still, the odd twitch
  goal.yaw = Math.sin(now / 2300) * 0.08; goal.pitch = -0.78; goal.roll = Math.sin(now / 3100) * 0.06;
  if (Math.random() < 0.004 && !fizz) glitch();
  if (bc.i < bc.lines.length && now > bc.at) {
    say(bc.lines[bc.i], 'signal'); glitch();
    if (bc.i === 2) fizzle(faceIndex('sad'), 500);
    bc.i++; bc.at = now + 1900 + Math.random() * 500;
  }
  if (bc.i >= bc.lines.length && now > bc.at + 1800) {
    bc.on = false; voidEl.classList.remove('broadcast');
    mode = 'glance'; nextGlance = now + 2500; walk.until = now + 5000; nextMood = now + 6000;
    if (LINES.broadcast_after.length) setTimeout(() => say(pick(LINES.broadcast_after)), 900);
    bc.next = now + 150000 + Math.random() * 150000;
  }
}

// ---- Wonder, bleeding in from CH 02 ----
// Once they've opened CH 02 (rp_flags.wonder_unlocked), Wonder's voice now and then cuts into the void.
// TODD flinches, snaps his head toward it and yells back.
const echo = { next: performance.now() + 50000 + Math.random() * 90000 };
function wonderUnlocked() { try { return !!(JSON.parse(localStorage.getItem('rp_flags')) || {}).wonder_unlocked; } catch (e) { return false; } }
function wonderEcho(now) {
  echo.next = now + 120000 + Math.random() * 140000;
  if (!wonderUnlocked() || !LINES.wonder.length || mode === 'watch') return;
  const left = Math.random() < 0.5;
  say(pick(LINES.wonder), left ? 'wonder-left' : 'wonder-right');
  // the flinch
  if (servos.upX) servos.upX.v -= 3; if (servos.chZ) servos.chZ.v += left ? 2 : -2;
  look.vy += left ? -5 : 5;
  const towardScreen = wrap(towardYou() + (left ? -0.9 : 0.9));
  goal.yaw = THREE.MathUtils.clamp(towardScreen, -1.1, 1.1); goal.pitch = 0; nextGlance = now + 2200;
  fizzle(faceIndex(Math.random() < 0.5 ? 'surprised' : 'angry'), 260);
  if (LINES.wonder_reply.length) setTimeout(() => { if (!rage.on) say(pick(LINES.wonder_reply)); }, 1300);
}

// ---- the grid floor: only there around him ----
// A world-space grid on the ground that fades in around TODD and out into the dark, with a ripple
// spreading out wherever a foot lands. (It'll be the arena floor when he fights.)
const RIPPLES = 6;
// (the patch is small and travels with him; the lines are anchored to the world, so it reads as one endless floor)
const grid = new THREE.Mesh(new THREE.PlaneGeometry(15, 15), new THREE.ShaderMaterial({
  // pure light added on top: where there's no grid it writes nothing at all (so the page's dark backdrop,
  // which shows through the canvas, isn't covered up)
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
  uniforms: {
    uCenter: { value: new THREE.Vector2() }, uRadius: { value: 6.5 }, uColor: { value: new THREE.Color(0x00fffa) },
    uCell: { value: 0.62 }, uTime: { value: 0 }, uStrength: { value: 1 },
    uRipples: { value: Array.from({ length: RIPPLES }, () => new THREE.Vector3(0, 0, -100)) }
  },
  vertexShader: `varying vec2 vP; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform vec2 uCenter; uniform float uRadius; uniform vec3 uColor; uniform float uCell; uniform float uTime; uniform float uStrength;
    uniform vec3 uRipples[${RIPPLES}];
    varying vec2 vP;
    void main() {
      vec2 g = vP / uCell;
      vec2 f = abs(fract(g - 0.5) - 0.5) / fwidth(g);
      float line = 1.0 - min(min(f.x, f.y), 1.0);
      vec2 f2 = abs(fract(g / 4.0 - 0.5) - 0.5) / fwidth(g / 4.0);
      float major = 1.0 - min(min(f2.x, f2.y), 1.0);
      float d = distance(vP, uCenter);
      float near = smoothstep(uRadius, uRadius * 0.15, d);
      float glow = (line * 0.32 + major * 0.35) * near * near;
      for (int i = 0; i < ${RIPPLES}; i++) {
        float age = uTime - uRipples[i].z;
        if (age < 0.0 || age > 1.6) continue;
        float r = age * 3.2, rd = distance(vP, uRipples[i].xy);
        glow += (line * 0.9 + 0.12) * smoothstep(0.35, 0.0, abs(rd - r)) * (1.0 - age / 1.6) * 0.8;
      }
      float a = clamp(glow * uStrength, 0.0, 1.0);
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor * a, a);
    }`
}));
grid.rotation.x = -Math.PI / 2; grid.position.y = 0.004; grid.renderOrder = -1;
scene.add(grid);
const gridMats = [grid.material];
// a faint patch of the same grid under something (the debris), so it sits on the floor
function gridPatch(x, z, r) {
  const m = grid.material.clone();
  m.uniforms.uCenter.value = new THREE.Vector2(x, z); m.uniforms.uRadius.value = r; m.uniforms.uStrength.value = 0.45;
  m.uniforms.uRipples.value = grid.material.uniforms.uRipples.value.map(() => new THREE.Vector3(0, 0, -100));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(r * 2.2, r * 2.2), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, 0.003, z); mesh.renderOrder = -1;
  scene.add(mesh); gridMats.push(m);
}
let rippleAt = 0;
function ripple(x, z, now) {
  const r = grid.material.uniforms.uRipples.value[rippleAt++ % RIPPLES];
  r.set(x, z, now / 1000);
}

// ---- debris: old things lying around the edges of the dark ----
// Dead monitors frozen on old faces of his, a toppled desk chair, a PC tower. Built from plain boxes in
// his palette. Now and then he walks over to one and stands staring down at it.
const debris = [];
function boxMesh(w, h, d, color) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
}
function frozenFace(name) {
  const c = document.createElement('canvas'); c.width = FACE.w; c.height = FACE.h;
  const g = c.getContext('2d'), data = faceData[faceIndex(name)];
  if (data) { const im = g.createImageData(FACE.w, FACE.h); im.data.set(data); g.putImageData(im, 0, 0); }
  // old screens: dimmer, a little dead
  g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, FACE.w, FACE.h);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  return t;
}
function monitor(face, cracked) {
  const m = new THREE.Group();
  m.add(boxMesh(1.25, 1.0, 1.0, 0x3e4646));
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.86), new THREE.MeshBasicMaterial({ map: frozenFace(face), fog: true }));
  scr.position.z = 0.501; m.add(scr);
  if (cracked) {
    const crack = new THREE.Mesh(new THREE.PlaneGeometry(1.08, 0.86), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    crack.position.z = 0.503; crack.scale.set(0.5, 1, 1); crack.position.x = -0.27; m.add(crack);
  }
  m.userData.screen = scr;
  return m;
}
function chair() {
  const c = new THREE.Group();
  const seat = boxMesh(0.75, 0.12, 0.75, 0x22262e); seat.position.y = 0.55; c.add(seat);
  const back = boxMesh(0.75, 0.8, 0.1, 0x22262e); back.position.set(0, 1.0, -0.33); c.add(back);
  const pole = boxMesh(0.1, 0.45, 0.1, 0x555c5c); pole.position.y = 0.28; c.add(pole);
  for (let i = 0; i < 5; i++) { const leg = boxMesh(0.42, 0.06, 0.08, 0x555c5c); leg.position.y = 0.04; leg.rotation.y = i * Math.PI * 2 / 5; leg.translateX(0.2); c.add(leg); }
  return c;
}
function tower() {
  const tw = new THREE.Group();
  tw.add(boxMesh(0.55, 1.25, 1.1, 0x3a4040));
  const drive = boxMesh(0.42, 0.08, 0.02, 0x1a1e1e); drive.position.set(0, 0.35, 0.56); tw.add(drive);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.05), new THREE.MeshBasicMaterial({ color: 0x00fffa }));
  led.position.set(0.18, -0.4, 0.556); tw.add(led); tw.userData.led = led;
  return tw;
}
function buildDebris() {
  if (debris.length) return;
  const place = (obj, angle, r, rotY, y, tiltX, tiltZ, kind) => {
    obj.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
    obj.rotation.set(tiltX || 0, rotY, tiltZ || 0);
    scene.add(obj);
    debris.push({ obj, x: obj.position.x, z: obj.position.z, kind });
  };
  // monitors on the floor, facing in toward the middle, a few knocked over
  place(monitor('sad'), 2.4, 9.5, 2.4 + Math.PI, 0.5, 0, 0, 'monitor');
  place(monitor('smile', true), 0.9, 10.5, 0.9 + Math.PI + 0.4, 0.5, 0, 0, 'monitor');
  place(monitor('error'), -1.7, 9.0, -1.7 + Math.PI - 0.3, 0.42, -0.35, 0, 'monitor');
  place(monitor('loading'), 4.1, 11.0, 4.1 + Math.PI, 0.62, 0, Math.PI / 2, 'monitor');
  place(chair(), -0.5, 10.0, 1.2, 0.35, 0, Math.PI / 2 - 0.05, 'chair');
  place(tower(), 3.3, 9.0, 3.3 + Math.PI + 0.6, 0.62, 0, 0, 'tower');
  // a faint patch of grid under each one, so they're sitting on something
  debris.forEach((dbr) => gridPatch(dbr.x, dbr.z, 2.2));
}
function debrisStep(now) {
  // the old screens flicker, the tower's light blinks
  debris.forEach((dbr, i) => {
    const sc = dbr.obj.userData.screen;
    if (sc) sc.material.color.setScalar(Math.random() < 0.015 ? 0.35 : 0.82 + 0.18 * Math.sin(now / 900 + i * 2));
    const led = dbr.obj.userData.led;
    if (led) led.visible = Math.sin(now / 600) > 0;
  });
}

// ---- asleep (midnight to 5 AM, his visitor's time) ----
// He sits down on the floor, legs out, slumps, his head drops, his screen goes dark (a standby light,
// the odd 'z'). He breathes slowly and twitches now and then. Poke him and he wakes up, grumpy, and
// gets to his feet; talking to him only gets mumbles (chat.js asks TODD.asleep).
const sleep = { on: false, amt: 0, waking: false, frame: 0, nextFrame: 0, nextMumble: 0, wokeAt: 0 };
function isNight() { const h = new Date().getHours(); return h < 5; }
function fallAsleep(now, instant) {
  if (rage.on || bc.on) return;
  Object.assign(sleep, { on: true, waking: false, nextFrame: now + 800, nextMumble: now + 9000 + Math.random() * 8000 });
  sleep.anim = instant ? null : { type: 'down', t0: now };
  if (instant) sleep.amt = 1;
  mode = 'sleep'; walk.state = 'stand'; walk.amp = 0; walk.approach = false; walk.visit = null; walk.until = 1e15;
  reach.on = false;
  fizzle(faceIndex('sleep'), instant ? 0 : 900);
  if (!instant && LINES.sleep && LINES.sleep.length) say(pick(LINES.sleep));
}
function wake(now) {
  sleep.on = false; sleep.waking = true; sleep.wokeAt = now;
  sleep.anim = { type: 'up', t0: now };
  // nothing that came due while he slept goes off the second he's up
  rage.next = Math.max(rage.next, now + 45000); bc.next = Math.max(bc.next, now + 60000); echo.next = Math.max(echo.next, now + 40000);
  fizzle(faceIndex('error'), 300);
  setTimeout(() => fizzle(faceIndex('angry'), 400), 1400);
  const hh = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (LINES.wake && LINES.wake.length) say(pick(LINES.wake).replace('{time}', hh));
  if (servos.upX) servos.upX.v -= 3;
}
function sleepThink(now) {
  const at = sleep.anim ? (now - sleep.anim.t0) / 1000 : 99;
  if (sleep.waking) {
    // getting up: head snaps up, then down at the floor as he pushes himself up, then at whoever woke him
    goal.roll = 0;
    if (at < 0.45) { goal.pitch = -0.3; goal.yaw = 0; }
    else if (at < 1.7) { goal.pitch = 0.45; goal.yaw = 0; }
    else { goal.pitch = 0.1; goal.yaw = THREE.MathUtils.clamp(towardYou() * 0.7, -0.9, 0.9); }
    if (!sleep.anim) {
      sleep.waking = false; sleep.backToBed = now + 120000 + Math.random() * 120000;
      mode = 'watch'; lastNotice = now; mouse.moved = now; modeUntil = now + 6000; stopAndFaceYou(now);
      walk.until = now + 6000; nextMood = now + 8000;
    }
    return;
  }
  if (sleep.anim && sleep.anim.type === 'down') {
    // lying down: watching the floor as he lowers himself, then the head drops
    goal.yaw = 0; goal.roll = 0; goal.pitch = at < 1.6 ? 0.55 : at < 2.6 ? 0.3 : 0.75;
    return;
  }
  // sleeping: head down, the odd twitch; the screen's standby light blinks, a 'z' drifts across
  goal.yaw = Math.sin(now / 5200) * 0.08; goal.pitch = 0.75 + Math.sin(now / 3900) * 0.04; goal.roll = 0.14 + Math.sin(now / 4700) * 0.05;
  if (now > sleep.nextFrame && !fizz) {
    sleep.frame++;
    const f = sleep.frame % 8;
    putFace(f === 5 ? SLEEP_FACES[2] : f === 6 ? SLEEP_FACES[3] : f % 2 ? SLEEP_FACES[1] : SLEEP_FACES[0]);
    sleep.nextFrame = now + 900;
  }
  if (Math.random() < 0.0015 && servos.chX) servos.chX.v += 1.5;    // a twitch
  if (now > sleep.nextMumble) {
    if (LINES.sleep && LINES.sleep.length) say(pick(LINES.sleep));
    sleep.nextMumble = now + 14000 + Math.random() * 16000;
  }
}
// The sitting pose, blended in over whatever balance() set: knees up, feet flat, slumped forward over
// his knees, one arm draped across them and the other hanging loose, head hanging.
const SIT = {
  // knees up: thighs angled up, shins forward and down, feet flat on the floor (worked out from his leg lengths)
  Right_Leg: [-2.2, 0.14, -0.1], Left_Leg: [-2.2, -0.14, 0.1], lowerleg_R: [1.17, 0, 0], lowerleg_L: [1.17, 0, 0],
  foot_R: [1.03, 0, 0], foot_L: [1.03, 0, 0], toe_R: [0, 0, 0], toe_L: [0, 0, 0],
  // slumped forward over his knees: right forearm resting across the tops of both, left arm hanging loose
  hips: [0, 0, 0], upper_body: [0.3, 0, 0.04], chest: [0.24, 0, 0.03],
  Right_Arm: [0.26, -1.66, 1.09], forearm_R: [-1.7, 0, 0],   // forearm lying across both knees (solved to fit)
  Left_Arm: [-0.12, -0.08, 0.2], forearm_L: [-0.2, 0, 0]
};
const sitQ = new THREE.Quaternion(), sitE = new THREE.Euler();
// Lying down and getting up are keyframed: each frame is a pose (bone -> [x, y, z]); anything not listed
// is straight. Between frames the pose eases. His height is worked out every frame from where his feet and
// hips really are, so his feet stay planted and he never sinks through the floor.
const STAND = {};
const DOWN = [
  [0.0, STAND],
  [0.6, { Right_Leg: [-0.15, 0, 0], Left_Leg: [-0.15, 0, 0], lowerleg_R: [0.3, 0, 0], lowerleg_L: [0.3, 0, 0], foot_R: [-0.15, 0, 0], foot_L: [-0.15, 0, 0],
          upper_body: [0.12, 0, 0], chest: [0.08, 0, 0], Right_Arm: [-0.2, 0, 0.08], Left_Arm: [-0.2, 0, -0.08] }],
  // down into a squat, arms out in front for balance
  [1.5, { Right_Leg: [-1.35, 0.12, -0.05], Left_Leg: [-1.35, -0.12, 0.05], lowerleg_R: [1.95, 0, 0], lowerleg_L: [1.95, 0, 0], foot_R: [-0.6, 0, 0], foot_L: [-0.6, 0, 0],
          upper_body: [0.5, 0, 0], chest: [0.25, 0, 0], Right_Arm: [-1.25, 0, 0.15], Left_Arm: [-1.25, 0, -0.15], forearm_R: [-0.35, 0, 0], forearm_L: [-0.35, 0, 0] }],
  // a hand back to the floor behind him
  [2.1, { Right_Leg: [-1.75, 0.12, -0.05], Left_Leg: [-1.75, -0.12, 0.05], lowerleg_R: [1.75, 0, 0], lowerleg_L: [1.75, 0, 0], foot_R: [0, 0, 0], foot_L: [0, 0, 0],
          upper_body: [0.2, 0, 0], chest: [0.1, 0, 0], Right_Arm: [-0.9, 0, 0.2], forearm_R: [-0.5, 0, 0], Left_Arm: [0.75, 0, -0.35], forearm_L: [-0.1, 0, 0] }],
  // bum down
  [2.5, { Right_Leg: [-2.0, 0.14, -0.08], Left_Leg: [-2.0, -0.14, 0.08], lowerleg_R: [1.4, 0, 0], lowerleg_L: [1.4, 0, 0], foot_R: [0.6, 0, 0], foot_L: [0.6, 0, 0],
          upper_body: [0.05, 0, 0], chest: [0.02, 0, 0], Right_Arm: [-0.6, 0, 0.1], forearm_R: [-0.6, 0, 0], Left_Arm: [0.5, 0, -0.3], forearm_L: [-0.1, 0, 0] }],
  // settling in: knees up, arm across them, slumped
  [3.5, SIT]
];
const UP = [
  [0.0, SIT],
  // jolted awake: sits up straight
  [0.35, Object.assign({}, SIT, { upper_body: [-0.05, 0, 0], chest: [-0.05, 0, 0], Right_Arm: [-0.5, 0, 0.25], forearm_R: [-0.6, 0, 0], Left_Arm: [0.2, 0, -0.3], forearm_L: [-0.2, 0, 0] })],
  // feet pulled in, leaning forward, hands toward the floor
  [1.0, { Right_Leg: [-2.3, 0.12, -0.05], Left_Leg: [-2.3, -0.12, 0.05], lowerleg_R: [2.15, 0, 0], lowerleg_L: [2.15, 0, 0], foot_R: [0.15, 0, 0], foot_L: [0.15, 0, 0],
          upper_body: [0.6, 0, 0], chest: [0.3, 0, 0], Right_Arm: [-1.0, 0, 0.15], Left_Arm: [-1.0, 0, -0.15], forearm_R: [-0.2, 0, 0], forearm_L: [-0.2, 0, 0] }],
  // pushed up into a squat
  [1.6, { Right_Leg: [-1.4, 0.1, -0.05], Left_Leg: [-1.4, -0.1, 0.05], lowerleg_R: [1.95, 0, 0], lowerleg_L: [1.95, 0, 0], foot_R: [-0.55, 0, 0], foot_L: [-0.55, 0, 0],
          upper_body: [0.5, 0, 0], chest: [0.25, 0, 0], Right_Arm: [-1.2, 0, 0.15], Left_Arm: [-1.2, 0, -0.15], forearm_R: [-0.35, 0, 0], forearm_L: [-0.35, 0, 0] }],
  // rising
  [2.3, { Right_Leg: [-0.55, 0, 0], Left_Leg: [-0.55, 0, 0], lowerleg_R: [0.85, 0, 0], lowerleg_L: [0.85, 0, 0], foot_R: [-0.3, 0, 0], foot_L: [-0.3, 0, 0],
          upper_body: [0.2, 0, 0], chest: [0.1, 0, 0], Right_Arm: [-0.5, 0, 0.1], Left_Arm: [-0.5, 0, -0.1], forearm_R: [-0.2, 0, 0], forearm_L: [-0.2, 0, 0] }],
  [2.9, STAND]
];
const ANIM_BONES = Array.from(new Set([].concat(...DOWN.concat(UP).map(([, f]) => Object.keys(f)))));
const ease = (u) => u * u * (3 - 2 * u);
function framesAt(frames, time) {
  let i = 0;
  while (i < frames.length - 2 && time > frames[i + 1][0]) i++;
  const [t0, a] = frames[i], [t1, b] = frames[i + 1];
  const u = ease(THREE.MathUtils.clamp((time - t0) / (t1 - t0), 0, 1));
  const out = {};
  ANIM_BONES.forEach((n) => {
    const va = a[n] || [0, 0, 0], vb = b[n] || [0, 0, 0];
    out[n] = [va[0] + (vb[0] - va[0]) * u, va[1] + (vb[1] - va[1]) * u, va[2] + (vb[2] - va[2]) * u];
  });
  return out;
}
let ankleRest = null;
const gV = new THREE.Vector3();
function ground() {
  // put his feet on the floor, and never let his seat go through it
  body.position.y = 0; body.updateMatrixWorld(true);
  const ankle = Math.min(bones.foot_R.getWorldPosition(gV).y, bones.foot_L.getWorldPosition(gV).y);
  const hipY = bones.Right_Leg.getWorldPosition(gV).y;
  body.position.y = Math.max(ankleRest - ankle, height * 0.07 - hipY);
}
function sleepPose(now, dt, t) {
  if (ankleRest === null && bones.foot_R) { body.updateMatrixWorld(true); ankleRest = bones.foot_R.getWorldPosition(gV).y - body.position.y; }
  const an = sleep.anim;
  if (an) {
    const frames = an.type === 'down' ? DOWN : UP, len = frames[frames.length - 1][0], time = (now - an.t0) / 1000;
    sleep.amt = an.type === 'down' ? Math.min(1, time / len) : Math.max(0, 1 - time / len);
    const pose = framesAt(frames, Math.min(time, len));
    Object.keys(pose).forEach((name) => {
      const b = bones[name]; if (!b) return;
      const v = pose[name];
      sitE.set(v[0], v[1], v[2], 'YXZ'); sitQ.setFromEuler(sitE); sitQ.premultiply(rest[name]);
      b.quaternion.copy(sitQ);
    });
    ground();
    if (time >= len) {
      sleep.anim = null;
      if (an.type === 'up') {
        sleep.amt = 0;
        if (servos.upX) servos.upX.v -= 2.5;                                  // a wobble as he straightens
        if (!shuffle.on) startShuffle(0, Math.random() < 0.5 ? 'L' : 'R');
      }
    }
    return;
  }
  if (!sleep.on) {
    sleep.amt = 0;
    if (!sleep.waking && isNight() && !rage.on && !bc.on && performance.now() > (sleep.backToBed || 0) && mode !== 'watch' && walk.state === 'stand' && !shuffle.on) fallAsleep(performance.now());
    return;
  }
  // asleep: the sitting pose, breathing
  sleep.amt = 1;
  const breath = Math.sin(t * 0.9) * 0.025;
  Object.keys(SIT).forEach((name) => {
    const b = bones[name]; if (!b) return;
    const v = SIT[name], extra = name === 'chest' ? breath : 0;
    sitE.set(v[0] + extra, v[1], v[2], 'YXZ'); sitQ.setFromEuler(sitE); sitQ.premultiply(rest[name]);
    b.quaternion.copy(sitQ);
  });
  ground();
}

// ---- poking him ----
// Tap him and he's shoved back a step and stumbles, then turns to look at you. Tap his screen and it
// glitches and his head snaps back. Each poke annoys him more; five close together and he loses it.
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
const shove = { x: 0, z: 0 };
let irk = 0, irkAt = 0, pokes = 0;
// Where you hit matters: his screen, his body, an arm, a leg, or below the belt. After a hit he clutches
// the sore spot for a few seconds (hand on it, rubbing); poke that hand and it's the same sore spot: OW.
const PART = {
  fat_fucking_dome: 'head', neck: 'head', chest: 'body', upper_body: 'body', hips: 'body', pelvis: 'low',
  Right_Arm: 'armR', no_elbow: 'armR', forearm_R: 'armR', hand_R: 'armR', Left_Arm: 'armL', no_elbow2: 'armL', forearm_L: 'armL', hand_L: 'armL',
  Right_Leg: 'legR', lowerleg_R: 'legR', foot_R: 'legR', toe_R: 'legR', Left_Leg: 'legL', lowerleg_L: 'legL', foot_L: 'legL', toe_L: 'legL', Legs: 'low'
};
function hitTodd(cx, cy) {
  if (!todd) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(todd, true);
  if (!hits.length) return null;
  const h = hits[0], m = h.object;
  let part = 'body', hitBone = 'chest';
  if (m.isSkinnedMesh && h.face) {
    const si = m.geometry.attributes.skinIndex, sw = m.geometry.attributes.skinWeight, a = h.face.a;
    let best = 0, bw = -1;
    const get = (attr, i, k) => [attr.getX, attr.getY, attr.getZ, attr.getW][k].call(attr, i);
    for (let k = 0; k < 4; k++) { const w = get(sw, a, k); if (w > bw) { bw = w; best = get(si, a, k); } }
    hitBone = m.skeleton.bones[best].name;
    part = PART[hitBone] || 'body';
  }
  const local = body.worldToLocal(h.point.clone());
  return { point: h.point, local, part, bone: hitBone, side: local.x > 0 ? 'R' : 'L', head: part === 'head' };
}
// his guard: one arm up across his screen ('face') or across his chest ('chest')
const guard = { side: 'R', target: 'face', amt: 0, until: 0, kick: 0 };
const GUARD = {
  face: { R: { Right_Arm: [-1.8, 0.3, -0.5], forearm_R: [-1.55, 0, 0] }, L: { Left_Arm: [-1.8, -0.3, 0.5], forearm_L: [-1.55, 0, 0] } },
  chest: { R: { Right_Arm: [-0.95, 0.2, -0.6], forearm_R: [-1.75, 0, 0] }, L: { Left_Arm: [-0.95, -0.2, 0.6], forearm_L: [-1.75, 0, 0] } }
};
const gQ = new THREE.Quaternion(), gE = new THREE.Euler();
function guardUp(target, side, now, hit) {
  Object.assign(guard, { target, side, until: now + 3600, custom: null, track: null });
  if (hit) { startGuard(hit); if (!guard.track) guard.until = 0; }   // couldn't reach it with either hand: no guard
}
// He holds the exact spot you hit: the spot is pinned to the bone it's on (his screen moves with his head),
// and every frame he nudges his arm to keep his hand on it. The hand on that side if it can reach, else the other.
const sv = new THREE.Vector3(), sv2 = new THREE.Vector3(), sv3 = new THREE.Vector3(), sTarget = new THREE.Vector3(), sView = new THREE.Vector3(), sQ = new THREE.Quaternion(), sE = new THREE.Euler();
const ARMS = { R: ['Right_Arm', 'forearm_R', 'hand_R'], L: ['Left_Arm', 'forearm_L', 'hand_L'] };
// the spot, in the world, and the line from your eye to it
const sSpot = new THREE.Vector3(), sEye = new THREE.Vector3();
function guardTarget() {
  const tr = guard.track, b = bones[tr.bone];
  sSpot.copy(tr.point); b.localToWorld(sSpot);
  sEye.copy(camera.position);
  sView.copy(sEye).sub(sSpot).normalize();          // from the spot toward you
  sTarget.copy(sSpot).addScaledVector(sView, 0.12);  // his hand, pressed on the spot
  shellUpdate();
}
// distance between his forearm (elbow to hand) and the line from your eye to the spot, and how far in
// front of the spot that crossing is: what decides whether the forearm actually covers it
const fA = new THREE.Vector3(), fB = new THREE.Vector3(), fD = new THREE.Vector3(), fW = new THREE.Vector3(), fP = new THREE.Vector3();
function crossing() {
  // closest points between segment fA-fB and the ray sSpot + t * sView (t >= 0, toward you)
  fD.copy(fB).sub(fA); fW.copy(fA).sub(sSpot);
  const a = fD.dot(fD), b = fD.dot(sView), c = 1, d = fD.dot(fW), e = sView.dot(fW);
  const den = a * c - b * b;
  let s = den > 1e-6 ? (b * e - c * d) / den : 0; s = Math.min(1, Math.max(0, s));
  let t = (b * s + e) / c; if (t < 0) t = 0;
  fP.copy(fA).addScaledVector(fD, s);
  const onRay = sv2.copy(sSpot).addScaledVector(sView, t);
  return { dist: fP.distanceTo(onRay), t };
}
// His own body, as boxes around each torso/head/thigh bone (from the mesh itself), so an arm that would
// have to pass through him to get there doesn't count as reaching it.
const SHELL_BONES = ['chest', 'upper_body', 'hips', 'pelvis', 'neck', 'fat_fucking_dome', 'Right_Leg', 'Left_Leg'];
let shell = null;
function buildShell() {
  let mesh = null; todd.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
  if (!mesh) return [];
  const sk = mesh.skeleton, pos = mesh.geometry.attributes.position, si = mesh.geometry.attributes.skinIndex, sw = mesh.geometry.attributes.skinWeight;
  const get = (attr, i, k) => [attr.getX, attr.getY, attr.getZ, attr.getW][k].call(attr, i);
  const boxes = {}, v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = get(sw, i, k); if (w > bw) { bw = w; best = get(si, i, k); } }
    const name = sk.bones[best].name; if (!SHELL_BONES.includes(name)) continue;
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(sk.boneInverses[best]);
    (boxes[name] = boxes[name] || new THREE.Box3()).expandByPoint(v);
  }
  return Object.keys(boxes).map((name) => ({ bone: sk.bones[best0(sk, name)], box: boxes[name], inv: new THREE.Matrix4(), scale: 1, mesh }));
}
function best0(sk, name) { return sk.bones.findIndex((b) => b.name === name); }
const shM = new THREE.Matrix4(), shP = new THREE.Vector3();
// where his body is this frame (the arm moves during a search, the body doesn't)
function shellUpdate() {
  if (!shell) shell = buildShell();
  shell.forEach((s) => {
    shM.copy(s.mesh.matrixWorld).multiply(s.mesh.bindMatrixInverse).multiply(s.bone.matrixWorld);
    s.scale = shM.getMaxScaleOnAxis(); s.inv.copy(shM).invert();
  });
}
const SHELL_MARGIN = 0.05;   // a hand resting on him is fine; it's going through him that isn't
function inside(p) {
  let worst = 0;
  for (const s of shell) {
    shP.copy(p).applyMatrix4(s.inv);
    const m = SHELL_MARGIN / s.scale, b = s.box;
    const d = Math.min(shP.x - b.min.x, b.max.x - shP.x, shP.y - b.min.y, b.max.y - shP.y, shP.z - b.min.z, b.max.z - shP.z) - m;
    if (d > 0) worst = Math.max(worst, d * s.scale);
  }
  return worst;
}
const clipA = new THREE.Vector3(), clipP = new THREE.Vector3();
// how far his arm (upper arm, forearm, hand) sinks into his own body
function clipDepth() {
  let sum = 0;
  for (const t of [0.5, 0.75, 1]) sum += inside(clipP.copy(clipA).lerp(fA, t));
  for (const t of [0.33, 0.66, 1]) sum += inside(clipP.copy(fA).lerp(fB, t));
  sum += inside(palm);
  return sum;
}
const palm = new THREE.Vector3();
function armCost(side, c) {
  const [arm, fore, hand] = ARMS[side], A = bones[arm], F = bones[fore], H = bones[hand];
  sE.set(c[0], c[1], c[2], 'YXZ'); sQ.setFromEuler(sE); A.quaternion.copy(rest[arm]).multiply(sQ);
  sE.set(c[3], 0, 0, 'YXZ'); sQ.setFromEuler(sE); F.quaternion.copy(rest[fore]).multiply(sQ);
  A.updateMatrixWorld(true);
  A.getWorldPosition(clipA); F.getWorldPosition(fA); H.getWorldPosition(fB);
  // his palm: a little past the wrist, along the forearm
  fD.copy(fB).sub(fA).normalize();
  palm.copy(fB).addScaledVector(fD, 0.16);
  // hand pressed on the spot (just on its surface, on your side), and the arm not tucked in behind him
  const ahead = sv.copy(palm).sub(sSpot).dot(sView);
  // and never through himself
  return palm.distanceTo(sTarget) + Math.max(0, -ahead) * 1.2 + clipDepth() * 6;
}
function startGuard(hit) {
  const b = bones[hit.bone]; if (!b) return;
  guard.track = { bone: hit.bone, point: b.worldToLocal(hit.point.clone()) };
  guardTarget();
  const sols = {};
  ['R', 'L'].forEach((side) => {
    const [arm, fore] = ARMS[side], keepA = bones[arm].quaternion.clone(), keepF = bones[fore].quaternion.clone();
    const m = side === 'R' ? 1 : -1;
    let bb = null;
    for (let i = 0; i < 420; i++) {
      const c = [-2.8 + Math.random() * 3.0, -1.6 + Math.random() * 3.2, m * (-1.5 + Math.random() * 1.8), -2.4 + Math.random() * 2.4];
      const cost = armCost(side, c); if (!bb || cost < bb.cost) bb = { cost, c };
    }
    for (let i = 0; i < 260; i++) {
      const c = bb.c.map((v) => v + (Math.random() - 0.5) * (0.3 * (1 - i / 160) + 0.02));
      const cost = armCost(side, c); if (cost < bb.cost) bb = { cost, c };
    }
    bones[arm].quaternion.copy(keepA); bones[fore].quaternion.copy(keepF); bones[arm].updateMatrixWorld(true);
    sols[side] = bb;
  });
  const near = hit.side, far = near === 'R' ? 'L' : 'R';
  const pickSide = sols[near].cost <= sols[far].cost + 0.1 ? near : far;   // the near arm, unless the other is clearly better
  if (sols[pickSide].cost > GUARD_OK * 3) { guard.track = null; return; } // neither can really get there: no guard
  guard.side = pickSide; guard.c = sols[pickSide].c; guard.other = sols[pickSide === 'R' ? 'L' : 'R'].c; guard.checkAt = 0;
}
// a few small corrections a frame keep the forearm on the spot as he moves
const GUARD_OK = 0.3;
// what a click on the guarded spot would hit right now
function spotHit() {
  if (!guard.track) return null;
  const v = guard.track.point.clone(); bones[guard.track.bone].localToWorld(v); v.project(camera);
  const r = canvas.getBoundingClientRect(), h = hitTodd(r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height);
  return h && h.part;
}
const now0 = () => performance.now();   // how close (in his units) the forearm has to get to the spot to count as covering it
function refine(side, c, tries, step) {
  const [arm, fore] = ARMS[side];
  const keepA = bones[arm].quaternion.clone(), keepF = bones[fore].quaternion.clone();
  let cost = armCost(side, c);
  for (let i = 0; i < tries; i++) {
    const n = c.map((v) => v + (Math.random() - 0.5) * step);
    const k = armCost(side, n); if (k < cost) { cost = k; c = n; }
  }
  bones[arm].quaternion.copy(keepA); bones[fore].quaternion.copy(keepF);
  return { c, cost };
}
function trackGuard(now) {
  guardTarget();
  const mine = refine(guard.side, guard.c, 24, 0.12);
  guard.c = mine.c; guard.cost = mine.cost;
  // every so often, if this arm has lost the spot, see whether the other one can cover it
  if (now > guard.checkAt) {
    guard.checkAt = now + 220;
    const otherSide = guard.side === 'R' ? 'L' : 'R';
    const other = refine(otherSide, guard.other || guard.c.map((v, i) => (i === 1 || i === 2 ? -v : v)), 40, 0.25);
    guard.other = other.c;
    // can't keep the hand on it (he's turned, or it's out of reach)? see if the other hand can
    if (mine.cost > GUARD_OK) { const fresh = refine(guard.side, guard.c.map((v) => v + (Math.random() - 0.5) * 1.2), 60, 0.3); if (fresh.cost < mine.cost) { guard.c = fresh.c; mine.cost = fresh.cost; } }
    if (mine.cost > GUARD_OK && other.cost < mine.cost - 0.12 && now > (guard.swappedAt || 0) + 700) {
      guard.swappedAt = now;
      // swap hands: the old arm lowers while the other comes up
      guard.old = { side: guard.side, c: guard.c, amt: guard.amt };
      guard.side = otherSide; guard.c = other.c; guard.other = mine.c;
      guard.amt = 0.15;
    }
  }
  const [arm, fore] = ARMS[guard.side];
  guard.custom = { [arm]: [guard.c[0], guard.c[1], guard.c[2]], [fore]: [guard.c[3], 0, 0] };
}
function guardPose(now, dt, t) {
  const want = now < guard.until && !rage.on && !sleep.on && !reach.on ? 1 : 0;
  guard.amt += (want - guard.amt) * Math.min(1, dt * (want ? 9 : 3));
  guard.kick *= Math.exp(-dt * 8);
  // an arm that's just handed the guard over to the other one, on its way down
  if (guard.old && guard.old.amt > 0.01) {
    guard.old.amt *= Math.exp(-dt * 6);
    const [oa, of] = ARMS[guard.old.side], oc = guard.old.c;
    [[oa, [oc[0], oc[1], oc[2]]], [of, [oc[3], 0, 0]]].forEach(([name, v]) => {
      gE.set(v[0], v[1], v[2], 'YXZ'); gQ.setFromEuler(gE); gQ.premultiply(rest[name]); bones[name].quaternion.slerp(gQ, guard.old.amt);
    });
  }
  if (guard.amt < 0.01) return;
  if (guard.track && guard.c) trackGuard(now);
  const set = guard.custom || GUARD[guard.target][guard.side];
  Object.keys(set).forEach((name) => {
    const b = bones[name]; if (!b) return;
    const v = set[name], shake = Math.sin(t * 9) * 0.05 + Math.sin(t * 23) * 0.015;   // rubbing it
    gE.set(v[0] + guard.kick * 0.5 + shake, v[1], v[2], 'YXZ'); gQ.setFromEuler(gE); gQ.premultiply(rest[name]);
    b.quaternion.slerp(gQ, guard.amt);
  });
}
function poke(cx, cy) {
  if (rage.on) return;
  const hit = hitTodd(cx, cy);
  if (!hit) return;
  if (sleep.on) return wake(performance.now());
  const now = performance.now();
  const decay = Math.max(0, irk - (now - irkAt) / 8000); irkAt = now; pokes++;
  const dx = body.position.x - camera.position.x, dz = body.position.z - camera.position.z, d = Math.hypot(dx, dz) || 1;
  const knock = (push) => { shove.x += dx / d * push; shove.z += dz / d * push; };
  const sore = guard.amt > 0.5 && (hit.part === 'armR' || hit.part === 'armL');   // poked the hand that's holding the sore spot
  let pool = null, mood = null, add = 1, lookLater = 650;
  if (sore) {
    // right on the sore spot: he winces, the hand jerks off it and goes back, and it hurts more
    guard.kick = 1.6; guard.until = now + 3200; knock(0.35); look.vp -= 4;
    if (servos.upX) servos.upX.v -= 3;
    pool = LINES.poke_sore; mood = Math.random() < 0.5 ? 'sad' : 'angry';
  } else if (hit.part === 'head') {
    knock(0.6); look.vp -= 9; look.vy += (Math.random() - 0.5) * 6; glitch();
    if (servos.upX) servos.upX.v -= 2.5;
    guardUp('face', hit.side, now, hit);
    pool = LINES.poke_screen;
  } else if (hit.part === 'low') {
    // below the belt: he doubles over
    knock(0.8); look.vp += 8; if (servos.chX) servos.chX.v += 7; if (servos.upX) servos.upX.v += 5;
    guardUp('chest', hit.side, now, hit); add = 1.5;
    pool = LINES.poke_low; mood = 'angry';
  } else if (hit.part === 'armR' || hit.part === 'armL') {
    // his arm gets knocked away, and he turns toward it
    const R = hit.part === 'armR';
    knock(0.4);
    if (servos[R ? 'raZ' : 'laZ']) servos[R ? 'raZ' : 'laZ'].v += R ? 7 : -7;
    if (servos[R ? 'raX' : 'laX']) servos[R ? 'raX' : 'laX'].v += 5;
    look.vy += R ? 5 : -5;
    pool = LINES.poke_arm;
  } else if (hit.part === 'legR' || hit.part === 'legL') {
    // he hops that foot up and looks down at it
    const side = hit.part === 'legR' ? 'R' : 'L';
    knock(0.5);
    if (!shuffle.on) startShuffle(0, side);
    goal.pitch = 0.6; goal.yaw = side === 'R' ? -0.35 : 0.35; nextGlance = now + 1400; lookLater = 1300;
    pool = LINES.poke_leg;
  } else {
    knock(1.4); look.vp -= 3; look.vy += (Math.random() - 0.5) * 6;
    if (servos.upX) servos.upX.v -= 4; if (servos.chZ) servos.chZ.v += (Math.random() - 0.5) * 3;
    guardUp('chest', hit.side, now, hit);
    setTimeout(() => { if (!rage.on && !shuffle.on) startShuffle(0, Math.random() < 0.5 ? 'L' : 'R'); }, 180);
  }
  irk = decay + add;
  walk.approach = false; walk.stopAt = 0; walk.visit = null;
  if (walk.state === 'walk') { walk.state = 'stand'; walk.until = now + 4000; }
  setTimeout(() => {
    if (rage.on || sleep.on) return;
    mode = 'watch'; lastNotice = performance.now(); mouse.moved = performance.now(); modeUntil = performance.now() + 5000;
    stopAndFaceYou(performance.now());
  }, lookLater);
  fizzle(faceIndex(mood || (irk < 1.6 ? 'surprised' : irk < 3 ? 'neutral' : 'angry')), 260);
  if (irk >= 3 && !sore) pool = LINES.poke_annoyed;
  if (!pool || !pool.length) pool = LINES.poke;
  if (pool && pool.length) say(pick(pool));
  nextMood = now + 4000;
  if (irk >= 4.5) { irk = 0; setTimeout(() => startRage(performance.now()), 600); }
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
    reachStep(dt);
    legs();
    balance(now, dt, t);
    guardPose(now, dt, t);
    sleepPose(now, dt, t);
    fadePrints(now);
    gridMats.forEach((m) => { m.uniforms.uTime.value = now / 1000; });
    fizzStep(now);
    debrisStep(now);
    agonyStep(now);
    crashStep(now);
    // the camera sways a little, so the void doesn't feel like a photo
    const d = camera.userData.dist || 10, aimY = floorY + height * 0.5;
    // the camera lags behind him like someone operating it: it turns to keep him in view first,
    // and only drifts after him once he's wandered a fair way off (then takes its time catching up)
    const ox = body.position.x - follow.x, oz = body.position.z - follow.z, off = Math.hypot(ox, oz);
    const slack = height * 0.45;
    if (off > slack && !rage.lock) {   // (in a tantrum the camera holds still and lets him come)
      const pull = (off - slack) / off * Math.min(1, dt * 0.55);
      follow.x += ox * pull; follow.z += oz * pull;
    }
    pan.x += (body.position.x - pan.x) * Math.min(1, dt * 1.6);
    pan.z += (body.position.z - pan.z) * Math.min(1, dt * 1.6);
    // where you've dragged the camera to (it keeps a little sway of its own)
    orbitStep(dt);
    const r = d * orbit.zoom;
    scene.fog.near = r * 0.75; scene.fog.far = r + 14;   // the dark stays around him however far back you are
    const yaw = orbit.yaw + Math.sin(t * 0.21) * 0.06, pitch = orbit.pitch + Math.sin(t * 0.17) * 0.012;
    camera.position.set(follow.x + Math.sin(yaw) * Math.cos(pitch) * r, aimY + Math.sin(pitch) * r, follow.z + Math.cos(yaw) * Math.cos(pitch) * r);
    camera.lookAt(follow.x + (pan.x - follow.x) * 0.75, aimY, follow.z + (pan.z - follow.z) * 0.75);
    if (rage.shake > 0.001 && !reduce) {
      camera.position.x += (Math.random() - 0.5) * rage.shake; camera.position.y += (Math.random() - 0.5) * rage.shake;
      camera.rotation.z += (Math.random() - 0.5) * rage.shake * 0.05;
    }
    colours(dt);
    terminal(now);
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
window.TODD = {
  face: (n) => fizzle(typeof n === 'number' ? n : faceIndex(n)), faces: FACES, screen: facePix, goal, look, walk, body, shuffle, orbit, camera,
  rage: () => { if (!rage.on) startRage(performance.now()); },   // set off a tantrum now
  get level() { return level; }, set level(v) { level = Math.max(0, Math.min(4, v | 0)); },
  say: (t, red) => say(t, red), state: rage,
  poke: (where) => { const r = canvas.getBoundingClientRect(); let hx = r.left + r.width / 2, hy = r.top + r.height / 2;
    const name = where === true ? 'fat_fucking_dome' : typeof where === 'string' ? where : 'chest';
    const v = new THREE.Vector3(); bones[name].getWorldPosition(v); if (name === 'fat_fucking_dome') v.y += 0.4;
    if (/lowerleg/.test(name)) v.y -= 0.4; if (/forearm|no_elbow/.test(name)) v.y -= 0.1; v.project(camera);
    hx = r.left + (v.x + 1) / 2 * r.width; hy = r.top + (1 - v.y) / 2 * r.height; poke(hx, hy); },
  sleep: () => fallAsleep(performance.now()), wake: () => { if (sleep.on) wake(performance.now()); },
  get asleep() { return sleep.on; },
  broadcast: () => { if (!rage.on && !bc.on) startBroadcast(performance.now()); },
  wonder: () => { echo.next = 0; wonderEcho(performance.now()); },
  reach: () => { const now = performance.now(); mode = 'watch'; mouse.moved = now; Object.assign(reach, { on: true, t0: now, until: now + 5000 }); modeUntil = now + 5500; },
  guard, get irk() { return irk; }, SIT, rest,
  // for testing: what would a click on this point of his body (in his own space) hit right now?
  probe: (lx, ly, lz) => { const v = new THREE.Vector3(lx, ly, lz); body.localToWorld(v); v.project(camera); const r = canvas.getBoundingClientRect();
    const h = hitTodd(r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height); return h && { part: h.part, local: h.local.toArray().map((n) => +n.toFixed(2)) }; },
  get guardInfo() { return { side: guard.side, cost: guard.cost, swapped: !!guard.old, track: !!guard.track, up: now0() < guard.until }; },
  probeGuard: () => spotHit(),
  clip: (side) => { shellUpdate(); const [a, f, h] = ARMS[side || guard.side]; bones[a].getWorldPosition(clipA); bones[f].getWorldPosition(fA); bones[h].getWorldPosition(fB); fD.copy(fB).sub(fA).normalize(); palm.copy(fB).addScaledVector(fD, 0.16); return clipDepth(); },
  clickAt: (lx, ly, lz) => { const v = new THREE.Vector3(lx, ly, lz); body.localToWorld(v); v.project(camera); const r = canvas.getBoundingClientRect();
    poke(r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height); },
  get showing() { return FACES[fizz ? fizz.to : shownFace]; },
  render: () => renderer.render(scene, camera), bones,
  // for the chat (chat.js)
  get busy() { return rage.on; }, get visits() { return visits; },
  attend: () => { const now = performance.now(); mouse.moved = now; if (mode === 'watch') modeUntil = Math.max(modeUntil, now + 6000); },
  faceYou: () => {
    if (rage.on) return;
    const now = performance.now();
    if (mode !== 'watch') { mode = 'watch'; lastNotice = now; stopAndFaceYou(now); }
    mouse.moved = now; modeUntil = Math.max(modeUntil, now + 8000);
  },
  approach: () => {
    if (rage.on) return;
    const now = performance.now();
    mode = 'watch'; mouse.moved = now; modeUntil = now + 9000;
    const dx = camera.position.x - body.position.x, dz = camera.position.z - body.position.z;
    walk.to.set(camera.position.x, camera.position.z); walk.stopAt = height * 1.5; walk.approach = true;
    walk.aim = Math.atan2(dx, dz); walk.state = 'turn'; walk.then = 'walk';
  },
  wander: () => { if (rage.on) return; mode = 'glance'; walk.approach = false; walk.state = 'stand'; walk.until = 0; },
  spin: () => { if (rage.on) return; walk.spin = 1; walk.aim = wrap(walk.heading + Math.PI); walk.state = 'turn'; walk.then = 'stand'; },
  glitch: () => glitch(),
  agony: (ms) => agonyFlash(ms),
  reboot: () => {
    if (rage.on) return;
    fizzle(faceIndex('loading'), 300); boot.textContent = 'TODD.OS'; boot.classList.remove('gone');
    setTimeout(() => { boot.classList.add('gone'); fizzle(faceIndex('smile')); }, 2200);
  },
  line: (t, kind) => say(t, kind), lines: () => LINES
};
