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

// ---------- The Crash ----------
// Crashes are switched on and off from GitHub: Actions tab > "Crash the market" > Run workflow.
// That workflow writes .github/market-crash.json, which is read here. You can also edit that file by hand.
//   tremor    nervous build-up: jitters, everything starts slipping
//   crash     everything falls, hard. Panic legs, fake bounces, circuit breakers, failed goals
//   recovery  the selling stops; prices that survived slowly find a floor again
// depth: how far each company gets dragged over the crash, in log terms (2.3 = to about a tenth,
// 3 = to about a twentieth), times the severity. Each company secretly rolls a share of it (spread),
// so nobody knows ahead of time who survives and who goes bankrupt.
const SEVERITY = { mild: 0.55, normal: 1, brutal: 1.4 };
const CRASH_DEFAULTS = {
  start: null,
  tremorHours: 2, crashHours: 48, recoveryHours: 72, severity: 'normal',
  depth: { RRM: 3.7, NACH: 3.5, BLU: 3.7, BNW: 2.9, BSTG: 5.5 },
  spread: [0.7, 1.35]
};
const CRASH = (() => {
  let file = {};
  try { file = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'market-crash.json'), 'utf8')) || {}; } catch (e) { /* no crash file: no crash */ }
  const c = Object.assign({}, CRASH_DEFAULTS, file);
  const k = SEVERITY[c.severity] || 1;
  c.depth = {};
  Object.keys(CRASH_DEFAULTS.depth).forEach((id) => { c.depth[id] = CRASH_DEFAULTS.depth[id] * k; });
  return c;
})();
const CRASH_MOODS = { calm: 0, normal: 0, rally: 0, slide: 4, choppy: 3, mania: 0, freefall: 10, bounce: 3 };
const PANIC_RATE = 1 / 200;         // per company per open crash tick: a sudden panic leg down
const CRASH_NEWS_HOURS = [2, 5];    // time between crash headlines
const HALT_DROP = -12;              // the average stock falls this much (%) in an hour: circuit breaker
const HALT_MIN = 15;                // trading halts this long; prices freeze
const HALT_COOLDOWN_HOURS = 4;

// ---------- Bankruptcy ----------
// Below LINEAR_BELOW a price moves in Polygons instead of percent, so it can reach zero and keep going.
// Under 0 the company is BANKRUPT: no goals, no dividends, no rumors. It gets out one of two ways:
//   * a TODD bailout: it files an appeal, TODD rules on it a little later (odds rise with every appeal)
//   * swimming: its price climbs back above SWIM_PRICE and stays there for SWIM_TICKS open ticks
const LINEAR_BELOW = 3;
const BRINK = 1.5;                  // an "on the brink" warning below this
const SWIM_PRICE = 1;
const SWIM_TICKS = 12;              // one hour
const PIT = [-4, -0.5];             // where a bankrupt price tends to sit at first
const PIT_CLIMB = 0.5;              // Polygons a day the pit rises on its own (the company earning money); not during the crash
const APPEAL_FIRST_HOURS = [1, 3];
const APPEAL_HOURS = [3, 6];        // time between appeals after a denial
const VERDICT_HOURS = [1, 2];       // TODD takes this long to decide
const BAILOUT_ODDS = { base: 0.2, perAppeal: 0.12, health: 0.15, crash: 0.45, max: 0.85 };
const BAILOUT_PRICE = [0.06, 0.12]; // a bailout restarts the price at this share of the start price (at least 2.50)
const BAILOUT_DIV_HOURS = 24;       // TODD keeps the dividend this long after a bailout
const HOPE_RATE = 1 / 90;           // per bankrupt company per open tick: a fundraiser or another disaster

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
// Each company pays its yield times a RATE the board sets: 0% (suspended), 25%, 50%, 75%, 100%, 125%,
// or 150% as a short boost. Every few hours the board reviews it and moves one step toward what the
// company's hidden health says it can afford. Failed goals cut it on the spot; wins bring it back.
const DIV_STEPS = [0, 0.25, 0.5, 0.75, 1, 1.25];
const DIV_BOOST = 1.5;
const DIV_BOOST_HOURS = [4, 8];   // a big success boosts the rate this long
const DIV_REVIEW_HOURS = [8, 16]; // time between board reviews
const DIV_BONUS_DAYS = 1;        // a successful goal drops this many days' worth on the meter
const SPECIAL_DIV_CHANCE = 0.3;  // good news also pays a special dividend this often (twice as often for major news)
const SPECIAL_DIV_DAYS = [1, 3];
// What the board thinks the company can afford, from its hidden health (-1 to 1).
function divTarget(health) {
  if (health >= 0.45) return 1.25;
  if (health >= -0.15) return 1;
  if (health >= -0.45) return 0.75;
  if (health >= -0.7) return 0.5;
  if (health >= -0.85) return 0.25;
  return 0;
}
function divStep(rate, n) {           // n steps up (+) or down (-) the normal ladder
  let i = DIV_STEPS.indexOf(rate);
  if (i < 0) i = DIV_STEPS.length - 1;  // a boosted rate counts as the top step
  return DIV_STEPS[Math.max(0, Math.min(DIV_STEPS.length - 1, i + n))];
}
function divStatus(rate) {
  return rate === 0 ? 'suspended' : rate < 1 ? 'cut' : rate > 1.25 ? 'boosted' : rate > 1 ? 'raised' : 'full';
}
const ratePct = (r) => Math.round(r * 100) + '%';
const MAX_ACCRUE_MIN = 15;       // a late or missed tick adds at most this many minutes

