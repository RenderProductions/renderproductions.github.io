// Rend-Conomy market engine, version 2.
//
// One call to tick() moves the whole market forward by one 5-minute step.
// tick.js does the file reading/writing; sim.js runs thousands of ticks to test the tuning.
//
// How a price moves now (all of this is hidden from players):
//   * Every company has a FAIR VALUE that wanders on its own and gets shoved by news.
//     The price is pulled toward it, but only gently, so prices can overshoot for a long time.
//   * Every company is in a MOOD (regime): calm, normal, rally, slide, choppy, or mania.
//     Moods last a few hours, then a new one is rolled. A rally can end at any moment.
//   * The whole market has a mood too (flat, bull, bear, jitters) that nudges everyone at once.
//   * Volatility CLUSTERS: a big move makes the next moves bigger for a while, then it settles.
//   * Moves have FAT TAILS: most ticks are small, but now and then one is much bigger than usual.
//   * Rare UNEXPLAINED JUMPS: a sudden gap with no news at all.
//   * Every company has a hidden HEALTH score. It tilts goal results and surprise news,
//     so a company on a hot streak tends to keep winning, until it doesn't.
//
// None of that is written to prices.json. It lives in .github/market-state.json,
// which tick.js encrypts when the MARKET_SECRET repository secret exists.

const STORIES = require('./stories');

// ---------- Market hours ----------
const TZ = 'America/Detroit';
const OPEN_HOUR = 3;
const CLOSE_HOUR = 21;
const CLOSED_DAYS = [];          // e.g. [0] closes Sundays (0 = Sunday ... 6 = Saturday)
const AFTER_HOURS_SCALE = 0.25;  // overnight moves are a quarter of the daytime size; no news overnight

const TICK_MIN = 5;
const TICK_MS = TICK_MIN * 60 * 1000;
const TICK_SEC = TICK_MIN * 60;
const POINTS = 288;              // history kept: 24 hours at 5 minutes per tick
const TICKS_PER_DAY = ((CLOSE_HOUR - OPEN_HOUR) * 60) / TICK_MIN; // open ticks in one day (216)
const HOUR = 60 * 60 * 1000;

// ---------- Companies ----------
// dailyVol   typical size of one day's random movement (0.06 = about 6%)
// beta       how strongly the company follows the whole market
// halfLife   days it takes the price to close half the gap to its fair value
// fairVol    how fast the fair value itself wanders per day
// bounds     where the fair value is gently kept (it can leave, it just gets pushed back)
// goalJump   size of a goal result (0.10 = 10%)
// surprise   size of surprise news
// jumpRate   chance per tick of an unexplained jump; jumpSize = its typical size
// sellNews   chance a successful goal turns into a "sell the news" slide anyway
// hype       during a goal, the price builds hype (or doubt) ahead of the deadline
// trendScale how strongly the company's moods push the price (blue chips trend less)
// leak       how much the price "knows" in the last 90 minutes before a goal result
const COMPANIES = [
  { id: 'RRM',  name: 'Render Room',              description: 'The server itself, publicly traded.',  start: 120.00,
    dailyVol: 0.045, beta: 1.0, halfLife: 2.0, fairVol: 0.02, bounds: [60, 240], trendScale: 0.5,
    goalJump: [0.04, 0.10], surprise: [0.025, 0.07], jumpRate: 1 / 1100, jumpSize: 0.04, sellNews: 0.2, leak: 0.03 },
  { id: 'NACH', name: 'De Nacho',                 description: 'Nachos, at scale.',                     start: 45.50,
    dailyVol: 0.075, beta: 0.8, halfLife: 1.5, fairVol: 0.035, bounds: [20, 100], trendScale: 0.8,
    goalJump: [0.06, 0.15], surprise: [0.04, 0.11], jumpRate: 1 / 900, jumpSize: 0.05, sellNews: 0.2, leak: 0.035 },
  { id: 'BLU',  name: "Builder's League United",  description: 'Building things together, allegedly.',  start: 78.25,
    dailyVol: 0.055, beta: 0.9, halfLife: 2.0, fairVol: 0.025, bounds: [35, 170], trendScale: 0.6,
    goalJump: [0.05, 0.12], surprise: [0.03, 0.10], jumpRate: 1 / 1000, jumpSize: 0.045, sellNews: 0.2, leak: 0.03 },
  { id: 'BNW',  name: 'Business Numbers Working', description: 'Numbers. Business. Working, mostly.',   start: 12.80,
    dailyVol: 0.10, beta: 1.2, halfLife: 1.25, fairVol: 0.045, bounds: [5, 30], trendScale: 1.0,
    goalJump: [0.08, 0.18], surprise: [0.05, 0.13], jumpRate: 1 / 800, jumpSize: 0.06, sellNews: 0.25, leak: 0.04 },
  // Bastardly Glory: still the wildest stock on the board, but a game studio, not a lottery ticket.
  // Big daily swings, launches that make or break the week, hype that builds before every goal,
  // and a habit of selling off even after good news. Its fair value is kept roughly between 15 and 200.
  { id: 'BSTG', name: 'Bastardly Glory',          description: 'Games. Glorious ones, occasionally.',    start: 50.00,
    dailyVol: 0.12, beta: 1.4, halfLife: 0.9, fairVol: 0.06, bounds: [15, 200], trendScale: 1.0,
    goalJump: [0.12, 0.30], surprise: [0.07, 0.18], jumpRate: 1 / 450, jumpSize: 0.10, sellNews: 0.4, leak: 0.06,
    hype: 0.10, swingPct: 25, surpriseRate: 1 / 300,
    moods: { calm: 8, normal: 26, rally: 18, slide: 18, choppy: 22, mania: 8 } }
];

