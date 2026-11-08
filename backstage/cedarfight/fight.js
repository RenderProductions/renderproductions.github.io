// VS CEDAR. The plan for all of it is the design doc ("VS CEDAR: Fight Design").
//
// A round turntable with Cedar fixed in the middle and you running around its rim. Left and right take you
// around the ring and the camera orbits to stay behind you. He turns to face you, a beat slower than you run.
// You have your VS TODD moves and 3 HP; dying restarts the fight. Parrying his bullets back at him is the only
// way to hurt him: 45 HP across phases 1 to 5, 9 each, then phase 6, where his HP can't be touched.
//
// His one working hand draws a flintlock from his coat, cocks it (click), the pan flashes, BANG. The bang is the
// parry beat. Then he throws the empty gun at you (dodge it, it can't be parried) and it lies on the ring.
// Misfires: a flash and no bang. Fake shots: a finger gun and a mouthed "bang"; parry it and he laughs at you.
//   1 Introductions  single aimed shots, slow
//   2 Quick Draw     chains of 3 to 5, faster, misfires
//   3 Ricochet       shots bounce off the rim and come from his blind side
//   4 The Kick       he stomps, the turntable spins, he keeps firing
//   5 Ten Paces      he turns his back, counts ten, whirls: only a perfect parry staggers him. He shoots the litter.
//   6 Main Character a Varandia battle: CEDAR used FLINTLOCK x4, x8, x12. Survive his turns. His coat runs dry.
// Try a phase from the console: CEDAR.phase(4)
import * as THREE from '../toddguts/vendor/three-gltf.min.js';

// ---------------- sizes ----------------
const PX = 34;            // stage pixels (the VS TODD player's units) per world unit: he's ~2.5 tall, Cedar ~5
const R = 7.5;            // the ring you run around
const DISC = R + 1.4;     // the turntable's edge
const HP_PHASE = 9, PHASES = 6;
const YOU_SIZE = 0.72;    // your sprite, against the VS TODD scale (your moves and speed are unchanged)
const HIM_SIZE = 1.3;     // Cedar, against his model's own size
const LIFT = 1.24 * YOU_SIZE;  // where on you his shots aim: the middle of your sprite

// ---------------- the player (same moves and feel as VS TODD) ----------------
const TUNE = {
  run: 300, accel: 2600, airAccel: 1700, friction: 3000, gravity: 2300, fall: 1100, jump: 830, cut: 0.45,
  coyote: 0.09, buffer: 0.12, parry: 0.2, spin: 0.34, parryCool: 0.22, groundHop: 380, airPop: 220, gold: 0.45, hurt: 1.1
};
const P = { s: 0, h: 0, vs: 0, vh: 0, face: 1, ground: true, coyote: 0, buffer: 0, walkT: 0,
  hp: 3, dead: false, hurtT: 0, parryT: 0, spin: 0, parryCool: 0, goldT: 0, parryAt: -9 };
const ang = () => P.s / (R * PX);                                    // where you are on the ring (radians)
const pPos = (lift = 0) => new THREE.Vector3(R * Math.sin(ang()), P.h / PX * YOU_SIZE + lift, R * Math.cos(ang()));

const keys = { left: false, right: false, jump: false, parry: false };
let jumpPressed = false, parryPressed = false;
const MAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'jump', ArrowUp: 'jump', KeyW: 'jump', KeyZ: 'jump',
  KeyX: 'parry', KeyK: 'parry', ShiftLeft: 'parry', ShiftRight: 'parry', ArrowDown: 'parry', KeyS: 'parry' };
