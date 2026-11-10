// Company jobs: names, ranks, starting prices (pay is scaled against these), and the work tasks.
// The Labor Day Update: every job has three kinds of tasks, tasks get harder at higher ranks,
// and ranks are earned (or lost) in a performance review every 10 shifts.

const COMPANIES = {
  RRM:  { name: 'Render Room',               role: 'moderation duty',  start: 120 },
  NACH: { name: 'De Nacho',                  role: 'the nacho line',   start: 45.5 },
  BLU:  { name: "Builder's League United",   role: 'the build crew',   start: 78.25 },
  BNW:  { name: 'Business Numbers Working',  role: 'number crunching', start: 12.8 },
  BSTG: { name: 'Bastardly Glory',           role: 'playtesting',      start: 50 }
};

const WORK_COOLDOWN_MS = 15 * 60 * 1000;
const GIG_COOLDOWN_MS = 10 * 60 * 1000;
const QUIT_LOCK_MS = 24 * 60 * 60 * 1000;
const ABANDON_MS = 60 * 1000;   // an unanswered task is cleared after this
const BASE_PAY = 35;
const GIG_PAY = 0.4;            // gigs pay 40% of an Intern shift
const LIMIT = { task: 20, rush: 15, memory: 15 }; // seconds to answer (memory: after the order disappears)

// Four ranks for every job. Pay multiplier by rank; the names depend on the company.
const MULTS = [1, 1.25, 1.5, 2];
const RANK_NAMES = {
  RRM:  ['Trial Mod', 'Moderator', 'Senior Mod', 'Admin'],
  NACH: ['Dishwasher', 'Line Cook', 'Sous Chef', 'Head Chef'],
  BLU:  ['Apprentice', 'Builder', 'Foreman', 'Architect'],
  BNW:  ['Intern', 'Analyst', 'Accountant', 'CFO'],
  BSTG: ['Playtester', 'Bug Hunter', 'QA Lead', 'Game Director'],
  default: ['Intern', 'Employee', 'Manager', 'Executive'] // player companies
};
const rankName = (job, r) => (RANK_NAMES[job] || RANK_NAMES.default)[Math.max(0, Math.min(3, r))];
const rank = (job, r = 0) => ({ index: Math.max(0, Math.min(3, r)), name: rankName(job, r), mult: MULTS[Math.max(0, Math.min(3, r))] });

// Performance reviews: every 10 shifts, by how many of those 10 were right
const REVIEW = { every: 10, promote: 8, demote: 4, topBonus: 5 }; // topBonus: shifts' worth of pay for a great review at the top rank

// ---------------------------------------------------------------------------------------------
// Task content
const RRM_POSTS = {
  ban: ['FREE NITRO click my link now', 'you are all trash and should leave', 'spamspamspamspamspamspamspam',
    'DM me for cheap Polygons for real money', 'selling accounts, cheap, dm', '@everyone @everyone @everyone JOIN MY SERVER'],
  warn: ['ugh this channel is so dead lol jk... unless?', 'stop being so dumb about the market', 'whos selling RRM rn im gonna find you',
    'posting this meme in every channel brb', 'ALL CAPS BECAUSE IM EXCITED ABOUT NACHOS'],
  ok: ['anyone want to play later?', 'whats the RRM price today', 'just made Line Cook at De Nacho lets go', 'gm everyone',
    'is the market open yet?', 'TODD said hi to me once', 'bought the dip, wish me luck']
};
const RRM_LINKS = {
  safe: ['renderproductions.github.io', 'discord.gg/D2v4EsuZBU', 'renderproductions.github.io/rend-conomy'],
  fake: ['renderproductions.github.io.free-nitro.ru', 'rendrproductions.github.io', 'renderproductions-github.io.xyz',
    'discord-gift.com/render', 'dlscord.gg/D2v4EsuZBU', 'free-polygons.store/render', 'render-room.giveaway.click']
};
const RRM_RULES = [
  ['Spam', ['spamspamspamspamspamspam', 'posting the same meme in every channel', '@everyone @everyone @everyone']],
  ['Be respectful', ['you are all trash and should leave', 'nobody likes you, quit', 'imagine being this bad at the market']],
  ['No scams', ['DM me for cheap Polygons for real money', 'FREE NITRO click my link now', 'send me 500 Polygons, I will send back 1000']],
  ['Stay on topic', ['anyway here is my 40 paragraph fanfic in #market', 'who wants to talk about taxes in #nacho-pics', 'posting my grocery list in #announcements']]
];
const NACH_ITEMS = [['cheese', '🧀'], ['jalapeno', '🌶️'], ['salsa', '🍅'], ['guac', '🥑'], ['beans', '🫘'], ['sour cream', '🥛'], ['chips', '🌽']];
const BLU_ORDERS = [
  ['roof walls foundation', 'foundation walls roof'],
  ['walls roof foundation', 'foundation walls roof'],
  ['paint drywall frame', 'frame drywall paint'],
  ['drywall paint frame', 'frame drywall paint']
];
const BLU_ORDERS_4 = ['survey dig pour frame', 'frame wire drywall paint', 'plan dig foundation walls', 'walls roof windows paint'];
const BLU_TOOLS = [['hammering in nails', 'hammer'], ['cutting a plank', 'saw'], ['tightening a bolt', 'wrench'],
  ['making a hole for a screw', 'drill'], ['checking a shelf is straight', 'level'], ['spreading mortar', 'trowel']];
