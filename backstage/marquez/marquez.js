// Marquez: a conversation with the gentleman behind the desk.
// All of his words live in dialogue.json. This file only knows how to say them.
//
// Other characters can use this same file: set window.TALK before loading it, e.g.
//   window.TALK = { name: 'WONDER', art: 'art/wonder', faces: [], talkFrames: false,
//                   seenKey: 'rvWonderSeen', muteKey: 'rvWonderMute', canTalk: function () { return true; },
//                   autoStart: true };   // autoStart: speak first on someone's first visit (true, or a delay in ms)
// Anything left out keeps Marquez's settings. The page needs the same element ids as marquez/index.html.
//
// Controls: Z / Enter / Space = next or pick, X / Shift = finish the line now,
// arrow keys = move between choices, M = sound on or off. Tapping works too.
// When he asks what you found, type it and press Enter (Esc or an empty answer backs out).
(function () {
  'use strict';

  var room = document.getElementById('room');
  var him = document.getElementById('him');
  var prompt = document.getElementById('prompt');
  var box = document.getElementById('box');
  var plate = document.getElementById('plate');
  var textEl = document.getElementById('text');
  var choicesEl = document.getElementById('choices');
  var answerEl = document.getElementById('answer');
  var answerIn = document.getElementById('answer-in');
  var muteBtn = document.getElementById('mute');

  var CFG = window.TALK || {};
  var ART = CFG.art || 'art/marquez';
  var FACES = CFG.faces || ['smile', 'angry', 'point'];
  var TALK_FRAMES = CFG.talkFrames !== false;
  var WHO = CFG.name || 'MARQUEZ';

  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var DATA = null, talking = false;
  var queue = [], node = null;      // lines left in the current node
  var chars = [], shown = 0, timer = 0, typing = false, speed = 32;
  var options = [], sel = 0;
  var asking = false;               // waiting for the visitor to type something
  var paneled = false;              // a page panel (e.g. Cedar's workbench) has the floor

  // ---- memory: what this visitor has already heard (their browser only) ----
  var SEEN_KEY = CFG.seenKey || 'rvMarquezSeen', MUTE_KEY = CFG.muteKey || 'rvMarquezMute';
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

  // Choice "has": "itemId" only shows if it's in their drawer ("!itemId" = only if it isn't).
  function hasItem(req) {
    if (!req) return true;
    var inv = window.RPInventory;
    return [].concat(req).every(function (r) {
      var not = r.charAt(0) === '!', id = not ? r.slice(1) : r;
      var got = !!(inv && (id === '*' ? inv.list().length > 0 : inv.has(id)));
      return not ? !got : got;
    });
  }

  // ---- shared flags (same 'rp_flags' the frequency scanner and RFT use) ----
  function setFlag(name) {
    if (!name) return;
    try {
      var f = JSON.parse(localStorage.getItem('rp_flags')) || {};
      if (!f[name]) { f[name] = Date.now(); localStorage.setItem('rp_flags', JSON.stringify(f)); }
    } catch (e) {}
  }

  // Once he's been found out (DATA.knownFlag set), his nameplate shows his real name.
  function known() {
    if (!DATA || !DATA.knownName || !DATA.knownFlag) return false;
    try { return !!(JSON.parse(localStorage.getItem('rp_flags')) || {})[DATA.knownFlag]; } catch (e) { return false; }
  }

  // ---- art ----
  // art/marquez.svg is his normal look; art/marquez-<face>.svg are expressions.
  // While he talks, his mouth flaps between <face>-talk1 and <face>-talk2 (talk1/talk2 for
  // his normal face). A face without talk frames just holds still. Found automatically.
  var face = '', mouth = 0, flapAt = 0, hasTalk = {};
  function artSrc(f) { return ART + (f ? '-' + f : '') + '.svg'; }
  function talkFrame(f, n) { return (f ? f + '-' : '') + 'talk' + n; }
  function preload(f) {
    new Image().src = artSrc(f);
    if (f in hasTalk) return;
    hasTalk[f] = false;
    if (!TALK_FRAMES) return;
    var a = new Image(), b = new Image(), ok = 0;
    a.onload = b.onload = function () { if (++ok === 2) hasTalk[f] = true; };
    a.src = artSrc(talkFrame(f, 1)); b.src = artSrc(talkFrame(f, 2));
  }
  [''].concat(FACES).forEach(preload);
  him.addEventListener('error', function () { if (him.getAttribute('src') !== artSrc('')) him.src = artSrc(''); });
  function show(f) { var src = artSrc(f); if (him.getAttribute('src') !== src) him.src = src; }
  function useArt(f) { face = f || ''; preload(face); show(face); }
  function flap() {
    if (!hasTalk[face]) return;
    var now = Date.now();
    if (now - flapAt < 90) return;
    flapAt = now; mouth = (mouth + 1) % 2;
    show(talkFrame(face, mouth ? 1 : 2));
  }

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
        if (tag === 'grey') tag = 'gray';
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
    if (/[A-Za-z0-9]/.test(c.ch)) flap(); else if (c.wait) show(face);
    if (/[A-Za-z0-9]/.test(c.ch) && shown % ((DATA.voice && DATA.voice.every) || 2) === 1) blip();
    timer = setTimeout(typeNext, speed + c.wait);
  }
  function finishTyping() {
    clearTimeout(timer);
    chars.forEach(function (c) { c.el.classList.add('on'); });
    shown = chars.length;
    typing = false;
    room.classList.remove('talking');
    show(face);
    if (!queue.length && node && node.panel) openPanel();
    else if (!queue.length && node && node.ask) openAnswer();
    else if (!queue.length && node && node.choices) showChoices();
    else box.classList.add('done');
  }

  // ---- lines, nodes, choices ----
  function say(line) {
    if (typeof line === 'string') line = { text: line };
    if (line.mark) [].concat(line.mark).forEach(remember);
    useArt(line.face || (node && node.face) || '');
    plate.textContent = line.name || (node && node.name) || (known() ? DATA.knownName : DATA.name) || WHO;
    speed = reduce ? 0 : (line.speed || (node && node.speed) || DATA.speed || 32);
    box.classList.remove('done', 'choosing');
    closeAnswer();
    var t = (line.text || '').trim();
    box.classList.toggle('narrate', line.narrate != null ? !!line.narrate : (t.charAt(0) === '(' && t.charAt(t.length - 1) === ')'));
    choicesEl.hidden = true;
    render(parse(line.text || ''));
    // A line with "fx": "name" asks the page for an effect as it starts (the page listens for talk:fx).
    if (line.fx) { try { document.dispatchEvent(new CustomEvent('talk:fx', { detail: { fx: line.fx, text: line.text } })); } catch (e) {} }
    typing = true;
    room.classList.add('talking');
    if (speed === 0) finishTyping(); else typeNext();
  }

  function go(id) {
    var n = DATA.nodes[id];
    if (!n) { console.warn('[' + WHO.toLowerCase() + '] no node called "' + id + '"'); return end(); }
    // Already heard it, and there's a shorter version for next time? Use that instead.
    if (n.repeat && seen[id] && DATA.nodes[n.repeat] && n.repeat !== id) return go(n.repeat);
    // Lines can have "needs" too (same rules as choices): they're skipped unless it holds,
    // checked before this node counts as heard. A line's "mark": "word" remembers that word once it's said.
    var lines = [].concat(n.say || []).filter(function (l) { return typeof l === 'string' || (has(l.needs) && hasItem(l.has)); });
    // "pick": 1 says just one of the node's lines, chosen at random (for reactions that shouldn't get old).
    if (n.pick && lines.length) lines = [lines[Math.floor(Math.random() * lines.length)]];
    node = n; options = []; remember(id); setFlag(n.flag);
    if (n.mark) [].concat(n.mark).forEach(remember);   // node "mark": remember extra words when it's heard
    if (n.give && window.RPInventory) [].concat(n.give).forEach(function (it) { RPInventory.give(it); });
    if (n.takeItem && window.RPInventory) [].concat(n.takeItem).forEach(function (it) { RPInventory.take(it); });
    queue = lines;
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
      return has(c.needs) && hasItem(c.has) && !(c.once && seen[c.to]);
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

  // ---- "I found something": the visitor types what they found ----
  // A node with "ask" opens a text box after its lines. What they type is looked up in
  // DATA.finds (code -> node). No match goes to DATA.findMiss. Typing nothing goes back to "ask".
  function norm(v) { return String(v || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
  var FINDS = null;
  function findsTable() {
    if (FINDS) return FINDS;
    FINDS = {};
    Object.keys(DATA.finds || {}).forEach(function (k) { FINDS[norm(k)] = DATA.finds[k]; });
    return FINDS;
  }
  function openAnswer() {
    asking = true;
    box.classList.add('choosing');
    answerIn.value = '';
    answerEl.hidden = false;
    setTimeout(function () { try { answerIn.focus({ preventScroll: true }); } catch (e) { answerIn.focus(); } }, 0);
  }
  function closeAnswer() {
    asking = false;
    answerEl.hidden = true;
    if (document.activeElement === answerIn) answerIn.blur();
  }
  function submitAnswer() {
    if (!asking) return;
    var v = norm(answerIn.value);
    var back = node.ask === true ? 'ask' : node.ask;
    closeAnswer();
    if (!v) return go(back || DATA.returning || DATA.start);
    var to = findsTable()[v] || (v.replace(/[.!?]+$/, '') && findsTable()[v.replace(/[.!?]+$/, '')]);
    go(to || DATA.findMiss || back);
  }
  answerEl.addEventListener('submit', function (e) { e.preventDefault(); e.stopPropagation(); submitAnswer(); });
  answerEl.addEventListener('click', function (e) { e.stopPropagation(); });
  answerIn.addEventListener('keydown', function (e) {
    e.stopPropagation();   // typing Z, M or space here is just typing
    if (e.key === 'Escape') { e.preventDefault(); answerIn.value = ''; submitAnswer(); }
  });

  // ---- panels: a node with "panel": "name" hands over to the page after its lines ----
  // The page hears 'talk:panel' ({ panel, node }) and answers with TALKER.go('nodeId') or TALKER.end().
  function openPanel() {
    paneled = true;
    box.classList.add('choosing');
    try { document.dispatchEvent(new CustomEvent('talk:panel', { detail: { panel: node.panel, node: node } })); } catch (e) {}
  }
  window.TALKER = {
    go: function (id) { if (!DATA) return; paneled = false; if (!talking) { talking = true; prompt.hidden = true; box.hidden = false; } go(id); },
    end: function () { paneled = false; end(); },
    seen: function (id) { return !!seen[id]; }
  };

  function start() {
    if (!DATA || talking) return;
    if (CFG.canTalk && !CFG.canTalk()) return;
    talking = true;
    prompt.hidden = true;
    box.hidden = false;
    var first = (DATA.returning && seen[DATA.start] && DATA.nodes[DATA.returning]) ? DATA.returning : DATA.start;
    go(first);
  }
  function end() {
    paneled = false;
    talking = false; node = null; queue = [];
    closeAnswer();
    box.hidden = true;
    useArt('');
    prompt.textContent = 'press Z or tap to talk again';
    prompt.hidden = false;
  }

  // ---- input ----
  function primary() {
    if (!talking) return start();
    if (typing) return finishTyping();
    if (asking || paneled) return;
    if (box.classList.contains('choosing')) return choose();
    advance();
  }
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('a, button, input')) return;   // let Enter follow "back", etc.
    var k = (e.key || '').toLowerCase();
    if (k === 'm') { toggleMute(); return; }
    if (k === 'z' || k === 'enter' || k === ' ') { e.preventDefault(); if (!e.repeat) primary(); return; }
    if ((k === 'x' || k === 'shift') && typing) { finishTyping(); return; }
    if (box.classList.contains('choosing') && !asking && !paneled) {
      var cols = getComputedStyle(choicesEl).gridTemplateColumns.split(' ').length;
      var d = { arrowleft: -1, arrowright: 1, arrowup: -cols, arrowdown: cols }[k];
      if (d) { e.preventDefault(); pick(sel + d); }
    }
  });
  room.addEventListener('click', function (e) {
    if (e.target.closest('a, button, form, [data-panel]')) return;
    // While choosing, only a tap on a choice itself picks (handled on the <li>),
    // so a stray tap on the room can't choose the highlighted option by accident.
    if (talking && !typing && box.classList.contains('choosing')) return;
    primary();
  });
  muteBtn.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(); });

  // ---- load his words ----
  fetch('dialogue.json?v=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (d) {
      DATA = d; FINDS = null;
      // TALK.autoStart: speak up on his own the first time someone arrives (before they press anything).
      if (CFG.autoStart && !seen[DATA.start] && (!CFG.canTalk || CFG.canTalk())) setTimeout(start, CFG.autoStart === true ? 900 : CFG.autoStart);
    })
    .catch(function (e) {
      console.warn('[' + WHO.toLowerCase() + '] dialogue.json did not load', e);
      prompt.textContent = '(He doesn\'t seem to want to talk right now.)';
    });
})();