// ---------- Moods (regimes) ----------
// w = how often it's picked, vol = volatility multiplier, trend = drift per day (range), hours = how long it lasts
const MOODS = {
  calm:   { w: 20, vol: 0.6, trend: [0, 0],         hours: [4, 14] },
  normal: { w: 30, vol: 1.0, trend: [0, 0],         hours: [6, 20] },
  rally:  { w: 15, vol: 1.0, trend: [0.02, 0.08],   hours: [3, 12] },
  slide:  { w: 15, vol: 1.1, trend: [-0.08, -0.02], hours: [3, 12] },
  choppy: { w: 14, vol: 1.7, trend: [0, 0],         hours: [2, 8] },
  mania:  { w: 6,  vol: 2.0, trend: [0.10, 0.25],   hours: [1, 4], randomSign: true },
  // crash-only moods (weight 0, so they never come up on a normal day)
  freefall: { w: 0, vol: 1.6, trend: [-0.10, -0.03], hours: [2, 6] },
  bounce:   { w: 0, vol: 1.3, trend: [0.6, 1.2],     hours: [1, 2] }   // a dead-cat bounce: false hope
};
const MARKET_MOODS = {
  flat:    { w: 40, vol: 1.0, trend: [0, 0],          hours: [8, 30] },
  bull:    { w: 20, vol: 0.9, trend: [0.01, 0.04],    hours: [8, 30] },
  bear:    { w: 20, vol: 1.2, trend: [-0.04, -0.01],  hours: [8, 30] },
  jitters: { w: 20, vol: 1.8, trend: [0, 0],          hours: [4, 16] },
  crash:   { w: 0,  vol: 2.2, trend: [-0.06, -0.03],  hours: [2, 6] }
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

// Which part of the scheduled crash we're in: null, 'tremor', 'crash' or 'recovery'.
function crashTimes() {
  if (!CRASH || !CRASH.start) return null;
  const t0 = Date.parse(CRASH.start);
  if (isNaN(t0)) return null;
  const t1 = t0 + CRASH.tremorHours * HOUR, t2 = t1 + CRASH.crashHours * HOUR, t3 = t2 + CRASH.recoveryHours * HOUR;
  return { t0, t1, t2, t3 };
}
function crashPhase(ms) {
  const t = crashTimes();
  if (!t || ms < t.t0 || ms >= t.t3) return null;
  return ms < t.t1 ? 'tremor' : ms < t.t2 ? 'crash' : 'recovery';
}

// Percent change that still makes sense when prices touch or cross zero.
function pctChange(now, then) {
  if (!then) return 0;
  return round2(((now - then) / Math.abs(then)) * 100);
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

  // ----- The Crash -----
  const phase = crashPhase(now);
  const oldPhase = state.market.crashPhase || null;
  const phaseChanged = phase !== oldPhase;
  state.market.crashPhase = phase;
  const ONLY = (name, table = MARKET_MOODS) => { const o = {}; Object.keys(table).forEach((k) => { o[k] = k === name ? 1 : 0; }); return o; };
  if (phaseChanged && phase === 'crash') state.market.mood = rollMood(MARKET_MOODS, ONLY('crash'));
  if (phaseChanged && phase === 'tremor') state.market.mood = rollMood(MARKET_MOODS, ONLY('jitters'));
  if (phaseChanged && oldPhase === 'crash') state.market.mood = rollMood(MARKET_MOODS, ONLY('jitters'));
  if (now >= state.market.mood.until) {
    state.market.mood = phase === 'crash' ? rollMood(MARKET_MOODS, ONLY('crash'))
      : phase === 'tremor' ? rollMood(MARKET_MOODS, ONLY('jitters'))
      : phase === 'recovery' ? rollMood(MARKET_MOODS, { flat: 40, bull: 15, bear: 25, jitters: 20, crash: 0 })
      : rollMood(MARKET_MOODS);
  }

  // ----- Circuit breaker: a halt freezes prices (and the bot should refuse trades) -----
  const halted = status === 'open' && state.market.haltUntil && now < state.market.haltUntil;
  const stepScale = halted ? 0 : scale;

  const mkt = state.market.mood;
  const marketMove = stepScale * (mkt.trend / TICKS_PER_DAY + (MARKET_DAILY_VOL / Math.sqrt(TICKS_PER_DAY)) * mkt.vol * fat());

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
    halted: !!halted,
    haltUntil: halted ? new Date(state.market.haltUntil).toISOString() : null,
    text: halted
      ? '🛑 **Trading halted** (circuit breaker) · resumes ' + ts(state.market.haltUntil)
      : open
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
    const kappaPit = Math.LN2 / (0.5 * TICKS_PER_DAY);

    // Bankruptcy record (public, it's in prices.json): null while the company is solvent.
    let bk = prev.bankrupt && prev.bankrupt.since ? Object.assign({}, prev.bankrupt) : null;

    // Each crash gives every company its own secret drag (so nobody knows who survives).
    if (phase && (!s.crash || s.crash.id !== CRASH.start)) {
      const depth = (CRASH.depth[c.id] || 3) * between(CRASH.spread[0], CRASH.spread[1]);
      s.crash = { id: CRASH.start, rate: depth / (CRASH.crashHours * 60 / TICK_MIN) };
    }
    const drag = !s.crash ? 0 : phase === 'crash' ? s.crash.rate : phase === 'tremor' ? s.crash.rate * 0.3 : 0;
    if (phaseChanged && phase === 'crash') s.mood = rollMood(MOODS, ONLY('freefall', MOODS));
    if (phaseChanged && oldPhase === 'crash') s.mood = rollMood(MOODS, c.moods);

    function stepPrice(price, sc) {
      if (now >= s.mood.until) s.mood = rollMood(MOODS, phase === 'crash' ? CRASH_MOODS : c.moods);
      const z = fat();
      const lp = Math.log(Math.max(price, 0.05));
      s.trend += (s.mood.trend * (c.trendScale || 1) - s.trend) * 0.05;
      let r = c.beta * marketMove;
      r += sc * (s.trend / TICKS_PER_DAY + v * s.mood.vol * s.g * z);
      if (bk) {
        // Bankrupt: the price is pulled toward its "pit" instead of a fair value.
        if (typeof s.pit !== 'number') s.pit = between(PIT[0], PIT[1]);
        r += sc * kappaPit * (s.pit - price) / LINEAR_BELOW;
        if (!phase || phase === 'recovery') s.pit += sc * PIT_CLIMB / TICKS_PER_DAY;
        r -= sc * drag * 0.5;
      } else {
        r += sc * kappa * (s.lnFair - lp);
        // Outside a crash, cheap stocks get a gentle lift off the floor (going bankrupt is possible, just rare).
        if (price < LINEAR_BELOW && !drag) r += 0.004 * (Math.log(LINEAR_BELOW) - lp);
        r += sc * s.hype / TICKS_PER_DAY;
        if (s.secret && s.secret.leakDir) r += sc * s.secret.leakDir * (c.leak / (DECIDE_MIN / TICK_MIN));
        r -= sc * drag;
      }
      // Volatility clustering: big surprises raise volatility, calm ticks let it settle back toward 1.
      s.g = clamp(1 + 0.98 * (s.g - 1) + 0.05 * (Math.abs(z) - 0.8), 0.5, 3.5);
      // The fair value wanders, and is gently kept inside its bounds (not during a crash: it sinks with everything else).
      s.lnFair += sc * (c.fairVol / Math.sqrt(TICKS_PER_DAY)) * normal() - sc * drag;
      const keep = drag ? 0 : phase === 'recovery' ? 0.08 : 1;
      if (s.lnFair > bounds[1]) s.lnFair -= sc * 0.01 * keep * (s.lnFair - bounds[1]);
      if (s.lnFair < bounds[0]) s.lnFair += sc * 0.01 * keep * (bounds[0] - s.lnFair);
      // Health drifts slowly back toward neutral (and rots during a crash).
      s.health = clamp(s.health * (1 - 0.003 * sc) + 0.035 * Math.sqrt(sc) * normal() - (drag ? 0.004 * sc : 0), -1, 1);
      // Above LINEAR_BELOW moves are percentages; below it they're Polygons, so the price can cross zero.
      const next = !bk && price >= LINEAR_BELOW ? price * Math.exp(r) : price + LINEAR_BELOW * r;
      return round2(next);
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
      // During a trading halt the clock keeps going but the price is frozen.
      history.push(stepScale > 0 ? stepPrice(history[history.length - 1], stepScale) : history[history.length - 1]);
      times.push(unix(now));
    }

    return {
      c, s, prev, history, times, newsLog,
      goal: prev.goal && prev.goal.text ? { index: prev.goal.index, text: prev.goal.text, deadline: prev.goal.deadline } : null,
      lastGoal: Number.isInteger(prev.lastGoal) ? prev.lastGoal : -1,
      nextGoalAt: prev.nextGoalAt || new Date(now + between(0, 2) * HOUR).toISOString(),
      divIndex: typeof prev.divIndex === 'number' ? prev.divIndex : 0,
      // first run of the new dividend rules: start each company where its board would put it
      divRate: typeof prev.divRate === 'number' ? prev.divRate : divTarget(s.health),
      divBoostUntil: prev.divBoostUntil || null,
      divReviewAt: prev.divReviewAt || new Date(now + between(1, 6) * HOUR).toISOString(),
      swingAt: prev.swingAt || null,
      bk,
      bailouts: prev.bailouts || 0,
      wipes: prev.wipes || 0,
      brinkAt: prev.brinkAt || null
    };
  });
  const byId = {};
  live.forEach((x) => { byId[x.c.id] = x; });

  // ----- Dividend rate changes -----
  function setRate(x, rate, boostHours) {
    x.divRate = rate;
    x.divBoostUntil = boostHours ? new Date(now + boostHours * HOUR).toISOString() : null;
    x.divReviewAt = new Date(now + between(DIV_REVIEW_HOURS[0], DIV_REVIEW_HOURS[1]) * HOUR).toISOString();
  }
  const BOARD = {
    up: ['{n} raises its dividend to {r}.', '{n}\'s board feels generous: dividend up to {r}.', '{n} bumps its payout to {r}.'],
    down: ['{n} cuts its dividend to {r}.', '{n}\'s board trims the payout to {r}.', '{n} tightens its belt: dividend down to {r}.'],
    off: ['{n} suspends its dividend.', '{n}\'s board freezes all payouts.', 'No dividends from {n} until further notice.'],
    back: ['{n} brings its dividend back at {r}.', '{n} turns the payouts back on ({r}).', '{n} resumes its dividend at {r}.']
  };
  function boardLine(kind, x, rate) { return pick(BOARD[kind]).replace('{n}', x.c.name).replace('{r}', ratePct(rate)); }

  // Moves the latest price by pct (0.1 = +10%) and lets the news reach the hidden state.
  // fair = how much of the move is "real" (shifts fair value), vol = volatility kick, health = health change.
  function shove(x, pct, { fair = 0.6, vol = 0.4, health = 0 } = {}) {
    const h = x.history;
    const before = h[h.length - 1];
    // Same as before * (1 + pct) above LINEAR_BELOW; below it the move is measured as if the price were LINEAR_BELOW.
    const after = round2(before + pct * Math.max(before, LINEAR_BELOW));
    h[h.length - 1] = after;
    if (before > 0 && after > 0 && !x.bk) x.s.lnFair += fair * Math.log(after / before);
    x.s.g = clamp(x.s.g + vol, 0.5, 3.5);
    x.s.health = clamp(x.s.health + health, -1, 1);
    return pctChange(after, before);
  }
  function setMood(x, name) {
    const m = MOODS[name];
    x.s.mood = { name, vol: m.vol, trend: between(m.trend[0], m.trend[1]), until: now + between(m.hours[0], m.hours[1]) * HOUR };
  }

  // ---------- Events (only while the market is open) ----------
  if (open && !halted) {
    live.forEach((x) => {
      const { c, s } = x;
      const h = x.history;
      if (x.bk) return;   // bankrupt: no goals, no surprises, no rumors, no dividend reviews (see the bankruptcy block)

      // Crash: sudden panic legs down
      if (phase === 'crash' && chance(PANIC_RATE)) {
        const move = shove(x, -between(0.06, 0.16), { fair: 0.5, vol: 0.8, health: -0.05 });
        if (chance(0.5)) x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'bad', headline: pick(STORIES.CRASH.panic).replace(/\{n\}/g, c.name), move }));
      }

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
            if (big) { setRate(x, DIV_BOOST, between(DIV_BOOST_HOURS[0], DIV_BOOST_HOURS[1])); dividend = 'boosted'; }
            else if (x.divRate < 1) { setRate(x, 1); dividend = 'restored'; }
            if (chance(c.sellNews)) setMood(x, 'slide');            // "buy the rumor, sell the news"
            else if (chance(0.5)) setMood(x, 'rally');
          } else if (outcome === 'fail') {
            const drop = between(c.goalJump[0], c.goalJump[1]) * mult;
            move = shove(x, -drop / (1 + drop), { fair: 0.6, vol: 0.6, health: -0.25 });
            headline = tpl.lose;
            const was = x.divRate > 1.25 ? 1 : x.divRate;     // a failure ends any boost
            setRate(x, divStep(was, big ? -2 : -1));
            dividend = x.divRate === 0 ? 'suspended' : 'cut';
            setMood(x, big ? 'slide' : chance(0.5) ? 'choppy' : 'normal');
          } else {
            move = shove(x, between(-0.04, 0.04), { fair: 0.4, vol: 0.3 });
            headline = tpl.mixed || (c.name + ' sort of delivers. Investors shrug.');
            setMood(x, 'choppy');
          }
          x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: outcome, headline, move, dividend, divRate: dividend ? x.divRate : undefined, big: big && outcome !== 'mixed' || undefined }));
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

      // ----- Board review of the dividend -----
      if (YIELDS[c.id] && x.divRate <= 1.25 && now >= Date.parse(x.divReviewAt)) {
        const target = divTarget(s.health);
        const from = x.divRate;
        setRate(x, from === target ? from : divStep(from, target > from ? 1 : -1));
        if (x.divRate !== from) {
          const kind = x.divRate === 0 ? 'off' : from === 0 ? 'back' : x.divRate > from ? 'up' : 'down';
          x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'dividend', headline: boardLine(kind, x, x.divRate),
            dividend: kind === 'off' ? 'suspended' : kind === 'back' ? 'resumed' : kind === 'up' ? 'raised' : 'cut', divRate: x.divRate, from }));
        }
      }

      // ----- Surprise news -----
      if (chance(c.surpriseRate || SURPRISE_RATE)) {
        const good = chance(clamp(0.5 + 0.2 * s.health, 0.2, 0.8));
        const major = chance(0.15);
        const size = between(c.surprise[0], c.surprise[1]) * (major ? 2 : 1);
        const move = shove(x, good ? size : -size / (1 + size), { fair: 0.7, vol: 0.4, health: good ? 0.15 : -0.15 });
        if (major) setMood(x, good ? 'rally' : 'slide');
        const headline = pick((good ? STORIES.GOOD : STORIES.BAD)[c.id] || [c.name + (good ? ' has a great day.' : ' has a rough day.')]);
        let special;
        if (good && x.divRate > 0 && YIELDS[c.id] && chance(SPECIAL_DIV_CHANCE * (major ? 2 : 1))) {
          special = Math.round(between(SPECIAL_DIV_DAYS[0], SPECIAL_DIV_DAYS[1]));
          x.divIndex += h[h.length - 1] * YIELDS[c.id] * special;
        }
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: good ? 'good' : 'bad', headline, move, big: major || undefined,
          dividend: special ? 'special' : undefined, divDays: special }));
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
        let restored;
        if (r.isTrue && r.dir > 0 && x.divRate < 1) { setRate(x, 1); restored = 'restored'; }
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type, headline: r.isTrue ? r.confirm : r.deny, move,
          dividend: restored, divRate: restored ? 1 : undefined }));
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
        if (x.bk) return;
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
      if (a && b && !a.bk && !b.bk) {
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

  // ---------- The Crash: phase changes and headlines ----------
  const fill = (t, x) => t.replace(/\{n\}/g, x ? x.c.name : '');
  function marketHit(lo, hi, headline, type) {
    const moves = {};
    live.forEach((x) => {
      if (x.bk) return;
      const size = between(lo, hi) * x.c.beta * between(0.7, 1.3);
      moves[x.c.id] = size ? shove(x, -size / (1 + size), { fair: 0.5, vol: 0.5, health: -0.05 }) : 0;
      x.newsLog.unshift({ time: nowIso, id: x.c.id, name: x.c.name, type, headline, move: moves[x.c.id] });
    });
    return moves;
  }
  if (phaseChanged) {
    if (phase === 'tremor') {
      addNews({ id: 'MARKET', name: 'Whole market', type: 'crash', headline: pick(STORIES.CRASH.tremor), moves: marketHit(0.01, 0.03, '', 'crash') });
    } else if (phase === 'crash') {
      addNews({ id: 'MARKET', name: 'Whole market', type: 'crash', big: true, headline: pick(STORIES.CRASH.start), moves: marketHit(0.06, 0.12, '', 'crash') });
      state.market.crashNewsAt = now + between(CRASH_NEWS_HOURS[0], CRASH_NEWS_HOURS[1]) * HOUR;
    } else if (phase === 'recovery') {
      addNews({ id: 'MARKET', name: 'Whole market', type: 'crash', headline: pick(STORIES.CRASH.end) });
    } else if (oldPhase && !phase) {
      addNews({ id: 'MARKET', name: 'Whole market', type: 'crash', headline: pick(STORIES.CRASH.over) });
    }
    // company logs got the headline text after the fact
    const top = news[0];
    if (top && top.type === 'crash') live.forEach((x) => { if (x.newsLog[0] && x.newsLog[0].time === nowIso && x.newsLog[0].type === 'crash') x.newsLog[0].headline = top.headline; });
  } else if (phase === 'crash' && open && !halted && now >= (state.market.crashNewsAt || 0)) {
    const headline = pick(STORIES.CRASH.during);
    const moves = marketHit(0.02, 0.06, headline, 'crash');
    addNews({ id: 'MARKET', name: 'Whole market', type: 'crash', headline, moves });
    state.market.crashNewsAt = now + between(CRASH_NEWS_HOURS[0], CRASH_NEWS_HOURS[1]) * HOUR;
  }

  // ---------- Bankruptcy ----------
  const B = STORIES.BANKRUPT;
  live.forEach((x) => {
    const { c, s } = x;
    const h = x.history;
    const price = h[h.length - 1];

    if (!x.bk) {
      if (price <= 0) {
        // Zero or under: BANKRUPT, and every shareholder's shares are wiped (the bot reads the wipes counter).
        x.wipes += 1;
        const scrapped = x.goal ? x.goal.text : null;
        x.bk = { since: nowIso, appeals: 0, nextAppealAt: new Date(now + between(APPEAL_FIRST_HOURS[0], APPEAL_FIRST_HOURS[1]) * HOUR).toISOString(), verdictAt: null, swim: 0 };
        s.pit = Math.min(price, between(PIT[0], PIT[1]));
        s.health = Math.min(s.health, -0.6);
        s.secret = null; s.hype = 0; s.rumor = null;
        x.goal = null;
        x.divRate = 0; x.divBoostUntil = null;
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'bankrupt', big: true, headline: fill(pick(B.enter), x),
          scrapped: scrapped || undefined, dividend: 'suspended', divRate: 0, wiped: true }));
      } else if (price < BRINK && (!x.brinkAt || now - Date.parse(x.brinkAt) > 12 * HOUR)) {
        x.brinkAt = nowIso;
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'brink', headline: fill(pick(B.brink), x) }));
      }
      return;
    }

    // Swimming back up: above SWIM_PRICE for SWIM_TICKS open ticks in a row.
    if (open && !halted) x.bk.swim = price >= SWIM_PRICE ? (x.bk.swim || 0) + 1 : 0;
    if (x.bk.swim >= SWIM_TICKS) {
      x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'recovered', headline: fill(pick(B.swim), x) }));
      x.bk = null;
      s.lnFair = Math.log(Math.max(price, 1.5));
      s.health = -0.2; s.pit = null;
      return;
    }
    if (!open || halted) return;

    if (x.bk.verdictAt && now >= Date.parse(x.bk.verdictAt)) {
      // TODD rules on the appeal.
      let odds = BAILOUT_ODDS.base + BAILOUT_ODDS.perAppeal * (x.bk.appeals - 1) + BAILOUT_ODDS.health * s.health;
      if (phase === 'crash') odds *= BAILOUT_ODDS.crash;
      odds = clamp(odds, 0.05, BAILOUT_ODDS.max);
      if (chance(odds)) {
        const restart = round2(Math.max(2.5, c.start * between(BAILOUT_PRICE[0], BAILOUT_PRICE[1])));
        h[h.length - 1] = restart;
        s.lnFair = Math.log(restart); s.g = 1.5; s.health = -0.3; s.pit = null;
        if (s.crash) s.crash.rate *= 0.5;      // TODD's money buys some shelter from the rest of the crash
        x.bailouts += 1;
        x.divRate = 0; x.divBoostUntil = null;
        x.divReviewAt = new Date(now + BAILOUT_DIV_HOURS * HOUR).toISOString();
        setMood(x, chance(0.5) ? 'normal' : 'rally');
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'bailout', big: true, headline: fill(pick(B.approved), x), restart, owed: true }));
        x.bk = null;
      } else {
        const move = shove(x, -between(0.1, 0.4), { fair: 0, vol: 0.4 });
        s.pit -= between(0.2, 0.6);
        x.bk.verdictAt = null;
        x.bk.nextAppealAt = new Date(now + between(APPEAL_HOURS[0], APPEAL_HOURS[1]) * HOUR).toISOString();
        x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'appealDenied', headline: fill(pick(B.denied), x), move, nextAppeal: x.bk.nextAppealAt }));
      }
      return;
    }
    if (!x.bk.verdictAt && now >= Date.parse(x.bk.nextAppealAt)) {
      x.bk.appeals += 1;
      x.bk.verdictAt = new Date(now + between(VERDICT_HOURS[0], VERDICT_HOURS[1]) * HOUR).toISOString();
      x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: 'appeal', headline: fill(pick(x.bk.appeals > 1 ? B.appealAgain : B.appeal), x), verdict: x.bk.verdictAt, appeals: x.bk.appeals }));
      return;
    }
    // A fundraiser (climb toward the surface) or another disaster (sink deeper).
    if (chance(HOPE_RATE)) {
      const good = chance(clamp(0.55 + 0.2 * s.health, 0.3, 0.7));
      const move = good ? shove(x, between(0.25, 0.8), { fair: 0, vol: 0.3 }) : shove(x, -between(0.15, 0.5), { fair: 0, vol: 0.3 });
      s.pit += good ? between(0.5, 1.2) : -between(0.2, 0.6);
      x.newsLog.unshift(addNews({ id: c.id, name: c.name, type: good ? 'good' : 'bad', headline: fill(pick(good ? B.hope : B.doom), x), move }));
    }
  });

  // ---------- Circuit breaker: the average stock fell too far in an hour ----------
  if (open && !halted) {
    const drops = live.filter((x) => !x.bk && x.history.length > SWING_TICKS)
      .map((x) => pctChange(x.history[x.history.length - 1], x.history[x.history.length - 1 - SWING_TICKS]));
    const avg = drops.length ? drops.reduce((a, b) => a + b, 0) / drops.length : 0;
    const cooled = !state.market.haltAt || now - state.market.haltAt >= HALT_COOLDOWN_HOURS * HOUR;
    if (avg <= HALT_DROP && cooled) {
      state.market.haltAt = now;
      state.market.haltUntil = now + HALT_MIN * 60 * 1000;
      market.halted = true;
      market.haltUntil = new Date(state.market.haltUntil).toISOString();
      market.text = '🛑 **Trading halted** (circuit breaker) · resumes ' + ts(state.market.haltUntil);
      addNews({ id: 'MARKET', name: 'Whole market', type: 'halt', headline: pick(STORIES.CRASH.halt).replace('{p}', Math.abs(avg).toFixed(1)), until: market.haltUntil });
    }
  }

  // ---------- Dividends, swing alerts, output ----------
  const OPEN_MS_PER_DAY = (CLOSE_HOUR - OPEN_HOUR) * HOUR;
  const companies = live.map((x) => {
    const { c } = x;
    const yieldPerDay = YIELDS[c.id] || 0;
    const price = x.history[x.history.length - 1];

    if (x.divBoostUntil && now >= Date.parse(x.divBoostUntil)) {
      x.divRate = divTarget(x.s.health) >= 1.25 ? 1.25 : 1;      // the boost wears off quietly
      x.divBoostUntil = null;
    }
    if (open && x.divRate > 0 && sinceLastTick > 0) {
      const ms = Math.min(sinceLastTick, MAX_ACCRUE_MIN * 60 * 1000);
      x.divIndex += price * yieldPerDay * x.divRate * (ms / OPEN_MS_PER_DAY);
    }
    x.divIndex = Math.round(x.divIndex * 10000) / 10000;

    if (x.bk) { x.divRate = 0; x.divBoostUntil = null; }
    if (open && !x.bk && price >= LINEAR_BELOW && x.history.length > SWING_TICKS) {
      const hourAgo = x.history[x.history.length - 1 - SWING_TICKS];
      const swing = pctChange(price, hourAgo);
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
      change: pctChange(price, history[0]),
      status: x.bk ? 'bankrupt' : price < LINEAR_BELOW ? 'distressed' : 'ok',
      bankrupt: x.bk,
      bailouts: x.bailouts,
      wipes: x.wipes,
      brinkAt: x.brinkAt,
      history,
      times,
      goal: x.goal,
      lastGoal: x.lastGoal,
      nextGoalAt: x.nextGoalAt,
      swingAt: x.swingAt,
      yield: yieldPerDay,
      divIndex: x.divIndex,
      divRate: x.divRate,
      divStatus: yieldPerDay ? divStatus(x.divRate) : 'none',
      divBoostUntil: x.divBoostUntil,
      divReviewAt: x.divReviewAt,
      divSuspendedUntil: yieldPerDay && x.divRate === 0 ? x.divReviewAt : null,   // kept for older readers: earliest it could come back
      newsLog: x.newsLog.slice(0, COMPANY_NEWS)
    };
  });

  news = news.slice(0, MAX_NEWS);
  const t = crashTimes();
  const crash = phase ? {
    phase,
    started: new Date(t.t0).toISOString(),
    crashFrom: new Date(t.t1).toISOString(),
    crashUntil: new Date(t.t2).toISOString(),
    recoveryUntil: new Date(t.t3).toISOString(),
    text: phase === 'tremor' ? '🫨 **Something is wrong with the market.** The crash hits <t:' + unix(t.t1) + ':R>'
      : phase === 'crash' ? '🚨 **MARKET CRASH IN PROGRESS** · the selling ends <t:' + unix(t.t2) + ':R>... maybe'
      : '🩹 **Crash recovery** · the market is finding its floor'
  } : null;
  const data = buildOutput({ nowIso, market, news, companies, crash });

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
  crossover: '🤝 **CROSSOVER**',
  dividend:  '💸 **DIVIDEND**',
  crash:     '🚨 **MARKET CRASH**',
  halt:      '🛑 **TRADING HALTED**',
  brink:     '⚠️ **ON THE BRINK**',
  bankrupt:  '💀 **BANKRUPT**',
  appeal:    '🙏 **BAILOUT APPEAL**',
  appealDenied: '🚫 **APPEAL DENIED**',
  bailout:   '🏦 **TODD BAILOUT**',
  recovered: '🛟 **OUT OF BANKRUPTCY**'
};