// Dividends: daily percentage of the share price. Smaller companies pay more.
const YIELDS = { RRM: 0.005, NACH: 0.015, BLU: 0.01, BNW: 0.025, BSTG: 0.03 };
const DIV_SUSPEND_HOURS = 24;    // a failed goal freezes that company's dividend this long
const DIV_BONUS_DAYS = 1;        // a successful goal drops this many days' worth on the meter
const MAX_ACCRUE_MIN = 15;       // a late or missed tick adds at most this many minutes

// ---------- Moods (regimes) ----------
// w = how often it's picked, vol = volatility multiplier, trend = drift per day (range), hours = how long it lasts
const MOODS = {
  calm:   { w: 20, vol: 0.6, trend: [0, 0],         hours: [4, 14] },
  normal: { w: 30, vol: 1.0, trend: [0, 0],         hours: [6, 20] },
  rally:  { w: 15, vol: 1.0, trend: [0.02, 0.08],   hours: [3, 12] },
  slide:  { w: 15, vol: 1.1, trend: [-0.08, -0.02], hours: [3, 12] },
  choppy: { w: 14, vol: 1.7, trend: [0, 0],         hours: [2, 8] },
  mania:  { w: 6,  vol: 2.0, trend: [0.10, 0.25],   hours: [1, 4], randomSign: true }
};
const MARKET_MOODS = {
  flat:    { w: 40, vol: 1.0, trend: [0, 0],          hours: [8, 30] },
  bull:    { w: 20, vol: 0.9, trend: [0.01, 0.04],    hours: [8, 30] },
  bear:    { w: 20, vol: 1.2, trend: [-0.04, -0.01],  hours: [8, 30] },
  jitters: { w: 20, vol: 1.8, trend: [0, 0],          hours: [4, 16] }
};
const MARKET_DAILY_VOL = 0.02;

// ---------- Events ----------
const GOAL_HOURS = [8, 20];      // how long a company has to reach a goal
const COOLDOWN_HOURS = [4, 12];   // quiet time before the next goal is announced
const DECIDE_MIN = 90;           // the result is settled this long before the deadline (and starts leaking)
const LEAK_TRUTH = 0.65;         // chance the pre-deadline drift points the right way (otherwise a fake-out)
const SURPRISE_RATE = 1 / 430;   // per company per open tick (about one surprise every two days)
const RUMOR_RATE = 1 / 650;      // per company per open tick
const RUMOR_TRUE = 0.6;          // chance a rumor turns out to be true
const RUMOR_HOURS = [2, 10];     // how long until a rumor is confirmed or denied
const MARKET_EVENT_RATE = 1 / 1400; // per open tick, for the whole market
const CROSSOVER_RATE = 1 / 1800;    // per open tick, for the whole market
const MAX_NEWS = 12;
const COMPANY_NEWS = 12;

// ---------- Discord feed ----------
const SWING_PCT = 8;             // a move this big (in %) over the last hour counts as a swing
const SWING_TICKS = 12;
const SWING_COOLDOWN_HOURS = 3;

// =====================================================================

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const unix = (ms) => Math.floor(ms / 1000);

