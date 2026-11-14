// Work tasks: three kinds per company, harder at higher ranks. A task is plain data (no functions),
// so it can be stored in a session and graded after a restart.
import type { Rng } from '../core/rng';
import { JOB_RULES } from './jobs';

export type Grade =
  | { type: 'exact'; value: string }
  | { type: 'oneOf'; values: string[] }
  | { type: 'near'; value: number; tolerance: number };

export interface Choice { label: string; value: string; style?: 'primary' | 'secondary' | 'success' | 'danger'; emoji?: string }

export interface Task {
  kind: string;
  prompt: string;
  /** Shown instead of the prompt after hideMs (memory tasks). */
  hidden?: string;
  hideMs?: number;
  limitSec: number;
  /** How the right answer is shown when someone gets it wrong. */
  shown: string;
  grade: Grade;
  choices?: Choice[];
  perRow?: number;
  /** Press several buttons in order; steps is the right order. */
  steps?: string[];
}

export const normalize = (s: string): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export function isRight(task: Task, answer: string): boolean {
  const a = normalize(answer);
  const g = task.grade;
  if (g.type === 'exact') return a === g.value;
  if (g.type === 'oneOf') return g.values.includes(a);
  const v = Number(a.replace(/[%\s+]/g, ''));
  return Number.isFinite(v) && Math.abs(v - g.value) <= g.tolerance;
}

// ---------------------------------------------------------------- content

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
const RRM_RULES: [string, string[]][] = [
  ['Spam', ['spamspamspamspamspamspam', 'posting the same meme in every channel', '@everyone @everyone @everyone']],
  ['Be respectful', ['you are all trash and should leave', 'nobody likes you, quit', 'imagine being this bad at the market']],
  ['No scams', ['DM me for cheap Polygons for real money', 'FREE NITRO click my link now', 'send me 500 Polygons, I will send back 1000']],
  ['Stay on topic', ['anyway here is my 40 paragraph fanfic in #market', 'who wants to talk about taxes in #nacho-pics', 'posting my grocery list in #announcements']]
];
const NACH_ITEMS: [string, string][] = [['cheese', '🧀'], ['jalapeno', '🌶️'], ['salsa', '🍅'], ['guac', '🥑'], ['beans', '🫘'], ['sour cream', '🥛'], ['chips', '🌽']];
const BLU_ORDERS: [string, string][] = [
  ['roof walls foundation', 'foundation walls roof'], ['walls roof foundation', 'foundation walls roof'],
  ['paint drywall frame', 'frame drywall paint'], ['drywall paint frame', 'frame drywall paint']
];
const BLU_ORDERS_4 = ['survey dig pour frame', 'frame wire drywall paint', 'plan dig foundation walls', 'walls roof windows paint'];
const BLU_TOOLS: [string, string][] = [['hammering in nails', 'hammer'], ['cutting a plank', 'saw'], ['tightening a bolt', 'wrench'],
  ['making a hole for a screw', 'drill'], ['checking a shelf is straight', 'level'], ['spreading mortar', 'trowel']];
const BSTG_BUGS: [string, string][] = [['🟩', '👾'], ['🟩', '🟥'], ['🟦', '🟪'], ['⬜', '⬛'], ['🟩', '🟢'], ['🟦', '🔵']]; // later ones are sneakier
const ARROWS: [string, string][] = [['up', '⬆️'], ['down', '⬇️'], ['left', '⬅️'], ['right', '➡️']];

export const KINDS: Record<string, string[]> = {
  RRM: ['queue', 'links', 'rule'], NACH: ['order', 'memory', 'count'], BLU: ['steps', 'bricks', 'tool'],
  BNW: ['math', 'sheet', 'percent'], BSTG: ['tile', 'grid', 'repro']
};
const MEMORY_KINDS = ['memory', 'repro'];

export interface TaskOptions {
  rush?: boolean;
  /** The worker's rank, 0-3: higher ranks get harder versions. */
  tier?: number;
  /** For BNW's percent task: a real price from about an hour ago, if available. */
  priceHistory?: { ticker: string; hourAgo: number; now: number };
  /** Force a kind (tests). */
  kind?: string;
}

