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
const R = 10.5;           // the ring you run around
const DISC = R + 1.8;     // the turntable's edge
const TURN_SCALE = 7.5 / R;   // his turning speeds were tuned for a 7.5 ring: scaled so he still lags behind you
const HP_PHASE = 9, PHASES = 6;
const YOU_SIZE = 0.72;    // your sprite, against the VS TODD scale (your moves and speed are unchanged)
const HIM_SIZE = 1.4;     // Cedar, against his model's own size
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
scene.fog = new THREE.Fog(0x050302, 30, 56);
const camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 120);
scene.add(new THREE.HemisphereLight(0xffe2b0, 0x140b05, 0.75));
const bulb = new THREE.PointLight(0xffd59a, 1.6, 40, 1.4); bulb.position.set(0, 10.5, 0); scene.add(bulb);
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
  const top = new THREE.Mesh(new THREE.CircleGeometry(DISC, 96), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
  top.rotation.x = -Math.PI / 2; table.add(top);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(DISC, DISC + 0.2, 0.6, 72, 1, true), new THREE.MeshStandardMaterial({ color: 0x5e3b22, roughness: 1 }));
  side.position.y = -0.3; table.add(side);
  const groove = new THREE.Mesh(new THREE.RingGeometry(R - 0.06, R + 0.06, 96), new THREE.MeshBasicMaterial({ color: 0x8a6a40, transparent: true, opacity: 0.35 }));
  groove.rotation.x = -Math.PI / 2; groove.position.y = 0.005; table.add(groove);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.85, 0.25, 32), new THREE.MeshStandardMaterial({ color: 0x24150a, roughness: 1 }));
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
// frames and tints exactly as VS TODD draws you: the walk passes through Idle between steps, the parry flip
// goes the way you're facing, pink while the parry window's open, gold (and untouchable) after a good one
const WALK = ['Walk1', 'Walk2', 'Walk3', 'Idle', 'Walk4', 'Walk5', 'Walk6', 'Idle'];
function frameFor() {
  if (P.dead) return 'Die';
  if (P.spin > 0 || P.parryT > 0) return art.Parry ? 'Parry' : 'Jump';
  if (!P.ground) return P.vh > 0 ? 'Jump' : 'Fall';
  if (Math.abs(P.vs) > 20) return WALK[Math.floor(P.walkT * 14) % WALK.length];
  return 'Idle';
}
const TINT = { gold: ['rgba(255,196,40,.62)', '#ffd23a', 26], pink: [null, '#ff5cf0', 22] };
const tintCv = document.createElement('canvas'), tintG = tintCv.getContext('2d');
function drawYou() {
  const name = frameFor(), a = art[name] || art.Idle;
  cardG.clearRect(0, 0, CARD, CARD);
  if (a) {
    cardG.save();
    cardG.translate(CARD / 2, CARD / 2);                       // the costume's centre
    if (P.face < 0) cardG.scale(-1, 1);
    if (P.hurtT > 0 && Math.floor(P.hurtT * 20) % 2) cardG.globalAlpha = 0.35;
    if (P.spin > 0) cardG.rotate((1 - P.spin / TUNE.spin) * Math.PI * 2 * P.face * (P.face < 0 ? -1 : 1));
    const tint = P.goldT > 0 ? 'gold' : P.parryT > 0 ? 'pink' : null;
    if (tint) {
      const [fill, glow, blur] = TINT[tint];
      tintCv.width = a.img.width; tintCv.height = a.img.height;
      tintG.drawImage(a.img, 0, 0);
      if (fill) { tintG.globalCompositeOperation = 'source-atop'; tintG.fillStyle = fill; tintG.fillRect(0, 0, tintCv.width, tintCv.height); tintG.globalCompositeOperation = 'source-over'; }
      if (glow) { cardG.shadowColor = glow; cardG.shadowBlur = blur; }
      if (tint === 'gold') { const k = Math.min(1, P.goldT / 0.15); if (k < 1) { cardG.drawImage(a.img, a.ox, a.oy); } cardG.globalAlpha *= k; }
      cardG.drawImage(tintCv, a.ox, a.oy);
    } else cardG.drawImage(a.img, a.ox, a.oy);
    cardG.restore();
  }
  cardTex.needsUpdate = true;
  const p = pPos(); you.position.copy(p);
  shadow.position.set(p.x, 0.02, p.z); shadow.scale.setScalar(YOU_SIZE * Math.max(0.4, 1 - P.h / 600));
}

