// Cedar, in 3D, behind his desk.
// The model is model/cedar.gltf (Blockbench). If WebGL or the model fails, the SVG drawing stays.
//
// His eye works like TODD's face: a little patch of his texture (the open lens, 12 x 9 pixels at
// x 769, y 116 of the 1024 x 1024 texture) gets its own panel, drawn live: he looks around, follows
// the cursor, blinks, squints when he smiles and glares when he's angry. Move his face around in
// Blockbench and the eye still finds its spot, as long as that patch of texture stays the lens.
//
// marquez.js tells him which face to wear (CEDAR3D.face('angry')) and pokes him every time a letter
// is spoken (CEDAR3D.flap()), so he nods along instead of flapping a mouth.
//   ''       his normal self
//   'smile'  happy squint, a little head tilt
//   'angry'  glare, leans in over the desk
//   'point'  raises his hand and points, like the drawing
// Try them in the console: CEDAR3D.face('point')
import * as THREE from '/backstage/toddguts/vendor/three-gltf.min.js';

const MODEL = 'model/cedar.gltf?v=2';
const EYE = { x: 769, y: 116, w: 12, h: 9, tex: 1024 };   // the lens patch on his texture
const EYE_SCALE = 4;                                       // the eye panel draws 4 x 4 pixels per texture pixel
const LENS = '#2b6f31', LID = '#3e9943', LID_DARK = '#1f5a26';
// The pointing pose, as the way each part of his arm points (in his own space: +x is his right,
// +y up, +z toward you). The rotations are worked out from these, so the arm can't bend the wrong
// way: the upper arm hangs by his side, a little out and forward; the forearm stands up in front
// of his shoulder; the hand carries on up with its palm turned toward you.
const POINT = { arm: [0.5, -0.6, 0.62], fore: [-0.04, 1, 0.22], hand: [-0.06, 1, 0.12], palm: [0.15, 0, 1] };
const ARM = [['Right_Arm', 'forearm_R'], ['forearm_R', 'hand_R'], ['hand_R', 'middle_R']];
const POCKET_AT = new THREE.Vector3(0.27, 2.62, 0.47);     // where the glowing thing in his pocket sits on the coat

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const scene3 = document.querySelector('.scene');
const holder = scene3 && scene3.querySelector('.him');
if (scene3 && holder) start();

