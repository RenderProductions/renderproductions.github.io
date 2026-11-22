// Story of Varandia: shared code for every /varandia/ page.
//   - dresses each <section class="page"> as old paper (creases, grain, stains, a ragged edge) and adds the spine
//   - Tome.data()        the rules (varandia/data.json), loaded once
//   - Tome.stat(c, key)  a character's full stat: d6 roll + points spent + race modifier
//   - Tome.derive(c, d)  Defense, max HP, max Stamina, Initiative, Movement, attack bonus
//   - Tome.chars         characters saved in this browser (list, get, save, remove)
//   - Tome.roll(bonus)   a d20 roll: { die, bonus, total }
(function () {
  'use strict';
  var Tome = window.Tome = window.Tome || {};

  // ---------------------------------------------------------------- paper
  var NS = 'http://www.w3.org/2000/svg';
  var FX = '<svg class="tome-fx" aria-hidden="true" focusable="false"><defs>' +
    '<filter id="tome-rough"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="7"/><feDisplacementMap in="SourceGraphic" scale="3.4"/></filter>' +
    '<filter id="tome-edge" x="-3%" y="-3%" width="106%" height="106%"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="4"/><feDisplacementMap in="SourceGraphic" scale="14"/></filter>' +
    '<filter id="tome-crease-a" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.011 0.016" numOctaves="5" seed="23"/><feDiffuseLighting surfaceScale="3.2" lighting-color="#fff4dc"><feDistantLight azimuth="235" elevation="48"/></feDiffuseLighting></filter>' +
    '<filter id="tome-crease-b" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.014 0.01" numOctaves="5" seed="61"/><feDiffuseLighting surfaceScale="3.2" lighting-color="#fff4dc"><feDistantLight azimuth="220" elevation="48"/></feDiffuseLighting></filter>' +
    '<filter id="tome-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="2"/><feColorMatrix values="0 0 0 0 0.25  0 0 0 0 0.16  0 0 0 0 0.08  0 0 0 -1.6 0.95"/></filter>' +
    '</defs></svg>';

  function layer(cls, filter) {
    var s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.setAttribute('focusable', 'false');
    s.setAttribute('preserveAspectRatio', 'none');
    var r = document.createElementNS(NS, 'rect');
    r.setAttribute('width', '100%'); r.setAttribute('height', '100%'); r.setAttribute('filter', 'url(#' + filter + ')');
    s.appendChild(r);
    return s;
  }
  function dress() {
    if (!document.getElementById('tome-rough')) document.body.insertAdjacentHTML('afterbegin', FX);
    document.querySelectorAll('.spread').forEach(function (sp) {
      if (sp.querySelector(':scope > .spine')) return;
      var spine = document.createElement('div'); spine.className = 'spine'; spine.setAttribute('aria-hidden', 'true');
      sp.appendChild(spine);
    });
    document.querySelectorAll('.page').forEach(function (p, i) {
      if (p.querySelector(':scope > .paper')) return;
      var stains = document.createElement('div'); stains.className = 'stains'; stains.setAttribute('aria-hidden', 'true');
      var paper = document.createElement('div'); paper.className = 'paper'; paper.setAttribute('aria-hidden', 'true');
      p.insertBefore(stains, p.firstChild);
      p.insertBefore(layer('grain', 'tome-grain'), p.firstChild);
      p.insertBefore(layer('crease', i % 2 ? 'tome-crease-b' : 'tome-crease-a'), p.firstChild);
      p.insertBefore(paper, p.firstChild);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', dress); else dress();
  Tome.dress = dress;

  // ---------------------------------------------------------------- helpers
  Tome.esc = function (t) {
    return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };
  Tome.sign = function (n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '+0'; };
  Tome.modText = function (n) { return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '—'; };
  /** Half a stat, rounded down (so −3 gives −2). This is what goes on a d20 roll. */
  Tome.half = function (v) { return Math.floor(v / 2); };
  Tome.$ = function (sel, root) { return (root || document).querySelector(sel); };
  Tome.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var dataP = null;
  Tome.data = function () {
    if (!dataP) dataP = fetch('/varandia/data.json', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('data.json: ' + r.status);
      return r.json();
    });
    return dataP;
  };
  Tome.race = function (d, key) { return d.races.filter(function (r) { return r.key === key; })[0] || null; };

  // ---------------------------------------------------------------- rules
  Tome.stat = function (c, key, d) {
    var race = d && Tome.race(d, c.race);
    return ((c.d6 && c.d6[key]) || 0) + ((c.pts && c.pts[key]) || 0) + ((race && race.mods[key]) || 0);
  };
  Tome.derive = function (c, d) {
    var r = d.derived, s = function (k) { return Tome.stat(c, k, d); }, lv = Math.max(1, c.level || 1), h = Tome.half;
    return {
      defense: r.defense.base + h(s(r.defense.halfOf)),
      hp: Math.max(1, r.hp.base + s(r.hp.plusStat) + (lv - 1) * (r.hp.perLevel + h(s(r.hp.perLevelHalfOf)))),
      stamina: Math.max(0, r.stamina.base + s(r.stamina.stat) * r.stamina.statTimes + (lv - 1) * (r.stamina.perLevel + h(s(r.stamina.perLevelHalfOf)))),
      initiative: h(s(r.initiative.halfOf)),
      movement: Math.max(0, r.movement.baseFeet + r.movement.feetPerTwo * Math.floor(Math.max(0, s(r.movement.stat)) / 2)),
      attack: h(s(r.attack.halfOf))
    };
  };
  Tome.roll = function (bonus, sides) {
    var die = 1 + Math.floor(Math.random() * (sides || 20));
    return { die: die, bonus: bonus || 0, total: die + (bonus || 0) };
  };

  // ---------------------------------------------------------------- characters (this browser)
  var KEY = 'varandia_chars';
  function readAll() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function writeAll(list) { try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }
  Tome.chars = {
    list: function () { return readAll().sort(function (a, b) { return (b.updated || 0) - (a.updated || 0); }); },
    get: function (id) { return readAll().filter(function (c) { return c.id === id; })[0] || null; },
    save: function (c) {
      var all = readAll().filter(function (x) { return x.id !== c.id; });
      c.updated = Date.now();
      all.push(c);
      return writeAll(all);
    },
    remove: function (id) { return writeAll(readAll().filter(function (c) { return c.id !== id; })); },
    newId: function () { return 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  };

  /** Draws a body-count style tally (groups of five) into el. */
  Tome.tally = function (el, n) {
    var html = '', left = Math.max(0, n | 0);
    while (left > 0) {
      var full = left >= 5, c = full ? 4 : left;
      html += '<span class="g' + (full ? ' full' : '') + '">' + new Array(c + 1).join('<i></i>') + '</span>';
      left -= full ? 5 : left;
    }
    el.innerHTML = html || '<span class="pencil">none yet</span>';
    el.setAttribute('aria-label', String(n | 0));
  };
})();