addEventListener('keydown', (e) => {
  const k = MAP[e.code]; if (!k) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.card')) return;
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

// only with something that can take a hit, like VS TODD: the Clear Polaroid or the Dubbed Tape
const PARRY_ITEMS = ['clear_polaroid', 'dubbed_tape'];
const canParry = () => { const inv = window.RPInventory; return !!(inv && PARRY_ITEMS.some((id) => inv.has(id))); };

function stepPlayer(dt) {
  if (P.dead) { P.vh -= TUNE.gravity * dt; P.h = Math.max(0, P.h + P.vh * dt); return; }
  const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  if (jumpPressed) { P.buffer = TUNE.buffer; jumpPressed = false; }
  P.buffer = Math.max(0, P.buffer - dt);
  P.hurtT = Math.max(0, P.hurtT - dt); P.goldT = Math.max(0, P.goldT - dt);
  const want = dir * TUNE.run;
  const acc = dir ? (P.ground ? TUNE.accel : TUNE.airAccel) : (P.ground ? TUNE.friction : TUNE.airAccel * 0.5);
  P.vs += Math.max(-acc * dt, Math.min(acc * dt, want - P.vs));
  if (dir) P.face = dir;
  P.vh -= TUNE.gravity * dt;
  if (P.vh < -TUNE.fall) P.vh = -TUNE.fall;
  if (!keys.jump && P.vh > 0 && P.cutReady) { P.vh *= TUNE.cut; P.cutReady = false; }
  if (P.buffer > 0 && (P.ground || P.coyote > 0)) { P.vh = TUNE.jump; P.ground = false; P.coyote = 0; P.buffer = 0; P.cutReady = true; sfx('jump', 0.35); }
  P.parryCool = Math.max(0, P.parryCool - dt);
  if (parryPressed) {
    parryPressed = false;
    if (P.parryCool <= 0 && P.spin <= 0) {
      if (P.ground) { P.vh = TUNE.groundHop; P.ground = false; P.cutReady = false; } else P.vh = Math.max(P.vh, TUNE.airPop);
      P.spin = TUNE.spin; P.parryCool = TUNE.spin + TUNE.parryCool;
      if (canParry()) { P.parryT = TUNE.parry; P.parryAt = clock; } else noParry();
      fakeCheck();
    }
  }
  P.parryT = Math.max(0, P.parryT - dt); P.spin = Math.max(0, P.spin - dt);
  P.s += (P.vs + spin.v * R * PX * (P.ground ? 1 : 0.4)) * dt;      // the spinning turntable carries you
  P.h += P.vh * dt;
  const was = P.ground;
  if (P.h <= 0) { P.h = 0; P.vh = 0; P.ground = true; } else P.ground = false;
  if (was && !P.ground) P.coyote = TUNE.coyote; else P.coyote = Math.max(0, P.coyote - dt);
  P.walkT = P.ground && Math.abs(P.vs) > 20 ? P.walkT + dt * Math.abs(P.vs) / TUNE.run : 0;
}
let noParryAt = -99;
function noParry() { if (clock - noParryAt > 6) { noParryAt = clock; say("(You need something that can take a hit to parry: the Clear Polaroid or the Dubbed Tape.)", 3.5, true); } }

// ---------------- sound ----------------
const SFX = { parry: '../toddfight/sfx/parry.mp3', ow: '../toddfight/sfx/ow.mp3', impact: '../toddfight/sfx/impact.mp3', jump: '../toddfight/sfx/jump.mp3' };
let actx = null; const buffers = {};
function audio() {
  if (actx) return actx;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
  Object.entries(SFX).forEach(([k, url]) => fetch(url).then((r) => r.arrayBuffer()).then((b) => actx.decodeAudioData(b)).then((d) => { buffers[k] = d; }).catch(() => {}));
  return actx;
}
addEventListener('pointerdown', audio); addEventListener('keydown', audio);
function sfx(name, vol = 1, rate = 1) {
  const a = actx, b = buffers[name]; if (!a || !b) return;
  const s = a.createBufferSource(), g = a.createGain(); s.buffer = b; s.playbackRate.value = rate; g.gain.value = vol;
  s.connect(g).connect(a.destination); s.start();
}
// made here: the click of the hammer, the hiss of the pan, the bang
function noise(len, vol, freq, q = 1, decay = 0.08) {
  const a = actx; if (!a) return;
  const n = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (a.sampleRate * decay));
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = n; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start();
}
const click = () => noise(0.05, 0.6, 3200, 4, 0.01);
const hiss = () => noise(0.25, 0.25, 6000, 0.7, 0.06);
const bang = () => { noise(0.6, 1.4, 900, 0.5, 0.12); noise(0.3, 0.8, 180, 0.7, 0.1); };

// ---------------- page bits ----------------
const $ = (id) => document.getElementById(id);
const sayEl = $('say'), banner = $('banner'), hud = $('hud'), bossEl = $('boss'), fill = $('b-fill'), phaseEl = $('b-phase');
let sayUntil = 0;
function say(text, secs = 2.6, hint = false) {
  sayEl.innerHTML = hint ? text : '<b>CEDAR:</b> ' + text; sayEl.className = 'say' + (hint ? ' hint' : ''); sayEl.hidden = false; sayUntil = clock + secs;
}
function showBanner(big, small) {
  banner.innerHTML = big + (small ? '<small>' + small + '</small>' : '');
  banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
}
function paintHud() {
  hud.textContent = 'HP ' + '◆'.repeat(Math.max(0, P.hp)) + '◇'.repeat(Math.max(0, 3 - P.hp));
  hud.classList.toggle('low', P.hp === 1);
  const inf = fight.phase >= 6;
  fill.parentElement.classList.toggle('inf', inf);
  fill.style.width = inf ? '100%' : (100 * fight.hp / (HP_PHASE * 5)).toFixed(1) + '%';
  phaseEl.textContent = 'PHASE ' + fight.phase + (inf ? '  ∞' : '');
}

// ---------------- the scene ----------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.setClearColor(0x050302);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x050302, 26, 48);
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 120);
scene.add(new THREE.HemisphereLight(0xffe2b0, 0x140b05, 0.75));
const bulb = new THREE.PointLight(0xffd59a, 1.4, 30, 1.6); bulb.position.set(0, 10.5, 0); scene.add(bulb);
const rim = new THREE.DirectionalLight(0xffe0a8, 0.6); rim.position.set(3, 6, 8); scene.add(rim);
// the bulb itself, hanging from its cord
const bulbMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe7b0 }));
bulbMesh.position.set(0, 10.5, 0); scene.add(bulbMesh);
const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0x1a120b }));
cord.position.set(0, 13.5, 0); scene.add(cord);

