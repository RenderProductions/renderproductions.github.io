// Marquez: an Undertale-style conversation in a dark room.
// All of his words live in dialogue.json. This file only knows how to say them.
//
// Controls: Z / Enter / Space = next or pick, X / Shift = finish the line now,
// arrow keys = move between choices, M = sound on or off. Tapping works too.
(function () {
  'use strict';

  var room = document.getElementById('room');
  var him = document.getElementById('him');
  var art = document.getElementById('art');
  var shade = document.getElementById('shade');
  var prompt = document.getElementById('prompt');
  var box = document.getElementById('box');
  var textEl = document.getElementById('text');
  var choicesEl = document.getElementById('choices');
  var muteBtn = document.getElementById('mute');

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DATA = null, talking = false;
  var queue = [], node = null;      // lines left in the current node
  var chars = [], shown = 0, timer = 0, typing = false, speed = 32;
  var options = [], sel = 0;

  // ---- memory: what this visitor has already heard (their browser only) ----
  var SEEN_KEY = 'rvMarquezSeen', MUTE_KEY = 'rvMarquezMute';
  var seen = {};
  try { (JSON.parse(localStorage.getItem(SEEN_KEY)) || []).forEach(function (k) { seen[k] = 1; }); } catch (e) {}
  function remember(id) {
    seen[id] = 1;
    try { localStorage.setItem(SEEN_KEY, JSON.stringify(Object.keys(seen))); } catch (e) {}
  }
  function has(req) {
    if (!req) return true;
    return [].concat(req).every(function (r) {
      return r.charAt(0) === '!' ? !seen[r.slice(1)] : !!seen[r];
    });
  }

  // ---- art: art/marquez.png if it exists, the silhouette if not ----
  var baseArt = false;
  function useArt(face) {
    var src = 'art/marquez' + (face ? '-' + face : '') + '.png';
    if (art.dataset.src === src) return;
    var probe = new Image();
    probe.onload = function () {
      art.src = src; art.dataset.src = src; art.hidden = false; shade.style.display = 'none';
      if (!face) baseArt = true;
    };
    probe.onerror = function () { if (face) useArt(''); };
    probe.src = src;
  }
  useArt('');

  // ---- voice: a short blip per letter, like Undertale ----
  var actx = null, muted = false;
  try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) {}
  function paintMute() { muteBtn.textContent = 'SOUND: ' + (muted ? 'OFF' : 'ON'); muteBtn.setAttribute('aria-pressed', String(muted)); }
  paintMute();
  function toggleMute() { muted = !muted; try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch (e) {} paintMute(); }
  function blip() {
    if (muted || !DATA) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      var v = DATA.voice || {}, t = actx.currentTime;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = v.wave || 'square';
      o.frequency.value = (v.pitch || 98) * (1 + (Math.random() - 0.5) * (v.wobble == null ? 0.06 : v.wobble));
      g.gain.setValueAtTime(v.volume || 0.045, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g); g.connect(actx.destination);
      o.start(t); o.stop(t + 0.07);
    } catch (e) {}
  }

  // ---- text markup ----
  // [red]..[/]  colors: red yellow blue gray gold     [shake]..[/]  [wave]..[/]
  // ^1 .. ^9    pause (each step is 150ms)              \n  new line
  var STYLES = { red: 1, yellow: 1, blue: 1, gray: 1, gold: 1, shake: 1, wave: 1 };
  function parse(str) {
    var out = [], stack = [], i = 0;
    while (i < str.length) {
      var ch = str.charAt(i);
      if (ch === '[') {
        var end = str.indexOf(']', i), tag = end > 0 ? str.slice(i + 1, end) : '';
        if (tag === '/') { stack.pop(); i = end + 1; continue; }
        if (STYLES[tag]) { stack.push(tag); i = end + 1; continue; }
      }
      if (ch === '^' && /[1-9]/.test(str.charAt(i + 1))) {
        if (out.length) out[out.length - 1].wait += +str.charAt(i + 1) * 150;
        i += 2; continue;
      }
      out.push({ ch: ch, cls: stack.slice(), wait: 0 });
      i++;
    }
    // Natural little pauses after punctuation.
    out.forEach(function (c, n) {
      var next = out[n + 1];
      if (next && next.ch !== ' ' && next.ch !== '\n') return;
      if (c.ch === ',') c.wait += 140;
      else if (c.ch === '.' || c.ch === '!' || c.ch === '?') c.wait += 260;
    });
    return out;
  }

  function render(parsed) {
    textEl.textContent = '';
    var idx = 0;
    chars = parsed.map(function (c) {
      var s = document.createElement('span');
      s.className = 'c ' + c.cls.join(' ');
      s.textContent = c.ch;
      if (c.cls.indexOf('wave') >= 0) s.style.setProperty('--i', idx++);
      textEl.appendChild(s);
      return { el: s, ch: c.ch, wait: c.wait };
    });
    shown = 0;
  }

  function typeNext() {
    if (shown >= chars.length) { finishTyping(); return; }
    var c = chars[shown++];
    c.el.classList.add('on');
    if (/[A-Za-z0-9]/.test(c.ch) && shown % ((DATA.voice && DATA.voice.every) || 2) === 1) blip();
    timer = setTimeout(typeNext, speed + c.wait);
  }
  function finishTyping() {
    clearTimeout(timer);
    chars.forEach(function (c) { c.el.classList.add('on'); });
    shown = chars.length;
    typing = false;
    him.classList.remove('talking');
    if (!queue.length && node && node.choices) showChoices();
    else box.classList.add('done');
  }

  // ---- lines, nodes, choices ----
  function say(line) {
    if (typeof line === 'string') line = { text: line };
    useArt(line.face || (node && node.face) || '');
    speed = reduce ? 0 : (line.speed || (node && node.speed) || DATA.speed || 32);
    box.classList.remove('done', 'choosing');
    choicesEl.hidden = true;
    render(parse(line.text || ''));
    typing = true;
    him.classList.add('talking');
    if (speed === 0) finishTyping(); else typeNext();
  }

  function go(id) {
    var n = DATA.nodes[id];
    if (!n) { console.warn('[marquez] no node called "' + id + '"'); return end(); }
    node = n; options = []; remember(id);
    queue = [].concat(n.say || []);
    if (!queue.length) queue = [''];
    say(queue.shift());
  }

  function advance() {
    if (queue.length) { say(queue.shift()); return; }
    if (node.choices && options.length) return;   // waiting on a pick
    if (node.next) go(node.next); else end();
  }

  function showChoices() {
    options = node.choices.filter(function (c) {
      return has(c.needs) && !(c.once && seen[c.to]);
    });
    choicesEl.textContent = '';
    if (!options.length) { box.classList.add('done'); return; }   // nothing left to ask: Z moves on
    options.forEach(function (c, i) {
      var li = document.createElement('li');
      li.textContent = c.text;
      li.addEventListener('pointerenter', function () { pick(i); });
      li.addEventListener('click', function (e) { e.stopPropagation(); pick(i); choose(); });
      choicesEl.appendChild(li);
    });
    choicesEl.hidden = false;
    box.classList.add('choosing');
    pick(0);
  }
  function pick(i) {
    if (!options.length) return;
    sel = (i + options.length) % options.length;
    [].forEach.call(choicesEl.children, function (li, n) { li.classList.toggle('sel', n === sel); });
    blip();
  }
  function choose() {
    var c = options[sel];
    if (c) go(c.to);
  }

  function start() {
    if (!DATA || talking) return;
    talking = true;
    prompt.hidden = true;
    box.hidden = false;
    var first = (DATA.returning && seen[DATA.start] && DATA.nodes[DATA.returning]) ? DATA.returning : DATA.start;
    go(first);
  }
  function end() {
    talking = false; node = null; queue = [];
    box.hidden = true;
    useArt('');
    prompt.textContent = '[ Z ] or tap to talk again';
    prompt.hidden = false;
  }

  // ---- input ----
  function primary() {
    if (!talking) return start();
    if (typing) return finishTyping();
    if (box.classList.contains('choosing')) return choose();
    advance();
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toLowerCase();
    if (k === 'm') { toggleMute(); return; }
    if (k === 'z' || k === 'enter' || k === ' ') { e.preventDefault(); if (!e.repeat) primary(); return; }
    if ((k === 'x' || k === 'shift') && typing) { finishTyping(); return; }
    if (box.classList.contains('choosing')) {
      var cols = getComputedStyle(choicesEl).gridTemplateColumns.split(' ').length;
      var d = { arrowleft: -1, arrowright: 1, arrowup: -cols, arrowdown: cols }[k];
      if (d) { e.preventDefault(); pick(sel + d); }
    }
  });
  room.addEventListener('click', function (e) {
    if (e.target.closest('a, button')) return;
    primary();
  });
  muteBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });

  // ---- load his words ----
  fetch('dialogue.json?v=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (d) { DATA = d; })
    .catch(function (e) {
      console.warn('[marquez] dialogue.json did not load', e);
      prompt.textContent = '* (He doesn\'t seem to want to talk right now.)';
    });
})();