function start() {
  let renderer;
  const box = document.createElement('div');
  box.className = 'him3d';
  box.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (e) { return; }      // no WebGL: the drawing stays
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.setClearColor(0x000000, 0);
  scene3.insertBefore(box, scene3.querySelector('.desk'));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(22, 1.3, 0.1, 100);
  // one weak warm light hanging over the desk, a little fill from the room
  const hemi = new THREE.HemisphereLight(0xffe2b0, 0x1a120b, 0.55);
  const lamp = new THREE.DirectionalLight(0xffe0a8, 0.85);
  lamp.position.set(0.6, 6, 4);
  scene.add(hemi, lamp);
  const room = document.getElementById('room');
  const WARM = [0xffe2b0, 0xffe0a8], COOL = [0xbef7ff, 0xc8f4ff];
  function paintLight() {
    const lit = room && room.classList.contains('lit');
    hemi.color.setHex(lit ? COOL[0] : WARM[0]); lamp.color.setHex(lit ? COOL[1] : WARM[1]);
  }
  if (room) new MutationObserver(paintLight).observe(room, { attributes: true, attributeFilter: ['class'] });
  paintLight();

  new THREE.GLTFLoader().load(MODEL, (gl) => {
    const him = gl.scene;
    scene.add(him);
    // his bones are the Blockbench groups. Cubes can share a group's name (and three.js renames
    // duplicates), so look each group up by its node in the file rather than by its name in the scene.
    const bones = {};
    const nodes = (gl.parser.json && gl.parser.json.nodes) || [];
    const assoc = gl.parser.associations;
    him.traverse((o) => {
      if (o.isMesh) { o.frustumCulled = false; [].concat(o.material).forEach((m) => { m.roughness = 1; m.metalness = 0; }); return; }
      const a = assoc && assoc.get(o);
      const nd = a && a.nodes !== undefined ? nodes[a.nodes] : null;
      if (nd && nd.mesh === undefined && nd.name) bones[nd.name] = o;
      else if (!nd && o.name && o.children.length) bones[o.name.replace(/_\d+$/, '')] = bones[o.name.replace(/_\d+$/, '')] || o;
    });
    const rest = {};
    Object.keys(bones).forEach((n) => { rest[n] = bones[n].rotation.clone(); });
    const eye = makeEye(him);
    run(him, bones, rest, eye);
    holder.classList.add('gone');
    box.classList.add('on');
    const pocket = holder.querySelector('.pocket');
    if (pocket) box.appendChild(pocket);
  }, undefined, () => { box.remove(); });

  // ---------------- the eye ----------------
  function makeEye(root) {
    // find the spot on his head whose texture coordinates hold the lens patch
    const uc = (EYE.x + EYE.w / 2) / EYE.tex, vc = (EYE.y + EYE.h / 2) / EYE.tex;
    let found = null;
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      if (found || !o.isMesh) return;
      const g = o.geometry, P = g.attributes.position, U = g.attributes.uv;
      if (!U) return;
      const idx = g.index ? g.index.array : null;
      const n = idx ? idx.length : P.count;
      for (let t = 0; t < n; t += 3) {
        const a = idx ? idx[t] : t, b = idx ? idx[t + 1] : t + 1, c = idx ? idx[t + 2] : t + 2;
        const A = new THREE.Vector2(U.getX(a), U.getY(a)), B = new THREE.Vector2(U.getX(b), U.getY(b)), C = new THREE.Vector2(U.getX(c), U.getY(c));
        // barycentric coordinates of the patch center in this triangle's texture space
        const v0 = B.clone().sub(A), v1 = C.clone().sub(A), v2 = new THREE.Vector2(uc, vc).sub(A);
        const den = v0.x * v1.y - v1.x * v0.y;
        if (Math.abs(den) < 1e-12) continue;
        const s = (v2.x * v1.y - v1.x * v2.y) / den, r = (v0.x * v2.y - v2.x * v0.y) / den;
        if (s < -1e-6 || r < -1e-6 || s + r > 1 + 1e-6) continue;
        const pa = new THREE.Vector3().fromBufferAttribute(P, a), pb = new THREE.Vector3().fromBufferAttribute(P, b), pc = new THREE.Vector3().fromBufferAttribute(P, c);
        // how position changes with u and with v across this triangle
        const e1 = pb.clone().sub(pa), e2 = pc.clone().sub(pa);
        const dPdu = e1.clone().multiplyScalar(v1.y).sub(e2.clone().multiplyScalar(v0.y)).divideScalar(den);
        const dPdv = e2.clone().multiplyScalar(v0.x).sub(e1.clone().multiplyScalar(v1.x)).divideScalar(den);
        const center = pa.clone().add(e1.multiplyScalar(s)).add(e2.multiplyScalar(r));
        const nrm = new THREE.Vector3().fromBufferAttribute(g.attributes.normal, a).normalize();
        found = { mesh: o, center, dPdu, dPdv, nrm };
        return;
      }
    });
    if (!found) return null;
    const { mesh, center, dPdu, dPdv, nrm } = found;
    const hu = dPdu.clone().multiplyScalar(EYE.w / EYE.tex / 2), hv = dPdv.clone().multiplyScalar(EYE.h / EYE.tex / 2);
    const lift = nrm.clone().multiplyScalar(0.0025);     // just in front of his face
    const corner = (su, sv) => center.clone().add(hu.clone().multiplyScalar(su)).add(hv.clone().multiplyScalar(sv)).add(lift);
    // corners: top-left, top-right, bottom-left, bottom-right (texture v grows downward)
    const pts = [corner(-1, -1), corner(1, -1), corner(-1, 1), corner(1, 1)];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0, 0, 1, 0], 2));
    geo.setIndex([0, 2, 1, 1, 2, 3]);
    geo.computeVertexNormals();
    const cv = document.createElement('canvas');
    cv.width = EYE.w * EYE_SCALE; cv.height = EYE.h * EYE_SCALE;
    const tex = new THREE.CanvasTexture(cv);
    tex.magFilter = THREE.NearestFilter; tex.minFilter = THREE.NearestFilter; tex.encoding = THREE.sRGBEncoding;
    const base = [].concat(mesh.material)[0];
    const mat = base.clone(); mat.map = tex; mat.side = THREE.DoubleSide;
    mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
    const panel = new THREE.Mesh(geo, mat);
    mesh.add(panel);
    return { cv, ctx: cv.getContext('2d'), tex, last: '' };
  }

  // the eye, drawn in 48 x 36 pixels (12 x 9 texture pixels, 4 each)
  function drawEye(eye, s) {
    const W = eye.cv.width, H = eye.cv.height, g = eye.ctx;
    const key = [s.face, Math.round(s.lx * 6), Math.round(s.ly * 3), Math.round(s.blink * 8)].join();
    if (key === eye.last) return;
    eye.last = key;
    g.fillStyle = LENS; g.fillRect(0, 0, W, H);
    const cx = Math.round(W / 2 + s.lx * 12), cy = Math.round(H / 2 + s.ly * 3);
    const px = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    let blink = s.blink;
    if (s.face === 'smile') {
      // a happy squint: the eye is a black arch
      px(0, 0, W, H, LENS);
      const w = 18, top = cy - 6;
      for (let i = 0; i < w; i += 2) {
        const d = Math.abs(i + 1 - w / 2) / (w / 2);
        const y = Math.round(top + d * d * 8);
        px(cx - w / 2 + i, y, 2, 5, '#000');
      }
      return (eye.tex.needsUpdate = true);
    }
    // the pupil: a tall black oval with a glint
    const pw = 16, ph = 28;
    for (let y = 0; y < ph; y += 2) {
      const t = (y + 1 - ph / 2) / (ph / 2);
      const half = Math.round((pw / 2) * Math.sqrt(Math.max(0, 1 - t * t)) / 2) * 2;
      if (half > 0) px(cx - half, cy - ph / 2 + y, half * 2, 2, '#000');
    }
    px(cx - 6, cy - 10, 4, 4, '#fff');
    if (s.face === 'angry') {
      // a heavy lid sloping down toward his nose (the left of the panel)
      g.fillStyle = LID;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, 6); g.lineTo(0, 18); g.closePath(); g.fill();
      g.fillStyle = LID_DARK;
      g.beginPath(); g.moveTo(0, 16); g.lineTo(W, 4); g.lineTo(W, 7); g.lineTo(0, 19); g.closePath(); g.fill();
      blink = Math.max(blink * 0.7, 0);
    }
    if (blink > 0.02) {
      const topH = Math.round((H * 0.58 * blink) / 2) * 2, botH = Math.round((H * 0.42 * blink) / 2) * 2;
      px(0, 0, W, topH, LID); px(0, H - botH, W, botH, LID);
      if (blink > 0.85) px(0, topH - 2, W, 3, LID_DARK);
    }
    eye.tex.needsUpdate = true;
  }

  // ---------------- motion ----------------
  function run(him, bones, rest, eye) {
    // ---- work out the pointing pose from the directions in POINT ----
    const restQ = {}, aimQ = {};
    ARM.forEach(([b]) => { if (bones[b]) restQ[b] = new THREE.Quaternion().setFromEuler(rest[b]); });
    function solvePoint() {
      if (!ARM.every(([b, c]) => bones[b] && bones[c])) return;
      ARM.forEach(([b]) => bones[b].quaternion.copy(restQ[b]));
      him.updateMatrixWorld(true);
      const at = (n) => bones[n].getWorldPosition(new THREE.Vector3());
      const rootQ = him.getWorldQuaternion(new THREE.Quaternion());
      const dirs = [POINT.arm, POINT.fore, POINT.hand].map((d) => new THREE.Vector3(...d).normalize().applyQuaternion(rootQ));
      // which way his palm faces at rest (toward his leg), in the hand's own space
      const handRestW = bones.hand_R.getWorldQuaternion(new THREE.Quaternion());
      const palmLocal = new THREE.Vector3(-1, 0, 0).applyQuaternion(rootQ).applyQuaternion(handRestW.clone().invert());
      ARM.forEach(([b, c], i) => {
        const bone = bones[b];
        const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()), inv = parentQ.clone().invert();
        const seg = at(c).sub(at(b)).normalize().applyQuaternion(inv);
        const want = dirs[i].clone().applyQuaternion(inv);
        bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(seg, want));
        bone.updateMatrixWorld(true);
        if (b === 'hand_R') {
          // roll the hand around its own length until the palm faces the way POINT.palm says
          const axis = dirs[i];
          const palmW = palmLocal.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
          const goal = new THREE.Vector3(...POINT.palm).normalize().applyQuaternion(rootQ);
          const a = palmW.projectOnPlane(axis).normalize(), g2 = goal.projectOnPlane(axis).normalize();
          const ang = Math.atan2(new THREE.Vector3().crossVectors(a, g2).dot(axis), a.dot(g2));
          bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(want.normalize(), ang));
          bone.updateMatrixWorld(true);
        }
        aimQ[b] = bone.quaternion.clone();
      });
      ARM.forEach(([b]) => bones[b].quaternion.copy(restQ[b]));
      him.updateMatrixWorld(true);
    }
    solvePoint();

    const state = { face: window.__marquezFace || '', lx: 0, ly: 0, blink: 0 };
    let nod = 0, nodV = 0, nextBlink = performance.now() + 1500, blinkT = -1;
    let glance = { x: 0, y: 0, until: 0 }, cursor = null, cursorAt = 0;
    const springs = {};
    // a little spring per value so every pose change eases in and settles
    let DT = 1 / 60;   // the real time since the last frame, so he moves at the same speed on slow machines
    function S(key, target, k = 60, d = 12) {
      const s = springs[key] || (springs[key] = { v: 0, x: target });
      // small steps, so a long frame can't make the spring overshoot
      const n = Math.max(1, Math.ceil(DT / (1 / 120))), h = DT / n;
      for (let i = 0; i < n; i++) { s.v += ((target - s.x) * k - s.v * d) * h; s.x += s.v * h; }
      return s.x;
    }
    function pose(name, x, y, z) {
      const b = bones[name], r = rest[name];
      if (!b) return;
      b.rotation.set(r.x + x, r.y + y, r.z + z);
    }
    addEventListener('pointermove', (e) => {
      const rc = canvas.getBoundingClientRect();
      cursor = { x: ((e.clientX - rc.left) / rc.width) * 2 - 1, y: ((e.clientY - rc.top) / rc.height) * 2 - 1 };
      cursorAt = performance.now();
    }, { passive: true });

    window.CEDAR3D = {
      face(f) { state.face = f || ''; },
      bones, POINT, solve: () => solvePoint(),
      flap() { if (!reduce) nodV += 2.2; }
    };

    him.updateMatrixWorld(true);
    const pocketLocal = bones.chest ? bones.chest.worldToLocal(POCKET_AT.clone()) : POCKET_AT.clone();
    const posePocket = (pocket) => {
      const p = pocketLocal.clone();
      if (bones.chest) bones.chest.localToWorld(p);
      p.project(camera);
      pocket.style.left = ((p.x + 1) / 2 * 100).toFixed(2) + '%';
      pocket.style.top = ((1 - p.y) / 2 * 100).toFixed(2) + '%';
    };

    function size() {
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // frame him from the waist (behind the desk) to the top of his hat
      const lo = 2.4, hi = 5.3, mid = (lo + hi) / 2;
      const dist = ((hi - lo) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.set(0, mid + 0.35, dist);
      camera.lookAt(0, mid + 0.02, 0);
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(size).observe(box);
    size();

    let last = performance.now();
    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      const dt = Math.min(0.25, (now - last) / 1000); last = now; DT = dt;
      const t = now / 1000;
      const amp = reduce ? 0.25 : 1;

      // where he's looking: at the cursor if it moved lately, otherwise little glances around the room
      let gx, gy;
      if (cursor && now - cursorAt < 4000) { gx = cursor.x; gy = cursor.y + 0.15; }
      else {
        if (now > glance.until) glance = { x: (Math.random() * 2 - 1) * 0.8, y: (Math.random() * 2 - 1) * 0.4, until: now + 1200 + Math.random() * 2800 };
        gx = glance.x; gy = glance.y;
      }
      gx = THREE.MathUtils.clamp(gx, -1, 1); gy = THREE.MathUtils.clamp(gy, -1, 1);
      // the eye snaps (eyes dart), the head follows slowly
      state.lx += (gx - state.lx) * Math.min(1, dt * 18);
      state.ly += (gy - state.ly) * Math.min(1, dt * 18);

      // blinking, now and then twice
      if (blinkT < 0 && now > nextBlink) blinkT = 0;
      if (blinkT >= 0) {
        blinkT += dt;
        const len = 0.16;
        state.blink = Math.sin(Math.min(1, blinkT / len) * Math.PI);
        if (blinkT > len) {
          blinkT = -1; state.blink = 0;
          nextBlink = now + (Math.random() < 0.2 ? 90 : 2200 + Math.random() * 4200);   // sometimes twice in a row
        }
      }
      if (eye) drawEye(eye, state);

      // talking: a nod per letter
      nodV += (-nod * 90 - nodV * 11) * dt; nod += nodV * dt;

      const f = state.face;
      const breathe = Math.sin(t * 1.4) * amp;
      const lean = f === 'angry' ? 1 : 0, tilt = f === 'smile' ? 1 : 0, point = f === 'point' ? 1 : 0;

      // body: breathing, leaning in when angry
      pose('upper_body', S('ubx', lean * 0.06) + breathe * 0.006, 0, 0);
      pose('chest', S('chx', lean * 0.08) + breathe * 0.012, S('chy', gx * 0.04 * amp), S('chz', -point * 0.04));
      // head: follows the look, tilts when he smiles, drops a little when angry, nods while talking
      pose('neck', S('nkx', gy * 0.08 * amp + lean * 0.05), S('nky', gx * 0.16 * amp), 0);
      pose('fat_fucking_dome', S('hdx', gy * 0.12 * amp + lean * 0.07) + nod * 0.06, S('hdy', gx * 0.22 * amp), S('hdz', tilt * 0.12 - point * 0.05) + Math.sin(t * 0.7) * 0.01 * amp);

      // pointing: the hand comes up beside his head, index up, the other fingers curled
      // one smooth turn per joint from resting to pointing (no odd paths in between)
      const pt = THREE.MathUtils.clamp(S('pt', point, 45, 13), 0, 1.05);
      ARM.forEach(([b]) => { if (bones[b] && aimQ[b]) bones[b].quaternion.copy(restQ[b]).slerp(aimQ[b], Math.min(1, pt)); });
      const c = (k) => S('curl' + k, point, 50, 11);
      const fold = (n, a, b, cc, k) => { pose(n + '_R', 0, 0, -a * c(k)); pose(n + '_mid_R', 0, 0, -b * c(k)); pose(n + '_tip_R', 0, 0, -cc * c(k)); };
      fold('middle', 1.35, 1.6, 1.0, 'm'); fold('ring', 1.4, 1.6, 1.0, 'r'); fold('index', -0.05, -0.05, 0, 'i');
      const tc = c('t');
      pose('thumb_R', 0, 0.5 * tc, -0.3 * tc); pose('thumb_mid_R', 0, 0.5 * tc, -0.3 * tc); pose('thumb_tip_R', 0, 0.3 * tc, -0.18 * tc);
      // the metal arm just hangs, swaying a hair with his breath
      pose('Left_Arm', 0, 0, S('laz', -lean * 0.05) - breathe * 0.004);

      const pocket = box.querySelector('.pocket');
      if (pocket) posePocket(pocket);
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);
  }
}