function makeRandom(rand) {
  const R = rand || Math.random;
  const between = (lo, hi) => lo + R() * (hi - lo);
  const chance = (p) => R() < p;
  const pick = (list) => list[Math.floor(R() * list.length)];
  function normal() {
    let u = 0;
    while (u === 0) u = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
  }
  // Student-t with 4 degrees of freedom, scaled to the same spread as a normal:
  // mostly small moves, with the occasional much bigger one.
  function fat() {
    let chi = 0;
    for (let i = 0; i < 4; i++) { const z = normal(); chi += z * z; }
    return clamp((normal() / Math.sqrt(chi / 4)) * Math.SQRT1_2, -8, 8);
  }
  function weighted(table, override) {
    const keys = Object.keys(table);
    const w = keys.map((k) => (override && override[k] != null ? override[k] : table[k].w));
    let x = R() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < keys.length; i++) { x -= w[i]; if (x <= 0) return keys[i]; }
    return keys[keys.length - 1];
  }
  return { R, between, chance, pick, normal, fat, weighted };
}

// ---------- Time ----------
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const tzParts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' });
function statusAt(ms) {
  const p = {};
  tzParts.formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
  if (CLOSED_DAYS.includes(WEEKDAYS[p.weekday])) return 'closed';
  const hour = Number(p.hour);
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR ? 'open' : 'after-hours';
}
function nextTime(now, test) {
  for (let t = now + TICK_MS; t < now + 8 * 24 * HOUR; t += TICK_MS) {
    if (test(statusAt(t))) return t - (t % TICK_MS);
  }
  return null;
}

// =====================================================================

