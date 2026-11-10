// Draws the live parts of a company page from /prices.json.
// The page says which company it is with <body data-ticker="BLU">.
// Live parts go into <div id="co-top"> (header, chart, stats, goal) and
// <div id="co-bottom"> (news, other companies, trading). Everything else on the
// page, like the Overview / History / Key people writing, is plain HTML and is never touched.
(function () {
  'use strict';

  var DATA_URL = '/prices.json';
  var REFRESH_MS = 60 * 1000;
  var TZ = 'America/Detroit';
  var OPEN_HOUR = 3, CLOSE_HOUR = 21;
  var RANGES = [['1H', 1], ['6H', 6], ['12H', 12], ['24H', 24]];
  var ticker = (document.body.getAttribute('data-ticker') || '').toUpperCase();
  var top = document.getElementById('co-top');
  var bottom = document.getElementById('co-bottom');
  if (!top) return;

  // What each kind of news looks like. tone: up / down / warn / muted (or decided by the move).
  var KIND = {
    goal:      ['NEW GOAL', 'muted'],
    success:   ['GOAL HIT', 'up'],
    fail:      ['GOAL MISSED', 'down'],
    mixed:     ['MIXED RESULT', 'warn'],
    good:      ['BREAKING', 'up'],
    bad:       ['BREAKING', 'down'],
    rumor:     ['RUMOR', 'muted'],
    confirmed: ['CONFIRMED', null],
    denied:    ['DENIED', null],
    market:    ['MARKET-WIDE', null],
    crossover: ['CROSSOVER', null],
    dividend:  ['DIVIDEND', null],
    crash:     ['MARKET CRASH', 'down'],
    boom:      ['MARKET BOOM', 'up'],
    halt:      ['TRADING HALTED', 'warn'],
    brink:     ['ON THE BRINK', 'warn'],
    bankrupt:  ['BANKRUPT', 'down'],
    appeal:    ['BAILOUT APPEAL', 'muted'],
    appealDenied: ['APPEAL DENIED', 'down'],
    bailout:   ['TODD BAILOUT', 'up'],
    recovered: ['OUT OF BANKRUPTCY', 'up']
  };
  function kindOf(n) {
    var k = KIND[n.type] || ['NEWS', null];
    var tone = k[1] || (typeof n.move === 'number' ? (n.move >= 0 ? 'up' : 'down')
      : n.type === 'dividend' ? (n.dividend === 'cut' || n.dividend === 'suspended' ? 'down' : 'up') : 'muted');
    return { label: k[0] + (n.big ? ' 🔥' : ''), tone: tone };
  }

  // ---------- Helpers ----------
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function money(v) { return Number(v).toFixed(2); }
  function price(v) { return '⬡ ' + money(v); } // ⬡ = a price in Polygons
  function pct(v) { return (v >= 0 ? '▲ +' : '▼ ') + v.toFixed(2) + '%'; }
  // Percent change that still makes sense when a price touches or crosses zero.
  function pctOf(now, then) { return then ? ((now - then) / Math.abs(then)) * 100 : 0; }
  var clockFmt = new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit' });
  var dayFmt = new Intl.DateTimeFormat([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  var fullFmt = new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' });
  var hourInTZ = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', hourCycle: 'h23' });
  function isNight(sec) {
    var h = Number(hourInTZ.format(new Date(sec * 1000)));
    return h < OPEN_HOUR || h >= CLOSE_HOUR;
  }
  function ago(iso) {
    var ms = Date.now() - Date.parse(iso);
    if (isNaN(ms)) return '';
    var m = Math.round(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
    return Math.floor(h / 24) + 'd ago';
  }
  function countdown(ms) {
    if (ms <= 0) return '00:00:00';
    var s = Math.floor(ms / 1000);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  // ---------- Build the page once ----------
  top.innerHTML =
    '<header class="hero co-head">' +
      '<div class="co-top-row"><span class="co-badge"></span><div class="co-chips"></div></div>' +
      '<h1 class="page-title co-name"></h1>' +
      '<p class="co-desc"></p>' +
      '<div class="co-quote"><span class="co-price"><span class="co-num">--</span><small>⬡ Polygons</small></span><span class="co-pill"></span></div>' +
      '<div class="co-sub"></div>' +
    '</header>' +
    '<section aria-label="Price chart">' +
      '<div class="section-head"><h2>Price</h2><span>Hover the chart · diamonds are news</span></div>' +
      '<div class="co-chart-wrap"><div class="co-tabs" role="group" aria-label="Chart range"></div>' +
        '<div class="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' +
          '<g class="nights"></g><g class="grids"></g><line class="base" x1="0" x2="100"/>' +
          '<polygon class="area"/><polyline class="line"/></svg>' +
          '<div class="labels"></div><div class="evts"></div>' +
          '<div class="cross" hidden></div><div class="dot" hidden></div><div class="tip" hidden></div>' +
        '</div></div>' +
      '<div class="stats"></div>' +
      '<p class="empty co-note">Loading prices...</p>' +
    '</section>' +
    '<section class="co-section" aria-label="Current goal">' +
      '<div class="section-head"><h2>Current goal</h2><span class="goal-side"></span></div>' +
      '<div class="goal-card idle"><div class="goal-text">Loading...</div></div>' +
    '</section>';

  if (bottom) {
    bottom.innerHTML =
      '<section class="co-section" aria-label="Company news">' +
        '<div class="section-head"><h2>Company news</h2><span class="news-count"></span></div>' +
        '<div class="tl"><p class="empty">Loading...</p></div>' +
      '</section>' +
      '<section class="co-section" aria-label="Other companies">' +
        '<div class="section-head"><h2>Other companies</h2></div><div class="peers"></div>' +
      '</section>' +
      '<section class="co-section" aria-label="Trade">' +
        '<div class="section-head"><h2>Trade ' + ticker + '</h2><span>in The Render Room</span></div>' +
        '<div class="panel prose"><p>Trading happens in Discord with the <a href="/bot/">Rend-Conomy bot</a>, 3 AM to 9 PM Eastern, every day.</p>' +
        '<div class="cmds"></div></div>' +
      '</section>';
    var cmds = [
      ['r!buy ' + ticker + ' 5', 'Buy 5 shares'],
      ['r!sell ' + ticker + ' all', 'Sell every share you own'],
      ['r!chart ' + ticker, 'This chart, in Discord'],
      ['r!dividends', 'Collect what your shares have earned']
    ];
    var box = bottom.querySelector('.cmds');
    cmds.forEach(function (c) {
      var row = el('div', 'cmd');
      row.appendChild(el('code', null, c[0]));
      row.appendChild(el('span', null, c[1]));
      var b = el('button', null, 'COPY');
      b.type = 'button';
      b.addEventListener('click', function () {
        var done = function () { b.textContent = 'COPIED'; setTimeout(function () { b.textContent = 'COPY'; }, 1200); };
        if (navigator.clipboard) navigator.clipboard.writeText(c[0]).then(done, function () {});
      });
      row.appendChild(b);
      box.appendChild(row);
    });
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var chart = $('.chart', top);
  var range = 24;
  var tabs = $('.co-tabs', top);
  RANGES.forEach(function (r) {
    var b = el('button', null, r[0]);
    b.type = 'button';
    b.setAttribute('aria-pressed', r[1] === range ? 'true' : 'false');
    b.addEventListener('click', function () {
      range = r[1];
      tabs.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
      if (last) drawChart(last.c);
    });
    tabs.appendChild(b);
  });
  var rangeLabel = el('span', 'co-range');
  tabs.appendChild(rangeLabel);

  var last = null;      // { c, data }
  var view = null;      // what the chart currently shows, for hovering
  var lastPrice = null;

  // ---------- Chart ----------
  function windowOf(c) {
    var h = c.history || [], t = c.times || [];
    if (t.length !== h.length || !t.length) return { h: h, t: h.map(function (_, i) { return i; }) };
    var cut = t[t.length - 1] - range * 3600, i = 0;
    while (i < t.length - 2 && t[i] < cut) i++;
    return { h: h.slice(i), t: t.slice(i) };
  }

  function drawChart(c) {
    var w = windowOf(c);
    var h = w.h, t = w.t;
    if (h.length < 2) return;
    var min = Math.min.apply(null, h), max = Math.max.apply(null, h);
    var pad = (max - min) * 0.1 || max * 0.02 || 1;
    var lo = Math.max(0, min - pad), hi = max + pad;
    var t0 = t[0], t1 = t[t.length - 1], span = t1 - t0 || 1;
    var X = function (sec) { return ((sec - t0) / span) * 100; };
    var Y = function (v) { return 100 - ((v - lo) / (hi - lo)) * 100; };
    var up = h[h.length - 1] >= h[0];
    view = { h: h, t: t, X: X, Y: Y };

    var pts = h.map(function (v, i) { return X(t[i]).toFixed(2) + ',' + Y(v).toFixed(2); }).join(' ');
    $('.line', chart).setAttribute('points', pts);
    $('.area', chart).setAttribute('points', '0,100 ' + pts + ' 100,100');
    var base = $('.base', chart);
    base.setAttribute('y1', Y(h[0]).toFixed(2));
    base.setAttribute('y2', Y(h[0]).toFixed(2));
    chart.classList.toggle('down', !up);

    // After-hours stretches are shaded.
    var nights = $('.nights', chart);
    nights.innerHTML = '';
    var start = null;
    for (var i = 0; i <= t.length; i++) {
      var night = i < t.length && isNight(t[i]);
      if (night && start === null) start = i;
      if (!night && start !== null) {
        var r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        r.setAttribute('class', 'night');
        r.setAttribute('x', X(t[start]).toFixed(2));
        r.setAttribute('width', Math.max(0.2, X(t[Math.min(i, t.length - 1)]) - X(t[start])).toFixed(2));
        r.setAttribute('y', 0);
        r.setAttribute('height', 100);
        nights.appendChild(r);
        start = null;
      }
    }

    // Grid lines and labels
    var grids = $('.grids', chart), labels = $('.labels', chart);
    grids.innerHTML = '';
    labels.innerHTML = '';
    for (var g = 0; g <= 3; g++) {
      var v = lo + ((hi - lo) * g) / 3, y = Y(v);
      var ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      ln.setAttribute('class', 'grid');
      ln.setAttribute('x1', 0); ln.setAttribute('x2', 100);
      ln.setAttribute('y1', y.toFixed(2)); ln.setAttribute('y2', y.toFixed(2));
      grids.appendChild(ln);
      var yl = el('span', 'ylab', money(v));
      yl.style.top = y + '%';
      labels.appendChild(yl);
    }
    var narrow = chart.clientWidth < 480;
    var multiDay = span > 20 * 3600 && !narrow;
    for (var k = 0; k <= 4; k += narrow ? 2 : 1) {
      var sec = t0 + (span * k) / 4;
      var xl = el('span', 'xlab', (multiDay && k < 4 ? dayFmt : clockFmt).format(new Date(sec * 1000)));
      xl.style.left = (k * 25) + '%';
      if (k === 0) xl.style.transform = 'none';
      if (k === 4) xl.style.transform = 'translateX(-100%)';
      labels.appendChild(xl);
    }

    // News markers along the bottom
    var evts = $('.evts', chart);
    evts.innerHTML = '';
    (c.newsLog || []).forEach(function (n) {
      var sec = Date.parse(n.time) / 1000;
      if (isNaN(sec) || sec < t0 || sec > t1 + 300) return;
      var kd = kindOf(n);
      var b = el('button', 'evt ' + kd.tone);
      b.type = 'button';
      b.style.left = Math.min(100, X(sec)) + '%';
      b.setAttribute('aria-label', kd.label + ': ' + n.headline);
      var showTip = function () {
        hideEvtTip();
        var tip = el('div', 'evt-tip');
        tip.appendChild(el('b', null, kd.label + (typeof n.move === 'number' ? ' · ' + pct(n.move) : '')));
        tip.appendChild(document.createTextNode(n.headline || ''));
        var x = Math.min(100, X(sec));
        tip.style.left = Math.max(15, Math.min(85, x)) + '%';
        evts.appendChild(tip);
      };
      b.addEventListener('mouseenter', showTip);
      b.addEventListener('focus', showTip);
      b.addEventListener('mouseleave', hideEvtTip);
      b.addEventListener('blur', hideEvtTip);
      evts.appendChild(b);
    });

    var change = pctOf(h[h.length - 1], h[0]);
    rangeLabel.textContent = 'H ' + price(max) + ' · L ' + price(min) + ' · ';
    var ch = el('span', up ? 'up' : 'down', pct(change));
    rangeLabel.appendChild(ch);
  }
  function hideEvtTip() { var t = $('.evt-tip', chart); if (t) t.remove(); }

  function hover(e) {
    if (!view || e.target.classList.contains('evt')) return;
    var box = chart.getBoundingClientRect();
    var f = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    var t = view.t, sec = t[0] + f * (t[t.length - 1] - t[0]);
    var i = 0, best = Infinity;
    for (var k = 0; k < t.length; k++) { var d = Math.abs(t[k] - sec); if (d < best) { best = d; i = k; } }
    var x = view.X(t[i]), y = view.Y(view.h[i]);
    var cross = $('.cross', chart), dot = $('.dot', chart), tip = $('.tip', chart);
    cross.style.left = x + '%'; cross.hidden = false;
    dot.style.left = x + '%'; dot.style.top = y + '%'; dot.hidden = false;
    tip.innerHTML = '';
    tip.appendChild(document.createTextNode(price(view.h[i])));
    tip.appendChild(el('span', 't', (t[i] > 1e9 ? fullFmt.format(new Date(t[i] * 1000)) : '')));
    tip.style.left = Math.max(12, Math.min(88, x)) + '%';
    tip.hidden = false;
  }
  function unhover() {
    ['.cross', '.dot', '.tip'].forEach(function (s) { $(s, chart).hidden = true; });
  }
  chart.addEventListener('pointermove', hover);
  chart.addEventListener('pointerdown', hover);
  chart.addEventListener('pointerleave', unhover);

  // ---------- Stats ----------
  // Volatility is measured from the last 24 hours of the chart (nothing hidden):
  // the typical size of a 5-minute move, scaled up to a day.
  function volatility(h) {
    var r = [];
    // Under 3.00 prices move in Polygons (and can cross zero), so measure those moves against 3.00.
    for (var i = 1; i < h.length; i++) {
      r.push(h[i - 1] >= 3 && h[i] > 0 ? Math.log(h[i] / h[i - 1]) : (h[i] - h[i - 1]) / Math.max(3, Math.abs(h[i - 1])));
    }
    if (r.length < 2) return 0;
    var mean = r.reduce(function (a, b) { return a + b; }, 0) / r.length;
    var v = r.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / (r.length - 1);
    return Math.sqrt(v * 216) * 100;
  }
  function volLabel(v) {
    return v < 4 ? ['CALM', 1] : v < 8 ? ['STEADY', 2] : v < 14 ? ['LIVELY', 3] : v < 25 ? ['WILD', 4] : ['EXTREME', 5];
  }

  function stat(k, v, s, extra) {
    var d = el('div', 'stat');
    d.appendChild(el('div', 'k', k));
    var vv = el('div', 'v', v);
    d.appendChild(vv);
    if (extra) d.appendChild(extra);
    if (s) d.appendChild(el('div', 's', s));
    return d;
  }

  function drawStats(c, data) {
    var box = $('.stats', top);
    box.innerHTML = '';
    var h = c.history || [c.price];
    var v = volatility(h), vl = volLabel(v);
    var meter = el('div', 'meter' + (vl[1] >= 4 ? ' hot' : ''));
    for (var i = 1; i <= 5; i++) meter.appendChild(el('i', i <= vl[1] ? 'on' : ''));
    box.appendChild(stat('24H HIGH', price(Math.max.apply(null, h))));
    box.appendChild(stat('24H LOW', price(Math.min.apply(null, h))));
    box.appendChild(stat('VOLATILITY', vl[0], '≈' + v.toFixed(1) + '% a day', meter));
    var y = c.yield || 0;
    var rate = typeof c.divRate === 'number' ? c.divRate : (c.divSuspendedUntil ? 0 : 1);
    var eff = y * rate;
    var divLine = c.status === 'bankrupt' ? 'None · the company is bankrupt'
      : !y ? 'No dividend'
      : rate === 0 ? 'Suspended · board review ' + (c.divReviewAt ? clockFmt.format(new Date(c.divReviewAt)) : 'soon')
      : price(c.price * eff) + ' per share per day' +
        (rate > 1.25 ? ' · boosted to ' + Math.round(rate * 100) + '%' + (c.divBoostUntil ? ' until ' + clockFmt.format(new Date(c.divBoostUntil)) : '')
          : rate !== 1 ? ' · ' + (rate < 1 ? 'cut' : 'raised') + ' to ' + Math.round(rate * 100) + '%' : '');
    box.appendChild(stat('DIVIDEND', y ? (eff * 100).toFixed(2).replace(/\.?0+$/, '') + '%' : '--', divLine));
  }

  // ---------- Goal ----------
  var goalTimer = null;
  function drawGoal(c) {
    var card = $('.goal-card', top), side = $('.goal-side', top);
    clearInterval(goalTimer);
    card.innerHTML = '';
    if (c.status === 'bankrupt' && c.bankrupt) {
      // Bankrupt: no goals. Show the bailout appeal (or the next one) and the climb back to the surface.
      var b = c.bankrupt;
      card.className = 'goal-card bankrupt';
      card.appendChild(el('div', 'goal-text', c.name + ' is bankrupt. Every share was wiped. No goals until it is rescued or climbs back above 1.00.'));
      var bclock = el('div', 'goal-clock');
      card.appendChild(bclock);
      var label = el('div', 'goal-meta');
      label.appendChild(el('span', null, b.verdictAt ? 'TODD is ruling on bailout appeal #' + b.appeals : 'Next bailout appeal to TODD'));
      label.appendChild(el('span', null, 'Bankrupt since ' + fullFmt.format(new Date(b.since))));
      card.appendChild(label);
      var sbar = el('div', 'goal-bar'), sfill = el('span');
      sfill.style.width = Math.min(100, ((b.swim || 0) / 12) * 100) + '%';
      sbar.appendChild(sfill);
      card.appendChild(sbar);
      card.appendChild(el('div', 'goal-meta', b.swim ? 'Above 1.00 for ' + (b.swim * 5) + ' of 60 minutes. Stay up there and it is free.' : 'Climb above 1.00 and hold it for an hour to escape on its own.'));
      var target = Date.parse(b.verdictAt || b.nextAppealAt);
      var tickB = function () {
        var left = target - Date.now();
        bclock.textContent = left > 0 ? countdown(left) : (b.verdictAt ? 'VERDICT SOON' : 'APPEAL SOON');
      };
      tickB();
      goalTimer = setInterval(tickB, 1000);
      side.textContent = 'Bailout approved: trading restarts · Denied: it sinks deeper';
      return;
    }
    if (c.goal && c.goal.text) {
      card.className = 'goal-card';
      card.appendChild(el('div', 'goal-text', c.goal.text));
      var clock = el('div', 'goal-clock');
      var bar = el('div', 'goal-bar'), fill = el('span');
      bar.appendChild(fill);
      var meta = el('div', 'goal-meta');
      var dl = Date.parse(c.goal.deadline);
      var ann = (c.newsLog || []).filter(function (n) { return n.type === 'goal' && n.headline === c.goal.text; })[0];
      var t0 = ann ? Date.parse(ann.time) : dl - 12 * 3600000;
      meta.appendChild(el('span', null, 'Announced ' + (ann ? ago(ann.time) : '')));
      meta.appendChild(el('span', null, 'Deadline ' + fullFmt.format(new Date(dl))));
      card.appendChild(clock);
      card.appendChild(bar);
      card.appendChild(meta);
      var tickClock = function () {
        var left = dl - Date.now();
        clock.textContent = left > 0 ? countdown(left) : 'RESULT SOON';
        fill.style.width = Math.max(0, Math.min(100, ((Date.now() - t0) / (dl - t0)) * 100)) + '%';
      };
      tickClock();
      goalTimer = setInterval(tickClock, 1000);
      side.textContent = 'Hit it: stock jumps · Miss it: stock drops';
    } else {
      card.className = 'goal-card idle';
      card.appendChild(el('div', 'goal-text', 'No active goal.'));
      if (c.nextGoalAt) card.appendChild(el('div', 'goal-meta', 'Next announcement expected around ' + fullFmt.format(new Date(c.nextGoalAt)) + '.'));
      side.textContent = '';
    }
  }

  // ---------- News ----------
  function drawNews(c, data) {
    if (!bottom) return;
    var tl = $('.tl', bottom);
    var list = Array.isArray(c.newsLog) ? c.newsLog : (data.news || []).filter(function (n) { return n.id === ticker; });
    tl.innerHTML = '';
    $('.news-count', bottom).textContent = list.length ? list.length + ' latest' : '';
    if (!list.length) { tl.appendChild(el('p', 'empty', 'No news yet. Goals, rumors and breaking stories will show up here.')); return; }
    list.forEach(function (n) {
      var kd = kindOf(n);
      var item = el('div', 'tl-item ' + kd.tone);
      var head = el('div', 'tl-head');
      head.appendChild(el('span', 'tl-kind', kd.label));
      var when = el('span', null, ago(n.time));
      when.title = fullFmt.format(new Date(n.time));
      head.appendChild(when);
      item.appendChild(head);
      item.appendChild(el('div', 'tl-text', n.headline || ''));
      if (typeof n.move === 'number') {
        item.appendChild(el('div', 'tl-move ' + (n.move >= 0 ? 'up' : 'down'), pct(n.move) + (n.type === 'rumor' ? ' on the whispers' : ' on the news')));
      } else if (n.deadline) {
        item.appendChild(el('div', 'tl-move muted', 'Deadline ' + fullFmt.format(new Date(n.deadline))));
      }
      var r = typeof n.divRate === 'number' ? Math.round(n.divRate * 100) + '%' : '';
      var DIV = {
        bonus: ['up', '🎉 Bonus dividend paid'],
        boosted: ['up', '🎉 Bonus dividend paid, dividend boosted to ' + r],
        restored: ['up', n.type === 'success' ? '🎉 Bonus dividend paid, dividend back to 100%' : '💸 Dividend back to 100%'],
        special: ['up', '💰 Special dividend: ' + n.divDays + ' day' + (n.divDays > 1 ? 's' : '') + "' worth"],
        cut: ['down', '✂️ Dividend cut to ' + r],
        suspended: ['down', n.divRate === undefined ? '💸 Dividend suspended for 24 hours' : '💸 Dividend suspended']
      };
      if (n.type !== 'dividend' && DIV[n.dividend]) item.appendChild(el('div', 'tl-move ' + DIV[n.dividend][0], DIV[n.dividend][1]));
      if (n.type === 'dividend' && typeof n.from === 'number') {
        item.appendChild(el('div', 'tl-move ' + (n.divRate > n.from ? 'up' : 'down'), Math.round(n.from * 100) + '% → ' + r));
      }
      tl.appendChild(item);
    });
  }

  function drawPeers(data) {
    if (!bottom) return;
    var box = $('.peers', bottom);
    box.innerHTML = '';
    data.companies.forEach(function (o) {
      if (o.id === ticker) return;
      var a = el('a', 'peer');
      a.href = '/rend-conomy/' + String(o.id).toLowerCase() + '/';
      var tt = el('div', 'pt');
      tt.appendChild(el('span', null, o.id));
      tt.appendChild(el('span', o.change >= 0 ? 'up' : 'down', pct(o.change)));
      a.appendChild(tt);
      a.appendChild(el('div', 'pn', o.name));
      a.appendChild(el('div', 'pp', price(o.price)));
      var h = o.history || [];
      var min = Math.min.apply(null, h), max = Math.max.apply(null, h), r = max - min || 1;
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'spark' + (o.change >= 0 ? '' : ' down'));
      svg.setAttribute('viewBox', '0 0 100 26');
      svg.setAttribute('preserveAspectRatio', 'none');
      var pl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      pl.setAttribute('points', h.map(function (v, i) { return (i / Math.max(1, h.length - 1) * 100).toFixed(1) + ',' + (24 - (v - min) / r * 22).toFixed(1); }).join(' '));
      svg.appendChild(pl);
      a.appendChild(svg);
      box.appendChild(a);
    });
  }

  // ---------- Header ----------
  function drawHead(c, data) {
    var head = $('.co-head', top);
    var up = c.change >= 0;
    head.classList.toggle('is-down', !up);
    document.title = c.name + ' (' + c.id + ') | Rend-Conomy';
    $('.co-badge', top).textContent = c.id;
    $('.co-name', top).textContent = c.name;
    $('.co-desc', top).textContent = c.description || '';
    var num = $('.co-num', top);
    num.textContent = money(c.price); // the label beside it carries the ⬡
    if (lastPrice !== null && lastPrice !== c.price) {
      num.classList.remove('co-tick'); void num.offsetWidth; num.classList.add('co-tick');
    }
    lastPrice = c.price;
    var pill = $('.co-pill', top);
    pill.textContent = pct(c.change) + ' 24h';
    pill.className = 'co-pill ' + (up ? 'up' : 'down');

    var chips = $('.co-chips', top);
    chips.innerHTML = '';
    var m = data.market || { status: 'open' };
    var st = el('span', 'tag' + (m.status === 'open' ? ' live' : m.status === 'closed' ? ' off' : ''),
      m.status === 'after-hours' ? 'AFTER HOURS' : m.status === 'closed' ? 'CLOSED' : 'MARKET OPEN');
    chips.appendChild(st);
    if (m.halted) chips.appendChild(el('span', 'tag bk', 'TRADING HALTED'));
    if (data.crash && data.crash.phase === 'crash') chips.appendChild(el('span', 'tag bk', 'MARKET CRASH'));
    if (c.status === 'bankrupt') chips.appendChild(el('span', 'tag bk', 'BANKRUPT'));
    else if (c.status === 'distressed') chips.appendChild(el('span', 'tag brink', 'DISTRESSED'));
    head.classList.toggle('is-bankrupt', c.status === 'bankrupt');
    if (c.goal && c.goal.text) chips.appendChild(el('span', 'tag', 'GOAL ACTIVE'));
    var dr = typeof c.divRate === 'number' ? c.divRate : (c.divSuspendedUntil ? 0 : 1);
    if (c.yield && dr === 0) chips.appendChild(el('span', 'tag off', 'DIVIDEND SUSPENDED'));
    else if (c.yield && dr < 1) chips.appendChild(el('span', 'tag off', 'DIVIDEND CUT ' + Math.round(dr * 100) + '%'));
    else if (c.yield && dr > 1.25) chips.appendChild(el('span', 'tag live', 'DIVIDEND BOOSTED'));

    $('.co-sub', top).textContent = data.updated ? 'Updated ' + ago(data.updated) + ' · prices are fictional' : '';
  }

  function show(data) {
    var c = (data.companies || []).filter(function (x) { return x.id === ticker; })[0];
    if (!c) {
      $('.co-note', top).textContent = 'This company is not on the market right now.';
      return;
    }
    last = { c: c, data: data };
    drawHead(c, data);
    drawChart(c);
    drawStats(c, data);
    drawGoal(c);
    drawNews(c, data);
    drawPeers(data);
    $('.co-note', top).textContent = 'Shaded stretches are after hours (9 PM to 3 AM Eastern), when prices only drift.';
  }

  function newestPrices(url) {
    // The market's prices live in two places: /prices.json (the GitHub Action) and the data branch (when the
    // bot runs the market). Whichever was updated last wins, so the site keeps working through the switch.
    var BOT = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io/data/prices.json';
    var get = function (u) { return fetch(u + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); }).catch(function () { return null; }); };
    return Promise.all([get(url || '/prices.json'), get(BOT)]).then(function (l) {
      var a = l[0], b = l[1];
      if (!a && !b) throw new Error('no prices');
      if (!a || !b) return a || b;
      return Date.parse(b.updated) > Date.parse(a.updated) ? b : a;
    });
  }

  function load() {
    newestPrices(DATA_URL)
      .then(show)
      .catch(function () { $('.co-note', top).textContent = 'Live prices could not be loaded right now.'; })
      .then(function () { setTimeout(load, REFRESH_MS); });
  }
  load();
})();
