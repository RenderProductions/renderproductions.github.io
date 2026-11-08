// A pretend brain for the people backstage (Cedar in /backstage/marquez/, Wonder in /backstage/wonder/).
// It works like TODD's chat in /backstage/toddguts/, but speaks through the dialogue box:
// you type anything, and he answers in his own voice, one text box at a time.
//
// Load it AFTER /backstage/marquez/marquez.js. It reads brain.json from the page's own folder.
// Everything he can say lives there (and in dialogue.json, which his brain can jump into).
//
// How it reads what you typed, in order:
//   1. Codes from dialogue.json "finds" typed on their own ("CEDAR", "404"...) do exactly what they
//      always did. Some can also be spotted inside a sentence (brain.json "loose").
//   2. Show-and-tell: "I want to show you something" opens your drawer; pick a thing to show him.
//      Naming a thing you have ("look at this pail") shows it straight away.
//   3. Making things (Cedar only): "make something" opens the workbench, once he has light to work by.
//   4. Topics: the longest matching phrase wins (all of its words somewhere in what you typed).
//   5. "my name is ..." (he remembers it), and patterns like "i feel *" that turn your words around.
//   6. Fallback lines.
(function () {
  'use strict';
  if (!window.TALKER) return;

  var BRAIN = null, SYN = {}, FINDS = {}, LOOSE = [], ITEMS = {}, CATALOG = {};
  var mode = 'chat', lastNode = '', lastTopic = '', lastReply = {}, picking = false;
  var anger = 0;   // his temper this visit (brain.json "temper"): insults raise it, kind words cool it
  var inv = window.RPInventory;
  var room = document.getElementById('room');

  // ---- memory (this browser only) ----
  var MEM_KEY = 'rv' + (document.body.getAttribute('data-who') || 'Someone') + 'Chat';
  var mem = { name: '', asked: {} };
  try { mem = Object.assign(mem, JSON.parse(localStorage.getItem(MEM_KEY)) || {}); } catch (e) {}
  function save() { try { localStorage.setItem(MEM_KEY, JSON.stringify(mem)); } catch (e) {} }
  function store(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch (e) { return {}; } }

  // ---- reading what you typed (the same rules as TODD's chat) ----
  var CONTRACT = [[/\bwhat's\b/g, 'what is'], [/\bwho's\b/g, 'who is'], [/\bwhere's\b/g, 'where is'], [/\bhow's\b/g, 'how is'],
    [/\bit's\b/g, 'it is'], [/\bthat's\b/g, 'that is'], [/\bi'm\b/g, 'i am'], [/\bim\b/g, 'i am'], [/\byou're\b/g, 'you are'],
    [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/n't\b/g, ' not'],
    [/'re\b/g, ' are'], [/'ll\b/g, ' will'], [/'ve\b/g, ' have'], [/'d\b/g, ' would'], [/\bu\b/g, 'you'], [/\br\b/g, 'are'], [/\bur\b/g, 'your']];
  function clean(text) {
    var t = String(text).toLowerCase().replace(/[‘’`]/g, "'");
    CONTRACT.forEach(function (c) { t = t.replace(c[0], c[1]); });
    return t.replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  function code(v) { return String(v || '').trim().replace(/\s+/g, ' ').toUpperCase().replace(/[.!?]+$/, ''); }
  function syn(w) { return SYN[w] || w; }
  function hasWords(t, phrase) { return (' ' + t + ' ').indexOf(' ' + phrase + ' ') >= 0; }

  // ---- conditions on a reply ----
  // has / had / lost / never: items. flag: shared rp_flags ("!flag" = not set). seen / unseen: something he's
  // said in dialogue.json (a node id or a "mark"). named: whether he knows your name. after: only right
  // after that node or topic. known: whether you've found out his real name (Cedar).
  function ok(r) {
    if (!r || typeof r === 'string' || Array.isArray(r)) return true;
    var have = store('rp_items'), had = store('rp_items_had'), flags = store('rp_flags');
    if (r.has && !have[r.has]) return false;
    if (r.had && !(had[r.had] || have[r.had])) return false;
    if (r.lost && !(had[r.lost] && !have[r.lost])) return false;
    if (r.never && (had[r.never] || have[r.never])) return false;
    if (r.flag) { var not = r.flag.charAt(0) === '!', f = flags[not ? r.flag.slice(1) : r.flag]; if (not ? f : !f) return false; }
    if (r.seen && !TALKER.seen(r.seen)) return false;
    if (r.unseen && TALKER.seen(r.unseen)) return false;
    if (r.named != null && !!mem.name !== r.named) return false;
    if (r.known != null && TALKER.known() !== r.known) return false;
    if (r.after && [].concat(r.after).indexOf(lastNode) < 0 && [].concat(r.after).indexOf(lastTopic) < 0) return false;
    return true;
  }
  function choose(list, key) {
    var good = (list || []).filter(ok);
    if (!good.length) return null;
    var r = good[Math.floor(Math.random() * good.length)];
    if (good.length > 1 && r === lastReply[key]) r = good[(good.indexOf(r) + 1) % good.length];
    lastReply[key] = r;
    return r;
  }
  function kills() { try { return +localStorage.getItem('rvKills') || 0; } catch (e) { return 0; } }
  function fill(text, bit, item) {
    return String(text)
      .replace(/\{name\}/g, mem.name || BRAIN.noName || 'friend')
      .replace(/\{NAME\}/g, (mem.name || BRAIN.noName || 'friend').toUpperCase())
      .replace(/\{kills\}/g, kills())
      .replace(/\{item\}/g, item || 'that')
      .replace(/\{1\}/g, bit || '...');
  }
  // A reply is a line, a list of lines, or {say: [...], face, go, do...}. Lines are dialogue.json lines.
  function linesOf(r, bit, item) {
    var src = typeof r === 'string' ? [r] : Array.isArray(r) ? r : (r.say ? [].concat(r.say) : [r]);
    return src.map(function (l) {
      if (typeof l === 'string') return fill(l, bit, item);
      var c = Object.assign({}, l);
      if (c.text) c.text = fill(c.text, bit, item);
      if (!c.face && r.face) c.face = r.face;
      return c;
    }).filter(ok);
  }

  // ---- the say-something box ----
  function open(m, n) {
    mode = m || 'chat';
    if (n && n !== true) {
      var id = Object.keys(TALKER.data().nodes).find(function (k) { return TALKER.data().nodes[k] === n; });
      if (id) lastNode = id;
    }
    if (mode === 'code') TALKER.ask(BRAIN.ui.codePlaceholder, BRAIN.ui.codeButton);
    else TALKER.ask(mem.name && BRAIN.ui.namedPlaceholder ? fill(BRAIN.ui.namedPlaceholder) : BRAIN.ui.placeholder, BRAIN.ui.button);
  }
  function speak(r, opts) {
    opts = opts || {};
    var lines = linesOf(r, opts.bit, opts.item);
    if (!lines.length) lines = linesOf(choose(BRAIN.fallback, 'fallback') || '...');
    TALKER.speak(lines, { end: !!opts.end, mark: r && r.mark });
  }
  function go(id) { lastNode = id; TALKER.go(id); }

  // ---- show and tell: the drawer, laid out in front of him ----
  var picker = null;
  function showNodeFor(id) {
    var give = TALKER.data().nodes[BRAIN.giveNode || 'give'];
    var c = give && (give.choices || []).filter(function (ch) { return ch.has === id; })[0];
    return c ? c.to : null;
  }
  function openPicker() {
    var things = inv ? inv.list().filter(showNodeFor) : [];
    if (!things.length) { lastTopic = 'show_none'; return speak(choose(BRAIN.say.show_none, 'show_none')); }
    if (!picker) {
      picker = document.createElement('section');
      picker.className = 'picker';
      picker.setAttribute('aria-label', 'Your drawer');
      picker.innerHTML = '<div class="picker-head"></div><div class="picker-tray"></div><button type="button" class="picker-no">NEVER MIND</button>';
      picker.addEventListener('click', function (e) { e.stopPropagation(); });
      picker.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); closePicker(); open('chat'); } });
      picker.querySelector('.picker-no').addEventListener('click', function () { closePicker(); speak(choose(BRAIN.say.show_cancel, 'show_cancel')); });
      room.appendChild(picker);
    }
    picker.querySelector('.picker-head').textContent = BRAIN.ui.pickerTitle || 'Show him...';
    var tray = picker.querySelector('.picker-tray');
    tray.textContent = '';
    things.forEach(function (id) {
      var it = CATALOG[id] || {};
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'picker-thing'; b.title = it.name || id;
      var pic = document.createElement('span'); pic.className = 'pic';
      if (it.art) { var img = new Image(); img.src = it.art; img.alt = ''; img.draggable = false; pic.appendChild(img); }
      var label = document.createElement('span'); label.className = 'label'; label.textContent = it.name || id;
      b.appendChild(pic); b.appendChild(label);
      b.addEventListener('click', function () { closePicker(); go(showNodeFor(id)); });
      tray.appendChild(b);
    });
    TALKER.closeAsk();
    picking = true;
    picker.hidden = false;
    requestAnimationFrame(function () { picker.classList.add('on'); });
    setTimeout(function () { var f = tray.querySelector('button'); if (f) f.focus({ preventScroll: true }); }, 60);
  }
  function closePicker() { picking = false; if (picker) { picker.classList.remove('on'); picker.hidden = true; } }

  // ---- making things (Cedar's workbench, bench.js) ----
  function craft() {
    var c = BRAIN.craft;
    if (!c) return false;
    if (!inv || !inv.has(c.light)) return speak(choose(BRAIN.say.craft_dark, 'craft_dark')), true;
    if (!TALKER.seen(c.unlock)) return speak(choose(BRAIN.say.craft_unshown, 'craft_unshown')), true;
    go(c.node);
    return true;
  }

  // ---- working out what you meant ----
  // The thing you named, if any. The longest name wins; on a tie (a "bulb" could be either bulb),
  // one you actually have wins.
  function itemIn(t) {
    var best = null, bestLen = 0, bestOwned = false;
    Object.keys(ITEMS).forEach(function (id) {
      var owned = !!(inv && inv.has(id));
      ITEMS[id].forEach(function (alias) {
        var a = clean(alias);
        if (!a || !hasWords(t, a)) return;
        if (a.length > bestLen || (a.length === bestLen && owned && !bestOwned)) { best = id; bestLen = a.length; bestOwned = owned; }
      });
    });
    return best ? { id: best, score: bestLen / 4 } : null;
  }
  function topicFor(t) {
    var raw = t.split(' '), set = {};
    raw.forEach(function (w) { set[w] = 1; set[syn(w)] = 1; });
    var best = null, bestScore = 0;
    (BRAIN.topics || []).forEach(function (tp) {
      if (tp.short && raw.length > 3) return;
      if (!ok(tp)) return;
      (tp.match || []).forEach(function (phrase) {
        var p = clean(phrase), words = p.split(' ');
        if (!words.every(function (w) { return set[w] || set[syn(w)]; })) return;
        var score = words.length + (t.indexOf(p) >= 0 ? 0.5 : 0) + (tp.after ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = tp; }
      });
    });
    return best ? { topic: best, score: bestScore } : null;
  }
  var SWAP = { i: 'you', me: 'you', my: 'your', mine: 'yours', am: 'are', myself: 'yourself', you: 'I', your: 'my', yours: 'mine', yourself: 'myself' };
  function reflect(t, names) {
    var list = BRAIN.reflect || [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      if (!!r.name !== !!names) continue;
      var re = new RegExp('(?:^|\\b)' + clean(r.pattern.replace('*', 'zzstarzz')).replace('zzstarzz', '(.+)') + '$');
      var m = t.match(re);
      if (!m) continue;
      return { r: r, bit: m[1].split(' ').slice(0, 6).map(function (w) { return SWAP[w] || w; }).join(' ') };
    }
    return null;
  }

  function think(said) {
    var c = code(said), t = clean(said);
    if (!c) return open(mode);

    // "Tell him something": the next thing typed is a code (like the old "what did you find?" box).
    if (mode === 'code') {
      var to = FINDS[c];
      return go(to || TALKER.data().findMiss || BRAIN.giveNode);
    }
    if (!t) return speak(choose(BRAIN.fallback, 'fallback'));

    // 1. a code on its own does what it always did (unless it's an everyday word, like "hello")
    var chatWord = (BRAIN.chatWords || []).indexOf(c) >= 0;
    if (FINDS[c] && !chatWord) return go(FINDS[c]);

    // 2-4. everything that could match, best score wins
    var hit = topicFor(t);
    var score = hit ? hit.score : 0;
    var loose = null;
    LOOSE.forEach(function (k) {
      var p = clean(k);
      if (p && hasWords(t, p)) { var s = p.split(' ').length + 1.5; if (!loose || s > loose.s) loose = { k: k, s: s }; }
    });
    var item = itemIn(t);

    if (loose && loose.s >= score) { lastTopic = ''; return go(FINDS[loose.k]); }
    // "look at this pail": showing something you named, straight away
    if (hit && hit.topic.do === 'show' && item && inv && inv.has(item.id) && showNodeFor(item.id)) { lastTopic = 'item'; return go(showNodeFor(item.id)); }
    if (item && (!hit || item.score + 1 >= score)) {
      lastTopic = 'item';
      if (inv && inv.has(item.id) && showNodeFor(item.id)) return go(showNodeFor(item.id));
      var name = (CATALOG[item.id] && CATALOG[item.id].name) || item.id;
      var everHad = store('rp_items_had')[item.id];
      return speak(choose(everHad ? BRAIN.say.item_gone : BRAIN.say.item_missing, 'item_missing'), { item: name });
    }

    // a name ("my name is ...")
    var named = reflect(t, true);
    if (named && (!hit || hit.score < 2.5)) {
      mem.name = named.bit.split(' ').slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
      save();
      lastTopic = 'name';
      return speak(choose(named.r.replies, 'name'), { bit: named.bit });
    }

    var echo = reflect(t, false);
    if (hit && (hit.score >= 1.5 || !echo)) {
      var tp = hit.topic, seenBefore = mem.asked[tp.id] || 0;
      mem.asked[tp.id] = seenBefore + 1; save();
      lastTopic = tp.id;
      if (tp.do === 'show') return openPicker();
      if (tp.do === 'craft' && craft()) return;
      if (tp.do === 'tell') { lastNode = BRAIN.tellNode; return TALKER.go(BRAIN.tellNode); }
      // temper: insults build toward him snapping; apologies and kind words cool him back down
      var T = BRAIN.temper;
      if (T && tp.anger > 0) {
        anger += tp.anger;
        if (anger >= (T.snapAt || 4)) {
          anger = 0;
          var to3d = window.CEDAR3D && T.snap && TALKER.data().nodes[T.snap];
          return go(to3d ? T.snap : (T.snapFlat || T.snap));
        }
        var lv = (T.levels || [])[Math.min(anger, (T.levels || []).length) - 1];
        if (lv) return speak(choose(lv, 'temper' + anger));
      } else if (T && tp.anger < 0 && anger > 0) {
        anger = Math.max(0, anger + tp.anger);
        return speak(choose(T.calm, 'calm'));
      }
      if (tp.setFlag) TALKER.flag(tp.setFlag);
      var r = null;
      if (seenBefore && tp.again && Math.random() < 0.75) r = choose(tp.again, tp.id + ':again');
      if (!r && tp.replies) r = choose(tp.replies, tp.id);
      if (r && r.go) return go(r.go);
      if (!r && tp.go) return go(tp.go);
      if (!r) r = choose(BRAIN.fallback, 'fallback');
      return speak(r, { end: !!tp.end });
    }
    if (echo) { lastTopic = ''; return speak(choose(echo.r.replies, echo.r.pattern), { bit: echo.bit }); }

    // a code that's also an everyday word, and nothing else fit: the code after all
    if (FINDS[c]) return go(FINDS[c]);
    lastTopic = '';
    return speak(choose(BRAIN.fallback, 'fallback'));
  }

  // Plugged into the talk engine only once brain.json has loaded. If it never loads,
  // he just keeps his old menus.
  function plugIn() {
  TALKER.useChat({
    silent: function (id) { return !!BRAIN && (BRAIN.silent || []).indexOf(id) >= 0; },
    ends: function (n) {
      if (!n) return false;
      if (n.end) return true;
      var nodes = TALKER.data().nodes;
      return (BRAIN.ends || []).some(function (id) { return nodes[id] === n; });
    },
    open: open,
    submit: function (said) {
      if (picking) return;
      if (!said || !said.trim()) return open(mode);
      think(said.slice(0, 120));
    },
    escape: function () { closePicker(); TALKER.endTalk(); }
  });
  }

  fetch('brain.json?v=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function (b) {
      BRAIN = b;
      BRAIN.ui = BRAIN.ui || {};
      BRAIN.say = BRAIN.say || {};
      Object.keys(b.synonyms || {}).forEach(function (main) { b.synonyms[main].forEach(function (w) { SYN[w] = main; }); });
      ITEMS = b.items || {};
      var wait = setInterval(function () {
        var d = TALKER.data();
        if (!d) return;
        clearInterval(wait);
        Object.keys(d.finds || {}).forEach(function (k) { FINDS[code(k)] = d.finds[k]; });
        var skip = (b.chatWords || []);
        // Show-and-tell nodes are left out: naming a thing in a sentence shows it only if you have it.
        var shows = {};
        var give = d.nodes[b.giveNode || 'give'];
        ((give && give.choices) || []).forEach(function (ch) { shows[ch.to] = 1; });
        LOOSE = b.loose === '*'
          ? Object.keys(FINDS).filter(function (k) { return clean(k).length >= 4 && skip.indexOf(k) < 0 && !shows[FINDS[k]]; })
          : (b.loose || []).map(code).filter(function (k) { return FINDS[k]; });
        plugIn();
      }, 50);
    })
    .catch(function (e) { console.warn('[brain] brain.json did not load', e); });
  if (inv) inv.catalog().then(function (c) { CATALOG = c; });
})();
