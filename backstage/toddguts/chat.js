// Talking to TODD: a pretend language model, in his terminal.
// Everything he can say is in brain.json. This file only reads what you type, works out what you mean,
// and makes him answer like he's thinking about it (a spinner, then the reply streaming in word by word).
//
// How it understands you, in order:
//   1. terminal commands: help, cls, dir, type <file>, reboot, ver
//   2. "my name is ..." style lines (he remembers your name)
//   3. topics (brain.json "topics"): the longest phrase whose words are all in what you typed wins
//   4. reflections ("i feel *"): he turns part of what you said back on you
//   5. fallback lines
// He remembers your name and what you've asked ("rvToddChat"). Insults raise his temper; at 3 he has a tantrum.
(function () {
  'use strict';
  const log = document.getElementById('log');
  const form = document.getElementById('ask');
  const input = document.getElementById('ask-in');
  let BRAIN = null, SYN = {}, busy = false, lastTopic = '', lastReply = {}, temper = 0, temperAt = Date.now();

  // ---- memory ----
  let mem = { name: '', asked: {}, visit: 0, last: '', feel: '', mean: 0 };
  try { mem = Object.assign(mem, JSON.parse(localStorage.getItem('rvToddChat')) || {}); } catch (e) {}
  function save() { try { localStorage.setItem('rvToddChat', JSON.stringify(mem)); } catch (e) {} }
  function items(key) { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }

  fetch('brain.json?v=' + Date.now()).then((r) => r.json()).then((b) => {
    BRAIN = b;
    Object.keys(b.synonyms || {}).forEach((main) => b.synonyms[main].forEach((w) => { SYN[w] = main; }));
    greetDead();
  }).catch((e) => { console.warn('[todd] brain.json did not load', e); });

  // ---- reading what you typed ----
  const CONTRACT = [[/\bwhat's\b/g, 'what is'], [/\bwho's\b/g, 'who is'], [/\bwhere's\b/g, 'where is'], [/\bhow's\b/g, 'how is'],
    [/\bit's\b/g, 'it is'], [/\bthat's\b/g, 'that is'], [/\bi'm\b/g, 'i am'], [/\bim\b/g, 'i am'], [/\byou're\b/g, 'you are'],
    [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/n't\b/g, ' not'],
    [/'re\b/g, ' are'], [/'ll\b/g, ' will'], [/'ve\b/g, ' have'], [/'d\b/g, ' would'], [/\bu\b/g, 'you'], [/\br\b/g, 'are'], [/\bur\b/g, 'your']];
  function clean(text) {
    let t = String(text).toLowerCase().replace(/[\u2018\u2019`]/g, "'");
    CONTRACT.forEach(([a, b]) => { t = t.replace(a, b); });
    return t.replace(/[^a-z0-9' ]+/g, ' ').replace(/'/g, '').replace(/\s+/g, ' ').trim();
  }
  const syn = (w) => SYN[w] || w;

  function topicFor(t) {
    const raw = t.split(' '), set = new Set(raw.concat(raw.map(syn)));
    let best = null, bestScore = 0;
    (BRAIN.topics || []).forEach((tp) => {
      if (tp.short && raw.length > 3) return;
      (tp.match || []).forEach((phrase) => {
        const words = clean(phrase).split(' ');
        if (!words.every((w) => set.has(w) || set.has(syn(w)))) return;
        const score = words.length + (t.indexOf(clean(phrase)) >= 0 ? 0.5 : 0);
        if (score > bestScore) { bestScore = score; best = tp; }
      });
    });
    return best ? { topic: best, score: bestScore } : null;
  }

  const SWAP = { i: 'you', me: 'you', my: 'your', mine: 'yours', am: 'are', myself: 'yourself', you: 'I', your: 'my', yours: 'mine', yourself: 'myself' };
  function reflect(t, names) {
    for (const r of BRAIN.reflect || []) {
      if (!!r.name !== !!names) continue;
      const re = new RegExp('(?:^|\\b)' + clean(r.pattern.replace('*', 'zzstarzz')).replace('zzstarzz', '(.+)') + '$');
      const m = t.match(re);
      if (!m) continue;
      const bit = m[1].split(' ').slice(0, 6).map((w) => SWAP[w] || w).join(' ');
      return { r, bit };
    }
    return null;
  }

  // ---- memory of this visit, for the next one ----
  function rememberSaid(said, t) {
    mem.visit = window.TODD ? TODD.visits : mem.visit;
    if (said.length > 3 && said.length < 60 && !/^(cls|clear|dir|ls|type|cat|reboot|ver)\b/i.test(said)) mem.last = said.trim();
    const feel = t.match(/\bi (?:feel|am feeling|am) (sad|tired|happy|bored|lonely|scared|angry|sick|fine|good|great|ok|okay|stressed|anxious|excited|hungry|sleepy|confused|lost)\b/);
    if (feel) mem.feel = feel[1];
    save();
  }
  // a new visit: TODD.OS brings something up from the last one
  function recall() {
    if (!window.TODD || !mem.visit || TODD.visits <= mem.visit) return;
    const options = [];
    if (mem.feel) options.push('> last time you said you felt ' + mem.feel.toUpperCase() + '. still?');
    if (mem.name) options.push('> ' + mem.name.toUpperCase() + '. you came BACK.', '> hello again, ' + mem.name + '. i KEPT your name.');
    else if (Object.keys(mem.asked).length) options.push('> you never told me your NAME.', '> you again. still no NAME?');
    if (mem.last) options.push('> you said "' + mem.last + '". i\'ve been THINKING about it.');
    if (mem.mean >= 2) options.push('> you were MEAN last time. i REMEMBER.');
    if (!options.length) return;
    TODD.line(options[(Math.random() * options.length) | 0]);
    // once per visit; then start fresh, so next time he brings up THIS visit (he keeps your name)
    Object.assign(mem, { visit: TODD.visits, feel: '', last: '', mean: 0 }); save();
  }
  setTimeout(recall, 7000 + Math.random() * 4000);

  // ---- choosing what he says ----
  function allowed(reply) {
    if (typeof reply === 'string') return true;
    const have = items('rp_items'), had = items('rp_items_had');
    if (reply.has && !have[reply.has]) return false;
    if (reply.had && !(had[reply.had] || have[reply.had])) return false;
    if (reply.lost && !(had[reply.lost] && !have[reply.lost])) return false;
    if (reply.never && (had[reply.never] || have[reply.never])) return false;
    if (reply.level != null && (window.TODD ? TODD.level : 0) < reply.level) return false;
    if (reply.named != null && !!mem.name !== reply.named) return false;
    if (reply.flag) {
      const not = reply.flag.charAt(0) === '!', f = items('rp_flags')[not ? reply.flag.slice(1) : reply.flag];
      if (not ? f : !f) return false;
    }
    return true;
  }
  function choose(list, key) {
    const ok = (list || []).filter(allowed);
    if (!ok.length) return null;
    let r = ok[(Math.random() * ok.length) | 0];
    if (ok.length > 1 && r === lastReply[key]) r = ok[(ok.indexOf(r) + 1) % ok.length];   // not the same line twice running
    lastReply[key] = r;
    return r;
  }
  function fill(text, bit) {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return String(text).replace(/\{name\}/g, mem.name || 'CURSOR').replace(/\{NAME\}/g, (mem.name || 'CURSOR').toUpperCase())
      .replace(/\{kills\}/g, (() => { try { return +localStorage.getItem('rvKills') || 0; } catch (e) { return 0; } })())
      .replace(/\{visits\}/g, window.TODD ? TODD.visits : 1).replace(/\{time\}/g, time).replace(/\{1\}/g, bit || '...');
  }

  function think(said) {
    const t = clean(said);
    if (!t) return null;
    const words = t.split(' ');
    // 1. commands
    const cmd = words[0], arg = (said.trim().split(/\s+/)[1] || '').toUpperCase();
    if (words.length <= 2 && ['cls', 'clear'].includes(cmd)) return { cls: true };
    if (words.length === 1 && ['dir', 'ls'].includes(cmd)) return { text: Object.keys(BRAIN.files || {}).map((f) => '  ' + f).join('\n'), raw: true };
    if (['type', 'cat', 'open', 'read'].includes(cmd) && arg) {
      const f = Object.keys(BRAIN.files || {}).find((k) => k === arg || k.split('.')[0] === arg.split('.')[0]);
      return f ? { text: BRAIN.files[f], raw: true } : { text: 'FILE NOT FOUND: ' + arg + '. try DIR.', face: 'error' };
    }
    if (words.length === 1 && cmd === 'reboot') return { text: 'REBOOTING... see you on the OTHER side.', do: 'reboot' };
    if (words.length === 1 && ['ver', 'version'].includes(cmd)) return { text: 'TODD.OS v0.?? // BOOT DISK 1 OF ?? // 640K', raw: true };
    // 2. names
    rememberSaid(said, t);
    const named = reflect(t, true);
    if (named) {
      mem.name = named.bit.split(' ').slice(0, 2).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      save();
      return { text: fill(choose(named.r.replies, 'name'), named.bit), face: named.r.face };
    }
    // 3. topics, 4. reflections, 5. fallback
    const hit = topicFor(t);
    const echo = reflect(t, false);
    if (hit && (hit.score >= 1.5 || !echo)) {
      const tp = hit.topic, seen = mem.asked[tp.id] || 0;
      mem.asked[tp.id] = seen + 1; save();
      let r = seen && tp.again && Math.random() < 0.7 ? choose(tp.again, tp.id + ':again') : null;
      if (!r) r = choose(tp.replies, tp.id);
      if (!r) r = choose(BRAIN.fallback, 'fallback');
      const repeat = lastTopic === tp.id && !tp.again && Math.random() < 0.35;
      lastTopic = tp.id;
      if (tp.id === 'insult') { mem.mean = (mem.mean || 0) + 1; save(); }
      if (tp.live === 'news') return { live: 'news', lead: fill(r.text || r), face: tp.face };
      if (tp.live === 'market' || (tp.ticker && /\b(price|prices|worth|doing|stock|stocks|cost|costs|value|up|down|trading|at|chart|buy|sell|invest)\b/.test(t))) {
        return { live: tp.live === 'market' ? 'market' : 'price', ticker: tp.ticker, lead: fill(r.text || r), face: tp.face };
      }
      return { text: repeat ? 'you JUST asked that. ' + fill(r.text || r) : fill(r.text || r), face: r.face || tp.face, anger: (tp.anger || 0) + (r.anger || 0), do: tp.do };
    }
    if (echo) { lastTopic = ''; return { text: fill(choose(echo.r.replies, echo.r.pattern), echo.bit), face: echo.r.face }; }
    lastTopic = '';
    const aware = window.TODD && TODD.level >= 1 && Math.random() < 0.35;
    const r = choose(aware ? BRAIN.fallback_aware : BRAIN.fallback, 'fallback');
    return { text: fill(r ? (r.text || r) : '...'), face: Math.random() < 0.5 ? 'error' : 'loading' };
  }

  // ---- the terminal ----
  function trim() { while (log.childElementCount > 40) log.firstElementChild.remove(); log.scrollTop = log.scrollHeight; }
  function line(cls, text) {
    const el = document.createElement('div');
    el.className = 'msg ' + cls;
    if (text != null) el.textContent = text;
    log.appendChild(el); trim();
    return el;
  }
  // now and then a word comes out in his jumbled caps ("I CouLD NEver Be LIKe HiM")
  function jumble(w) { return w.split('').map((c) => (Math.random() < 0.5 ? c.toUpperCase() : c.toLowerCase())).join(''); }
  function stream(el, text, raw, done) {
    const parts = raw ? [text] : text.split(/(\s+)/);
    let i = 0;
    el.textContent = '';
    const cursor = document.createElement('span'); cursor.className = 'caret'; cursor.textContent = '\u2588';
    el.appendChild(cursor);
    (function next() {
      if (i >= parts.length) { cursor.remove(); return done(); }
      let p = parts[i++];
      if (!raw && /\w{3,}/.test(p) && Math.random() < 0.06) p = jumble(p);
      cursor.before(document.createTextNode(p));
      trim();
      setTimeout(next, raw ? 0 : /\s/.test(p) ? 0 : 35 + Math.random() * 90 + (/[.!?]$/.test(p) ? 220 : 0));
    })();
  }

  // the real market, from /prices.json
  let pricesAt = 0, prices = null;
  function market() {
    if (prices && Date.now() - pricesAt < 60000) return Promise.resolve(prices);
    return fetch('/prices.json?v=' + Date.now()).then((r) => r.json()).then((d) => { prices = d; pricesAt = Date.now(); return d; }).catch(() => null);
  }
  function quote(c) {
    const ch = +c.change || 0;
    return c.id + ' is at ' + (+c.price).toFixed(2) + ' POLYGONS, ' + (ch > 0 ? 'UP ' : ch < 0 ? 'DOWN ' : 'FLAT ') + Math.abs(ch).toFixed(2) + '%' +
      (ch > 8 ? '. GLORIOUS.' : ch < -8 ? '. OOF. OUCH.' : '.');
  }
  function live(reply) {
    if (!reply || !reply.live) return Promise.resolve(reply);
    return market().then((d) => {
      const list = d && d.companies;
      if (!list) return Object.assign(reply, { text: reply.lead + ' ...the MARKET feed is down. i can\'t SEE the numbers.' });
      if (reply.live === 'news') {
        const n = (d.news || [])[0];
        return Object.assign(reply, { text: n ? reply.lead + '\n  "' + n.headline + '"' + (typeof n.move === 'number' ? ' (' + (n.move >= 0 ? '+' : '') + n.move.toFixed(2) + '%)' : '') : reply.lead + ' ...NOTHING. no news. SUSPICIOUS.', keepLines: true });
      }
      if (reply.live === 'market') return Object.assign(reply, { text: reply.lead + '\n' + list.map((c) => '  ' + quote(c)).join('\n'), keepLines: true });
      const c = list.find((x) => x.id === reply.ticker);
      return Object.assign(reply, { text: c ? quote(c) + ' ' + reply.lead : reply.lead });
    });
  }

  function answer(said) {
    if (!BRAIN || busy) return;
    if (window.TODD && TODD.busy) { line('todd err', 'ERROR: TODD.EXE IS NOT RESPONDING'); return; }
    if (window.TODD && TODD.asleep) {
      // he's asleep: you get mumbles, not answers (poke him to wake him)
      line('you', 'C:\\TODD> ' + said);
      const pool = (TODD.lines().sleep_talk || []);
      line('todd think', pool.length ? pool[(Math.random() * pool.length) | 0] : '> zzz');
      return;
    }
    // his temper cools off over time
    temper = Math.max(0, temper - (Date.now() - temperAt) / 60000); temperAt = Date.now();
    line('you', 'C:\\TODD> ' + said);
    const first = think(said);
    if (!first) return;
    if (first.cls) { log.textContent = ''; return; }
    const ready = live(first);   // looks up the market while he 'thinks'
    busy = true; form.classList.add('busy');
    if (window.TODD) { TODD.faceYou(); TODD.face('loading'); }
    // thinking...
    const el = line('todd think');
    const spin = '|/-\\';
    let k = 0;
    const thinking = setInterval(() => { el.textContent = 'processing ' + spin[k++ % 4]; }, 90);
    const minThink = new Promise((ok) => setTimeout(ok, 450 + Math.min(1400, said.length * 25) + Math.random() * 500));
    Promise.all([ready, minThink]).then(([reply]) => {
      clearInterval(thinking);
      el.className = 'msg todd';
      if (window.TODD && reply.face) TODD.face(reply.face);
      temper = Math.max(0, temper + (reply.anger || 0));
      stream(el, (reply.raw ? '' : '> ') + reply.text, reply.raw, () => {
        busy = false; form.classList.remove('busy');
        if (window.TODD) {
          TODD.attend();
          const act = { face_you: TODD.faceYou, approach: TODD.approach, wander: TODD.wander, spin: TODD.spin, glitch: TODD.glitch, reboot: TODD.reboot, rage: TODD.rage, agony: () => TODD.agony(1300) }[reply.do];
          if (act) act();
          if (temper >= 3 || reply.do === 'rage') { temper = 0; setTimeout(TODD.rage, 500); }
        }
      });
    });
  }

  // he was beaten in the fight (rp_flags.todd_dead), but here he still is: he says so as his page opens
  function greetDead(tries) {
    if (!items('rp_flags').todd_dead) return;
    tries = tries || 0;
    const ready = document.getElementById('boot').classList.contains('gone') && window.TODD;
    if (!ready || busy || TODD.busy) { if (tries < 40) setTimeout(() => greetDead(tries + 1), 400); return; }
    if (TODD.asleep) return;   // asleep at night: he'll ask some other time
    const r = choose(BRAIN.greet_dead, 'greet_dead');
    if (!r) return;
    busy = true; form.classList.add('busy');
    TODD.faceYou(); TODD.face(r.face || 'surprised');
    const el = line('todd');
    setTimeout(() => stream(el, '> ' + fill(r.text || r), false, () => { busy = false; form.classList.remove('busy'); TODD.attend(); }), 900);
  }

  // ---- phones ----
  const touch = matchMedia('(pointer: coarse)').matches;
  if (touch) input.placeholder = 'tap to talk';
  // tap the void to put the keyboard away
  document.getElementById('stage').addEventListener('pointerdown', () => { if (touch && document.activeElement === input) input.blur(); });
  // the on-screen keyboard covers the bottom of the screen (on iPhone it doesn't shrink the page): lift the chat above it
  const vv = window.visualViewport;
  if (vv) {
    const lift = () => {
      const kb = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
      document.documentElement.style.setProperty('--kb', kb + 'px');
      document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
      log.scrollTop = log.scrollHeight;
    };
    vv.addEventListener('resize', lift); vv.addEventListener('scroll', lift); lift();
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const said = input.value.trim().slice(0, 120);
    input.value = '';
    if (said) answer(said);
  });
  input.addEventListener('input', () => { if (window.TODD) TODD.attend(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') input.blur(); });
  // start typing anywhere and it goes to the terminal
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || document.activeElement === input) return;
    if (e.key.length === 1 && /\S/.test(e.key)) input.focus();
  });
  form.addEventListener('pointerdown', (e) => e.stopPropagation());
})();
