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
  var spellsP = null;
  /** All spells as one list: Varandia's Evil spells first (element "evil", own: true), then the SRD ones. */
  Tome.spells = function () {
    if (!spellsP) spellsP = fetch('/varandia/spells.json').then(function (r) {
      if (!r.ok) throw new Error('spells.json: ' + r.status);
      return r.json();
    }).then(function (s) {
      s.all = s.evil.map(function (e) { var x = Object.assign({}, e); x.element = 'evil'; x.own = true; return x; }).concat(s.srd);
      s.byKey = {}; s.all.forEach(function (x) { s.byKey[x.key] = x; });
      return s;
    });
    return spellsP;
  };
  /** What a spell costs in Varandia: { stamina, blood, need, fail, chaotic, favored }. Evil spells carry their own numbers.
      With a character c, the Need is theirs: Chaotic spells get easier with level, and spells on their class's list are easier. */
  Tome.spellCost = function (sp, d, c) {
    var out;
    if (sp.own) out = { stamina: sp.stamina, blood: sp.blood, need: sp.need, fail: sp.fail };
    else {
      var r = d.spells, lv = sp.level, ch = sp.element === 'chaotic';
      var need = r.needBase + lv;
      if (ch) need = r.chaotic.needBase + lv - (c ? Math.floor(Math.max(0, (c.level || 1) - 1) / (r.chaotic.easierEvery || 1)) * r.chaotic.easierPerLevel : 0);
      out = {
        stamina: lv === 0 ? r.cantripStamina : r.staminaPerLevel * lv, blood: 0,
        need: Math.max(r.needBase + lv, need), chaotic: ch,
        fail: lv === 0 ? r.failCantrip : lv + r.failDie
      };
    }
    if (c && c.cls && sp.classes && sp.classes.indexOf(c.cls) >= 0) { out.need -= (d.classRules || {}).classListNeed || 0; out.favored = true; }
    return out;
  };
  Tome.cls = function (d, key) { return (d.classes || []).filter(function (x) { return x.key === key; })[0] || null; };
  /** Proficiency bonus for a character level (D&D's table: +2 at 1, +3 at 5, ... +6 at 17). */
  Tome.prof = function (d, level) {
    var b = 0; (d.proficiency ? d.proficiency.byLevel : []).forEach(function (r) { if ((level || 1) >= r[0]) b = r[1]; });
    return b;
  };
  /** Rolls dice written like "3d4", "1d20+5" or "2"; null if it isn't dice. */
  Tome.dice = function (expr) {
    var m = String(expr).replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$|^(\d+)$/);
    if (!m) return null;
    if (m[4]) return +m[4];
    var n = +(m[1] || 1), sides = +m[2], t = +(m[3] || 0);
    for (var i = 0; i < n; i++) t += 1 + Math.floor(Math.random() * sides);
    return t;
  };
  var itemsP = null;
  /** Items: { weapons, armor, gear, relics, masks, all, byKey, byName }. */
  Tome.items = function () {
    if (!itemsP) itemsP = fetch('/varandia/items.json').then(function (r) {
      if (!r.ok) throw new Error('items.json: ' + r.status);
      return r.json();
    }).then(function (x) {
      x.relics.forEach(function (r) { r.group = 'relic'; if (r.weapon) { r.dice = r.weapon.dice; r.type = r.weapon.type; } });
      x.masks.forEach(function (m) { m.group = 'mask'; });
      x.healing.forEach(function (h) { h.group = 'healing'; });
      x.all = [].concat(x.weapons, x.armor, x.healing, x.magic, x.gear, x.relics, x.masks);
      x.byKey = {}; x.byName = {};
      x.all.forEach(function (i) { x.byKey[i.key] = i; if (!x.byName[i.name.toLowerCase()]) x.byName[i.name.toLowerCase()] = i; });
      /** Finds an item by what's written in a Satchel: "Longsword", or "+1 Longsword" for a magic version. */
      x.find = function (text) {
        var t = String(text || '').trim().toLowerCase(), it = x.byName[t];
        if (it) return it;
        var m = t.match(/^\+([1-3])\s+(.+)$/) || t.match(/^(.+?),?\s+\+([1-3])$/);
        if (!m) return null;
        var n = /^\d$/.test(m[1]) ? +m[1] : +m[2], base = x.byName[/^\d$/.test(m[1]) ? m[2] : m[1]];
        if (!base || !(base.group === 'weapon' || base.group === 'armor')) return null;
        var c2 = Object.assign({}, base); c2.plus = n; c2.name = '+' + n + ' ' + base.name;
        if (base.group === 'armor') c2.defense = base.defense + n;
        return c2;
      };
      return x;
    });
    return itemsP;
  };
  /** The attack bonus for a weapon: half Strength (melee), half Speed (ranged), the better of the two for Finesse. */
  Tome.weaponBonus = function (c, d, w) {
    var str = Tome.half(Tome.stat(c, d.weapons.melee, d)), spd = Tome.half(Tome.stat(c, d.weapons.ranged, d));
    if (w.props && w.props.indexOf('Finesse') >= 0) return Math.max(str, spd);
    return w.ranged ? spd : str;
  };
  Tome.levelName = function (lv) { return lv === 0 ? 'Cantrip' : 'Level ' + lv; };

  Tome.race = function (d, key) { return d.races.filter(function (r) { return r.key === key; })[0] || null; };

  // ---------------------------------------------------------------- rules
  Tome.stat = function (c, key, d) {
    var race = d && Tome.race(d, c.race);
    return ((c.d6 && c.d6[key]) || 0) + ((c.pts && c.pts[key]) || 0) + ((race && race.mods[key]) || 0) + ((c.grow && c.grow[key]) || 0);
  };
  Tome.derive = function (c, d) {
    var r = d.derived, s = function (k) { return Tome.stat(c, k, d); }, lv = Math.max(1, c.level || 1), h = Tome.half;
    return {
      defense: r.defense.base + h(s(r.defense.halfOf)) + (c.worn || []).reduce(function (n, w) { return n + (w.defense || 0); }, 0),
      hp: Math.max(1, r.hp.base + s(r.hp.plusStat) + (lv - 1) * (r.hp.perLevel + h(s(r.hp.perLevelHalfOf))) + lv * ((Tome.cls(d, c.cls) || {}).hpPerLevel || 0)),
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