function tick({ old = {}, state = null, now = Date.now(), rand } = {}) {
  const rnd = makeRandom(rand);
  const { R, between, chance, pick, normal, fat, weighted } = rnd;
  const nowIso = new Date(now).toISOString();

  const status = statusAt(now);
  const open = status === 'open';
  const scale = open ? 1 : status === 'after-hours' ? AFTER_HOURS_SCALE : 0;

  // On a closed day, write once (to flip the status to closed), then leave everything alone.
  if (status === 'closed' && old.market && old.market.status === 'closed') return { skip: true };

  const existing = {};
  (old.companies || []).forEach((c) => { existing[c.id] = c; });

  // ---------- Hidden state ----------
  state = state && state.v === 2 ? state : { v: 2, market: null, co: {} };
  const rollMood = (table, override) => {
    const name = weighted(table, override);
    const m = table[name];
    let trend = between(m.trend[0], m.trend[1]);
    if (m.randomSign && chance(0.5)) trend = -trend;
    return { name, vol: m.vol, trend, until: now + between(m.hours[0], m.hours[1]) * HOUR };
  };
  if (!state.market) state.market = { mood: rollMood(MARKET_MOODS) };
  if (now >= state.market.mood.until) state.market.mood = rollMood(MARKET_MOODS);
  const mkt = state.market.mood;
  const marketMove = scale * (mkt.trend / TICKS_PER_DAY + (MARKET_DAILY_VOL / Math.sqrt(TICKS_PER_DAY)) * mkt.vol * fat());

  // ---------- Market status ----------
  const sinceLastTick = old.updated ? now - Date.parse(old.updated) : 0;
  const nextChange = nextTime(now, (st) => st !== status);
  const nextOpen = open ? null : nextTime(now, (st) => st === 'open');
  const ts = (ms) => '<t:' + Math.floor(ms / 1000) + ':R>';
  const market = {
    status,
    open,
    nextChange: nextChange ? new Date(nextChange).toISOString() : null,
    nextOpen: nextOpen ? new Date(nextOpen).toISOString() : null,
    text: open
      ? '🟢 **Market open** · closes ' + ts(nextChange)
      : status === 'after-hours'
        ? '🌙 **After hours** · prices drift, trading opens ' + ts(nextOpen)
        : '⛔ **Market closed today** · opens ' + ts(nextOpen)
  };

  let news = Array.isArray(old.news) ? old.news.slice() : [];
  const posts = [];
  const oldStatus = old.market && old.market.status;
  if (oldStatus && oldStatus !== status) posts.push({ kind: 'market', status, nextChange: market.nextChange, nextOpen: market.nextOpen });

  function addNews(item) {
    const full = Object.assign({ time: nowIso }, item);
    full.discord = discordLine(full);
    news.unshift(full);
    const { discord, ...plain } = full;
    return plain;
  }

  // ---------- Per company: the normal price move ----------
  const live = COMPANIES.map((c) => {
    const prev = existing[c.id] || {};
    let history = Array.isArray(prev.history) && prev.history.length ? prev.history.slice() : null;
    let times = Array.isArray(prev.times) ? prev.times.slice() : [];
    const newsLog = Array.isArray(prev.newsLog) ? prev.newsLog.slice() : [];
    const bounds = c.bounds.map(Math.log);

    // Hidden state, created the first time this company is seen by the new engine.
    let s = state.co[c.id];
    const current = history ? history[history.length - 1] : c.start;
    if (!s) {
      s = state.co[c.id] = {
        lnFair: Math.log(clamp(current, c.bounds[0], c.bounds[1])),
        trend: 0, g: 1, health: 0,
        mood: rollMood(MOODS, c.moods),
        rumor: null, secret: null, hype: 0
      };
      // A company far above where the new engine thinks it belongs gets a heads-up in the news,
      // so the slide back down that follows doesn't come out of nowhere.
      const warning = c.id === 'BSTG'
        ? "Bastardly Glory's new board promises \"fewer surprises.\" Analysts expect the stock to come back down to Earth."
        : c.name + ' looks badly overpriced, analysts warn.';
      if (history && current > c.bounds[1] * 1.2 && !newsLog.some((n) => n.headline === warning)) {
        newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'bad', headline: warning }));
      }
    }

    const v = c.dailyVol / Math.sqrt(TICKS_PER_DAY);
    const kappa = Math.LN2 / (c.halfLife * TICKS_PER_DAY);

    function stepPrice(price, sc) {
      if (now >= s.mood.until) s.mood = rollMood(MOODS, c.moods);
      const z = fat();
      const lp = Math.log(price);
      s.trend += (s.mood.trend * (c.trendScale || 1) - s.trend) * 0.05;
      let r = c.beta * marketMove;
      r += sc * (s.trend / TICKS_PER_DAY + v * s.mood.vol * s.g * z);
      r += sc * kappa * (s.lnFair - lp);
      if (price < 3) r += 0.02 * (Math.log(3) - lp);   // keep penny prices off the floor
      r += sc * s.hype / TICKS_PER_DAY;
      if (s.secret && s.secret.leakDir) r += sc * s.secret.leakDir * (c.leak / (DECIDE_MIN / TICK_MIN));
      // Volatility clustering: big surprises raise volatility, calm ticks let it settle back toward 1.
      s.g = clamp(1 + 0.98 * (s.g - 1) + 0.05 * (Math.abs(z) - 0.8), 0.5, 3.5);
      // The fair value wanders, and is gently kept inside its bounds.
      s.lnFair += sc * (c.fairVol / Math.sqrt(TICKS_PER_DAY)) * normal();
      if (s.lnFair > bounds[1]) s.lnFair -= sc * 0.01 * (s.lnFair - bounds[1]);
      if (s.lnFair < bounds[0]) s.lnFair += sc * 0.01 * (bounds[0] - s.lnFair);
      // Health drifts slowly back toward neutral.
      s.health = clamp(s.health * (1 - 0.003 * sc) + 0.035 * Math.sqrt(sc) * normal(), -1, 1);
      return Math.max(1, round2(price * Math.exp(r)));
    }

    if (!history) {
      // Brand new company: build a believable past so the chart isn't empty.
      history = [c.start];
      while (history.length < POINTS) history.push(stepPrice(history[history.length - 1], 1));
      times = [];
    }

    // Older files may lack times: count back 5 minutes per point from the last update.
    if (times.length < history.length) {
      const anchor = times.length ? times[0] : unix(Date.parse(old.updated) || now);
      const missing = history.length - times.length;
      const offset = times.length ? 1 : 0;
      const before = [];
      for (let i = missing; i >= 1; i--) before.push(anchor - (i - 1 + offset) * TICK_SEC);
      times = before.concat(times);
    }
    times = times.slice(-history.length);

    if (scale > 0) {
      history.push(stepPrice(history[history.length - 1], scale));
      times.push(unix(now));
    }

    return {
      c, s, prev, history, times, newsLog,
      goal: prev.goal && prev.goal.text ? { index: prev.goal.index, text: prev.goal.text, deadline: prev.goal.deadline } : null,
      lastGoal: Number.isInteger(prev.lastGoal) ? prev.lastGoal : -1,
      nextGoalAt: prev.nextGoalAt || new Date(now + between(0, 2) * HOUR).toISOString(),
      divIndex: typeof prev.divIndex === 'number' ? prev.divIndex : 0,
      divSuspendedUntil: prev.divSuspendedUntil && now < Date.parse(prev.divSuspendedUntil) ? prev.divSuspendedUntil : null,
      swingAt: prev.swingAt || null
    };
  });
  const byId = {};
  live.forEach((x) => { byId[x.c.id] = x; });

  // Moves the latest price by pct (0.1 = +10%) and lets the news reach the hidden state.
  // fair = how much of the move is "real" (shifts fair value), vol = volatility kick, health = health change.
  function shove(x, pct, { fair = 0.6, vol = 0.4, health = 0 } = {}) {
    const h = x.history;
    const before = h[h.length - 1];
    const after = Math.max(1, round2(before * (1 + pct)));
    h[h.length - 1] = after;
    x.s.lnFair += fair * Math.log(after / before);
    x.s.g = clamp(x.s.g + vol, 0.5, 3.5);
    x.s.health = clamp(x.s.health + health, -1, 1);
    return round2((after / before - 1) * 100);
  }
  function setMood(x, name) {
    const m = MOODS[name];
    x.s.mood = { name, vol: m.vol, trend: between(m.trend[0], m.trend[1]), until: now + between(m.hours[0], m.hours[1]) * HOUR };
  }

  // ---------- Events (only while the market is open) ----------
  if (open) {
    live.forEach((x) => {
      const { c, s } = x;
      const h = x.history;

      // Unexplained jump: the price gaps with no news. Shows up as a "big move" alert at most.
      if (chance(c.jumpRate)) {
        const size = clamp(c.jumpSize * Math.exp(0.5 * normal()), c.jumpSize * 0.4, c.jumpSize * 3);
        shove(x, chance(0.5) ? size : -size / (1 + size), { fair: 0.3, vol: 0.5 });
      }

      // ----- Goals -----
      const pool = STORIES.GOALS[c.id] || [];
      if (x.goal && !pool[x.goal.index]) { x.goal = null; s.secret = null; s.hype = 0; }

      if (x.goal) {
        const deadline = Date.parse(x.goal.deadline);
        // Settle the result a little before the deadline. From then on the price may drift
        // toward the answer (usually the right way, sometimes a fake-out).
        if (!s.secret || !s.secret.outcome) {
          if (now >= deadline - DECIDE_MIN * 60 * 1000) {
            const u = R() + 0.22 * s.health;
            const outcome = u >= 0.55 ? 'success' : u >= 0.42 ? 'mixed' : 'fail';
            const truthful = chance(LEAK_TRUTH);
            const dir = outcome === 'success' ? 1 : outcome === 'fail' ? -1 : 0;
            s.secret = { outcome, big: chance(0.25), leakDir: truthful ? dir : -dir || (chance(0.5) ? 1 : -1) * 0.5 };
          }
        }
        if (now >= deadline && s.secret && s.secret.outcome) {
          const tpl = pool[x.goal.index];
          const { outcome, big } = s.secret;
          const mult = big ? 1.4 : 1;
          let move, dividend = null, headline;
          if (outcome === 'success') {
            move = shove(x, between(c.goalJump[0], c.goalJump[1]) * mult, { fair: 0.6, vol: 0.5, health: 0.25 });
            headline = tpl.win;
            x.divIndex += h[h.length - 1] * (YIELDS[c.id] || 0) * DIV_BONUS_DAYS;
            dividend = 'bonus';
            if (chance(c.sellNews)) setMood(x, 'slide');            // "buy the rumor, sell the news"
            else if (chance(0.5)) setMood(x, 'rally');
          } else if (outcome === 'fail') {
            const drop = between(c.goalJump[0], c.goalJump[1]) * mult;
            move = shove(x, -drop / (1 + drop), { fair: 0.6, vol: 0.6, health: -0.25 });
            headline = tpl.lose;
            x.divSuspendedUntil = new Date(now + DIV_SUSPEND_HOURS * HOUR).toISOString();
            dividend = 'suspended';
            setMood(x, big ? 'slide' : chance(0.5) ? 'choppy' : 'normal');
          } else {
            move = shove(x, between(-0.04, 0.04), { fair: 0.4, vol: 0.3 });
            headline = tpl.mixed || (c.name + ' sort of delivers. Investors shrug.');
            setMood(x, 'choppy');
          }
          x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: outcome, headline, move, dividend, big: big && outcome !== 'mixed' || undefined }));
          x.lastGoal = x.goal.index;
          x.goal = null;
          s.secret = null;
          s.hype = 0;
          x.nextGoalAt = new Date(now + between(COOLDOWN_HOURS[0], COOLDOWN_HOURS[1]) * HOUR).toISOString();
        }
      } else if (pool.length && now >= Date.parse(x.nextGoalAt)) {
        let index = Math.floor(R() * pool.length);
        if (pool.length > 1 && index === x.lastGoal) index = (index + 1 + Math.floor(R() * (pool.length - 1))) % pool.length;
        const deadline = new Date(now + between(GOAL_HOURS[0], GOAL_HOURS[1]) * HOUR).toISOString();
        x.goal = { index, text: pool[index].goal, deadline };
        s.secret = null;
        // Hype companies build excitement (or doubt) while the goal runs.
        s.hype = c.hype ? (chance(0.65) ? 1 : -1) * c.hype * between(0.5, 1.5) : 0;
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'goal', headline: pool[index].goal, deadline }));
      }

      // ----- Surprise news -----
      if (chance(c.surpriseRate || SURPRISE_RATE)) {
        const good = chance(clamp(0.5 + 0.2 * s.health, 0.2, 0.8));
        const major = chance(0.15);
        const size = between(c.surprise[0], c.surprise[1]) * (major ? 2 : 1);
        const move = shove(x, good ? size : -size / (1 + size), { fair: 0.7, vol: 0.4, health: good ? 0.15 : -0.15 });
        if (major) setMood(x, good ? 'rally' : 'slide');
        const headline = pick((good ? STORIES.GOOD : STORIES.BAD)[c.id] || [c.name + (good ? ' has a great day.' : ' has a rough day.')]);
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: good ? 'good' : 'bad', headline, move, big: major || undefined }));
      }

      // ----- Rumors -----
      const rumors = STORIES.RUMORS[c.id];
      if (s.rumor && now >= s.rumor.resolveAt) {
        const r = s.rumor;
        let move, type;
        if (r.isTrue) {
          move = shove(x, r.dir * between(c.surprise[0], c.surprise[1]) * 0.8 / (r.dir < 0 ? 1.1 : 1), { fair: 0.6, vol: 0.3, health: r.dir * 0.1 });
          type = 'confirmed';
        } else {
          move = shove(x, -r.dir * between(0.02, 0.06), { fair: 0.2, vol: 0.2 });
          type = 'denied';
        }
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type, headline: r.isTrue ? r.confirm : r.deny, move }));
        s.rumor = null;
      } else if (!s.rumor && rumors && chance(RUMOR_RATE)) {
        const dir = chance(clamp(0.5 + 0.15 * s.health, 0.25, 0.75)) ? 1 : -1;
        const t = pick(dir > 0 ? rumors.up : rumors.down);
        s.rumor = { dir, isTrue: chance(RUMOR_TRUE), confirm: t[1], deny: t[2], resolveAt: now + between(RUMOR_HOURS[0], RUMOR_HOURS[1]) * HOUR };
        const move = shove(x, dir * between(0.01, 0.035), { fair: 0, vol: 0.2 });
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'rumor', headline: t[0], move }));
      }
    });

    // ----- Market-wide news -----
    if (chance(MARKET_EVENT_RATE)) {
      const ev = pick(STORIES.MARKET);
      const moves = {};
      live.forEach((x) => {
        const size = between(0.02, 0.07) * x.c.beta * between(0.6, 1.4);
        moves[x.c.id] = shove(x, ev.dir > 0 ? size : -size / (1 + size), { fair: 0.5, vol: 0.4 });
        x.newsLog.unshift({ time: nowIso, id: x.c.id, name: x.c.name, type: 'market', headline: ev.headline, move: moves[x.c.id] });
      });
      if (ev.dir > 0 && chance(0.5)) state.market.mood = Object.assign(rollMood({ bull: MARKET_MOODS.bull }), {});
      if (ev.dir < 0 && chance(0.5)) state.market.mood = rollMood({ bear: MARKET_MOODS.bear, jitters: MARKET_MOODS.jitters });
      addNews({ id: 'MARKET', name: 'Whole market', type: 'market', headline: ev.headline, moves });
    }

    // ----- Two companies in one story -----
    if (chance(CROSSOVER_RATE)) {
      const ev = pick(STORIES.CROSSOVER);
      const a = byId[ev.a], b = byId[ev.b];
      if (a && b) {
        const moves = {};
        [[a, ev.moveA], [b, ev.moveB]].forEach(([x, dir]) => {
          const size = between(0.03, 0.09);
          moves[x.c.id] = shove(x, dir > 0 ? size : -size / (1 + size), { fair: 0.6, vol: 0.3, health: dir * 0.08 });
          x.newsLog.unshift({ time: nowIso, id: x.c.id, name: x.c.name, type: 'crossover', headline: ev.headline, move: moves[x.c.id] });
        });
        addNews({ id: ev.a + '/' + ev.b, name: a.c.name + ' & ' + b.c.name, type: 'crossover', headline: ev.headline, moves });
      }
    }
  }

  // ---------- Dividends, swing alerts, output ----------
  const OPEN_MS_PER_DAY = (CLOSE_HOUR - OPEN_HOUR) * HOUR;
  const companies = live.map((x) => {
    const { c } = x;
    const yieldPerDay = YIELDS[c.id] || 0;
    const price = x.history[x.history.length - 1];

    if (open && !x.divSuspendedUntil && sinceLastTick > 0) {
      const ms = Math.min(sinceLastTick, MAX_ACCRUE_MIN * 60 * 1000);
      x.divIndex += price * yieldPerDay * (ms / OPEN_MS_PER_DAY);
    }
    x.divIndex = Math.round(x.divIndex * 10000) / 10000;

    if (open && x.history.length > SWING_TICKS) {
      const hourAgo = x.history[x.history.length - 1 - SWING_TICKS];
      const swing = round2((price / hourAgo - 1) * 100);
      const recentNews = x.newsLog.some((n) => typeof n.move === 'number' && now - Date.parse(n.time) < SWING_TICKS * TICK_MS);
      const cooled = !x.swingAt || now - Date.parse(x.swingAt) >= SWING_COOLDOWN_HOURS * HOUR;
      if (Math.abs(swing) >= (c.swingPct || SWING_PCT) && !recentNews && cooled) {
        x.swingAt = nowIso;
        posts.push({ kind: 'swing', id: c.id, name: c.name, move: swing, price });
      }
    }

    const history = x.history.slice(-POINTS);
    const times = x.times.slice(-POINTS);
    return {
      id: c.id,
      name: c.name,
      description: c.description,
      price,
      change: round2((price / history[0] - 1) * 100),
      history,
      times,
      goal: x.goal,
      lastGoal: x.lastGoal,
      nextGoalAt: x.nextGoalAt,
      swingAt: x.swingAt,
      yield: yieldPerDay,
      divIndex: x.divIndex,
      divSuspendedUntil: x.divSuspendedUntil,
      newsLog: x.newsLog.slice(0, COMPANY_NEWS)
    };
  });

  news = news.slice(0, MAX_NEWS);
  const data = buildOutput({ nowIso, market, news, companies });

  // News made this tick goes to Discord too (oldest first, so it reads in order).
  news.filter((n) => n.time === nowIso).reverse().forEach((n) => {
    posts.push({ kind: 'news', id: n.id, type: n.type, discord: n.discord, price: data.prices[n.id] != null ? data.prices[n.id] : null });
  });

  return { data, state, posts };
}

