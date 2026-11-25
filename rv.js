// RendConomy on the site: play Rend-Conomy from any page.
//   RV.me()            who's logged in (from Log in with Discord on the profile page), or null
//   RV.token()         their Discord token for this browser session, or null
//   RV.login()         logs in, then comes back to this page
//   RV.servers()       the servers they play in (from the published profiles), as [{ id, server, worth }]
//   RV.guild()         the server their actions go to (picked with RV.picker, remembered)
//   RV.run(line)       runs a bot command as them, in that server; resolves to the bot's reply
//   RV.show(el, line, reply)  draws a reply (with the bot's emojis, its buttons and live updates) into el
//   RV.live(fn)        calls fn with the live feed (prices, changes, world event) now and every 20 seconds
// It also puts a notification bell in the site's nav for logged-in players.
(function () {
  'use strict';
  var CLIENT_ID = '1569206837352337609';
  var RELAY = 'https://rend-conomy.lowrendergaming.workers.dev';
  var PROFILES = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io/data/profiles.json';
  var RV = window.RV = window.RV || {};
  var ls = {
    get: function (k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var esc = function (t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  RV.esc = esc;

  // ---------------------------------------------------------------- who
  RV.me = function () { return ls.get('rv_me'); };
  RV.token = function () {
    try { var t = JSON.parse(sessionStorage.getItem('rv_token')); return t && t.until > Date.now() + 60000 ? t.t : null; } catch (e) { return null; }
  };
  /** Discord sends players back to /profile/, which sends them on to where they started. */
  RV.login = function () {
    var state = Math.random().toString(36).slice(2);
    try { sessionStorage.setItem('rv_state', state); sessionStorage.setItem('rv_return', location.pathname + location.search); } catch (e) {}
    location.href = 'https://discord.com/oauth2/authorize?client_id=' + CLIENT_ID + '&response_type=token&scope=identify' +
      '&redirect_uri=' + encodeURIComponent(location.origin + '/profile/') + '&state=' + state;
  };

  // ---------------------------------------------------------------- servers
  var profiles = null, names = null;
  /** Everyone's profiles: live from the Worker, or the data branch copy (up to 10 minutes old) if that's unavailable. */
  RV.loadProfiles = function () {
    var raw = function () { return fetch(PROFILES + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }); };
    return fetch(RELAY + '/api/profiles', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : raw(); }, raw)
      .then(function (d) { return d && d.users ? d : raw(); }).catch(function () { return null; });
  };
  RV.profiles = function () {
    if (!profiles) profiles = RV.loadProfiles().then(function (d) { names = d && d.users; return d; });
    return profiles;
  };
  RV.servers = function () {
    var me = RV.me();
    return RV.profiles().then(function (d) {
      var u = me && d && d.users && d.users[me.id];
      return u ? u.servers.filter(function (s) { return s.id; }) : [];
    });
  };
  RV.guild = function () { return ls.get('rv_guild'); };
  RV.setGuild = function (id) { ls.set('rv_guild', id); document.dispatchEvent(new CustomEvent('rv:guild', { detail: id })); };
  /** A server picker. Calls back once a server is chosen (and whenever it changes). */
  RV.picker = function (el, onPick) {
    return RV.servers().then(function (list) {
      el.textContent = '';
      if (!list.length) { el.innerHTML = '<span class="rv-dim">Play in a server with Render\'s Vision first (try <code>r!daily</code>); it shows up here within a few minutes.</span>'; return null; }
      var cur = RV.guild();
      if (!list.some(function (s) { return s.id === cur; })) { cur = list[0].id; ls.set('rv_guild', cur); }
      if (list.length === 1) { el.innerHTML = '<span class="rv-dim">Server:</span> <b>' + esc(list[0].server) + '</b>'; }
      else {
        var lab = document.createElement('label'); lab.className = 'rv-dim'; lab.textContent = 'Server ';
        var sel = document.createElement('select'); sel.className = 'rv-select';
        list.forEach(function (s) { var o = document.createElement('option'); o.value = s.id; o.textContent = s.server; if (s.id === cur) o.selected = true; sel.appendChild(o); });
        sel.onchange = function () { RV.setGuild(sel.value); if (onPick) onPick(sel.value); };
        lab.appendChild(sel); el.appendChild(lab);
      }
      if (onPick) onPick(cur);
      return cur;
    });
  };

  // ---------------------------------------------------------------- the relay
  RV.run = function (line) {
    var token = RV.token(), guild = RV.guild();
    if (!token) return Promise.reject(new Error('login'));
    if (!guild) return Promise.reject(new Error('Pick a server first.'));
    var auth = { Authorization: 'Bearer ' + token };
    return fetch(RELAY + '/api/run', { method: 'POST', headers: { Authorization: auth.Authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ guild_id: guild, line: line }) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) throw new Error('login'); if (!r.ok) throw new Error(j.error === 'slow down' ? 'Slow down a little.' : j.error || 'The bot could not be reached.'); return j; }); })
      .then(function (j) {
        // the bot is connected live: the reply came back with the request
        if (j.status === 'done') return j.result || {};
        var id = j.id, tries = 0;
        return new Promise(function (resolve, reject) {
          (function poll() {
            if (++tries > 30) return reject(new Error("The bot didn't answer. It may be restarting; try again in a minute."));
            fetch(RELAY + '/api/result?id=' + id, { headers: auth }).then(function (r) { return r.json(); }).then(function (j) {
              if (j.status !== 'done') return setTimeout(poll, tries < 5 ? 600 : 1200);
              resolve(j.result || {});
            }).catch(function () { setTimeout(poll, 1500); });
          })();
        });
      });
  };

  // ---------------------------------------------------------------- drawing replies
  // Discord code blocks; in a ```diff block, + lines are green and - lines red, like in Discord
  var codeBlock = function (lang, body) {
    return '<pre class="rv-code">' + body.replace(/\n$/, '').split('\n').map(function (l) {
      var c = lang === 'diff' ? (l.charAt(0) === '+' ? ' class="rv-add"' : l.charAt(0) === '-' ? ' class="rv-del"' : '') : '';
      return '<span' + c + '>' + esc(l) + '</span>';
    }).join('\n') + '</pre>';
  };
  RV.md = function (t) {
    var blocks = [];
    t = String(t == null ? '' : t).replace(/```(\w*)\n?([\s\S]*?)```/g, function (_, lang, body) { blocks.push(codeBlock(lang, body)); return '\u0000' + (blocks.length - 1) + '\u0000'; });
    return esc(t)
      .replace(/&lt;a?:(rc_[a-z0-9_]+):\d+&gt;/gi, '<img class="rv-emo" src="/bot/emojis/$1.png" alt="">').replace(/&lt;a?:\w+:\d+&gt;/g, '')
      .replace(/&lt;t:(\d+)(?::[a-zA-Z])?&gt;/g, function (_, s) { return esc(new Date(Number(s) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })); })
      .replace(/&lt;@!?(\d+)&gt;/g, function (_, id) { var u = names && names[id]; return '@' + (u ? u.name : 'player'); }).replace(/&lt;#\d+&gt;/g, '#channel')
      .replace(/^## (.*)$/gm, '<strong class="rv-ebig">$1</strong>')
      .replace(/^-# (.*)$/gm, '<span class="rv-sub">$1</span>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\u0000(\d+)\u0000\n?/g, function (_, i) { return blocks[Number(i)]; });
  };
  var onlyEmoji = function (t) { return /^(\s|<a?:\w+:\d+>|\p{Extended_Pictographic}|️)+$/u.test(t); };
  RV.html = function (r) {
    var h = '';
    if (r.content) h += onlyEmoji(r.content) ? '<div class="rv-jumbo">' + RV.md(r.content) + '</div>' : '<div>' + RV.md(r.content) + '</div>';
    (r.embeds || []).forEach(function (e) {
      h += '<div class="rv-embed"' + (e.color ? ' style="--rv-c:#' + Number(e.color).toString(16).padStart(6, '0') + '"' : '') + '>';
      if (e.title) h += '<div class="rv-etitle">' + RV.md(e.title) + '</div>';
      if (e.description) h += '<div class="rv-desc">' + RV.md(e.description) + '</div>';
      (e.fields || []).forEach(function (f) { h += '<div class="rv-field"><b>' + RV.md(f.name) + '</b><br>' + RV.md(f.value) + '</div>'; });
      if (e.footer) h += '<div class="rv-sub">' + RV.md(typeof e.footer === 'string' ? e.footer : e.footer.text || '') + '</div>';
      h += '</div>';
    });
    return h || '<span class="rv-dim">Done.</span>';
  };
  /** Draws a reply into el, with its buttons (pressed through the bot) and live frames. */
  RV.show = function (el, line, r, after) {
    el._rv = { content: r.content, embeds: r.embeds, buttons: r.buttons };
    el._live = null;
    paint(el, after);
    if (r.live) follow(el, r.live, r.everyMs, after);
  };
  function paint(el, after) {
    var st = el._rv;
    el.innerHTML = RV.html(st) + (el._note ? '<div class="rv-sub">' + RV.md(el._note) + '</div>' : '');
    var btns = (st.buttons || []).reduce(function (a, row) { return a.concat(row); }, []);
    if (btns.length) {
      var box = document.createElement('div'); box.className = 'rv-ebtns';
      var press = function (id) {
        box.querySelectorAll('button,select').forEach(function (q) { q.disabled = true; });
        RV.run('__press ' + id).then(function (res) {
          el._note = res.notice || '';
          if (res.update) { ['content', 'embeds', 'buttons'].forEach(function (k) { if (res.update[k] !== undefined) el._rv[k] = res.update[k]; }); }
          paint(el, after);
          if (res.update && res.update.live) follow(el, res.update.live, res.update.everyMs, after);
          if (res.followUp) { el._rv = res.followUp; paint(el, after); }
          if (after) after();
        }).catch(function (e) { el._note = e.message === 'login' ? 'Your login ran out. Log in again.' : e.message; paint(el, after); });
      };
      btns.forEach(function (b) {
        if (b.options) {   // a dropdown: picking an option presses id:value
          var sel = document.createElement('select'); sel.className = 'rv-sel'; sel.disabled = !!b.disabled;
          var ph = document.createElement('option'); ph.value = ''; ph.textContent = b.placeholder || b.label || 'Pick one'; sel.appendChild(ph);
          b.options.forEach(function (o) {
            var op = document.createElement('option'); op.value = o.value;
            op.textContent = (o.emoji && !/^<a?:/.test(o.emoji) ? o.emoji + ' ' : '') + o.label + (o.description ? ' · ' + o.description : '');
            if (o.default) op.selected = true;
            sel.appendChild(op);
          });
          sel.onchange = function () { if (sel.value) press(b.id + ':' + sel.value); };
          box.appendChild(sel);
          return;
        }
        var x = document.createElement('button'); x.type = 'button'; x.className = 'rv-b ' + (b.style || ''); x.disabled = !!b.disabled;
        x.innerHTML = (b.emoji ? (/^<a?:/.test(b.emoji) ? RV.md(b.emoji) : esc(b.emoji)) + ' ' : '') + esc(b.label || '');
        x.onclick = function () { press(b.id); };
        box.appendChild(x);
      });
      el.appendChild(box);
    }
  }
  function follow(el, key, every, after) {
    el._live = key;
    var tick = function () {
      if (el._live !== key || !el.isConnected) return;
      RV.run('__poll ' + key).then(function (r) {
        if (el._live !== key) return;
        if (r.update) { ['content', 'embeds', 'buttons'].forEach(function (k) { if (r.update[k] !== undefined) el._rv[k] = r.update[k]; }); paint(el, after); }
        if (r.done) { el._live = null; if (after) after(); return; }
        setTimeout(tick, Math.max(1500, every || 2500));
      }).catch(function () { el._live = null; });
    };
    setTimeout(tick, Math.max(1500, every || 2500));
  }

  // ---------------------------------------------------------------- the live feed
  var feed = null, listeners = [];
  RV.live = function (fn) {
    listeners.push(fn);
    if (feed) { fn(feed); return; }
    if (listeners.length > 1) return;
    var get = function () {
      fetch(RELAY + '/api/live', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (j) {
        if (!j || !j.prices) return;
        feed = j; listeners.forEach(function (f) { try { f(j); } catch (e) {} });
      }).catch(function () {});
    };
    // Live: the Worker sends each new feed down an open connection the moment the bot pushes it.
    // Until that's open (or if it drops), it's fetched every 20 seconds instead.
    var open = false, wait = 5000;
    var connect = function () {
      if (!window.WebSocket) return;
      var ws, ping;
      try { ws = new WebSocket(RELAY.replace(/^http/, 'ws') + '/ws/live'); } catch (e) { return; }
      ws.onopen = function () { open = true; wait = 5000; ping = setInterval(function () { try { ws.send('ping'); } catch (e) {} }, 45000); };
      ws.onmessage = function (ev) {
        if (ev.data === 'pong') return;
        try { var j = JSON.parse(ev.data); if (j && j.prices) { feed = j; listeners.forEach(function (f) { try { f(j); } catch (e) {} }); } } catch (e) {}
      };
      ws.onclose = function () { open = false; clearInterval(ping); setTimeout(connect, wait); wait = Math.min(wait * 2, 120000); };
    };
    get(); connect();
    setInterval(function () { if (!document.hidden && !open) get(); }, 20000);
  };

  // ---------------------------------------------------------------- styles
  var css = document.createElement('style');
  css.textContent =
    '.rv-emo{width:20px;height:20px;vertical-align:-5px;image-rendering:pixelated}' +
    '.rv-jumbo{line-height:1.05;white-space:pre-line;margin:2px 0 8px}.rv-jumbo .rv-emo{width:56px;height:56px;margin:1px;vertical-align:0}' +
    '.rv-embed{border-left:3px solid var(--rv-c,var(--bright));padding:.55rem .8rem;margin:.35rem 0;background:rgba(255,255,255,.025)}' +
    '.rv-etitle{font-weight:700;color:var(--bright);margin-bottom:.3rem}.rv-desc{white-space:pre-wrap;line-height:1.5}.rv-field{margin-top:.35rem}' +
    '.rv-code{margin:.3rem 0;padding:.45rem .6rem;background:rgba(0,0,0,.35);border:1px solid var(--line);border-radius:4px;font:12.5px/1.45 ui-monospace,Consolas,monospace;white-space:pre;overflow-x:auto}.rv-add{color:#43d17a}.rv-del{color:#f0605d}' +
    '.rv-sub{display:block;color:var(--grey);font-size:.85em}.rv-dim{color:var(--grey)}.rv-ebig{font-size:1.25em;display:block}' +
    '.rv-ebtns{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem}' +
    '.rv-sel{flex-basis:100%;font:inherit;font-size:.9rem;padding:.4rem .6rem;color:var(--bright);background:var(--panel-2);border:1px solid var(--line-strong)}' +
    '.rv-b{font:inherit;font-size:.9rem;padding:.4rem .75rem;color:var(--bright);background:var(--panel-2);border:1px solid var(--line-strong);cursor:pointer}' +
    '.rv-b.success{border-color:#3ddc84;color:#b9ffd5}.rv-b.danger{border-color:#ff5c61;color:#ffc2c4}.rv-b.primary{background:rgba(var(--accent-rgb),.14)}.rv-b:disabled{opacity:.45;cursor:default}' +
    '.rv-b .rv-emo{width:18px;height:18px;vertical-align:-4px}' +
    '.rv-b:has(.rv-px),.tabs button:has(.rv-px){display:inline-flex;align-items:center;justify-content:center;gap:.35em}.rv-b .rv-px,.tabs button .rv-px{margin:0}' +
    '.rv-px{width:1.25em;height:1.25em;vertical-align:-.28em;image-rendering:pixelated;display:inline-block;margin:0 .05em}' +
    '.rv-select{font:inherit;color:var(--bright);background:var(--bg);border:1px solid var(--line-strong);padding:.3rem .5rem;margin-left:.3rem}' +
    '.nav ul a.rv-bell{position:relative;display:inline-flex;padding:2px 4px;color:var(--grey);border:0}.nav ul a.rv-bell:hover,.nav ul a.rv-bell.on{color:var(--bright)}' +
    '.rv-bell svg{width:18px;height:18px;display:block;shape-rendering:crispEdges}.rv-bell.on svg{filter:drop-shadow(0 0 4px rgba(var(--accent-rgb),.7));animation:rv-ring 2.4s ease-in-out infinite;transform-origin:50% 0}' +
    '@keyframes rv-ring{0%,70%,100%{transform:rotate(0)}74%{transform:rotate(14deg)}80%{transform:rotate(-12deg)}86%{transform:rotate(8deg)}92%{transform:rotate(-4deg)}}' +
    '@media (prefers-reduced-motion:reduce){.rv-bell.on svg{animation:none}}' +
    '.nav ul a.rv-me{display:inline-flex;padding:0;color:var(--grey);border:0}.nav ul a.rv-me:hover,.nav ul a.rv-me[aria-current]{color:var(--bright)}' +
    '.rv-me svg{width:18px;height:18px;display:block;shape-rendering:crispEdges;margin:2px 4px}.rv-me img{width:22px;height:22px;display:block;border:1px solid var(--line-strong);image-rendering:auto}' +
    '.rv-me:hover img,.rv-me[aria-current] img{border-color:var(--bright);box-shadow:0 0 6px rgba(var(--accent-rgb),.6)}' +
    '.rv-bell i{position:absolute;top:-7px;right:-9px;min-width:15px;height:15px;padding:0 3px;background:#ff5c61;color:#fff;font:700 10px/15px var(--mono,monospace);text-align:center;font-style:normal;box-shadow:0 0 0 2px var(--bg)}' +
    '.rv-epop{position:absolute;z-index:50;right:0;top:2.2rem;width:min(360px,90vw);max-height:60vh;overflow:auto;background:var(--panel);border:1px solid var(--line-strong);padding:.6rem .8rem;box-shadow:0 12px 40px rgba(0,0,0,.5);text-align:left;font-size:.9rem}';
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the bell
  function bell() {
    var nav = document.querySelector('.nav ul');
    if (!nav || !RV.token() || document.querySelector('.rv-bell')) return;
    var li = document.createElement('li'); li.style.position = 'relative';
    var a = document.createElement('a'); a.href = '/play/#inbox'; a.className = 'rv-bell'; a.title = 'Notifications'; a.setAttribute('aria-label', 'Notifications'); a.innerHTML = '<svg viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor"><rect x="5" y="0" width="2" height="1"/><rect x="4" y="1" width="4" height="1"/><rect x="3" y="2" width="6" height="3"/><rect x="2" y="5" width="8" height="2"/><rect x="1" y="7" width="10" height="1"/><rect x="0" y="8" width="12" height="1"/><rect x="5" y="10" width="2" height="1"/></g><g fill="#fff" fill-opacity=".35"><rect x="4" y="2" width="1" height="3"/><rect x="3" y="5" width="1" height="2"/></g></svg>';
    li.appendChild(a); nav.appendChild(li);
    var badge = function (n) { var i = a.querySelector('i'); a.classList.toggle('on', !!n); if (!n) { if (i) i.remove(); a.setAttribute('aria-label', 'Notifications'); return; } if (!i) { i = document.createElement('i'); a.appendChild(i); } i.textContent = n > 9 ? '9+' : n; a.setAttribute('aria-label', n + ' unread notifications'); };
    var check = function () {
      if (!RV.guild() || document.hidden) return;
      RV.run('inbox count').then(function (r) { var m = /^(\d+)/.exec(r.content || ''); badge(m ? Number(m[1]) : 0); }).catch(function () {});
    };
    a.onclick = function (e) {
      if (location.pathname.indexOf('/play') === 0) return;   // the hub has its own inbox
      e.preventDefault();
      var pop = li.querySelector('.rv-epop');
      if (pop) { pop.remove(); return; }
      pop = document.createElement('div'); pop.className = 'rv-epop'; pop.innerHTML = '<span class="rv-dim">Loading…</span>';
      li.appendChild(pop);
      RV.run('inbox').then(function (r) { RV.show(pop, 'inbox', r); badge(0); pop.insertAdjacentHTML('beforeend', '<p style="margin:.5rem 0 0"><a href="/play/">Open the hub →</a></p>'); })
        .catch(function (err) { pop.textContent = err.message === 'login' ? 'Log in again to see notifications.' : err.message; });
    };
    if (!RV.guild()) RV.servers().then(function (l) { if (l.length) { ls.set('rv_guild', RV.guild() || l[0].id); check(); } });
    else check();
    setInterval(check, 120000);
  }
  // ------------------------------------------------------------- your profile
  // Sits after the bell: your Discord picture when logged in, a pixel person when not.
  function account() {
    var nav = document.querySelector('.nav ul');
    if (!nav || document.querySelector('.rv-me')) return;
    var me = RV.me(), li = document.createElement('li'), a = document.createElement('a');
    a.className = 'rv-me'; a.href = me ? '/profile/?id=' + encodeURIComponent(me.id) : '/profile/';
    a.title = me ? 'Your profile' : 'Profiles and log in'; a.setAttribute('aria-label', a.title);
    if (location.pathname.indexOf('/profile') === 0) a.setAttribute('aria-current', 'page');
    var person = '<svg viewBox="0 0 12 12" aria-hidden="true"><g fill="currentColor"><rect x="4" y="1" width="4" height="1"/><rect x="3" y="2" width="6" height="3"/><rect x="4" y="5" width="4" height="1"/><rect x="2" y="7" width="8" height="1"/><rect x="1" y="8" width="10" height="3"/></g></svg>';
    if (me && me.avatar) {
      var img = document.createElement('img'); img.src = me.avatar; img.alt = ''; img.width = 22; img.height = 22;
      img.onerror = function () { a.innerHTML = person; };
      a.appendChild(img);
    } else a.innerHTML = person;
    li.appendChild(a); nav.appendChild(li);
  }
  // ------------------------------------------------------------- pixel emojis
  // On the Rend-Conomy pages, standard emojis that the bot has its own pixel version of are swapped for it
  // (the same art as in Discord). Runs on the page, and on anything added later (bot replies, profiles...).
  // Leaves form controls, code and anything marked data-noemoji alone. RV.emo(name) gives one as HTML.
  var PIX = {
    '🧑‍🌾': 'farmhand', '🐦‍⬛': 'crow', '🌾': 'farm', '💧': 'wateringcan', '🧺': 'harvest', '🧪': 'fertilizer', '♻': 'compost',
    '🥕': 'carrot', '🌽': 'corn', '🍅': 'tomato', '🎃': 'pumpkin', '🌧': 'rain', '⛈': 'storm', '🪧': 'newplot',
    '🏠': 'property', '🛖': 'prop_shack', '🏪': 'prop_shop', '🗼': 'prop_lighthouse', '🏛': 'prop_mansion', '🔨': 'repair', '🔑': 'key', '✉': 'bid', '🚪': 'evict', '🛌': 'squatter',
    '💼': 'work', '🛠': 'gig', '🧰': 'gig', '💰': 'polygon', '🛍': 'shop', '🤝': 'social', '🎁': 'gift', '🐖': 'savings', '🐷': 'savings', '📜': 'loan', '🧾': 'receipt', '🏦': 'reserve', '🌅': 'daily',
    '🏆': 'achievement', '🏅': 'leaderboard', '🔒': 'locked', '🌐': 'event', '🖥': 'todd', '🦹': 'heist', '🎟': 'lottery', '📈': 'stonks', '🎣': 'fishing', '🪝': 'lure',
    '🎰': 'slots', '🪙': 'coinflip', '🎲': 'dice', '🎡': 'roulette', '🃏': 'blackjack', '💣': 'mines', '🚀': 'rocket', '🔼': 'hilo',
    '🌱': 'start', '❓': 'secret', '🎄': 'holiday', '🎅': 'santa', '⛄': 'snowman', '☃': 'snowman', '❄': 'snowflake', '🎉': 'promoted', '📣': 'megaphone', '📢': 'megaphone',
    '⚡': 'quickadd', '🔥': 'hotfix', '🆕': 'new', '🩹': 'fixed', '🗑': 'removed', '✅': 'yes', '⏳': 'time', '⌛': 'time'
  };
  var PIX_RE = new RegExp('(' + Object.keys(PIX).sort(function (a, b) { return b.length - a.length; }).map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|') + ')️?', 'g');
  var PIX_SKIP = 'script,style,textarea,input,select,option,code,pre,svg,[data-noemoji],.emoji-grid,.rv-me,.rv-bell';
  RV.emo = function (name, alt) { return '<img class="rv-px" src="/bot/emojis/rc_' + name + '.png" alt="' + esc(alt || '') + '" draggable="false">'; };
  function emojify(root) {
    if (!root) return;
    if (root.nodeType === 3) { root = root.parentNode; if (!root) return; }
    if (root.nodeType !== 1 || (root.closest && root.closest(PIX_SKIP))) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) { PIX_RE.lastIndex = 0; if (PIX_RE.test(n.nodeValue) && !(n.parentNode.closest && n.parentNode.closest(PIX_SKIP))) nodes.push(n); }
    nodes.forEach(function (t) {
      var text = t.nodeValue, frag = document.createDocumentFragment(), last = 0, m;
      PIX_RE.lastIndex = 0;
      while ((m = PIX_RE.exec(text))) {
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        var img = document.createElement('img'); img.className = 'rv-px'; img.src = '/bot/emojis/rc_' + PIX[m[1]] + '.png'; img.alt = m[0]; img.draggable = false;
        img.onerror = function () { this.replaceWith(document.createTextNode(this.alt)); };
        frag.appendChild(img);
        last = m.index + m[0].length;
      }
      if (!last) return;
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      t.parentNode.replaceChild(frag, t);
    });
  }
  RV.emojify = emojify;
  var PIX_PAGES = /^\/(rend-conomy|play|profile|bot|patch-notes|wiki)(\/|$)/;
  function pixelEmoji() {
    if (!PIX_PAGES.test(location.pathname) || document.documentElement.hasAttribute('data-noemoji')) return;
    try { if ((JSON.parse(localStorage.getItem('rp_prefs') || '{}')).emoji === false) return; } catch (e) {}   // Settings on the profile page
    emojify(document.body);
    new MutationObserver(function (list) {
      list.forEach(function (r) { r.addedNodes.forEach(function (x) { if (x.nodeType === 1 && x.classList.contains('rv-px')) return; emojify(x); }); });
    }).observe(document.body, { childList: true, subtree: true });
  }

  function start() { bell(); account(); pixelEmoji(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