// the turntable: dark boards round a lighter rim, a groove where you run
const table = new THREE.Group(); scene.add(table);
{
  const tex = document.createElement('canvas'); tex.width = tex.height = 512;
  const g = tex.getContext('2d');
  g.fillStyle = '#3a2213'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 32) { g.fillStyle = i % 64 ? '#33200f' : '#3f2716'; g.fillRect(i, 0, 30, 512); g.fillStyle = '#24150a'; g.fillRect(i + 30, 0, 2, 512); }
  for (let i = 0; i < 900; i++) { g.fillStyle = 'rgba(0,0,0,' + (Math.random() * 0.12) + ')'; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 6 + Math.random() * 20); }
  const t = new THREE.CanvasTexture(tex); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
  const top = new THREE.Mesh(new THREE.CircleGeometry(DISC, 72), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  top.rotation.x = -Math.PI / 2; table.add(top);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(DISC, DISC + 0.2, 0.6, 72, 1, true), new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 1 }));
  side.position.y = -0.3; table.add(side);
  const groove = new THREE.Mesh(new THREE.RingGeometry(R - 0.06, R + 0.06, 96), new THREE.MeshBasicMaterial({ color: 0x8a6a40, transparent: true, opacity: 0.35 }));
  groove.rotation.x = -Math.PI / 2; groove.position.y = 0.005; table.add(groove);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0x24150a, roughness: 1 }));
  hub.position.y = 0.12; table.add(hub);
}
const spin = { v: 0 };     // turntable spin (rad/s), from his kick

// you: your VS TODD sprite on a card that always faces the camera
const ORIGIN = { x: 240, y: 180 }, FEET = 41, CARD = 256;
const FRAMES = ['Idle', 'Walk1', 'Walk2', 'Walk3', 'Walk4', 'Walk5', 'Walk6', 'Jump', 'Fall', 'Die', 'Parry'];
const art = {};
function loadFrame(name) {
  return fetch('../toddfight/player/' + name + '.svg').then((r) => (r.ok ? r.text() : '')).then((txt) => new Promise((ok) => {
    if (!/<svg/.test(txt)) return ok();
    const t = /translate\((-?[\d.]+),(-?[\d.]+)\)/.exec(txt);
    const img = new Image();
    img.onload = () => ok(); img.onerror = () => ok();
    img.src = URL.createObjectURL(new Blob([txt], { type: 'image/svg+xml' }));
    art[name] = { img, ox: -parseFloat(t[1]) - ORIGIN.x, oy: -parseFloat(t[2]) - ORIGIN.y };
  }));
}
const cardCv = document.createElement('canvas'); cardCv.width = cardCv.height = CARD;
const cardG = cardCv.getContext('2d');
const cardTex = new THREE.CanvasTexture(cardCv); cardTex.encoding = THREE.sRGBEncoding;
const you = new THREE.Sprite(new THREE.SpriteMaterial({ map: cardTex, transparent: true }));
you.scale.set(CARD / PX * YOU_SIZE, CARD / PX * YOU_SIZE, 1);
you.center.set(0.5, (CARD / 2 - FEET) / CARD);
scene.add(you);
const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.55, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45 }));
shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
let lastFrame = '';
function drawYou() {
  let name = 'Idle';
  if (P.dead) name = 'Die';
  else if (P.spin > 0 || P.parryT > 0) name = art.Parry ? 'Parry' : 'Jump';
  else if (!P.ground) name = P.vh > 0 ? 'Jump' : 'Fall';
  else if (P.walkT > 0) name = 'Walk' + (1 + Math.floor(P.walkT * 6) % 6);
  const key = name + P.face;
  if (key !== lastFrame && art[name]) {
    lastFrame = key; const a = art[name];
    cardG.clearRect(0, 0, CARD, CARD); cardG.save();
    if (P.face < 0) { cardG.translate(CARD, 0); cardG.scale(-1, 1); }
    cardG.drawImage(a.img, CARD / 2 + a.ox, CARD / 2 + a.oy);
    cardG.restore(); cardTex.needsUpdate = true;
  }
  const m = you.material;
  if (P.parryT > 0) m.color.setRGB(1, 0.62, 0.85);
  else if (P.goldT > 0) m.color.setRGB(1, 0.86, 0.4);
  else m.color.setRGB(1, 1, 1);
  m.opacity = P.hurtT > 0 && Math.floor(clock * 14) % 2 ? 0.35 : 1;
  const p = pPos(); you.position.copy(p);
  you.material.rotation = P.spin > 0 ? -P.face * (1 - P.spin / TUNE.spin) * Math.PI * 2 : 0;
  shadow.position.set(p.x, 0.02, p.z); shadow.scale.setScalar(YOU_SIZE * Math.max(0.4, 1 - P.h / 600));
}

// ---------------- Cedar ----------------
let him = null, bones = {}, rest = {}, gun = null, gunProto = null;
const cedar = { yaw: 0, turn: 1.05, state: 'wait', t: 0, plan: [], shotN: 0, hold: false, flinch: 0, laugh: 0, stagger: 0, back: false, kneel: 0 };
const loader = new THREE.GLTFLoader();
const loadGLTF = (url) => new Promise((ok, no) => loader.load(url, ok, undefined, no));

function findBones(gl) {
  const out = {}, nodes = (gl.parser.json && gl.parser.json.nodes) || [], assoc = gl.parser.associations;
  gl.scene.traverse((o) => {
    if (o.isMesh) { o.frustumCulled = false; [].concat(o.material).forEach((m) => { m.roughness = 1; m.metalness = 0; }); return; }
    const a = assoc && assoc.get(o), nd = a && a.nodes !== undefined ? nodes[a.nodes] : null;
    if (nd && nd.mesh === undefined && nd.name) out[nd.name] = o;
  });
  return out;
}
function pose(name, x, y, z) { const b = bones[name], r = rest[name]; if (b) b.rotation.set(r.x + x, r.y + y, r.z + z); }