// ---------------- Cedar ----------------
let him = null, bones = {}, rest = {}, gun = null, gunProto = null, hisMats = [];
const cedar = { yaw: 0, turn: 0.85 * TURN_SCALE, state: 'wait', t: 0, plan: [], shotN: 0, hold: false, flinch: 0, laugh: 0, stagger: 0, back: false, kneel: 0 };
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
// a round: a bright core with a long glowing tail behind it, so you can see where it's going
const tracerGeo = new THREE.CylinderGeometry(0.09, 0.02, 1.6, 8, 1, true); tracerGeo.translate(0, -0.8, 0); tracerGeo.rotateX(Math.PI / 2);
const coreGeo = new THREE.SphereGeometry(0.14, 10, 8);
const glowMat = (c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
const ballMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), tailMat = glowMat(0xffb347);
const backMat = new THREE.MeshBasicMaterial({ color: 0xffd6f4 }), backTail = glowMat(0xff5cf0);
function round(color) {
  const g = new THREE.Group(), core = new THREE.Mesh(coreGeo, color === 'back' ? backMat : ballMat), tail = new THREE.Mesh(tracerGeo, color === 'back' ? backTail : tailMat);
  g.add(core, tail); g.userData.tail = tail; g.userData.core = core; return g;
}
function aimRound(s) { s.m.lookAt(s.m.position.clone().add(s.v)); }
function recolor(s) { s.m.userData.core.material = backMat; s.m.userData.tail.material = backTail; }
function fire(target, opts = {}) {
  const from = muzzlePos();
  const m = round(); m.position.copy(from); scene.add(m);
  const via = opts.via || null;
  const dir = (via || target).clone().sub(from).normalize();
  const s = { m, v: dir.multiplyScalar(opts.speed || PH[fight.phase].speed), via, target, back: false, perfect: !!opts.perfect, life: 4 };
  aimRound(s); shots.push(s);
  flashAt(from, 1.3); bang(); shake(0.16); muzzleLight.intensity = 6; cedar.recoil = 1;
}
function flashAt(p, size) {
  const f = new THREE.Mesh(new THREE.SphereGeometry(0.3 * size, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95 }));
  f.position.copy(p); scene.add(f); fx.push({ m: f, t: 0, len: 0.18, grow: 2.2 });
  // a few faint puffs of powder smoke drifting up
  for (let i = 0; i < 4; i++) {
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.16 * size, 8, 6), new THREE.MeshBasicMaterial({ color: 0xb8ad9c, transparent: true, opacity: 0.16, depthWrite: false }));
    smoke.position.copy(p).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.4));
    scene.add(smoke); fx.push({ m: smoke, t: -i * 0.05, len: 1.1, grow: 4 + Math.random() * 2, rise: 0.5 + Math.random() * 0.5 });
  }
}
const fx = [];
const muzzleLight = new THREE.PointLight(0xffc870, 0, 9, 2); scene.add(muzzleLight);
// the aim line: while he takes aim a faint line runs from the barrel to you, following you; when the pan
// flashes it locks and burns bright. The bang comes down that line a beat later.
const aimLine = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 6, 1, true), glowMat(0xff6a3d));
aimLine.geometry.translate(0, 0.5, 0); aimLine.geometry.rotateX(Math.PI / 2); aimLine.visible = false; scene.add(aimLine);
const aim = { on: false, locked: null, k: 0 };
function drawAim() {
  if (!aim.on || !gun || !gun.visible) { aimLine.visible = false; return; }
  const from = muzzlePos(), to = aim.locked || pPos(LIFT);
  aimLine.visible = true; aimLine.position.copy(from); aimLine.lookAt(to);
  aimLine.scale.set(aim.locked ? 1.8 : 1, aim.locked ? 1.8 : 1, from.distanceTo(to));
  aimLine.material.opacity = aim.locked ? 0.9 : 0.15 + 0.35 * aim.k;
  aimLine.material.color.setHex(aim.locked ? 0xffd27a : 0xff6a3d);
}
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
    if (stepT > tD) { aim.on = true; aim.k = Math.min(1, (stepT - tD) / ph.aim); }
    if (stepT > tA && once('cock')) { click(); cedar.cock = 1; }
    if (stepT > tA + 0.05 && once('flash')) { panFlash(); aim.locked = o.ricochet ? null : pPos(LIFT); }
    if (stepT > tF && once('bang')) {
      const target = aim.locked; aim.on = false; aim.locked = null;
      if (o.misfire) { flashAt(muzzlePos(), 0.35); say(pick(["...Hm.", "Damp powder.", "Tch."]), 1.2); }
      else if (o.ricochet) {
        // off the rim on your far side, so it comes at you from where he isn't looking
        const a = ang() + (P.face > 0 ? 0.9 : -0.9);
        fire(pPos(LIFT), { via: new THREE.Vector3(DISC * Math.sin(a), 1.1, DISC * Math.cos(a)) });
      } else fire(target || pPos(LIFT));
    }
    if (stepT > tF + 0.12 && once('wind')) cedar.throwAt = clock;
    if (stepT > tF + 0.3 && once('throw')) throwGun();
    if (stepT > tT) nextStep();
    return;
  }
  if (kind === 'fake') {
    const tA = ph.draw + ph.aim, tF = tA + ph.flash;
    if (once('draw')) { gun.visible = false; aim.on = false; }
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
    if (stepT > 0.8 + beat * 10 + 0.4 && once('wind')) cedar.throwAt = clock;
    if (stepT > 0.8 + beat * 10 + 0.58 && once('throw')) throwGun();
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
  sfx('impact', 0.9); cedar.flinch = 1; cedar.hitFlash = 1; shake(0.25);
  if (fight.phase >= 6) return;
  fight.hp = Math.max(0, fight.hp - dmg); paintHud();
  if (Math.random() < 0.3) say(pick(LINES.hit), 1.2);
  const phaseNow = Math.min(6, 1 + Math.floor((HP_PHASE * 5 - fight.hp) / HP_PHASE));
  if (phaseNow > fight.phase) setPhase(phaseNow);
}
function setPhase(n) {
  fight.phase = n; cedar.plan = []; step = ['rest', 1.4]; stepT = 0; step.done = {};
  cedar.turn = PH[n].turn * TURN_SCALE;
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
      s.v = pPos(LIFT).sub(s.via).normalize().multiplyScalar(s.v.length()); s.via = null; aimRound(s);
    }
    if (!s.back && !s.via && s.m.position.distanceTo(you3) < 0.62) {
      if (P.parryT > 0 && (!s.perfect || clock - P.parryAt < 0.1)) {
        s.back = true; recolor(s); P.goldT = TUNE.gold; sfx('parry', 0.8); shake(0.1);
        s.v = heart.clone().sub(s.m.position).normalize().multiplyScalar(s.v.length() * 1.25); aimRound(s);
        if (s.perfect) s.perfectHit = true;
        if (P.ground) { P.vh = 520; P.ground = false; }
        continue;
      }
      hurtYou(); scene.remove(s.m); shots.splice(i, 1); continue;
    }
    if (s.back && s.m.position.distanceTo(heart) < 0.9) {
      if (PH[fight.phase].swat && Math.random() < PH[fight.phase].swat) {      // the metal arm bats it away
        cedar.swat = 1; sfx('impact', 0.6, 1.8); say(pick(["No.", "Not today."]), 0.9);
        s.v.reflect(new THREE.Vector3(1, 0, 0)).multiplyScalar(0.8); s.back = 'swatted'; aimRound(s); continue;
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
  // like VS TODD's fixed camera: you run freely across most of the screen; only near an edge does the
  // view turn with you, just enough to keep you in
  let d = ang() - camAng; d = Math.atan2(Math.sin(d), Math.cos(d));
  const DZ = 0.42;
  if (Math.abs(d) > DZ) camAng += (d - Math.sign(d) * DZ) * Math.min(1, dt * 10);
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
  ['flinch', 'laugh', 'swat', 'cock'].forEach((k) => { if (cedar[k] > 0) cedar[k] = Math.max(0, cedar[k] - dt * (k === 'laugh' ? 0.9 : 2.5)); });
  const t = clock, breathe = Math.sin(t * 1.6), sway = Math.sin(t * 0.85);
  const fl = cedar.flinch, la = cedar.laugh, st = cedar.stagger > 0 ? 1 : 0;
  const k0 = step && step[0];
  // footwork: his feet step as he turns to follow you; in Ten Paces, one step per count
  const turning = Math.abs(d) > 0.06 ? 1 : 0;
  cedar.walk = (cedar.walk || 0) + (turning - (cedar.walk || 0)) * Math.min(1, dt * 6);
  cedar.stepPh = (cedar.stepPh || 0) + dt * 7 * cedar.walk;
  let wk = cedar.walk, sp = cedar.stepPh;
  if (k0 === 'paces' && cedar.back && stepT > 0.8) { wk = 1; sp = (stepT - 0.8) / 0.42 * Math.PI; }
  const stepL = Math.sin(sp) * wk, liftL = Math.max(0, Math.sin(sp)) * wk, liftR = Math.max(0, -Math.sin(sp)) * wk;
  // the kick: knee up high, then down hard
  const kk = k0 === 'kick' ? (stepT < 0.3 ? stepT / 0.3 : Math.max(0, 1 - (stepT - 0.3) / 0.1)) : 0;
  // the stagger: a knee buckles and he sways
  const sg = st ? 0.5 + 0.5 * Math.sin(t * 5) : 0;
  cedar.kn = (cedar.kn || 0) + ((cedar.kneel ? 1 : 0) - (cedar.kn || 0)) * Math.min(1, dt * 8);
  const kn = cedar.kn;
  // his whole body: rocks back when you hit him, bobs with each step, sinks when he kneels or stomps
  const fwd = new THREE.Vector3(Math.sin(cedar.yaw), 0, Math.cos(cedar.yaw));
  const rock = -0.55 * fl * fl + 0.12 * la * Math.sin(t * 9);
  him.position.set(fwd.x * rock, 0.05 * Math.abs(Math.sin(sp)) * wk - 0.35 * kn - 0.12 * sg + 0.08 * kk, fwd.z * rock);
  pose('pelvis', 0, 0.05 * sway, 0.03 * sway);
  pose('hips', 0, 0, -0.02 * sway);
  pose('Right_Leg', -0.35 * stepL - 1.35 * kk + 0.5 * kn + 0.03 * sway, 0, 0.02 * sway);
  pose('lowerleg_R', 0.6 * liftR + 1.7 * kk + 0.05 * (1 + sway), 0, 0);
  pose('Left_Leg', 0.35 * stepL - 0.45 * sg - 0.9 * kn - 0.03 * sway, 0, -0.02 * sway);
  pose('lowerleg_L', 0.6 * liftL + 0.75 * sg + 1.6 * kn + 0.05 * (1 - sway), 0, 0);
  pose('upper_body', -0.2 * fl + 0.3 * sg + 0.2 * kn + 0.14 * kk - 0.16 * la, 0, 0.03 * sway);
  pose('chest', breathe * 0.02 - 0.12 * fl - 0.1 * la + 0.07 * Math.abs(Math.sin(t * 18)) * la, 0, 0.12 * st * Math.sin(t * 6) - 0.02 * sway);
  // his head turns to you ahead of his body and looks down at you; snaps back when hit; shakes when he laughs
  let hd = ang() - cedar.yaw; hd = Math.atan2(Math.sin(hd), Math.cos(hd));
  if (cedar.back) hd = 0;
  const hy = THREE.MathUtils.clamp(hd, -0.7, 0.7);
  pose('neck', 0.1 - 0.15 * fl, hy * 0.4, 0);
  pose('fat_fucking_dome', 0.08 - 0.28 * fl - 0.32 * la + 0.15 * st - 0.25 * kk, hy * 0.5, 0.1 * la * Math.sin(t * 20) + 0.04 * sway);
  runEye(dt, THREE.MathUtils.clamp((hd - 0.9 * hy) * 2.5, -0.7, 0.7));
  pose('hat', 0, 0, 0);
  // the metal arm: his hand on his hip when he's at ease; it swats, and swings for balance
  const atEase = cedar.forceHip != null ? cedar.forceHip : k0 === 'rest' || (k0 === 'paces' && cedar.back) ? 1 : 0.25;
  cedar.hip = (cedar.hip || 0) + (atEase - (cedar.hip || 0)) * Math.min(1, dt * 4);
  const sw = cedar.swat || 0;
  pose('Left_Arm', -0.9 * sw + 0.25 * stepL * (1 - cedar.hip) - 0.5 * kk, 0.35 * cedar.hip, -0.85 * cedar.hip - 0.4 * sw - 0.3 * la);
  pose('forearm_L', 0, 0, 1.75 * cedar.hip);
  // between attacks, a little showmanship: tip the hat, beckon you closer, shrug
  if (k0 === 'rest' && once('taunt') && step[1] >= 0.7 && Math.random() < 0.7) cedar.taunt = { kind: pick(['hat', 'beckon', 'shrug']), t0: clock, len: Math.min(1.6, step[1]) };
  if (cedar.taunt && clock - cedar.taunt.t0 > cedar.taunt.len) cedar.taunt = null;
  // the gun arm: aimed at you while a shot is coming, otherwise at his side
  const kind = k0;
  const aiming = (kind === 'shot' || kind === 'fake') && stepT > PH[fight.phase].draw * 0.5 || (fight.rpg && fight.rpg.state === 'his') || (kind === 'paces' && !cedar.back && step.done.whirl);
  cedar.aimK = (cedar.aimK || 0) + ((aiming ? 1 : 0) - (cedar.aimK || 0)) * Math.min(1, dt * 12);
  him.updateMatrixWorld(true);
  const sh = bones.Right_Arm ? bones.Right_Arm.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, 3.2, 0);
  const toYou = (aim.locked ? aim.locked.clone() : pPos(LIFT)).sub(sh).normalize();
  const yawQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), cedar.yaw);
  const coat = new THREE.Vector3(-0.75, -0.35, 0.55).normalize().applyQuaternion(yawQ);     // reaching into his coat
  const up = new THREE.Vector3(0, 1, 0);
  let dir = toYou.clone(), amt = cedar.aimK;
  // the draw: his hand goes into the coat first, then comes up to aim
  if (kind === 'shot' || kind === 'fake') {
    const ph = PH[fight.phase], k = Math.min(1, stepT / ph.draw);
    if (k < 1) { dir = coat.clone().lerp(toYou, Math.max(0, (k - 0.55) / 0.45)).normalize(); amt = Math.max(amt, Math.min(1, k * 2.5)); }
  }
  // recoil: the barrel kicks up and settles
  cedar.recoil = Math.max(0, (cedar.recoil || 0) - dt * 5);
  if (cedar.recoil > 0) dir.add(up.clone().multiplyScalar(0.55 * cedar.recoil)).normalize();
  // the throw: arm back and up, then whipped forward at you
  const tt = cedar.throwAt != null ? clock - cedar.throwAt : 9;
  if (tt < 0.45) {
    const back = new THREE.Vector3(0.3, 0.9, -0.5).normalize().applyQuaternion(yawQ);
    dir = tt < 0.18 ? toYou.clone().lerp(back, tt / 0.18).normalize() : back.clone().lerp(toYou.clone().add(new THREE.Vector3(0, -0.4, 0)), (tt - 0.18) / 0.27).normalize();
    amt = 1;
  }
  let palm = new THREE.Vector3(0, -1, 0), beckon = 0;
  const T = cedar.taunt;
  if (T && amt < 0.3 && tt >= 0.45) {
    const k = (clock - T.t0) / T.len, env = Math.sin(Math.PI * Math.min(1, Math.max(0, k)));
    if (T.kind === 'hat') { dir = new THREE.Vector3(-0.15, 1, 0.2).normalize().applyQuaternion(yawQ); palm = new THREE.Vector3(0, 0, -1).applyQuaternion(yawQ); pose('fat_fucking_dome', 0.3 * env, hy * 0.5, 0); pose('hat', -0.7 * env, 0, 0.2 * env); }
    if (T.kind === 'beckon') { dir = new THREE.Vector3(0.2, -0.05, 1).normalize().applyQuaternion(yawQ); palm = new THREE.Vector3(0, 1, 0); beckon = env; }
    if (T.kind === 'shrug') { dir = new THREE.Vector3(0.9, -0.35, 0.4).normalize().applyQuaternion(yawQ); palm = new THREE.Vector3(0, 1, 0); pose('chest', -0.06 * env, 0, 0); pose('fat_fucking_dome', 0.05, hy * 0.5, 0.18 * env); }
    amt = Math.max(amt, env);
  }
  aimArm(dir, palm, amt);
  // fingers: wrapped round the grip, or a finger gun for a fake
  const fake = kind === 'fake';
  const curl = gun && gun.visible ? 1 : beckon ? (0.15 + 0.55 * (0.5 + 0.5 * Math.sin(clock * 12))) * beckon + 0.25 * (1 - beckon) : 0.25;
  ['middle', 'ring'].forEach((n) => { pose(n + '_R', 0, 0, -1.2 * curl); pose(n + '_mid_R', 0, 0, -1.4 * curl); pose(n + '_tip_R', 0, 0, -0.8 * curl); });
  const ic = fake ? 0 : curl;
  pose('index_R', 0, 0, -1.0 * ic); pose('index_mid_R', 0, 0, -0.9 * ic); pose('index_tip_R', 0, 0, -0.5 * ic);
  pose('thumb_R', 0, fake ? -0.4 : 0.5 * curl, -0.3 * curl);
  if (gun) { const hm = gun.getObjectByName('hammer'); if (hm) hm.rotation.z = cedar.cock > 0.5 ? -0.75 : 0; }
  // a flash of light on him when your parry lands
  cedar.hitFlash = Math.max(0, (cedar.hitFlash || 0) - dt * 5);
  hisMats.forEach((m) => { m.emissive.setRGB(cedar.hitFlash * 0.9, cedar.hitFlash * 0.5, cedar.hitFlash * 0.75); });
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 30);
  if (gun && gun.visible) muzzleLight.position.copy(muzzlePos());
}