// =====================================================================
// Discord lines and the ready-made tables the bot reads.

const KINDS = {
  goal:      '📢 **NEW GOAL**',
  success:   '🟢 **SUCCESS**',
  fail:      '🔴 **FAILED**',
  mixed:     '🟡 **MIXED RESULT**',
  good:      '📈 **BREAKING**',
  bad:       '📉 **BREAKING**',
  rumor:     '👂 **RUMOR**',
  confirmed: '✅ **CONFIRMED**',
  denied:    '❌ **DENIED**',
  market:    '🌐 **MARKET-WIDE**',
  crossover: '🤝 **CROSSOVER**'
};

function pctText(m) { return (m >= 0 ? '▲ +' : '▼ ') + m.toFixed(2) + '%'; }

function discordLine(item) {
  const tag = KINDS[item.type] || '📢 **NEWS**';
  let extra;
  if (item.moves) {
    extra = Object.keys(item.moves).map((k) => k + ' ' + pctText(item.moves[k])).join(' · ');
  } else if (typeof item.move === 'number') {
    extra = pctText(item.move) + (item.type === 'rumor' ? ' on the whispers' : ' on the news');
  } else if (item.deadline) {
    extra = 'Deadline <t:' + unix(Date.parse(item.deadline)) + ':R>';
  }
  const div = item.dividend === 'suspended' ? '\n💸 Dividend suspended for ' + DIV_SUSPEND_HOURS + ' hours'
    : item.dividend === 'bonus' ? '\n🎉 Bonus dividend paid to shareholders' : '';
  return tag + (item.big ? ' 🔥' : '') + ' · `' + item.id + '` · <t:' + unix(Date.parse(item.time)) + ':R>\n' +
    item.headline + (extra ? '\n*' + extra + '*' : '') + div;
}

