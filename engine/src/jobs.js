// Company jobs: names, roles, starting prices (pay is scaled against these), ranks, and work tasks.

const COMPANIES = {
  RRM:  { name: 'Render Room',               role: 'moderation duty', start: 120 },
  NACH: { name: 'De Nacho',                  role: 'the nacho line',  start: 45.5 },
  BLU:  { name: "Builder's League United",   role: 'the build crew',  start: 78.25 },
  BNW:  { name: 'Business Numbers Working',  role: 'number crunching', start: 12.8 },
  BSTG: { name: 'Bastardly Glory',           role: 'playtesting',     start: 50 }
};

const WORK_COOLDOWN_MS = 15 * 60 * 1000;
const QUIT_LOCK_MS = 24 * 60 * 60 * 1000;
const ABANDON_MS = 60 * 1000;   // an unanswered task is cleared after this
const BASE_PAY = 35;

// Rank and pay multiplier from shifts worked
function rank(shifts) {
  if (shifts >= 50) return { name: 'Executive', mult: 2 };
  if (shifts >= 25) return { name: 'Manager', mult: 1.5 };
  if (shifts >= 10) return { name: 'Employee', mult: 1.25 };
  return { name: 'Intern', mult: 1 };
}

// Promotion message when a shift count is reached
const PROMOTIONS = {
  10: '🎉 **Promoted to Employee!** Pay is now 1.25x.',
  25: '🎉 **Promoted to Manager!** Pay is now 1.5x.',
  50: '🎉 **Promoted to Executive!** Pay is now 2x.'
};

const BLU_ORDERS = [
  ['roof walls foundation', 'foundation walls roof'],
  ['walls roof foundation', 'foundation walls roof'],
  ['roof foundation walls', 'foundation walls roof'],
  ['paint drywall frame', 'frame drywall paint'],
  ['drywall paint frame', 'frame drywall paint'],
  ['paint frame drywall', 'frame drywall paint']
];

const RRM_POSTS = [
  ['FREE NITRO click my link now', 'ban'],
  ['anyone want to play later?', 'ok'],
  ['you are all trash and should leave', 'ban'],
  ['whats the RRM price today', 'ok'],
  ['spamspamspamspamspamspamspam', 'ban'],
  ['just made Manager at De Nacho lets go', 'ok'],
  ['DM me for cheap Polygons for real money', 'ban'],
  ['gm everyone', 'ok']
];

// A work task for a job. rush = true gives the shorter rush-round wording.
// Returns { q: the prompt, ans: the expected reply (lowercase), choices?: [{ label, value }] }.
// Tasks with choices get buttons; typing the answer works for every task.
function task(job, rush, random = Math.random) {
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));
  const pick = (arr) => arr[Math.floor(random() * arr.length)];
  let q;
  let ans;
  let choices;

  if (job === 'NACH') {
    ans = `${int(1, 5)} cheese ${int(1, 4)} jalapeno ${pick(['salsa', 'guac', 'beans', 'sour cream'])}`;
    q = rush ? `🧀 Type it back exactly:\n\`${ans}\`` : `🧀 **De Nacho, order up!** Type it back exactly:\n\`${ans}\``;
  } else if (job === 'BNW') {
    if (rush) {
      const x = int(12, 91);
      const y = int(13, 92);
      ans = x + y;
      q = `📊 What is **${x} + ${y}**?`;
    } else {
      const op = pick(['plus', 'minus', 'times']);
      let x; let y; let sign;
      if (op === 'plus') { x = int(23, 99); y = int(12, 90); ans = x + y; sign = '+'; }
      else if (op === 'minus') { x = int(50, 99); y = int(11, 49); ans = x - y; sign = '−'; }
      else { x = int(12, 30); y = int(3, 10); ans = x * y; sign = '×'; }
      q = `📊 **BNW needs these numbers, fast:** what is **${x} ${sign} ${y}**?`;
    }
  } else if (job === 'BLU') {
    const [shown, right] = pick(BLU_ORDERS);
    ans = right;
    // Three possible orders to pick from: the right one and two wrong ones, shuffled
    const words = right.split(' ');
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]].map((o) => o.map((i) => words[i]).join(' '));
    const wrong = perms.filter((x) => x !== right).sort(() => random() - 0.5).slice(0, 2);
    choices = [right, ...wrong].sort(() => random() - 0.5).map((x) => ({ label: x, value: x }));
    q = rush ? `🏗️ Put these steps in the right order:\n\`${shown}\``
      : `🏗️ **BLU build crew:** put these steps in the right order:\n\`${shown}\``;
  } else if (job === 'RRM') {
    const [post, right] = pick(RRM_POSTS);
    ans = right;
    choices = [{ label: 'Ban', value: 'ban', style: 'red' }, { label: 'OK', value: 'ok', style: 'green' }];
    q = rush ? `🛡️ A member posted:\n> ${post}\nBan them, or OK?`
      : `🛡️ **Render Room mod queue.** A member posted:\n> ${post}\nBan them, or OK?`;
  } else if (job === 'BSTG') {
    const g = int(1, 8);
    const bug = pick(['👾', '🟪', '⬛', '🟥', '🟨']);
    const row = Array.from({ length: 8 }, (_, i) => (i + 1 === g ? bug : '🟩')).join('');
    ans = g;
    choices = Array.from({ length: 8 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) }));
    q = rush ? `🎮 Another bug report! Which tile is glitched? (1-8):\n${row}`
      : `🎮 **Bastardly Glory playtest.** The build ships soon. Which tile is glitched? (1-8, left to right):\n${row}`;
  }
  return { q, ans: String(ans).toLowerCase(), choices };
}

module.exports = { COMPANIES, WORK_COOLDOWN_MS, QUIT_LOCK_MS, ABANDON_MS, BASE_PAY, rank, PROMOTIONS, task };