// aiming his arm: point the upper arm, forearm and hand along a direction, palm down (the grip hangs below)
const ARM = [['Right_Arm', 'forearm_R'], ['forearm_R', 'hand_R'], ['hand_R', 'middle_R']];
const restQ = {};
function aimArm(dirWorld, palmWorld, amount) {
  if (!ARM.every(([b, c]) => bones[b] && bones[c])) return;
  const target = {};
  ARM.forEach(([b]) => bones[b].quaternion.copy(restQ[b]));
  him.updateMatrixWorld(true);
  const at = (n) => bones[n].getWorldPosition(new THREE.Vector3());
  const handRestW = bones.hand_R.getWorldQuaternion(new THREE.Quaternion());
  const palmLocal = new THREE.Vector3(-1, 0, 0).applyQuaternion(him.quaternion).applyQuaternion(handRestW.clone().invert());
  ARM.forEach(([b, c]) => {
    const bone = bones[b], inv = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const seg = at(c).sub(at(b)).normalize().applyQuaternion(inv), want = dirWorld.clone().applyQuaternion(inv);
    bone.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(seg, want));
    bone.updateMatrixWorld(true);
    if (b === 'hand_R') {
      const palmW = palmLocal.clone().applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
      const a = palmW.projectOnPlane(dirWorld).normalize(), g2 = palmWorld.clone().projectOnPlane(dirWorld).normalize();
      bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(want.clone().normalize(), Math.atan2(new THREE.Vector3().crossVectors(a, g2).dot(dirWorld), a.dot(g2))));
      bone.updateMatrixWorld(true);
    }
    target[b] = bone.quaternion.clone();
  });
  ARM.forEach(([b]) => bones[b].quaternion.copy(restQ[b]).slerp(target[b], amount));
}
const handPos = () => (bones.middle_R ? bones.middle_R.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 3, 0));
const chestPos = () => (bones.chest ? bones.chest.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.5, 0)) : new THREE.Vector3(0, 3.2, 0));
const muzzlePos = () => (gun && gun.visible ? gun.localToWorld(new THREE.Vector3(21.5 / 16, 5.75 / 16, 0)) : handPos());

// ---------------- the fight ----------------
const fight = { phase: 1, hp: HP_PHASE * 5, started: false, over: false, t: 0, turnN: 0, rpg: null };
const PH = {   // how each phase plays: cycle speeds, chains, chances
  1: { draw: 0.55, aim: 0.5, flash: 0.32, rest: 1.1, chain: [1, 1], misfire: 0, fake: 0, speed: 15, turn: 0.85 },
  2: { draw: 0.35, aim: 0.3, flash: 0.26, rest: 0.8, chain: [3, 5], misfire: 0.18, fake: 0.08, speed: 18, turn: 1.0 },
  3: { draw: 0.35, aim: 0.3, flash: 0.26, rest: 0.9, chain: [2, 3], misfire: 0.15, fake: 0.1, speed: 19, turn: 1.0, ricochet: 0.6 },
  4: { draw: 0.32, aim: 0.28, flash: 0.24, rest: 0.8, chain: [2, 4], misfire: 0.15, fake: 0.1, speed: 19, turn: 1.1, kick: true },
  5: { draw: 0.3, aim: 0.26, flash: 0.22, rest: 0.8, chain: [2, 3], misfire: 0.15, fake: 0.12, speed: 21, turn: 1.15, paces: true, swat: 0.25, litterShots: true },
  6: { draw: 0.1, aim: 0.12, flash: 0.18, rest: 0.4, chain: [1, 1], misfire: 0, fake: 0, speed: 20, turn: 1.6 }
};
const LINES = {
  start: ["You wanted my attention, friend. You have it.", "Let's see what all that talk was worth."],
  phase: { 2: "Warmed up yet? Good.", 3: "Mind the edges.", 4: "Hold on to something.", 5: "Ten paces, friend. Like gentlemen.", 6: "Enough playing by your rules." },
  hit: ["Hm.", "Lucky.", "Again, then.", "Not bad.", "Ah."],
  hurtYou: ["Manners.", "Keep up.", "Too slow.", "Steady, friend."],
  laugh: ["Ha! Bang.", "Hah! Nothing there, friend.", "Ha ha! Jumpy."],
  death: ["Come back when you've learned some manners.", "That's what I thought.", "Sit down, friend. Rest a while.", "I've been at this longer than you've been anything."]
};
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// bullets, thrown guns, litter
const shots = [], thrown = [], litter = [];
const ballGeo = new THREE.SphereGeometry(0.11, 8, 6);
const ballMat = new THREE.MeshBasicMaterial({ color: 0xfff1c8 });
const backMat = new THREE.MeshBasicMaterial({ color: 0xff8ad1 });
function fire(target, opts = {}) {
  const from = muzzlePos();
  const m = new THREE.Mesh(ballGeo, ballMat); m.position.copy(from); scene.add(m);
  const via = opts.via || null;
  const dir = (via || target).clone().sub(from).normalize();
  shots.push({ m, v: dir.multiplyScalar(opts.speed || PH[fight.phase].speed), via, target, back: false, perfect: !!opts.perfect, life: 4 });
  flashAt(from, 1.0); bang(); shake(0.12);
}
function flashAt(p, size) {
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.3 * size, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
  f.position.copy(p); scene.add(f); fx.push({ m: f, t: 0, len: 0.18, grow: 2.2 });
  const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.35 * size, 8, 6), new THREE.MeshBasicMaterial({ color: 0x8c8378, transparent: true, opacity: 0.5 }));
  smoke.position.copy(p); scene.add(smoke); fx.push({ m: smoke, t: 0, len: 1.2, grow: 3.5, rise: 0.8 });
}
const fx = [];
function panFlash() {
  if (!gun || !gun.visible) return;
  const p = gun.localToWorld(new THREE.Vector3(3 / 16, 5.4 / 16, 2 / 16));
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff0a0, transparent: true }));
  f.position.copy(p); scene.add(f); fx.push({ m: f, t: 0, len: 0.25, grow: 4 }); hiss();
}
function throwGun() {
  if (!gun || !gun.visible) return;
  const g = gunProto.clone(true); g.position.copy(muzzlePos()); scene.add(g);
  gun.visible = false;
  const to = pPos().setY(0.1); const from = g.position.clone();
  const T = 0.75 + Math.random() * 0.2;
  thrown.push({ m: g, from, to: to.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0, 0)), T, t: 0, spinAxis: new THREE.Vector3(Math.random(), 1, Math.random()).normalize() });
}
function landGun(tg) {
  const p = tg.m.position; scene.remove(tg.m);
  const g = gunProto.clone(true); g.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
  const local = table.worldToLocal(new THREE.Vector3(p.x, 0.08, p.z));
  g.position.copy(local); table.add(g); litter.push({ m: g, armed: 0 });
  if (litter.length > 30) { const old = litter.shift(); table.remove(old.m); }
  sfx('impact', 0.25, 1.6);
}