const CHART_POINTS = 48;
const SPARK = '▁▂▃▄▅▆▇█';
const MAX_URL = 2000;
const LABELS_SHOWN = 6;
const labelFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: 'numeric', minute: '2-digit' });
const tzName = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'short' });

function thin(h, n) {
  if (h.length <= n) return h.slice();
  const out = [];
  for (let i = 0; i < n; i++) out.push(h[Math.round(i * (h.length - 1) / (n - 1))]);
  return out;
}
function timeLabel(sec, lastDay) {
  const p = {};
  labelFmt.formatToParts(new Date(sec * 1000)).forEach((x) => { p[x.type] = x.value; });
  const clock = p.hour + (p.minute === '00' ? '' : ':' + p.minute) + ' ' + p.dayPeriod;
  return p.weekday === lastDay ? clock : p.weekday + ' ' + clock;
}
function zoneLabel(sec) {
  const z = tzName.formatToParts(new Date(sec * 1000)).find((x) => x.type === 'timeZoneName');
  return z ? z.value : 'ET';
}
function sparkline(h) {
  const pts = thin(h, 24);
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1;
  return pts.map((v) => SPARK[Math.round(((v - min) / range) * (SPARK.length - 1))]).join('');
}
function buildChartUrl(c, n) {
  const pts = thin(c.history, n);
  const tms = thin(c.times, n);
  const every = Math.ceil((tms.length - 1) / LABELS_SHOWN);
  const up = c.change >= 0;
  const last = tms[tms.length - 1];
  const hours = Math.max(1, Math.round((last - tms[0]) / 3600));
  const lastDay = labelFmt.formatToParts(new Date(last * 1000)).find((x) => x.type === 'weekday').value;
  const config = {
    type: 'line',
    data: {
      labels: tms.map((t, i) => (i % every === 0 || i === tms.length - 1 ? timeLabel(t, lastDay) : '')),
      datasets: [{ data: pts, borderColor: up ? '#ffe600' : '#ff6b6b', backgroundColor: up ? 'rgba(255,230,0,0.12)' : 'rgba(255,107,107,0.12)', fill: true, pointRadius: 0, borderWidth: 2, lineTension: 0 }]
    },
    options: {
      legend: { display: false },
      title: { display: true, text: c.id + ' · last ' + hours + 'h · times in ' + zoneLabel(last), fontColor: '#ffe600', fontSize: 16 },
      scales: {
        xAxes: [{ ticks: { fontColor: '#8a93ab', autoSkip: false, maxRotation: 0 }, gridLines: { display: false } }],
        yAxes: [{ ticks: { fontColor: '#8a93ab' }, gridLines: { color: 'rgba(255,230,0,0.12)' } }]
      }
    }
  };
  return 'https://quickchart.io/chart?w=600&h=300&bkg=%23050810&c=' + encodeURIComponent(JSON.stringify(config));
}
function chartUrl(c) {
  for (let n = CHART_POINTS; n >= 12; n -= 6) {
    const url = buildChartUrl(c, n);
    if (url.length <= MAX_URL) return url;
  }
  return buildChartUrl(c, 12);
}