export function makeTask(style: string, rng: Rng, opts: TaskOptions = {}): Task {
  const { rush = false, tier: t = 0 } = opts;
  const tier = Math.max(0, Math.min(3, t));
  const kinds = KINDS[style] ?? KINDS.RRM!;
  const usable = rush ? kinds.filter((k) => !MEMORY_KINDS.includes(k)) : kinds;
  const kind = opts.kind && kinds.includes(opts.kind) ? opts.kind : rng.pick(usable);
  const head = (s: string) => (rush ? '' : s + ' ');
  const limitSec = rush ? JOB_RULES.limits.rush : JOB_RULES.limits.task;
  const exact = (v: string): Grade => ({ type: 'exact', value: normalize(v) });

  switch (kind) {
    // ---------------- Render Room ----------------
    case 'queue': {
      const options = tier >= 1 ? ['ban', 'warn', 'ok'] as const : ['ban', 'ok'] as const;
      const right = rng.pick(options);
      return { kind, limitSec, grade: exact(right), shown: right === 'ok' ? 'OK' : right,
        prompt: `🛡️ ${head('**Render Room mod queue.**')}A member posted:\n> ${rng.pick(RRM_POSTS[right])}\n${tier >= 1 ? 'Ban, warn, or OK?' : 'Ban them, or OK?'}`,
        choices: options.map((o) => ({ label: o === 'ok' ? 'OK' : o[0]!.toUpperCase() + o.slice(1), value: o, style: o === 'ban' ? 'danger' : o === 'ok' ? 'success' : 'primary' })) };
    }
    case 'links': {
      const safe = rng.pick(RRM_LINKS.safe);
      const list = rng.shuffle([safe, ...rng.shuffle(RRM_LINKS.fake).slice(0, 2 + tier)]);
      const n = String(list.indexOf(safe) + 1);
      return { kind, limitSec, grade: { type: 'oneOf', values: [n, normalize(safe)] }, shown: `${n}. ${safe}`,
        prompt: `🛡️ ${head('**Render Room:**')}someone asks which link is safe. Which one is the **real** one?\n${list.map((l, i) => `**${i + 1}.** \`${l}\``).join('\n')}`,
        choices: list.map((_, i) => ({ label: String(i + 1), value: String(i + 1) })) };
    }
    case 'rule': {
      const rules = rng.shuffle(RRM_RULES).slice(0, tier >= 2 ? 4 : 3);
      const [right, posts] = rng.pick(rules);
      return { kind, limitSec, grade: exact(right), shown: right,
        prompt: `🛡️ ${head('**Render Room:**')}which rule does this break?\n> ${rng.pick(posts)}`,
        choices: rules.map(([r]) => ({ label: r, value: normalize(r) })) };
    }
    // ---------------- De Nacho ----------------
    case 'order': {
      const parts = [`${rng.int(1, 5)} cheese`, `${rng.int(1, 4)} jalapeno`, rng.pick(['salsa', 'guac', 'beans', 'sour cream'])];
      if (tier >= 2) parts.push(rng.pick(['extra chips', 'no onions', 'light salt', 'double guac']));
      if (tier >= 3) parts.splice(1, 0, `${rng.int(2, 6)} beans`);
      const ans = parts.join(' ');
      return { kind, limitSec, grade: exact(ans), shown: ans, prompt: `🧀 ${head('**De Nacho, order up!**')}Type it back exactly:\n\`${ans}\`` };
    }
    case 'memory': {
      const order = Array.from({ length: 3 + Math.min(tier, 2) }, () => rng.pick(NACH_ITEMS));
      const steps = order.map(([w]) => w);
      const hideMs = tier >= 3 ? 3000 : 4000;
      return { kind, limitSec: JOB_RULES.limits.memory, grade: exact(steps.join(' ')), shown: steps.join(', '), steps, hideMs,
        prompt: `🧠 **De Nacho, memory order!** Remember it; it disappears in ${hideMs / 1000} seconds:\n## ${order.map(([, e]) => e).join(' ')}\n-# ${steps.join(', ')}`,
        hidden: `🧠 **De Nacho, memory order!** Build it from memory: press the ingredients **in order**.\n## ${order.map(() => '❔').join(' ')}`,
        choices: NACH_ITEMS.map(([w, e]) => ({ label: w, value: w, emoji: e })) };
    }
    case 'count': {
      const item = rng.pick(['cheese', 'jalapeno', 'salsa']);
      const orders = Array.from({ length: 3 + Math.min(tier, 2) }, () => {
        const a = rng.int(0, 3 + tier), b = rng.int(0, 3);
        const side = `${b || 1} ${rng.pick(['guac', 'beans', 'chips'])}`;
        return [a, a ? `${a} ${item} ${side}` : side] as const;
      });
      const total = String(orders.reduce((s, [a]) => s + a, 0));
      return { kind, limitSec, grade: exact(total), shown: total,
        prompt: `🧀 ${head('**De Nacho inventory check.**')}How many **${item}** are in these orders, in total?\n${orders.map(([, o]) => `• \`${o}\``).join('\n')}` };
    }
    // ---------------- Builder's League United ----------------
    case 'steps': {
      let shown: string, right: string;
      if (tier >= 2) { right = rng.pick(BLU_ORDERS_4); shown = rng.shuffle(right.split(' ')).join(' '); if (shown === right) shown = right.split(' ').reverse().join(' '); }
      else [shown, right] = rng.pick(BLU_ORDERS);
      const perms = new Set([right]);
      while (perms.size < 3) perms.add(rng.shuffle(right.split(' ')).join(' '));
      const opts = rng.shuffle([...perms]);
      return { kind, limitSec, grade: { type: 'oneOf', values: [normalize(right), String(opts.indexOf(right) + 1)] }, shown: right,
        prompt: `🏗️ ${head('**BLU build crew:**')}put these steps in the right order:\n\`${shown}\``,
        choices: opts.map((x, i) => ({ label: x, value: String(i + 1) })) };
    }
    case 'bricks': {
      const per = rng.int(4, 8 + tier * 4), rows = rng.int(3, 6 + tier * 3), extra = tier >= 2 ? rng.int(2, 9) : 0;
      const ans = String(per * rows + extra);
      return { kind, limitSec, grade: exact(ans), shown: ans,
        prompt: `🧱 ${head('**BLU supply run.**')}A wall is **${rows}** rows of **${per}** bricks${extra ? `, plus **${extra}** spares` : ''}. How many bricks do you order?` };
    }
    case 'tool': {
      const opts = rng.shuffle(BLU_TOOLS).slice(0, 3 + tier);
      const [what, tool] = rng.pick(opts);
      return { kind, limitSec, grade: exact(tool), shown: tool,
        prompt: `🔧 ${head('**BLU build crew:**')}which tool do you grab for **${what}**?`,
        choices: rng.shuffle(opts).map(([, x]) => ({ label: x, value: x })) };
    }
    // ---------------- Business Numbers Working ----------------
    case 'math': {
      const op = rush ? 'plus' : rng.pick(tier >= 1 ? ['plus', 'minus', 'times'] : ['plus', 'minus']);
      const big = 1 + tier;
      let x: number, y: number, ans: number, sign: string;
      if (op === 'plus') { x = rng.int(12, 50 * big); y = rng.int(12, 40 * big); ans = x + y; sign = '+'; }
      else if (op === 'minus') { x = rng.int(50, 60 * big); y = rng.int(11, 49); ans = x - y; sign = '−'; }
      else { x = rng.int(12, 15 + 10 * tier); y = rng.int(3, 6 + 2 * tier); ans = x * y; sign = '×'; }
      if (tier >= 3 && !rush) {
        const z = rng.int(5, 30);
        return { kind, limitSec, grade: exact(String(ans + z)), shown: String(ans + z), prompt: `📊 **BNW needs these numbers, fast:** what is **${x} ${sign} ${y} + ${z}**?` };
      }
      return { kind, limitSec, grade: exact(String(ans)), shown: String(ans), prompt: `📊 ${head('**BNW needs these numbers, fast:**')}what is **${x} ${sign} ${y}**?` };
    }
    case 'sheet': {
      const n = tier >= 3 ? 5 : 4;
      const bad = rng.int(1, n);
      const lines = Array.from({ length: n }, (_, i) => {
        const a = rng.int(10, 60 + tier * 40), b = rng.int(10, 60 + tier * 40);
        const off = tier >= 2 ? rng.pick([1, -1, 10, -10]) : rng.pick([7, -6, 9, -11]);
        return `Row ${i + 1}  ${a} + ${b} = ${a + b + (i + 1 === bad ? off : 0)}`;
      });
      return { kind, limitSec, grade: { type: 'oneOf', values: [String(bad), `row ${bad}`, `row${bad}`] }, shown: `Row ${bad}`,
        prompt: `📊 ${head('**BNW audit.**')}One row of this spreadsheet is wrong. Which one?\n\`\`\`\n${lines.join('\n')}\n\`\`\``,
        choices: Array.from({ length: n }, (_, i) => ({ label: `Row ${i + 1}`, value: String(i + 1) })) };
    }
    case 'percent': {
      let from: number, to: number, who: string;
      const h = opts.priceHistory;
      if (h && h.hourAgo > 1 && Math.abs(h.now / h.hourAgo - 1) >= 0.005) {
        from = h.hourAgo; to = h.now;
        who = `**${h.ticker}** was ⬡${from.toFixed(2)} an hour ago and is ⬡${to.toFixed(2)} now`;
      } else {
        from = rng.int(10, 90); to = Math.round(from * (1 + rng.int(-40, 60) / 100) * 100) / 100;
        if (to === from) to = from + 1;
        who = `A stock went from ⬡${from.toFixed(2)} to ⬡${to.toFixed(2)}`;
      }
      const pct = (to / from - 1) * 100;
      return { kind, limitSec, grade: { type: 'near', value: pct, tolerance: tier >= 2 ? 0.5 : 1 }, shown: `about ${Math.round(pct)}%`,
        prompt: `📈 ${head('**BNW analyst desk.**')}${who}. By what **percent** did it change? (nearest whole number, use - for a drop)` };
    }
    // ---------------- Bastardly Glory ----------------
    case 'tile': {
      const g = rng.int(1, 8);
      const [ok, bug] = BSTG_BUGS[Math.min(BSTG_BUGS.length - 1, rng.int(0, 1) + tier)]!;
      return { kind, limitSec, grade: exact(String(g)), shown: String(g),
        prompt: `🎮 ${head('**Bastardly Glory playtest.** The build ships soon.')}Which tile is glitched? (1-8, left to right):\n${Array.from({ length: 8 }, (_, i) => (i + 1 === g ? bug : ok)).join('')}`,
        choices: Array.from({ length: 8 }, (_, i) => ({ label: String(i + 1), value: String(i + 1) })), perRow: 4 };
    }
    case 'grid': {
      const size = tier >= 2 ? 4 : 3;
      const [ok, bug] = BSTG_BUGS[Math.min(BSTG_BUGS.length - 1, rng.int(0, 1) + tier)]!;
      const cell = rng.int(0, size * size - 1);
      const name = (i: number) => 'ABCD'[Math.floor(i / size)]! + ((i % size) + 1);
      const grid = Array.from({ length: size }, (_, r) => `\`${'ABCD'[r]}\` ` + Array.from({ length: size }, (_, c) => (r * size + c === cell ? bug : ok)).join('')).join('\n');
      return { kind, limitSec, grade: exact(name(cell)), shown: name(cell),
        prompt: `🎮 ${head('**Bastardly Glory playtest.**')}Find the glitched tile (rows ${'ABCD'.slice(0, size).split('').join(', ')}, columns 1-${size}):\n${grid}`,
        choices: Array.from({ length: size * size }, (_, i) => ({ label: name(i), value: name(i).toLowerCase() })), perRow: size };
    }
    case 'repro': {
      const seq = Array.from({ length: 3 + tier }, () => rng.pick(ARROWS));
      const steps = seq.map(([w]) => w);
      const hideMs = tier >= 3 ? 3000 : 4000;
      return { kind, limitSec: JOB_RULES.limits.memory, grade: exact(steps.join(' ')), shown: steps.join(', '), steps, hideMs,
        prompt: `🎮 **Bastardly Glory bug report:** the game crashes after this combo. Remember it; it disappears in ${hideMs / 1000} seconds:\n## ${seq.map(([, e]) => e).join(' ')}`,
        hidden: `🎮 **Reproduce the bug.** Press the combo **in order**.\n## ${seq.map(() => '❔').join(' ')}`,
        choices: ARROWS.map(([w, e]) => ({ label: w, value: w, emoji: e })) };
    }
  }
  return makeTask('RRM', rng, { ...opts, kind: undefined });
}