// ---------------- his attacks ----------------
// a "plan" is a list of steps; each step is [kind, ...]. He works through it, then rests and makes a new one.
function newPlan() {
  const ph = PH[fight.phase];
  if (fight.phase === 6) return [];
  if (ph.kick && Math.random() < 0.35 && Math.abs(spin.v) < 0.2) return [['kick'], ['rest', 0.4], ...chain(ph)];
  if (ph.paces && Math.random() < 0.4) return [['paces'], ['rest', 0.6]];
  if (ph.litterShots && litter.length > 3 && Math.random() < 0.35) return [['litter'], ['rest', 0.4]];
  return [...chain(ph), ['rest', ph.rest]];
}
function chain(ph) {
  const n = ph.chain[0] + Math.floor(Math.random() * (ph.chain[1] - ph.chain[0] + 1)), out = [];
  for (let i = 0; i < n; i++) {
    const r = Math.random();
    out.push(r < ph.fake ? ['fake'] : r < ph.fake + ph.misfire ? ['shot', { misfire: true }] : ['shot', { ricochet: ph.ricochet && Math.random() < ph.ricochet }]);
  }
  return out;
}

// the step he's on, and how far into it
let step = null, stepT = 0, fakeWindow = null;
function nextStep() { if (!cedar.plan.length) cedar.plan = newPlan(); step = cedar.plan.shift() || ['rest', 0.5]; stepT = 0; step.done = {}; }
function once(key) { if (step.done[key]) return false; step.done[key] = true; return true; }

