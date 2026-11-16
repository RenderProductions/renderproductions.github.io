// Render's Vision on the site: play Rend-Conomy from any page.
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
  RV.profiles = function () {
    if (!profiles) profiles = fetch(PROFILES + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { names = d && d.users; return d; }).catch(function () { return null; });
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
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (r.status === 401) throw new Error('login'); if (!r.ok) throw new Error(j.error === 'slow down' ? 'Slow down a little.' : j.error || 'The bot could not be reached.'); return j.id; }); })
      .then(function (id) {
        var tries = 0;
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
  RV.md = function (t) {
    return esc(t)
      .replace(/&lt;a?:(rc_[a-z0-9_]+):\d+&gt;/gi, '<img class="rv-emo" src="/bot/emojis/$1.png" alt="">').replace(/&lt;a?:\w+:\d+&gt;/g, '')
      .replace(/&lt;t:(\d+)(?::[a-zA-Z])?&gt;/g, function (_, s) { return esc(new Date(Number(s) * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })); })
      .replace(/&lt;@!?(\d+)&gt;/g, function (_, id) { var u = names && names[id]; return '@' + (u ? u.name : 'player'); }).replace(/&lt;#\d+&gt;/g, '#channel')
      .replace(/^## (.*)$/gm, '<strong class="rv-ebig">$1</strong>')
      .replace(/^-# (.*)$/gm, '<span class="rv-sub">$1</span>')
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/`([^`]+)`/g, '<code>$1</code>');
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
      btns.forEach(function (b) {
        var x = document.createElement('button'); x.type = 'button'; x.className = 'rv-b ' + (b.style || ''); x.disabled = !!b.disabled;
        x.innerHTML = (b.emoji ? (/^<a?:/.test(b.emoji) ? RV.md(b.emoji) : esc(b.emoji)) + ' ' : '') + esc(b.label || '');
        x.onclick = function () {
          box.querySelectorAll('button').forEach(function (q) { q.disabled = true; });
          RV.run('__press ' + b.id).then(function (res) {
            el._note = res.notice || '';
            if (res.update) { ['content', 'embeds', 'buttons'].forEach(function (k) { if (res.update[k] !== undefined) el._rv[k] = res.update[k]; }); }
            paint(el, after);
            if (res.update && res.update.live) follow(el, res.update.live, res.update.everyMs, after);
            if (res.followUp) { el._rv = res.followUp; paint(el, after); }
            if (after) after();
          }).catch(function (e) { el._note = e.message === 'login' ? 'Your login ran out. Log in again.' : e.message; paint(el, after); });
        };
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
    get(); setInterval(function () { if (!document.hidden) get(); }, 20000);
  };

  // ---------------------------------------------------------------- styles
  var css = document.createElement('style');
  css.textContent =
    '.rv-emo{width:20px;height:20px;vertical-align:-5px;image-rendering:pixelated}' +
    '.rv-jumbo{line-height:1.05;white-space:pre-line;margin:2px 0 8px}.rv-jumbo .rv-emo{width:56px;height:56px;margin:1px;vertical-align:0}' +
    '.rv-embed{border-left:3px solid var(--rv-c,var(--bright));padding:.55rem .8rem;margin:.35rem 0;background:rgba(255,255,255,.025)}' +
    '.rv-etitle{font-weight:700;color:var(--bright);margin-bottom:.3rem}.rv-desc{white-space:pre-wrap;line-height:1.5}.rv-field{margin-top:.35rem}' +
    '.rv-sub{display:block;color:var(--grey);font-size:.85em}.rv-dim{color:var(--grey)}.rv-ebig{font-size:1.25em;display:block}' +
    '.rv-ebtns{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem}' +
    '.rv-b{font:inherit;font-size:.9rem;padding:.4rem .75rem;color:var(--bright);background:var(--panel-2);border:1px solid var(--line-strong);cursor:pointer}' +
    '.rv-b.success{border-color:#3ddc84;color:#b9ffd5}.rv-b.danger{border-color:#ff5c61;color:#ffc2c4}.rv-b.primary{background:rgba(var(--accent-rgb),.14)}.rv-b:disabled{opacity:.45;cursor:default}' +
    '.rv-b .rv-emo{width:18px;height:18px;vertical-align:-4px}' +
    '.rv-select{font:inherit;color:var(--bright);background:var(--bg);border:1px solid var(--line-strong);padding:.3rem .5rem;margin-left:.3rem}' +
    '.rv-bell{position:relative;font-size:1.1rem;text-decoration:none}.rv-bell i{position:absolute;top:-6px;right:-10px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:#ff5c61;color:#fff;font:700 10px/16px system-ui;text-align:center;font-style:normal}' +
    '.rv-epop{position:absolute;z-index:50;right:0;top:2.2rem;width:min(360px,90vw);max-height:60vh;overflow:auto;background:var(--panel);border:1px solid var(--line-strong);padding:.6rem .8rem;box-shadow:0 12px 40px rgba(0,0,0,.5);text-align:left;font-size:.9rem}';
  document.head.appendChild(css);

  // ---------------------------------------------------------------- the bell
  function bell() {
    var nav = document.querySelector('.nav ul');
    if (!nav || !RV.token() || document.querySelector('.rv-bell')) return;
    var li = document.createElement('li'); li.style.position = 'relative';
    var a = document.createElement('a'); a.href = '/play/#inbox'; a.className = 'rv-bell'; a.title = 'Notifications'; a.setAttribute('aria-label', 'Notifications'); a.textContent = '🔔';
    li.appendChild(a); nav.appendChild(li);
    var badge = function (n) { var i = a.querySelector('i'); if (!n) { if (i) i.remove(); return; } if (!i) { i = document.createElement('i'); a.appendChild(i); } i.textContent = n > 9 ? '9+' : n; a.setAttribute('aria-label', n + ' unread notifications'); };
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bell); else bell();
})();