function divNote(item) {
  switch (item.dividend) {
    case 'bonus': return '\n🎉 Bonus dividend paid to shareholders';
    case 'boosted': return '\n🎉 Bonus dividend paid, and the dividend is boosted to ' + ratePct(DIV_BOOST) + ' for a while';
    case 'restored': return (item.type === 'success' ? '\n🎉 Bonus dividend paid, and the' : '\n💸 The') + ' dividend is back to 100%';
    case 'cut': return '\n✂️ Dividend cut to ' + ratePct(item.divRate);
    case 'suspended': return '\n💸 Dividend suspended';
    case 'special': return '\n💰 Special dividend: ' + item.divDays + " day" + (item.divDays > 1 ? 's' : '') + "' worth paid to shareholders";
    default: return '';
  }
}

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
  } else if (item.verdict) {
    extra = 'Appeal #' + item.appeals + ' · TODD rules <t:' + unix(Date.parse(item.verdict)) + ':R>';
  } else if (typeof item.restart === 'number') {
    extra = 'Trading restarts at ⬡ ' + item.restart.toFixed(2) + ' · TODD keeps the dividends for ' + BAILOUT_DIV_HOURS + ' hours';
  } else if (item.until) {
    extra = 'Prices frozen · trading resumes <t:' + unix(Date.parse(item.until)) + ':R>';
  }
  if (item.wiped) extra = (extra ? extra + '\n' : '') + '🗑️ Every share of ' + item.id + ' has been wiped from every portfolio';
  if (item.scrapped) extra = (extra ? extra + '\n' : '') + 'Goal scrapped: ' + item.scrapped;
  if (item.nextAppeal) extra = (extra ? extra + ' · ' : '') + 'next appeal <t:' + unix(Date.parse(item.nextAppeal)) + ':R>';
  const div = item.type === 'dividend' ? '' : divNote(item);
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