function runCedar(dt) {
  if (!him || !fight.started || fight.over) return;
  stepT += dt;
  const ph = PH[fight.phase];
  const kind = step ? step[0] : null;
  if (!step) return nextStep();
  if (cedar.stagger > 0) { cedar.stagger -= dt; return; }
  if (kind === 'rest') { if (stepT > step[1]) nextStep(); return; }
  if (kind === 'shot') {
    const o = step[1] || {};
    const tD = ph.draw, tA = tD + ph.aim, tF = tA + ph.flash, tT = tF + 0.35;
    if (once('draw')) { gun.visible = false; }
    if (stepT > tD * 0.6 && once('show')) { gun.visible = true; }
    if (stepT > tA && once('cock')) { click(); cedar.cock = 1; }
    if (stepT > tA + 0.05 && once('flash')) panFlash();
    if (stepT > tF && once('bang')) {
      if (o.misfire) { flashAt(muzzlePos(), 0.35); say(pick(["...Hm.", "Damp powder.", "Tch."]), 1.2); }
      else if (o.ricochet) {
        // off the rim on your far side, so it comes at you from where he isn't looking
        const a = ang() + (P.face > 0 ? 0.9 : -0.9);
        fire(pPos(LIFT), { via: new THREE.Vector3(DISC * Math.sin(a), 1.1, DISC * Math.cos(a)) });
      } else fire(pPos(LIFT));
    }
    if (stepT > tF + 0.12 && once('throw')) throwGun();
    if (stepT > tT) nextStep();
    return;
  }
  if (kind === 'fake') {
    const tA = ph.draw + ph.aim, tF = tA + ph.flash;
    if (once('draw')) gun.visible = false;
    if (stepT > tF && once('bang')) { say('<i>bang.</i>', 1); fakeWindow = { from: clock - 0.15, to: clock + 0.25 }; }
    if (stepT > tF + 0.6) { fakeWindow = null; nextStep(); }
    return;
  }
  if (kind === 'kick') {
    if (once('k')) { cedar.kneel = 1; say(pick(["Hold on.", "Round and round, friend."]), 1.6); }
    if (stepT > 0.35 && once('stomp')) { spin.v = (Math.random() < 0.5 ? -1 : 1) * 0.85; shake(0.4); sfx('impact', 0.8, 0.6); }
    if (stepT > 0.6) { cedar.kneel = 0; nextStep(); }
    return;
  }
  if (kind === 'litter') {
    // he shoots the guns lying near you: each flashes, then goes off
    if (once('l')) {
      const near = litter.map((l) => ({ l, d: l.m.getWorldPosition(new THREE.Vector3()).distanceTo(pPos()) })).sort((a, b) => a.d - b.d).slice(0, 3);
      near.forEach((n, i) => { n.l.armed = 0.6 + i * 0.35; });
      say("Mind your feet.", 1.4);
    }
    if (stepT > 1.6) nextStep();
    return;
  }
  if (kind === 'paces') {
    // turn his back, count ten, whirl, one shot: only a perfect parry staggers him
    if (once('p')) { cedar.back = true; say("Ten paces.", 1.4); gun.visible = true; }
    const beat = 0.42, n = Math.floor((stepT - 0.8) / beat) + 1;
    if (stepT > 0.8 && n >= 1 && n <= 10 && once('n' + n)) { showCount(n); click(); }
    if (stepT > 0.8 + beat * 10 && once('whirl')) { cedar.back = false; cedar.whirl = 1; }
    if (stepT > 0.8 + beat * 10 + 0.28 && once('fire')) { fire(pPos(LIFT), { speed: 30, perfect: true }); }
    if (stepT > 0.8 + beat * 10 + 0.55 && once('throw')) throwGun();
    if (stepT > 0.8 + beat * 10 + 1) nextStep();
    return;
  }
}
function showCount(n) { banner.innerHTML = String(n); banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show'); }

function fakeCheck() {
  if (fakeWindow && clock >= fakeWindow.from && clock <= fakeWindow.to) {
    fakeWindow = null; cedar.laugh = 1.2; say(pick(LINES.laugh), 1.6);
    P.parryCool += 0.35;                // the humiliation costs you a beat
  }
}

// ---------------- hits ----------------
function hurtYou() {
  if (P.hurtT > 0 || P.goldT > 0 || P.dead) return;
  P.hp--; P.hurtT = TUNE.hurt; sfx('ow', 0.7); shake(0.35); paintHud();
  if (P.hp <= 0) return die();
  if (Math.random() < 0.4) say(pick(LINES.hurtYou), 1.4);
}
function hitHim(dmg) {
  sfx('impact', 0.9); cedar.flinch = 1; shake(0.2);
  if (fight.phase >= 6) return;
  fight.hp = Math.max(0, fight.hp - dmg); paintHud();
  if (Math.random() < 0.3) say(pick(LINES.hit), 1.2);
  const phaseNow = Math.min(6, 1 + Math.floor((HP_PHASE * 5 - fight.hp) / HP_PHASE));
  if (phaseNow > fight.phase) setPhase(phaseNow);
}
function setPhase(n) {
  fight.phase = n; cedar.plan = []; step = ['rest', 1.4]; stepT = 0; step.done = {};
  cedar.turn = PH[n].turn;
  if (n >= 6) { fight.hp = HP_PHASE * 5; startRPG(); }
  showBanner('PHASE ' + n, ['', 'INTRODUCTIONS', 'QUICK DRAW', 'RICOCHET', 'THE KICK', 'TEN PACES', 'MAIN CHARACTER'][n]);
  if (LINES.phase[n]) setTimeout(() => say(LINES.phase[n], 2.2), 900);
  paintHud();
}

function stepShots(dt) {
  const you3 = pPos(LIFT), heart = chestPos();
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    s.m.position.addScaledVector(s.v, dt); s.life -= dt;
    if (s.via && !s.back && s.m.position.distanceTo(s.via) < 0.45) {         // the ricochet: off the rim, now at you
      flashAt(s.via, 0.3); sfx('impact', 0.3, 2);
      s.v = pPos(LIFT).sub(s.via).normalize().multiplyScalar(s.v.length()); s.via = null;
    }
    if (!s.back && !s.via && s.m.position.distanceTo(you3) < 0.62) {
      if (P.parryT > 0 && (!s.perfect || clock - P.parryAt < 0.1)) {
        s.back = true; s.m.material = backMat; P.goldT = TUNE.gold; sfx('parry', 0.8);
        s.v = heart.clone().sub(s.m.position).normalize().multiplyScalar(s.v.length() * 1.25);
        if (s.perfect) s.perfectHit = true;
        if (P.ground) { P.vh = 520; P.ground = false; }
        continue;
      }
      hurtYou(); scene.remove(s.m); shots.splice(i, 1); continue;
    }
    if (s.back && s.m.position.distanceTo(heart) < 0.9) {
      if (PH[fight.phase].swat && Math.random() < PH[fight.phase].swat) {      // the metal arm bats it away
        cedar.swat = 1; sfx('impact', 0.6, 1.8); say(pick(["No.", "Not today."]), 0.9);
        s.v.reflect(new THREE.Vector3(1, 0, 0)).multiplyScalar(0.8); s.back = 'swatted'; continue;
      }
      if (s.perfectHit) { cedar.stagger = 1.6; hitHim(3); say("[He staggers.]", 1.2); } else hitHim(1);
      scene.remove(s.m); shots.splice(i, 1); continue;
    }
    if (s.life <= 0) { scene.remove(s.m); shots.splice(i, 1); }
  }
  for (let i = thrown.length - 1; i >= 0; i--) {
    const g = thrown[i]; g.t += dt; const k = Math.min(1, g.t / g.T);
    g.m.position.lerpVectors(g.from, g.to, k); g.m.position.y += Math.sin(k * Math.PI) * 2.2 - k * 0.0;
    g.m.rotateOnAxis(g.spinAxis, dt * 14);
    if (g.m.position.distanceTo(pPos(LIFT)) < 0.6) hurtYou();
    if (k >= 1) { landGun(g); thrown.splice(i, 1); }
  }
  for (const l of litter) {
    if (l.armed > 0) {
      l.armed -= dt;
      l.m.visible = Math.floor(l.armed * 12) % 2 === 0;
      if (l.armed <= 0) {
        l.m.visible = true;
        const p = l.m.getWorldPosition(new THREE.Vector3());
        flashAt(p.clone().setY(0.4), 1.4); bang();
        if (p.distanceTo(pPos()) < 1.6 && P.h < 60) hurtYou();
      }
    }
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i]; f.t += dt; const k = f.t / f.len;
    f.m.scale.setScalar(1 + k * (f.grow - 1)); f.m.material.opacity = Math.max(0, (f.m.material.opacity || 1) * (1 - dt / f.len * 1.6));
    if (f.rise) f.m.position.y += f.rise * dt;
    if (k >= 1) { scene.remove(f.m); fx.splice(i, 1); }
  }
}