const BSTG_BUGS = [['🟩', '👾'], ['🟩', '🟥'], ['🟦', '🟪'], ['⬜', '⬛'], ['🟩', '🟢'], ['🟦', '🔵']]; // later ones are sneakier
const ARROWS = [['up', '⬆️'], ['down', '⬇️'], ['left', '⬅️'], ['right', '➡️']];

// ---------------------------------------------------------------------------------------------
// A work task. tier (0-3) is the worker's rank: higher ranks get harder versions.
// Returns { kind, q, ans, choices?, seq?, check?, hideMs?, hidden?, limit }
//   choices: buttons [{ label, value, style?, emoji? }]. seq = true: press several buttons in order.
//   check(text): custom grading for typed answers. hideMs/hidden: the prompt is replaced after hideMs.
// Typing the answer always works too.
function task(job, { rush = false, tier = 0, random = Math.random, market = null, kind: want = null } = {}) {
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  const shuffle = (arr) => arr.map((x) => [random(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const kinds = { RRM: ['queue', 'links', 'rule'], NACH: ['order', 'memory', 'count'], BLU: ['steps', 'bricks', 'tool'],
    BNW: ['math', 'sheet', 'percent'], BSTG: ['tile', 'grid', 'repro'] }[job] || ['queue'];
  const usable = rush ? kinds.filter((k) => !['memory', 'repro'].includes(k)) : kinds; // no memory games in a rush
  const kind = want && kinds.includes(want) ? want : pick(usable);
  const head = (t) => (rush ? '' : t + ' ');
  const T = { kind, limit: rush ? LIMIT.rush : LIMIT.task };

  // ---------------- Render Room ----------------
  if (kind === 'queue') {
    const options = tier >= 1 ? ['ban', 'warn', 'ok'] : ['ban', 'ok'];
    const right = pick(options);
    const post = pick(RRM_POSTS[right]);
    return { ...T, ans: right,
      q: `🛡️ ${head('**Render Room mod queue.**')}A member posted:\n> ${post}\n${tier >= 1 ? 'Ban, warn, or OK?' : 'Ban them, or OK?'}`,
      choices: options.map((o) => ({ label: o === 'ok' ? 'OK' : o[0].toUpperCase() + o.slice(1), value: o, style: o === 'ban' ? 'red' : o === 'ok' ? 'green' : 'blue' })) };
  }
  if (kind === 'links') {
    const safe = pick(RRM_LINKS.safe);
    const fakes = shuffle(RRM_LINKS.fake).slice(0, 2 + tier);
    const list = shuffle([safe, ...fakes]);
    return { ...T, ans: safe,
      q: `🛡️ ${head('**Render Room:**')}someone asks which link is safe. Which one is the **real** one?\n${list.map((l, i) => `**${i + 1}.** \`${l}\``).join('\n')}`,
      choices: list.map((l, i) => ({ label: String(i + 1), value: l })),
      check: (txt) => txt === safe || txt === String(list.indexOf(safe) + 1) };
  }
  if (kind === 'rule') {
    const rules = shuffle(RRM_RULES).slice(0, Math.min(4, 3 + (tier >= 2 ? 1 : 0)));
    const [right, posts] = pick(rules);
    return { ...T, ans: right.toLowerCase(),
      q: `🛡️ ${head('**Render Room:**')}which rule does this break?\n> ${pick(posts)}`,
      choices: rules.map(([r]) => ({ label: r, value: r.toLowerCase() })) };
  }

  // ---------------- De Nacho ----------------
  if (kind === 'order') {
    const parts = [`${int(1, 5)} cheese`, `${int(1, 4)} jalapeno`, pick(['salsa', 'guac', 'beans', 'sour cream'])];
    if (tier >= 2) parts.push(pick(['extra chips', 'no onions', 'light salt', 'double guac']));
    if (tier >= 3) parts.splice(1, 0, `${int(2, 6)} beans`);
    const ans = parts.join(' ');
    return { ...T, ans, q: `🧀 ${head('**De Nacho, order up!**')}Type it back exactly:\n\`${ans}\`` };
  }
  if (kind === 'memory') {
    const n = 3 + Math.min(tier, 2);
    const order = Array.from({ length: n }, () => pick(NACH_ITEMS));
    const ans = order.map(([w]) => w).join(' ');
    const hideMs = tier >= 3 ? 3000 : 4000;
    return { ...T, kind, ans, seq: true, steps: order.map(([w]) => w), hideMs, limit: LIMIT.memory,
      q: `🧠 **De Nacho, memory order!** Remember it, it disappears in ${hideMs / 1000} seconds:\n## ${order.map(([, e]) => e).join(' ')}\n-# ${order.map(([w]) => w).join(', ')}`,
      hidden: `🧠 **De Nacho, memory order!** Build it from memory: press the ingredients **in order**.\n## ${order.map(() => '❔').join(' ')}`,
      choices: NACH_ITEMS.map(([w, e]) => ({ label: w, value: w, emoji: e })) };
  }
  if (kind === 'count') {
    const item = pick(['cheese', 'jalapeno', 'salsa']);
    const orders = Array.from({ length: 3 + Math.min(tier, 2) }, () => {
      const a = int(0, 3 + tier), b = int(0, 3);
      const side = `${b || 1} ${pick(['guac', 'beans', 'chips'])}`;
      return [a, a ? `${a} ${item} ${side}` : side];
    });
    const total = orders.reduce((s, [a]) => s + a, 0);
    return { ...T, ans: String(total),
      q: `🧀 ${head('**De Nacho inventory check.**')}How many **${item}** are in these orders, in total?\n${orders.map(([, o]) => `• \`${o}\``).join('\n')}` };
  }

  // ---------------- Builder's League United ----------------
  if (kind === 'steps') {
    let shown, right;
    if (tier >= 2) { right = pick(BLU_ORDERS_4); shown = shuffle(right.split(' ')).join(' '); if (shown === right) shown = right.split(' ').reverse().join(' '); }
    else [shown, right] = pick(BLU_ORDERS);
    const words = right.split(' ');
    const perms = new Set([right]);
    while (perms.size < 3) perms.add(shuffle(words).join(' '));
    return { ...T, ans: right,
      q: `🏗️ ${head('**BLU build crew:**')}put these steps in the right order:\n\`${shown}\``,
      choices: shuffle([...perms]).map((x) => ({ label: x, value: x })) };
  }
  if (kind === 'bricks') {
    const per = int(4, 8 + tier * 4), rows = int(3, 6 + tier * 3);
    const extra = tier >= 2 ? int(2, 9) : 0;
    const ans = per * rows + extra;
    return { ...T, ans: String(ans),
      q: `🧱 ${head('**BLU supply run.**')}A wall is **${rows}** rows of **${per}** bricks${extra ? `, plus **${extra}** spares` : ''}. How many bricks do you order?` };
  }
  if (kind === 'tool') {
    const opts = shuffle(BLU_TOOLS).slice(0, 3 + tier);
    const [job2, tool] = pick(opts);
    return { ...T, ans: tool,
      q: `🔧 ${head('**BLU build crew:**')}which tool do you grab for **${job2}**?`,
      choices: shuffle(opts).map(([, t]) => ({ label: t, value: t })) };
  }

  // ---------------- Business Numbers Working ----------------
  if (kind === 'math') {
    let x, y, ans, sign;
    const op = rush ? 'plus' : pick(tier >= 1 ? ['plus', 'minus', 'times'] : ['plus', 'minus']);
    const big = 1 + tier;
    if (op === 'plus') { x = int(12, 50 * big); y = int(12, 40 * big); ans = x + y; sign = '+'; }
    else if (op === 'minus') { x = int(50, 60 * big); y = int(11, 49); ans = x - y; sign = '−'; }
    else { x = int(12, 15 + 10 * tier); y = int(3, 6 + 2 * tier); ans = x * y; sign = '×'; }
    if (tier >= 3 && !rush) { const z = int(5, 30); ans += z; return { ...T, ans: String(ans), q: `📊 **BNW needs these numbers, fast:** what is **${x} ${sign} ${y} + ${z}**?` }; }
    return { ...T, ans: String(ans), q: `📊 ${head('**BNW needs these numbers, fast:**')}what is **${x} ${sign} ${y}**?` };
  }
  if (kind === 'sheet') {
    const n = tier >= 3 ? 5 : 4;
    const bad = int(1, n);
    const lines = Array.from({ length: n }, (_, i) => {
      const a = int(10, 60 + tier * 40), b = int(10, 60 + tier * 40);
      const off = (tier >= 2 ? pick([1, -1, 10, -10]) : pick([7, -6, 9, -11]));
      return `Row ${i + 1}  ${a} + ${b} = ${a + b + (i + 1 === bad ? off : 0)}`;
    });
    return { ...T, ans: String(bad),
      q: `📊 ${head('**BNW audit.**')}One row of this spreadsheet is wrong. Which one?\n\`\`\`\n${lines.join('\n')}\n\`\`\``,
      choices: Array.from({ length: n }, (_, i) => ({ label: `Row ${i + 1}`, value: String(i + 1) })),
      check: (txt) => txt.replace(/^row\s*/, '') === String(bad) };
  }
  if (kind === 'percent') {
    // Uses a real company's price from about an hour ago, when it makes for a sensible question
    let from, to, who;
    const cs = market && market.companies ? market.companies.filter((c) => c.history && c.history.length > 13 && c.price > 1) : [];
    const c = cs.length ? pick(cs) : null;
    if (c && c.history[c.history.length - 13] > 1) { from = c.history[c.history.length - 13]; to = c.price; who = `**${c.id}** was ⬡ ${from.toFixed(2)} an hour ago and is ⬡ ${to.toFixed(2)} now`; }
    if (!who || Math.abs(to / from - 1) < 0.005) { from = int(10, 90); to = Math.round(from * (1 + (int(-40, 60) / 100)) * 100) / 100; who = `A stock went from ⬡ ${from.toFixed(2)} to ⬡ ${to.toFixed(2)}`; }
    const pct = (to / from - 1) * 100;
    const tol = tier >= 2 ? 0.5 : 1;
    return { ...T, ans: String(Math.round(pct)),
      q: `📈 ${head('**BNW analyst desk.**')}${who}. By what **percent** did it change? (nearest whole number, use - for a drop)`,
      check: (txt) => { const v = Number(txt.replace(/[%\s+]/g, '')); return Number.isFinite(v) && Math.abs(v - pct) <= tol; } };
  }

  // ---------------- Bastardly Glory ----------------
  if (kind === 'tile') {
    const g = int(1, 8);
    const [ok, bug] = BSTG_BUGS[Math.min(BSTG_BUGS.length - 1, int(0, 1) + tier)];
    const row = Array.from({ length: 8 }, (_, i) => (i + 1 === g ? bug : ok)).join('');
    return { ...T, ans: String(g),
      q: `🎮 ${head('**Bastardly Glory playtest.** The build ships soon.')}Which tile is glitched? (1-8, left to right):\n${row}`,
      choices: Array.from({ length: 8 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) })) };
  }
  if (kind === 'grid') {
    const size = tier >= 2 ? 4 : 3;
    const [ok, bug] = BSTG_BUGS[Math.min(BSTG_BUGS.length - 1, int(0, 1) + tier)];
    const cell = int(0, size * size - 1);
    const name = (i) => 'ABCD'[Math.floor(i / size)] + (i % size + 1);
    const grid = Array.from({ length: size }, (_, r) => `\`${'ABCD'[r]}\` ` + Array.from({ length: size }, (_, c) => (r * size + c === cell ? bug : ok)).join('')).join('\n');
    return { ...T, ans: name(cell).toLowerCase(),
      q: `🎮 ${head('**Bastardly Glory playtest.**')}Find the glitched tile (rows ${'ABCD'.slice(0, size).split('').join(', ')}, columns 1-${size}):\n${grid}`,
      choices: Array.from({ length: size * size }, (_, i) => ({ label: name(i), value: name(i).toLowerCase() })), perRow: size };
  }
  if (kind === 'repro') {
    const n = 3 + tier;
    const seq = Array.from({ length: n }, () => pick(ARROWS));
    const hideMs = tier >= 3 ? 3000 : 4000;
    return { ...T, ans: seq.map(([w]) => w).join(' '), seq: true, steps: seq.map(([w]) => w), hideMs, limit: LIMIT.memory,
      q: `🎮 **Bastardly Glory bug report:** the game crashes after this combo. Remember it, it disappears in ${hideMs / 1000} seconds:\n## ${seq.map(([, e]) => e).join(' ')}`,
      hidden: `🎮 **Reproduce the bug!** Press the combo **in order**.\n## ${seq.map(() => '❔').join(' ')}`,
      choices: ARROWS.map(([w, e]) => ({ label: w, value: w, emoji: e })) };
  }
  return task('RRM', { rush, tier, random, market });
}

module.exports = { COMPANIES, WORK_COOLDOWN_MS, GIG_COOLDOWN_MS, QUIT_LOCK_MS, ABANDON_MS, BASE_PAY, GIG_PAY, LIMIT,
  MULTS, RANK_NAMES, rankName, rank, REVIEW, task };
