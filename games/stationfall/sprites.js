// Stationfall: pixel-art sprites, drawn in code on 16x16 canvases and scaled up 2x with
// smoothing off. Original art for this game.
window.SF = window.SF || {};

(() => {
  const P = {
    k: '#05070d', n: '#0d1322', n2: '#151d33', s1: '#232b42', s2: '#2f3852', s3: '#3d4762', s4: '#566180', s5: '#7a86a6', s6: '#a9b3cc', w: '#e8ecf5',
    y: '#ffe600', y2: '#fff27a', yd: '#a08c00', o: '#ff9b3d', r: '#ff5c5c', rd: '#9b2c2c',
    g: '#8fd14f', gd: '#3f7a2a', g2: '#c4f080', c: '#6fd3ee', cd: '#2b7b93', c2: '#c9f3ff',
    b: '#2a3f7a', b2: '#4a6ad0', br: '#6b4a2a', br2: '#9a6b3a', soil: '#3a2a1c', pu: '#b88cff', sk: '#e9b48a'
  };

  function make(fn, w = 16, h = 16) {
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    const d = {
      r: (a, b, ww, hh, col) => { x.fillStyle = P[col] || col; x.fillRect(a, b, ww, hh); },
      p: (a, b, col) => { x.fillStyle = P[col] || col; x.fillRect(a, b, 1, 1); },
      o: (a, b, ww, hh, col) => { x.fillStyle = P[col] || col; x.fillRect(a, b, ww, 1); x.fillRect(a, b + hh - 1, ww, 1); x.fillRect(a, b, 1, hh); x.fillRect(a + ww - 1, b, 1, hh); },
      c: (cx, cy, rad, col) => { x.fillStyle = P[col] || col; for (let j = -rad; j <= rad; j++) for (let i = -rad; i <= rad; i++) if (i * i + j * j <= rad * rad + rad * 0.8) x.fillRect(cx + i, cy + j, 1, 1); },
      ctx: x
    };
    fn(d);
    return cv;
  }

  const S = {};
  // ---------- terrain ----------
  for (let v = 0; v < 3; v++) {
    S['ground' + v] = make((d) => {
      d.r(0, 0, 16, 16, ['#141a2a', '#171e30', '#1a2134'][v]);
      const spots = [[2, 3], [9, 1], [13, 7], [5, 11], [11, 13], [1, 14], [7, 6]];
      spots.forEach(([a, b], i) => { if ((i + v) % 2 === 0) d.p(a, b, '#232b42'); else d.p(a, b, '#0f1422'); });
      if (v === 1) { d.p(12, 3, 's2'); d.p(3, 8, 's2'); }
    });
  }
  const boulder = (d, base, hi, lo) => {
    d.r(1, 2, 14, 13, 'k');
    d.r(2, 1, 12, 14, lo); d.r(1, 3, 14, 10, lo);
    d.r(2, 2, 11, 9, base); d.r(3, 1, 9, 2, base);
    d.r(3, 2, 6, 2, hi); d.r(2, 4, 2, 3, hi);
    d.p(10, 6, lo); d.p(6, 8, lo); d.p(11, 9, lo);
  };
  S.rock = make((d) => boulder(d, 's4', 's5', 's2'));
  S.ice = make((d) => {
    boulder(d, 'cd', 'c', '#1d5468');
    for (let k = 0; k < 5; k++) { d.p(4 + k, 9 - k, 'c2'); d.p(9 + k, 11 - k, 'c'); }
    d.p(5, 5, 'w'); d.p(11, 4, 'c2');
  });
  S.ore = make((d) => {
    boulder(d, 's3', 's4', 's1');
    for (const [a, b] of [[4, 5], [9, 3], [10, 9], [5, 10]]) { d.p(a, b - 1, 'y2'); d.r(a - 1, b, 3, 1, 'y'); d.p(a, b + 1, 'yd'); }
  });

  // ---------- station ----------
  S.floor = make((d) => {
    d.r(0, 0, 16, 16, '#2b3349'); d.r(1, 1, 14, 14, '#323b55');
    d.r(1, 1, 14, 1, '#3c4664'); d.r(1, 1, 1, 14, '#3c4664');
    d.r(7, 1, 1, 14, '#2b3349'); d.r(1, 7, 14, 1, '#2b3349');
    for (const [a, b] of [[2, 2], [13, 2], [2, 13], [13, 13]]) d.p(a, b, '#4a5577');
  });
  S.wallTop = make((d) => {
    d.r(0, 0, 16, 16, 's5'); d.r(0, 0, 16, 1, 's6'); d.r(0, 15, 16, 1, 's3');
    d.r(2, 2, 12, 12, '#8d98b6'); d.o(2, 2, 12, 12, 's4'); d.p(3, 3, 's6'); d.p(12, 12, 's3');
  });
  S.wallFront = make((d) => {
    d.r(0, 0, 16, 8, 's3'); d.r(0, 0, 16, 1, 's4'); d.r(0, 7, 16, 1, 'k');
    for (let i = 1; i < 16; i += 5) d.r(i, 2, 3, 3, 's2');
    d.r(0, 5, 16, 1, 'y'); d.r(0, 6, 16, 1, 'yd');
  }, 16, 8);
  S.door = make((d) => {
    d.r(0, 0, 16, 16, 's3'); d.o(0, 0, 16, 16, 'k');
    d.r(2, 2, 12, 12, 'n');
    for (let i = 0; i < 6; i++) { d.r(2 + i * 2, 2, 1, 12, i % 2 ? 'y' : 'k'); }
    d.r(7, 2, 2, 12, 's5'); d.p(7, 7, 'r'); d.p(8, 8, 'r');
  });
  S.doorOpen = make((d) => {
    d.r(0, 0, 16, 16, 's3'); d.o(0, 0, 16, 16, 'k'); d.r(3, 1, 10, 14, '#2b3349');
    d.r(1, 2, 2, 12, 'y'); d.r(13, 2, 2, 12, 'y');
  });
  S.airlock = make((d) => {
    d.r(0, 0, 16, 16, 's4'); d.o(0, 0, 16, 16, 'k');
    d.r(2, 2, 12, 12, 'n'); d.r(3, 3, 10, 10, 'cd'); d.r(7, 3, 2, 10, 'c'); d.r(3, 7, 10, 2, 'c');
    d.p(2, 2, 'c2'); d.p(13, 13, 'c2');
  });
  S.airlockOpen = make((d) => {
    d.r(0, 0, 16, 16, 's4'); d.o(0, 0, 16, 16, 'k'); d.r(3, 3, 10, 10, '#2b3349'); d.o(2, 2, 12, 12, 'c');
  });
  S.solar = make((d) => {
    d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 'b');
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) d.r(3 + i * 4, 3 + j * 4, 3, 3, 'b2');
    d.p(3, 3, 'c2'); d.p(7, 3, 'c2');
  });
  S.battery = make((d) => {
    d.r(3, 2, 10, 13, 'k'); d.r(4, 3, 8, 11, 's2'); d.r(6, 1, 4, 2, 's4');
    d.r(5, 4, 6, 9, 'n');
  });
  S.lamp = make((d) => {
    d.r(6, 10, 4, 4, 's3'); d.r(5, 13, 6, 2, 's2');
    d.c(8, 7, 3, 'y'); d.c(8, 7, 1, 'w'); d.r(7, 10, 2, 1, 'yd');
  });
  S.lampOff = make((d) => { d.r(6, 10, 4, 4, 's3'); d.r(5, 13, 6, 2, 's2'); d.c(8, 7, 3, 's4'); });
  S.o2gen = make((d) => {
    d.r(1, 2, 14, 13, 'k'); d.r(2, 3, 12, 11, 's4'); d.r(2, 3, 12, 2, 's5');
    d.c(8, 9, 4, 'n'); d.c(8, 9, 2, 'cd');
    d.r(3, 6, 1, 6, 'c'); d.r(12, 6, 1, 6, 'c');
  });
  S.o2tank = make((d) => {
    d.r(4, 1, 8, 14, 'k'); d.r(5, 2, 6, 12, 'c'); d.r(5, 2, 2, 12, 'c2'); d.r(9, 2, 2, 12, 'cd');
    d.r(6, 0, 4, 2, 's5'); d.r(5, 6, 6, 1, 'w'); d.r(5, 10, 6, 1, 'w');
  });
  S.med = make((d) => {
    d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 'w'); d.r(2, 2, 12, 2, '#ffffff');
    d.r(7, 4, 2, 8, 'r'); d.r(4, 7, 8, 2, 'r');
  });
  S.crate = make((d) => {
    d.r(1, 2, 14, 13, 'k'); d.r(2, 3, 12, 11, 'br'); d.r(2, 3, 12, 2, 'br2');
    d.r(2, 8, 12, 1, 'k'); d.r(4, 5, 1, 8, '#4a3018'); d.r(11, 5, 1, 8, '#4a3018'); d.r(7, 6, 2, 2, 'y');
  });
  S.furnace = make((d) => {
    d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 's3'); d.r(2, 2, 12, 2, 's4');
    d.r(4, 7, 8, 6, 'k'); d.r(5, 8, 6, 4, 'n2'); d.r(6, 4, 4, 2, 's2');
  });
  S.furnaceOn = make((d) => {
    d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 's3'); d.r(2, 2, 12, 2, 's4');
    d.r(4, 7, 8, 6, 'k'); d.r(5, 8, 6, 4, 'o'); d.r(6, 10, 4, 2, 'y'); d.r(6, 4, 4, 2, 's2');
  });
  S.workbench = make((d) => {
    d.r(0, 4, 16, 10, 'k'); d.r(1, 5, 14, 8, 'br2'); d.r(1, 5, 14, 2, '#c08850');
    d.r(1, 13, 2, 3, 's2'); d.r(13, 13, 2, 3, 's2');
    d.r(3, 3, 4, 3, 's5'); d.r(10, 2, 1, 5, 's6'); d.r(9, 2, 3, 1, 's6'); d.p(5, 8, 'y'); d.p(11, 9, 'c');
  });
  S.drill = make((d) => {
    d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 's4'); d.r(2, 2, 12, 1, 's5');
    d.r(3, 3, 2, 2, 'y'); d.r(11, 3, 2, 2, 'y'); d.r(3, 11, 2, 2, 'y'); d.r(11, 11, 2, 2, 'y');
    d.c(8, 8, 3, 'n');
  });
  S.drillBit = make((d) => { d.r(7, 2, 2, 12, 'y'); d.r(2, 7, 12, 2, 'y'); d.c(8, 8, 2, 'yd'); });
  S.turretBase = make((d) => { d.c(8, 8, 7, 'k'); d.c(8, 8, 6, 's3'); d.c(8, 8, 4, 's4'); d.p(4, 4, 's5'); });
  S.turretGun = make((d) => { d.r(6, 5, 9, 6, 'k'); d.r(7, 6, 8, 4, 'y'); d.r(7, 6, 8, 1, 'y2'); d.c(6, 8, 4, 'k'); d.c(6, 8, 3, 's2'); d.p(5, 7, 'r'); }, 16, 16);
  S.bed = make((d) => {
    d.r(2, 0, 12, 16, 'k'); d.r(3, 1, 10, 14, 's2'); d.r(3, 1, 10, 4, 'w'); d.r(3, 6, 10, 9, 'b2'); d.r(3, 6, 10, 1, '#7d93e0');
  });
  S.table = make((d) => { d.r(1, 3, 14, 10, 'k'); d.r(2, 4, 12, 8, 's4'); d.r(2, 4, 12, 2, 's5'); d.p(5, 7, 'c'); d.r(9, 6, 3, 3, 'w'); });
  S.chair = make((d) => { d.r(4, 3, 8, 10, 'k'); d.r(5, 4, 6, 8, 'br2'); d.r(5, 4, 6, 3, '#c08850'); });
  S.comms = make((d) => {
    d.r(1, 5, 14, 10, 'k'); d.r(2, 6, 12, 8, 's3'); d.r(3, 7, 7, 5, 'n'); d.r(4, 8, 5, 1, 'g'); d.r(4, 10, 3, 1, 'g');
    d.r(11, 7, 2, 2, 'r'); d.r(11, 10, 2, 2, 'y'); d.r(10, 1, 1, 5, 's5'); d.c(10, 2, 1, 'c');
  });
  for (let s = 0; s < 4; s++) {
    S['farm' + s] = make((d) => {
      d.r(1, 1, 14, 14, 'k'); d.r(2, 2, 12, 12, 'soil'); d.r(2, 2, 12, 1, '#57402a');
      for (const a of [4, 8, 12]) {
        if (s === 0) { d.p(a, 10, 'gd'); continue; }
        const h = s * 3;
        d.r(a, 12 - h, 1, h, 'gd'); d.p(a - 1, 12 - h + 1, 'g'); d.p(a + 1, 12 - h + 2, 'g');
        if (s === 3) { d.c(a, 4, 1, 'y'); }
      }
    });
  }
  S.pod = make((d) => { d.c(8, 8, 7, 'k'); d.c(8, 8, 6, 's5'); d.c(8, 8, 4, 's3'); d.c(8, 7, 2, 'c'); d.r(2, 12, 12, 2, 'o'); });

  // ---------- people and enemies (drawn facing right, rotated in code) ----------
  const person = (suit, visor) => make((d) => {
    d.c(8, 8, 6, 'k'); d.c(8, 8, 5, suit); d.r(4, 4, 3, 8, 's2');      // pack
    d.c(9, 8, 3, 'k'); d.c(10, 8, 2, visor); d.p(11, 7, 'w');
    d.r(12, 11, 3, 2, 'k');                                              // hand
  });
  S.player = person('y', 'c');
  S.playerSuit = person('w', 'y');
  S.crew = person('#5fa8d3', 'c2');
  S.crewHurt = person('#d36060', 'c2');
  S.drone = make((d) => {
    d.r(1, 6, 14, 4, 'k'); d.r(2, 7, 12, 2, 'rd');
    d.c(8, 8, 5, 'k'); d.c(8, 8, 4, 'r'); d.c(8, 8, 2, 'k'); d.p(9, 8, 'y');
    d.r(1, 3, 3, 2, 's4'); d.r(12, 3, 3, 2, 's4'); d.r(1, 11, 3, 2, 's4'); d.r(12, 11, 3, 2, 's4');
  });
  S.brute = make((d) => {
    d.c(8, 8, 7, 'k'); d.c(8, 8, 6, 'rd'); d.r(3, 3, 10, 10, 'rd'); d.o(3, 3, 10, 10, 'k');
    d.c(8, 8, 3, 'k'); d.r(8, 7, 3, 2, 'y'); d.r(12, 6, 4, 4, 's4');
  });

  // ---------- item icons ----------
  S.i_ore = make((d) => { d.c(8, 9, 5, 'k'); d.c(8, 9, 4, 's4'); d.p(6, 7, 's6'); d.p(10, 10, 'o'); d.p(7, 11, 'o'); });
  S.i_ice = make((d) => { d.r(4, 3, 8, 11, 'k'); d.r(5, 4, 6, 9, 'c'); d.r(5, 4, 2, 9, 'c2'); d.r(9, 4, 2, 9, 'cd'); });
  S.i_crystal = make((d) => { for (let i = 0; i < 6; i++) d.r(8 - i, 2 + i, 1 + i * 2, 1, 'k'); for (let i = 0; i < 5; i++) d.r(8 - i, 8 + i, 1 + (4 - i) * 2 + 1, 1, 'k'); d.r(6, 4, 5, 8, 'y'); d.r(7, 3, 2, 10, 'y'); d.p(7, 5, 'w'); d.r(9, 7, 2, 4, 'yd'); });
  S.i_bar = make((d) => { d.r(2, 6, 12, 6, 'k'); d.r(3, 7, 10, 4, 's5'); d.r(4, 7, 8, 1, 's6'); d.r(3, 10, 10, 1, 's3'); });
  S.i_circuit = make((d) => { d.r(2, 3, 12, 10, 'k'); d.r(3, 4, 10, 8, 'gd'); d.r(5, 6, 3, 3, 'k'); d.r(9, 5, 2, 1, 'y'); d.r(9, 8, 3, 1, 'y'); d.r(4, 10, 6, 1, 'y'); d.p(12, 4, 'y'); });
  S.i_food = make((d) => { d.r(3, 4, 10, 9, 'k'); d.r(4, 5, 8, 7, 'g'); d.r(4, 5, 8, 2, 'g2'); d.r(6, 8, 4, 2, 'w'); });
  S.i_ammo = make((d) => { for (const a of [4, 7, 10]) { d.r(a, 4, 3, 9, 'k'); d.r(a, 7, 2, 5, 'y'); d.r(a, 5, 2, 2, 'o'); } });
  S.i_medkit = make((d) => { d.r(2, 4, 12, 9, 'k'); d.r(3, 5, 10, 7, 'w'); d.r(7, 6, 2, 5, 'r'); d.r(5, 8, 6, 1, 'r'); d.r(6, 3, 4, 2, 's4'); });
  S.i_laser = make((d) => { d.r(2, 7, 9, 4, 'k'); d.r(3, 8, 7, 2, 's5'); d.r(10, 8, 4, 2, 'c'); d.r(4, 10, 2, 3, 's3'); d.p(14, 8, 'c2'); });
  S.i_cutter = make((d) => { d.r(2, 6, 10, 5, 'k'); d.r(3, 7, 8, 3, 'o'); d.r(11, 7, 4, 3, 'pu'); d.r(4, 10, 2, 3, 's3'); d.p(14, 7, 'w'); });
  S.i_pistol = make((d) => { d.r(3, 6, 10, 3, 'k'); d.r(4, 7, 8, 1, 's5'); d.r(4, 9, 3, 4, 'k'); d.r(5, 9, 1, 3, 's3'); });
  S.i_rifle = make((d) => { d.r(1, 6, 14, 3, 'k'); d.r(2, 7, 12, 1, 's5'); d.r(3, 9, 3, 3, 'br'); d.r(8, 9, 2, 3, 'k'); d.p(14, 6, 'y'); });
  S.i_suit = make((d) => { d.c(8, 5, 3, 'k'); d.c(8, 5, 2, 'w'); d.p(9, 5, 'y'); d.r(4, 8, 8, 7, 'k'); d.r(5, 9, 6, 5, 'w'); d.r(7, 9, 2, 5, 'y'); });

  SF.SPR = S;
  SF.PALETTE = P;
  // a data URL per item for the HTML panels
  SF.ICON_URL = {};
  for (const k of Object.keys(S)) if (k.startsWith('i_')) SF.ICON_URL[k.slice(2)] = S[k].toDataURL();
  SF.BUILD_ICON = (type) => {
    const map = { floor: 'floor', wall: 'wallTop', door: 'door', airlock: 'airlock', farm: 'farm3', furnace: 'furnaceOn', turret: 'turretBase' };
    return (S[map[type] || type] || S.crate).toDataURL();
  };
})();