// ---------------- phase 6: his rules ----------------
const rpgEl = $('rpg'), rpgText = $('rpg-text'), rpgOpt = $('rpg-opt');
const TURNS = [4, 8, 12];
function startRPG() {
  fight.rpg = { turn: 0, state: 'intro', t: 0, left: 0 };
  rpgEl.hidden = false; rpgText.textContent = 'A wild CEDAR stands his ground.'; rpgOpt.textContent = '';
}
function runRPG(dt) {
  const r = fight.rpg; if (!r || fight.over) return;
  r.t += dt;
  if (r.state === 'intro' && r.t > 2.2) { r.state = 'his'; r.t = 0; r.left = TURNS[r.turn]; rpgText.textContent = 'CEDAR used FLINTLOCK ×' + r.left + '!'; rpgOpt.textContent = ''; r.next = 0.9; }
  if (r.state === 'his') {
    // a steady volley, one shot per beat: parry every one
    r.next -= dt;
    if (r.next <= 0 && r.left > 0) {
      gun.visible = true; click(); panFlash();
      setTimeout(() => { if (!fight.over) fire(pPos(LIFT), { speed: 20 }); }, 160);
      r.left--; r.next = 0.62 - r.turn * 0.08;
    }
    if (r.left <= 0 && r.next < -1.2) {
      r.turn++;
      if (r.turn >= TURNS.length) return finale();
      r.state = 'yours'; r.t = 0; rpgText.textContent = 'Your turn.'; rpgOpt.textContent = 'STAND YOUR GROUND (jump)';
    }
  }
  if (r.state === 'yours' && (P.buffer > 0 || keys.jump || r.t > 6)) {
    rpgText.textContent = 'You stand your ground.'; rpgOpt.textContent = ''; r.state = 'intro'; r.t = 1.2;
  }
}
function finale() {
  const r = fight.rpg; r.state = 'end';
  rpgText.textContent = 'CEDAR reaches into his coat...';
  setTimeout(() => { rpgText.textContent = '...and finds it empty.'; cedar.empty = 1; }, 1800);
  setTimeout(() => { rpgEl.hidden = true; say("...Well. That's never happened before.", 2.8); }, 3800);
  setTimeout(() => { say("Here. You've earned one.", 2.4); }, 6800);
  setTimeout(won, 9200);
}
function won() {
  fight.over = true;
  try { window.RPInventory && RPInventory.give('cedars_gun'); } catch (e) {}
  try { const f = JSON.parse(localStorage.getItem('rp_flags')) || {}; f.survived_cedar = 1; localStorage.setItem('rp_flags', JSON.stringify(f)); } catch (e) {}
  $('w-item').textContent = "Cedar's Gun is in your drawer.";
  $('won').hidden = false;
}
function die() {
  P.dead = true; fight.over = true;
  setTimeout(() => {
    $('d-quote').textContent = pick(LINES.death);
    $('d-sub').textContent = 'Phase ' + fight.phase + (fight.phase < 6 ? ' · ' + fight.hp + ' HP left' : '');
    $('dead').hidden = false; $('dead').querySelector('button').focus();
  }, 1300);
}
$('dead').querySelector('[data-go="retry"]').addEventListener('click', () => location.reload());

