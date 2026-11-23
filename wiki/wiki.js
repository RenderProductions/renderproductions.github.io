// The Rend-Conomy Wiki: search, the contents highlight, and every table filled from data.json (which the bot
// builds from its own code, so the numbers are always current). Plain script, no build step.
(function () {
  'use strict';
  var BASE = '/wiki/';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var md = function (s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>'); };
  var poly = function (n) { return n == null ? 'varies' : '⬡' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); };
  var pct = function (x, d) { return (Math.round(x * 1000) / 10).toFixed(d == null ? (x * 100 % 1 ? 1 : 0) : d).replace(/\.0$/, '') + '%'; };
  var img = function (name, fb) { return '<img class="px" src="/bot/emojis/rc_' + name + '.png" alt="" loading="lazy" onerror="this.replaceWith(document.createTextNode(\'' + (fb || '') + '\'))">'; };
  var dur = function (h) { return h >= 24 && h % 24 === 0 ? (h / 24) + (h === 24 ? ' day' : ' days') : h < 1 ? Math.round(h * 60) + ' min' : h + (h === 1 ? ' hour' : ' hours'); };

  // ---------------------------------------------------------------- search
  var index = null;
  function loadIndex() { return index || (index = fetch(BASE + 'search.json').then(function (r) { return r.json(); }).catch(function () { return []; })); }
  function score(e, words) {
    var t = e.title.toLowerCase(), h = (e.heads || []).join(' ').toLowerCase(), b = (e.text || '').toLowerCase(), s = 0;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (t.indexOf(w) >= 0) s += 10; else if (h.indexOf(w) >= 0) s += 5; else if (b.indexOf(w) >= 0) s += 1; else return 0;
    }
    return s;
  }
  function snippet(e, words) {
    var b = e.text || '', i = b.toLowerCase().indexOf(words[0]);
    if (i < 0) return e.summary || '';
    var start = Math.max(0, i - 50);
    return (start ? '…' : '') + b.slice(start, start + 140).trim() + '…';
  }
  function bindSearch(input) {
    var box = document.createElement('div');
    box.className = 'results'; box.setAttribute('role', 'listbox');
    input.parentNode.appendChild(box);
    var on = -1, hits = [];
    function render(q) {
      var words = q.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) { box.classList.remove('open'); return; }
      loadIndex().then(function (all) {
        hits = all.map(function (e) { return { e: e, s: score(e, words) }; }).filter(function (x) { return x.s; }).sort(function (a, b) { return b.s - a.s; }).slice(0, 8);
        on = -1;
        box.innerHTML = hits.length ? hits.map(function (x, i) { return '<a href="' + x.e.url + '" data-i="' + i + '"><b>' + esc(x.e.title) + '</b><small>' + esc([x.e.section, snippet(x.e, words)].filter(Boolean).join(' · ')) + '</small></a>'; }).join('')
          : '<div class="none">Nothing matches "' + esc(q) + '". Try a command name, like <code>heist</code>.</div>';
        box.classList.add('open');
      });
    }
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('focus', function () { if (input.value) render(input.value); });
    input.addEventListener('keydown', function (ev) {
      var links = $$('a', box);
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        on = Math.max(0, Math.min(links.length - 1, on + (ev.key === 'ArrowDown' ? 1 : -1)));
        links.forEach(function (a, i) { a.classList.toggle('on', i === on); });
      } else if (ev.key === 'Enter') {
        var go = links[on >= 0 ? on : 0];
        if (go) { ev.preventDefault(); location.href = go.href; }
      } else if (ev.key === 'Escape') { box.classList.remove('open'); input.blur(); }
    });
    document.addEventListener('click', function (ev) { if (!input.parentNode.contains(ev.target)) box.classList.remove('open'); });
  }
  $$('input[data-search]').forEach(bindSearch);
  document.addEventListener('keydown', function (ev) {
    if (ev.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { var s = $('input[data-search]'); if (s) { ev.preventDefault(); s.focus(); } }
  });

  // ---------------------------------------------------------------- contents highlight
  var toc = $$('.toc a[href^="#"]');
  if (toc.length && 'IntersectionObserver' in window) {
    var seen = {};
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { seen[e.target.id] = e.isIntersecting; });
      var first = toc.find(function (a) { return seen[a.getAttribute('href').slice(1)]; });
      if (first) toc.forEach(function (a) { a.classList.toggle('on', a === first); });
    }, { rootMargin: '0px 0px -70% 0px' });
    toc.forEach(function (a) { var t = document.getElementById(a.getAttribute('href').slice(1)); if (t) io.observe(t); });
  }

  // ---------------------------------------------------------------- tables from data.json
  var holders = $$('[data-table], [data-v]');
  if (!holders.length) return;
  fetch(BASE + 'data.json').then(function (r) { return r.json(); }).then(function (D) {
    var get = function (path) { return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, D); };
    $$('[data-v]').forEach(function (el) {
      var v = get(el.getAttribute('data-v')), f = el.getAttribute('data-f');
      el.textContent = f === 'pct' ? pct(v) : f === 'num' ? Number(v).toLocaleString('en-US') : f === 'raw' ? v : poly(v);
    });
    var table = function (heads, rows) {
      return '<div class="tbl"><table><thead><tr>' + heads.map(function (h) { return '<th' + (h[1] ? ' class="n"' : '') + ' scope="col">' + h[0] + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    };
    var row = function (cells) { return '<tr>' + cells.join('') + '</tr>'; };
    var td = function (v, cls) { return '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + v + '</td>'; };
    // The site's own pixel emojis wherever one exists for the thing (the same art the bot uses in Discord), and
    // the plain emoji otherwise. `icon` can be a name or a list of names to try in order.
    var have = {}; (D.emojis || []).forEach(function (n) { have[n] = true; });
    var ico = function (icon, fb) {
      var list = [].concat(icon || []).filter(function (n) { return have[n]; });
      return list.length ? img(list[0], fb) : fb ? '<span class="uni" aria-hidden="true">' + esc(fb) + '</span>' : '';
    };
    var slug = function (s) { return String(s).toLowerCase().replace(/ set$/, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); };
    var name = function (icon, fb, label, extra) { return td('<span class="ic">' + ico(icon, fb) + esc(label) + (extra || '') + '</span>', 'nm'); };

    var T = {
      buildings: function () {
        return table([['Building'], ['Price', 1], ['Makes / day', 1], ['Upkeep', 1], ['Build', 1], ['Levels', 1], ['Perk']], D.city.buildings.map(function (b) {
          return row([name('prop_' + b.id, b.emoji, b.name), td(poly(b.price), 'n'), td(b.id === 'factory' ? '24 Goods' : b.rent ? poly(b.rent) : '—', 'n'), td(poly(b.upkeep), 'n'), td(dur(b.hours), 'n'), td(b.maxLevel, 'n'), td('<strong>' + esc(b.perk) + ':</strong> ' + esc(b.perkText), 'dim')]);
        }));
      },
      landmarks: function () {
        return table([['Landmark'], ['Cost', 1], ['Everyone here gets']], D.city.landmarks.map(function (l) { return row([name('landmark_' + l.id, l.emoji, l.name), td(poly(l.cost), 'n'), td(esc(l.perk))]); }));
      },
      tax: function () {
        var t = D.city.tax;
        return table([['Buildings you own'], ['Tax a day', 1]], t.map(function (x, i) { var to = t[i + 1] ? t[i + 1].from - 1 : null; return row([td(x.from + (to ? '–' + to : '+')), td(x.rate ? pct(x.rate, 1) + ' of their value' : 'none', 'n')]); }));
      },
      crops: function () {
        return table([['Crop'], ['Seed', 1], ['Grows in', 1], ['Harvests', 1], ['Worth', 1]], D.farming.crops.map(function (c) { return row([name(c.id, c.emoji, c.name), td(poly(c.seed), 'n'), td(dur(c.growHours), 'n'), td(c.harvests, 'n'), td(poly(c.value), 'n')]); }));
      },
      mutations: function () {
        return table([['Mutation'], ['Chance', 1], ['Worth', 1]], D.farming.mutations.map(function (m) { return row([name({ golden: 'golden_carrot', rainbow: 'rainbow_carrot', square: 'squarepumpkin' }[m.id], m.emoji, m.label, m.id === 'square' ? ' <span class="dim">(pumpkins only)</span>' : ''), td(pct(m.chance), 'n'), td(m.mult + '×', 'n')]); }));
      },
      grades: function () {
        return table([['Grade'], ['Chance', 1], ['Fertilized', 1], ['Sells for', 1]], D.farming.grades.map(function (g) { return row([td(esc(g.label), 'nm'), td(pct(g.chance), 'n'), td(pct(g.fertChance), 'n'), td(pct(g.band[0]) + '–' + pct(g.band[1]) + ' of its value', 'n')]); }));
      },
      plots: function () {
        var f = D.farming;
        return table([['Plot'], ['Price', 1]], f.plotPrices.map(function (pr, i) { var n = f.startPlots + i + 1; return row([td('Plot ' + n + (n > f.maxPlots ? ' <span class="dim">(needs a Barn)</span>' : '')), td(poly(pr), 'n')]); }));
      },
      fish: function () {
        return table([['Catch'], ['Size'], ['Marquez pays', 1]], D.fishing.catch.map(function (c) { return row([name('fish_' + c.id, c.emoji, c.name), td(esc(c.size), 'dim'), td(poly(c.value), 'n')]); }));
      },
      fishtables: function () {
        var cols = [['nothing', 'Nothing'], ['snag', 'Snag'], ['junk', 'Junk'], ['wallet', 'Wallet'], ['1', 'Small'], ['2', 'Medium'], ['3', 'Large'], ['4', 'Legendary']];
        var names = { bait: 'Plain bait', lure: 'Lure', 1: 'A small fish', 2: 'A medium fish', 3: 'A large fish' };
        return table([['Casting with']].concat(cols.map(function (c) { return [c[1], 1]; })), Object.keys(D.fishing.tables).map(function (k) {
          var t = D.fishing.tables[k], sum = 0; Object.keys(t).forEach(function (x) { sum += t[x]; });
          return row([td(names[k] || k, 'nm')].concat(cols.map(function (c) { return td(t[c[0]] ? pct(t[c[0]] / sum, 1) : '—', 'n'); })));
        }));
      },
      jobs: function () {
        return table([['Company'], ['The job'], ['Ranks']], D.work.companies.map(function (c) { return row([td(esc(c.name) + ' <span class="dim">' + c.ticker + '</span>', 'nm'), td(esc(c.role), 'dim'), td(c.ranks.map(function (r, i) { return esc(r) + ' <span class="dim">' + D.work.rankPay[i] + '×</span>'; }).join(' → '))]); }));
      },
      games: function () {
        return table([['Game'], ['Max bet', 1], ['Rules and return']], D.casino.games.map(function (g) { return row([name(g.id, '', g.name.replace(/^[^A-Za-z]+/, '')), td(poly(g.maxBet), 'n'), td(md(g.odds))]); }));
      },
      vip: function () {
        return table([['Level'], ['Total bet', 1], ['Daily free spin', 1]], D.casino.vip.map(function (v) { return row([name(['vip_' + slug(v.name), 'vip'], v.emoji, v.name), td(poly(v.at), 'n'), td(poly(v.spin), 'n')]); }));
      },
      targets: function () {
        return table([['Target'], ['Odds', 1], ['Stake each', 1], ['Haul', 1], ['Needs']], D.heists.targets.map(function (t) { return row([name({ vault: ['company'], stash: ['todd'], reserve: ['reserve'], train: ['freight'] }[t.id], t.emoji, t.label.replace(/^a /, '').replace(/^./, function (c) { return c.toUpperCase(); })), td(pct(t.odds), 'n'), td(poly(t.stake), 'n'), td(poly(t.haul[0]) + '–' + poly(t.haul[1]).slice(1), 'n'), td(t.needs ? 'a ' + esc(t.needs.replace(/^./, function (c) { return c.toUpperCase(); })) : '—', 'dim')]); }));
      },
      roles: function () {
        var what = { Hacker: 'needed for the Reserve', Driver: 'if it goes wrong, a chance to get away with no fine', Lookout: '', Muscle: 'a bigger haul' };
        return table([['Role'], ['Odds', 1], ['Also']], D.heists.roles.map(function (r) { return row([name({ Hacker: 'password', Driver: 'fuel', Lookout: 'heat_off', Muscle: 'heist' }[r.label], r.emoji, r.label), td('+' + pct(r.odds), 'n'), td(esc((what[r.label] || '') + (r.haul ? ' (+' + pct(r.haul) + ')' : '')) || '—', 'dim')]); }));
      },
      contraband: function () {
        return table([['Contraband'], ['Price', 1], ['Heat', 1], ['What it does']], D.underground.contraband.map(function (c) { return row([name(slug(c.name), '', c.name), td(poly(c.price), 'n'), td('+' + c.heat, 'n'), td(esc(c.desc), 'dim')]); }));
      },
      loot: function () {
        return table([['Hot loot'], ['Worth', 1]], D.underground.loot.map(function (l) { return row([name(l.emoji, '', l.name.replace(/^a /, '').replace(/^./, function (c) { return c.toUpperCase(); })), td(l.value[0] === l.value[1] ? poly(l.value[0]) : poly(l.value[0]) + '–' + poly(l.value[1]).slice(1), 'n')]); }));
      },
      events: function () {
        return table([['Event'], ['For an hour']], D.events.map(function (e) { return row([name({ snow_day: 'snowday', rain: 'rain', storm: 'storm', fish_frenzy: 'fishing', police_strike: 'heat_off', bear_rumors: 'down', chatty: 'megaphone', spotlight: 'stonks', fire_sale: 'sold', happy_hour: 'jackpot', labor_shortage: 'work' }[e.id], e.emoji, e.name), td(md(e.desc))]); }));
      },
      levels: function () {
        return table([['Level'], ['Upgrade cost', 1], ['Upkeep / day', 1], ['Pay', 1]], D.companies.levels.map(function (l, i) { return row([td((i + 1) + '. ' + esc(l.name), 'nm'), td(poly(l.cost), 'n'), td(poly(l.upkeep), 'n'), td(l.payMult + '×', 'n')]); }));
      },
      brokers: function () {
        return table([['Broker'], ['Salary / day', 1], ['Cut of profits', 1], ['Style']], D.market.brokers.traits.map(function (t) { return row([name('broker_' + slug(t.label), t.emoji, t.label), td(poly(t.salary), 'n'), td(pct(t.cut), 'n'), td(esc(t.desc), 'dim')]); }));
      },
      savings: function () {
        var pl = D.savings.plans;
        return table([['Locked for'], ['Interest at the end', 1]], Object.keys(pl).map(function (d) { return row([td(d + ' days'), td(pct(pl[d] / 10000), 'n')]); }));
      },
      rarity: function () {
        return table([['Rarity'], ['Pays', 1], ['How many', 1]], Object.keys(D.rarity).map(function (k) { var r = D.rarity[k]; return row([name('rarity_' + k, r.emoji, r.label), td(poly(r.pay), 'n'), td(D.achievements.filter(function (a) { return a.rarity === k; }).length, 'n')]); }));
      },
      items: function (el) { filtered(el, D.items.concat(D.collectibles.map(function (c) { c.collectible = true; return c; })), function (i) { return i.shelf; }, ['Item'], function (i) { return [name(i.id, i.emoji, i.name), td(i.price == null ? 'rolled each restock' : poly(i.price), 'n'), td(i.collectible ? 'limited' : i.stock, 'n'), td(esc(i.shelf), 'dim'), td(esc(i.desc) + (i.passive ? ' <span class="dim">(works on its own)</span>' : ''))]; }, [['Item'], ['Price', 1], ['Stock', 1], ['Shelf'], ['What it does']], function (i) { return i.name + ' ' + i.desc + ' ' + i.id; }); },
      achievements: function (el) { var order = Object.keys(D.rarity); filtered(el, D.achievements.slice().sort(function (x, y) { return order.indexOf(y.rarity) - order.indexOf(x.rarity); }), function (a) { return a.category; }, null, function (a) { var r = D.rarity[a.rarity]; return [td(ico('rarity_' + a.rarity, r.emoji), ''), td(esc(a.name), 'nm'), td(esc(a.desc)), td(esc(a.category), 'dim'), td(poly(r.pay), 'n')]; }, [['<span class="sr">Rarity</span>'], ['Achievement'], ['How'], ['Section'], ['Pays', 1]], function (a) { return a.name + ' ' + a.desc + ' ' + a.category + ' ' + D.rarity[a.rarity].label; }); },
      cityWorks: function (el) {
        var W = D.refined.city.works, icons = { rent: 'property', chat: 'megaphone', shifts: 'work', crops: 'carrot', happyhour: 'jackpot' };
        el.innerHTML = table([['Effect'], ['Size'], ['How long'], ['Rate', 1]], Object.keys(W).map(function (k) {
          var w = W[k], hours = w.unit === 'h';
          return row([name(icons[k], '', w.label.charAt(0).toUpperCase() + w.label.slice(1)), td(hours ? w.min + ' to ' + w.max + ' hours' : (k === 'chat' ? '×' + (1 + w.min) + ' to ×' + (1 + w.max) : '+' + Math.round(w.min * 100) + '% to +' + Math.round(w.max * 100) + '%')),
            td(hours ? 'that many hours' : D.refined.city.workDays[0] + ' to ' + D.refined.city.workDays[1] + ' days'), td(poly(w.rate) + (hours ? ' per hour' : ' per % per day'), 'n')]);
        }));
      },
      commands: function (el) {
        filtered(el, D.commands, function (c) { return (D.sections[c.section] || {}).label || c.section; }, null, function (c) {
          var opts = c.options.map(function (o) { return o.required ? '&lt;' + esc(o.name) + '&gt;' : '[' + esc(o.name) + ']'; }).join(' ');
          return [td('<code>r!' + esc(c.name) + (opts ? ' ' + opts : '') + '</code>' + (c.aliases.length ? '<br><span class="dim" style="font-size:12px">also ' + c.aliases.map(function (a) { return 'r!' + esc(a); }).join(', ') + '</span>' : '')), td(esc(c.description)), td('<code>' + esc(c.slash) + '</code>', 'dim')];
        }, [['Command'], ['What it does'], ['Slash']], function (c) { return c.name + ' ' + c.aliases.join(' ') + ' ' + c.description; });
      },
      emojis: function (el) {
        var group = function (n) { return /^prop_|^landmark_|^construction|^tile_|^lot_|^freight|^goods|^brick|^squatter/.test(n) ? 'The city' : /^crop_|^seed_|^farm|^plot|^water|^ferti|^wilt|^sprout|^grow/.test(n) ? 'Farming' : /^fish_|^rod|^lure|^bait/.test(n) ? 'Fishing' : /^col_/.test(n) ? 'Collectibles' : /^n[0-9]$|^n(dot|x|pct|plus|minus|k|m)$/.test(n) ? 'Digits' : 'Everything else'; };
        filtered(el, D.emojis.map(function (n) { return { n: n }; }), function (e) { return group(e.n); }, null, null, null, function (e) { return e.n; }, function (list) {
          return '<div class="emojigrid">' + list.map(function (e) { return '<figure title=":rc_' + esc(e.n) + ':">' + img(e.n) + '<figcaption>' + esc(e.n) + '</figcaption></figure>'; }).join('') + '</div>';
        });
      }
    };

    // a table with a filter box and category buttons
    function filtered(el, items, catOf, _u, cells, heads, textOf, custom) {
      var cats = []; items.forEach(function (i) { var c = catOf(i); if (cats.indexOf(c) < 0) cats.push(c); });
      var id = 'f' + Math.random().toString(36).slice(2, 7), cur = 'All', q = '';
      el.innerHTML = '<div class="tbltools"><label class="sr" for="' + id + '">Filter</label><input id="' + id + '" type="search" class="field" placeholder="Filter…">'
        + ['All'].concat(cats).map(function (c) { return '<button type="button" class="pill" aria-pressed="' + (c === 'All') + '">' + esc(c) + '</button>'; }).join('')
        + '</div><div class="count"></div><div class="out"></div>';
      var draw = function () {
        var words = q.toLowerCase().split(/\s+/).filter(Boolean);
        var list = items.filter(function (i) { var t = textOf(i).toLowerCase(); return (cur === 'All' || catOf(i) === cur) && words.every(function (w) { return t.indexOf(w) >= 0; }); });
        $('.count', el).textContent = list.length + ' of ' + items.length;
        $('.out', el).innerHTML = list.length ? (custom ? custom(list) : table(heads, list.map(function (i) { return row(cells(i)); }))) : '<p class="dim" style="color:var(--grey)">Nothing matches.</p>';
      };
      $('input', el).addEventListener('input', function (e) { q = e.target.value; draw(); });
      $$('.pill', el).forEach(function (b) { b.addEventListener('click', function () { cur = b.textContent; $$('.pill', el).forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); }); draw(); }); });
      draw();
    }

    $$('[data-table]').forEach(function (el) {
      var fn = T[el.getAttribute('data-table')];
      if (!fn) return;
      var out = fn(el);
      if (typeof out === 'string') el.innerHTML = out;
    });
  }).catch(function () {
    $$('[data-table]').forEach(function (el) { el.innerHTML = '<p class="note warn"><b>OOPS</b><span>The numbers didn\'t load. Refresh to try again.</span></p>'; });
  });
})();