function statusLine(c) {
  if (c.status === 'bankrupt') {
    const b = c.bankrupt;
    return '💀 **BANKRUPT** since <t:' + unix(Date.parse(b.since)) + ':R> · ' +
      (b.verdictAt ? 'TODD rules on appeal #' + b.appeals + ' <t:' + unix(Date.parse(b.verdictAt)) + ':R>'
        : 'next bailout appeal <t:' + unix(Date.parse(b.nextAppealAt)) + ':R>') +
      (b.swim ? ' · back above ⬡ ' + SWIM_PRICE.toFixed(2) + ' for ' + (b.swim * TICK_MIN) + '/' + (SWIM_TICKS * TICK_MIN) + ' min' : '');
  }
  if (c.status === 'distressed') return '⚠️ **Distressed** · under ⬡ ' + LINEAR_BELOW.toFixed(2) + ', one bad day from bankruptcy';
  return '✅ Solvent';
}

function buildOutput({ nowIso, market, news, companies, crash = null }) {
  const prices = {}, changes = {}, dividends = {}, divDaily = {}, divText = {}, names = {}, sparks = {}, charts = {};
  const statuses = {}, statusText = {}, tradable = {}, wipes = {};
  companies.forEach((c) => {
    wipes[c.id] = c.wipes || 0;
    statuses[c.id] = c.status || 'ok';
    statusText[c.id] = statusLine(c);
    tradable[c.id] = c.status !== 'bankrupt' && !market.halted && market.status === 'open';
    prices[c.id] = c.price;
    changes[c.id] = c.change;
    dividends[c.id] = c.divIndex;
    divDaily[c.id] = Math.round(c.price * c.yield * c.divRate * 10000) / 10000;
    const eff = (c.yield * c.divRate * 100).toFixed(2).replace(/\.?0+$/, '') + '% daily · ⬡ ' + divDaily[c.id].toFixed(2) + ' per share';
    divText[c.id] = c.status === 'bankrupt' ? '💀 None · the company is bankrupt'
      : !c.yield ? '🚫 No dividend'
      : c.divRate === 0 ? '💸 Suspended · next board review <t:' + unix(Date.parse(c.divReviewAt)) + ':R>'
      : c.divRate > 1.25 ? '🚀 Boosted to ' + ratePct(c.divRate) + ' · ' + eff + ' · until <t:' + unix(Date.parse(c.divBoostUntil)) + ':R>'
      : c.divRate < 1 ? '✂️ Cut to ' + ratePct(c.divRate) + ' · ' + eff
      : c.divRate > 1 ? '📈 Raised to ' + ratePct(c.divRate) + ' · ' + eff
      : eff;
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
  const crashText = crash ? crash.text : '';
  return { updated: nowIso, engine: 2, market, crash, crashText, prices, changes, statuses, statusText, tradable, wipes, dividends, divDaily, divText, names, sparks, charts, headline, headlineText, newsText, news: withLines, companies };
}

module.exports = { tick, COMPANIES, TICK_MS, statusAt };