// ---------------- camera ----------------
let camAng = 0, shakeT = 0;
function shake(a) { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) shakeT = Math.max(shakeT, a); }
function placeCamera(dt) {
  // low and far, with a long lens: close to the flat, side-on feel of VS TODD, Cedar looming over you
  const target = ang() - 0.2 * P.face;          // a little behind you, so he's never hidden behind your back
  let d = target - camAng; d = Math.atan2(Math.sin(d), Math.cos(d));
  camAng += d * Math.min(1, dt * 7);
  const dist = R + 13;
  camera.position.set(dist * Math.sin(camAng), 2.3, dist * Math.cos(camAng));
  camera.lookAt(0, 3.3, 0);
  if (shakeT > 0) { shakeT = Math.max(0, shakeT - dt); camera.position.add(new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.5), 0).multiplyScalar(shakeT * 0.6)); }
}
function size() {
  const w = canvas.clientWidth, h = canvas.clientHeight; if (!w || !h) return;
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(size).observe(canvas); size();

// ---------------- his body each frame ----------------
function poseCedar(dt) {
  if (!him) return;
  // turn toward you, slower than you can run (or away, counting paces)
  const want = ang() + (cedar.back ? Math.PI : 0);
  let d = want - cedar.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
  const rate = cedar.whirl ? 9 : cedar.turn * (cedar.stagger > 0 ? 0.2 : 1);
  cedar.yaw += Math.sign(d) * Math.min(Math.abs(d), rate * dt);
  if (cedar.whirl) { cedar.whirl = Math.max(0, cedar.whirl - dt * 3); }
  him.rotation.y = cedar.yaw;
  ['flinch', 'laugh', 'swat', 'cock', 'kneel', 'empty'].forEach((k) => { if (cedar[k] > 0 && k !== 'kneel' && k !== 'empty') cedar[k] = Math.max(0, cedar[k] - dt * 2.5); });
  const t = clock, breathe = Math.sin(t * 1.6);
  const fl = cedar.flinch, la = cedar.laugh, st = cedar.stagger > 0 ? 1 : 0, kn = cedar.kneel;
  pose('upper_body', -0.12 * fl + 0.05 * la * Math.sin(t * 30) + 0.25 * st + 0.2 * kn, 0, 0);
  pose('chest', breathe * 0.012 - 0.08 * fl - 0.1 * la, 0, 0.1 * st * Math.sin(t * 6));
  pose('fat_fucking_dome', -0.1 * fl - 0.2 * la + 0.2 * st, 0, 0.12 * la * Math.sin(t * 22));
  pose('Right_Leg', -0.35 * kn, 0, 0); pose('lowerleg_R', 0.5 * kn, 0, 0);
  pose('Left_Arm', -0.9 * (cedar.swat || 0), 0, -0.4 * (cedar.swat || 0));
  // the gun arm: aimed at you while a shot is coming, otherwise at his side
  const kind = step && step[0];
  const aiming = (kind === 'shot' || kind === 'fake') && stepT > PH[fight.phase].draw * 0.5 || (fight.rpg && fight.rpg.state === 'his') || (kind === 'paces' && !cedar.back && step.done.whirl);
  cedar.aimK = (cedar.aimK || 0) + ((aiming ? 1 : 0) - (cedar.aimK || 0)) * Math.min(1, dt * 12);
  him.updateMatrixWorld(true);
  const sh = bones.Right_Arm ? bones.Right_Arm.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 3.2, 0);
  const dir = pPos(LIFT).sub(sh).normalize();
  aimArm(dir, new THREE.Vector3(0, -1, 0), cedar.aimK);
  // fingers: wrapped round the grip, or a finger gun for a fake
  const fake = kind === 'fake';
  const curl = gun && gun.visible ? 1 : 0.25;
  ['middle', 'ring'].forEach((n) => { pose(n + '_R', 0, 0, -1.2 * curl); pose(n + '_mid_R', 0, 0, -1.4 * curl); pose(n + '_tip_R', 0, 0, -0.8 * curl); });
  const ic = fake ? 0 : curl;
  pose('index_R', 0, 0, -1.0 * ic); pose('index_mid_R', 0, 0, -0.9 * ic); pose('index_tip_R', 0, 0, -0.5 * ic);
  pose('thumb_R', 0, fake ? -0.4 : 0.5 * curl, -0.3 * curl);
  if (gun) { const hm = gun.getObjectByName('hammer'); if (hm) hm.rotation.z = cedar.cock > 0.5 ? -0.75 : 0; }
}

// ---------------- loading, and the opening ----------------
Promise.all([loadGLTF('../marquez/model/cedar.gltf?v=2'), loadGLTF('../marquez/model/cedars_gun.gltf?v=1'), ...FRAMES.map(loadFrame)]).then(([gl, gg]) => {
  him = gl.scene; him.scale.setScalar(HIM_SIZE); scene.add(him);
  bones = findBones(gl);
  Object.keys(bones).forEach((n) => { rest[n] = bones[n].rotation.clone(); });
  ARM.forEach(([b]) => { if (bones[b]) restQ[b] = new THREE.Quaternion().setFromEuler(rest[b]); });
  gunProto = gg.scene;
  gunProto.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  gun = gunProto.clone(true);
  // in his hand: barrel along where the hand points, grip down into the palm
  const holder = bones.hand_R || him;
  holder.add(gun); gun.position.set(0.04, -0.3, 0.02); gun.rotation.set(0, 0, -Math.PI / 2); gun.visible = false;
  paintHud(); bossEl.hidden = false;
  $('fade').classList.add('out');
  setTimeout(() => say(LINES.start[0], 2.4), 600);
  setTimeout(() => say(LINES.start[1], 2.2), 3100);
  setTimeout(() => { fight.started = true; showBanner('PHASE 1', 'INTRODUCTIONS'); if (!canParry()) setTimeout(noParry, 2600); }, 5400);
}).catch((e) => { console.error(e); $('fade').classList.add('out'); say("(He couldn't be found. Try again later.)", 99, true); });

// ---------------- the loop ----------------
let clock = 0, last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (document.hidden) return;
  clock += dt;
  if (fight.started && !fight.over) stepPlayer(dt);
  else if (P.dead) stepPlayer(dt);
  spin.v *= Math.pow(0.55, dt); if (Math.abs(spin.v) < 0.01) spin.v = 0;
  table.rotation.y += spin.v * dt;
  runCedar(dt); runRPG(dt);
  stepShots(dt);
  poseCedar(dt);
  drawYou();
  placeCamera(dt);
  if (sayEl.hidden === false && clock > sayUntil) sayEl.hidden = true;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.CEDAR = { phase: (n) => { fight.started = true; fight.hp = HP_PHASE * (6 - Math.min(6, n)); setPhase(n); }, P, fight };
