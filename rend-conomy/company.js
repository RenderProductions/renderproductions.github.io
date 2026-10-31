// Fills in a company page from /prices.json.
// The page says which company it is with <body data-ticker="BLU">.
// Everything you write by hand (overview, history, people) is plain HTML
// in the page itself; this script only touches elements with a data-live attribute.
(function () {
  'use strict';

  var DATA_URL = '/prices.json';
  var REFRESH_MS = 60 * 1000;
  var TICK_MIN = 5; // minutes between price ticks
  var ticker = (document.body.getAttribute('data-ticker') || '').toUpperCase();

  function $(name) { return document.querySelector('[data-live="' + name + '"]'); }
  function set(name, text) { var el = $(name); if (el) el.textContent = text; }

  function fmtTime(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function timeLeft(iso) {
    var ms = Date.parse(iso) - Date.now();
    if (isNaN(ms)) return '';
    if (ms <= 0) return 'deadline passed, result soon';
    var h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
    return (h ? h + 'h ' : '') + m + 'm left';
  }

  function ago(ticks) {
    var min = ticks * TICK_MIN;
    if (min === 0) return 'now';
    if (min < 60) return 'about ' + min + 'm ago';
    var h = Math.floor(min / 60), m = min % 60;
    return 'about ' + h + 'h' + (m ? ' ' + m + 'm' : '') + ' ago';
  }

  // ---------- Chart ----------
  var chart = $('chart');
  var hist = [];

  function drawChart(h, up) {
    hist = h;
    var svg = chart.querySelector('svg');
    var min = Math.min.apply(null, h), max = Math.max.apply(null, h);
    var range = max - min || 1;
    var n = Math.max(h.length - 1, 1);
    var pts = h.map(function (v, i) {
      return (i / n * 100).toFixed(2) + ',' + (100 - (v - min) / range * 100).toFixed(2);
    });
    svg.querySelector('.line').setAttribute('points', pts.join(' '));
    svg.querySelector('.area').setAttribute('points', '0,100 ' + pts.join(' ') + ' 100,100');
    chart.classList.toggle('down', !up);
    chart.querySelector('.hi').textContent = max.toFixed(2);
    chart.querySelector('.lo').textContent = min.toFixed(2);
    var hours = Math.round(h.length * TICK_MIN / 60);
    chart.querySelector('.span').textContent = 'last ' + hours + 'h';
  }

  function hover(e) {
    if (!hist.length) return;
    var box = chart.getBoundingClientRect();
    var f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    var i = Math.round(f * (hist.length - 1));
    var marker = chart.querySelector('.marker'), readout = chart.querySelector('.readout');
    marker.style.left = (i / Math.max(hist.length - 1, 1) * 100) + '%';
    marker.hidden = false;
    readout.textContent = hist[i].toFixed(2) + ' · ' + ago(hist.length - 1 - i);
    readout.hidden = false;
  }
  function unhover() {
    chart.querySelector('.marker').hidden = true;
    chart.querySelector('.readout').hidden = true;
  }
  if (chart) {
    chart.addEventListener('pointermove', hover);
    chart.addEventListener('pointerdown', hover);
    chart.addEventListener('pointerleave', unhover);
  }

  // ---------- News ----------
  function drawNews(list) {
    var feed = $('news');
    feed.innerHTML = '';
    if (!list.length) {
      var p = document.createElement('p');
      p.className = 'empty';
      p.textContent = 'No news yet. Goals and their results will show up here.';
      feed.appendChild(p);
      return;
    }
    list.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'log' + (n.type === 'fail' ? ' is-rare' : n.type === 'goal' ? ' is-decoy' : '');

      var label = document.createElement('div');
      label.className = 'label';
      var k = document.createElement('span');
      k.className = 'kind';
      k.textContent = n.type === 'success' ? 'SUCCESS' : n.type === 'fail' ? 'FAILED' : 'NEW GOAL';
      var when = document.createElement('span');
      when.textContent = fmtTime(n.time);
      label.appendChild(k);
      label.appendChild(when);

      var frag = document.createElement('div');
      frag.className = 'fragment';
      frag.textContent = n.headline || '';

      item.appendChild(label);
      item.appendChild(frag);

      if (typeof n.move === 'number') {
        var stamp = document.createElement('div');
        stamp.className = 'stamp';
        var mv = document.createElement('span');
        mv.className = 'move';
        mv.textContent = (n.move >= 0 ? '▲ +' : '▼ ') + n.move.toFixed(2) + '% on the news';
        stamp.appendChild(mv);
        item.appendChild(stamp);
      }
      feed.appendChild(item);
    });
  }

  // ---------- Page ----------
  function show(data) {
    var c = (data.companies || []).filter(function (x) { return x.id === ticker; })[0];
    if (!c) {
      set('status', 'NOT LISTED');
      set('note', 'This company is not on the market right now.');
      return;
    }
    var h = c.history || [c.price];
    var last = h[h.length - 1];
    var up = c.change >= 0;

    document.title = c.name + ' (' + c.id + ') | Rend-Conomy';
    set('name', c.name);
    set('desc', c.description || '');
    set('price', last.toFixed(2));
    var ch = $('change');
    ch.textContent = (up ? '▲ +' : '▼ ') + c.change.toFixed(2) + '%';
    ch.className = 'co-change ' + (up ? 'up' : 'down');

    drawChart(h, up);

    set('high', Math.max.apply(null, h).toFixed(2));
    set('low', Math.min.apply(null, h).toFixed(2));
    set('open', h[0].toFixed(2));

    var m = data.market || { status: 'open' };
    var tag = $('status');
    tag.textContent = m.status === 'after-hours' ? 'AFTER HOURS' : m.status === 'closed' ? 'CLOSED' : 'OPEN';
    tag.className = 'tag' + (m.status === 'open' ? ' live' : m.status === 'closed' ? ' off' : '');
    set('market', tag.textContent);

    var gp = $('goal');
    if (c.goal && c.goal.text) {
      gp.querySelector('.goal-text').textContent = c.goal.text;
      gp.querySelector('.goal-when').textContent =
        'Deadline: ' + fmtTime(c.goal.deadline) + ' (' + timeLeft(c.goal.deadline) + ')';
    } else {
      gp.querySelector('.goal-text').textContent = 'No active goal.';
      gp.querySelector('.goal-when').textContent =
        c.nextGoalAt ? 'Next announcement expected around ' + fmtTime(c.nextGoalAt) + '.' : '';
    }

    var others = $('others');
    if (others) {
      others.innerHTML = '';
      data.companies.forEach(function (o) {
        if (o.id === ticker) return;
        var a = document.createElement('a');
        a.className = 'btn';
        a.href = '/rend-conomy/' + String(o.id).toLowerCase() + '/';
        a.textContent = o.name + ' (' + o.id + ')';
        others.appendChild(a);
      });
    }

    drawNews(Array.isArray(c.newsLog) ? c.newsLog : (data.news || []).filter(function (n) { return n.id === ticker; }));

    set('note', 'Prices are fictional.' + (data.updated ? ' Last update: ' + fmtTime(data.updated) + '.' : ''));
  }

  function load() {
    fetch(DATA_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(show)
      .catch(function () { set('note', 'Live prices could not be loaded right now.'); })
      .then(function () { setTimeout(load, REFRESH_MS); });
  }
  load();
})();