// his eye: the same live eye as at his desk (a little panel over the lens patch of his texture, drawn live)
const EYE = { x: 769, y: 116, w: 12, h: 9, tex: 1024 };
const EYE_SCALE = 4;
const LENS = '#2b6f31', LID = '#3e9943', LID_DARK = '#1f5a26';
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


const eyeState = { face: '', lx: 0, ly: 0.5, blink: 0, next: 2, t: -1 };
let eye = null;
function runEye(dt, hy) {
  if (!eye) return;
  const e = eyeState;
  e.face = cedar.laugh > 0.05 ? 'smile' : (cedar.flinch > 0.05 || cedar.stagger > 0 || (step && (step[0] === 'paces' || step[0] === 'kick'))) ? 'angry' : '';
  e.lx += (THREE.MathUtils.clamp(hy / 0.7, -1, 1) - e.lx) * Math.min(1, dt * 14);
  e.ly += (0.55 - e.ly) * Math.min(1, dt * 6);
  if (e.t < 0 && clock > e.next) e.t = 0;
  if (e.t >= 0) { e.t += dt; e.blink = Math.sin(Math.min(1, e.t / 0.16) * Math.PI); if (e.t > 0.16) { e.t = -1; e.blink = 0; e.next = clock + (Math.random() < 0.2 ? 0.09 : 2 + Math.random() * 4); } }
  drawEye(eye, e);
}

// ---------------- loading, and the opening ----------------
Promise.all([loadGLTF('../marquez/model/cedar.gltf?v=2'), loadGLTF('../marquez/model/cedars_gun.gltf?v=1'), ...FRAMES.map(loadFrame)]).then(([gl, gg]) => {
  him = gl.scene; him.scale.setScalar(HIM_SIZE); scene.add(him);
  him.traverse((o) => { if (o.isMesh) [].concat(o.material).forEach((m) => { if (m.emissive && hisMats.indexOf(m) < 0) hisMats.push(m); }); });
  try { eye = makeEye(him); } catch (e) { eye = null; }
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
  drawYou(); drawAim();
  placeCamera(dt);
  if (sayEl.hidden === false && clock > sayUntil) sayEl.hidden = true;
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

window.CEDAR = { phase: (n) => { fight.started = true; fight.hp = HP_PHASE * (6 - Math.min(6, n)); setPhase(n); }, P, fight, cedar, cam: camera, get clock() { return clock; } };