function buildOutput({ nowIso, market, news, companies }) {
  const prices = {}, changes = {}, dividends = {}, divDaily = {}, divText = {}, names = {}, sparks = {}, charts = {};
  companies.forEach((c) => {
    prices[c.id] = c.price;
    changes[c.id] = c.change;
    dividends[c.id] = c.divIndex;
    divDaily[c.id] = Math.round(c.price * c.yield * 10000) / 10000;
    divText[c.id] = !c.yield
      ? '🚫 No dividend'
      : c.divSuspendedUntil
        ? '💸 Suspended, resumes <t:' + unix(Date.parse(c.divSuspendedUntil)) + ':R>'
        : (c.yield * 100).toFixed(1).replace(/\.0$/, '') + '% daily · $' + divDaily[c.id].toFixed(2) + ' per share';
    names[c.id] = c.name;
    sparks[c.id] = sparkline(c.history);
    charts[c.id] = chartUrl(c);
  });
  const withLines = news.map((n) => (n.discord ? n : Object.assign({}, n, { discord: discordLine(n) })));
  const headline = withLines[0] ? withLines[0].headline : '';
  const newsText = withLines.length
    ? withLines.slice(0, 5).map((n) => n.discord).join('\n\n')
    : 'No market news yet. Check back soon.';
  const headlineText = withLines[0] ? withLines[0].discord : 'No market news yet.';
  return { updated: nowIso, engine: 2, market, prices, changes, dividends, divDaily, divText, names, sparks, charts, headline, headlineText, newsText, news: withLines, companies };
}

module.exports = { tick, COMPANIES, TICK_MS, statusAt };
