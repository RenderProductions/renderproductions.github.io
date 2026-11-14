// Chat pay and TODD drop-ins: the bot pays people for hanging out in the server.
//   Chat pay: a few Polygons for a real message (not a command, not the same thing twice), at most once a
//   minute, up to ⬡300 a day per server, only for players who have used the bot. Paid from the Reserve.
//   Drop-ins: every so often, while a channel is busy, TODD barges in with a question; the first right
//   answer wins the pot. Mods can switch them off or pin them to one channel (/dropin).
import { awardHere, bump } from '../achievements/achievements';
import type { Ctx } from '../commands/types';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { dayKey, MINUTE } from '../core/time';
import type { MarketData } from '../market/engine';

export const CHATTER = {
  chat: { min: polygons(5), max: polygons(15), cooldownMs: MINUTE, perDay: polygons(300), minLength: 4 },
  drop: { chance: 0.03, gapMs: 45 * MINUTE, answerMs: MINUTE, potMin: 300, potMax: 800 }
};

/** World events can multiply chat pay (Gossip Hour: double pay, double cap). */
let chatMult: (db: Db) => number = () => 1;
export const setChatMultiplier = (fn: (db: Db) => number): void => { chatMult = fn; };

const norm = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');

/** Pays for one message if it counts. Returns the cents paid (0 if it didn't). */
export function chatPay(ctx: Ctx, text: string): Cents {
  const R = CHATTER.chat, g = ctx.guildId!;
  const clean = text.trim();
  if (clean.length < R.minLength) return 0;
  const p = ctx.db.get<{ frozen: number }>('SELECT frozen FROM players WHERE guild_id = ? AND user_id = ?', g, ctx.user.id);
  if (!p || p.frozen) return 0;
  const today = dayKey(ctx.now);
  const row = ctx.db.get<{ day: string; paid: number; last_at: number; last_text: string | null }>('SELECT day, paid, last_at, last_text FROM chat_pay WHERE guild_id = ? AND user_id = ?', g, ctx.user.id);
  const paidToday = row && row.day === today ? row.paid : 0;
  const x = chatMult(ctx.db);
  if (row && ctx.now - row.last_at < R.cooldownMs) return 0;
  if (row && row.last_text === clean.toLowerCase()) return 0;
  const room = R.perDay * x - paidToday;
  if (room <= 0) return 0;
  const want = Math.min(room, ctx.rng.int(R.min, R.max) * x);
  const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet(g, ctx.user.id), cents: want, reason: 'chat', guildId: g, actorId: ctx.user.id, now: ctx.now });
  ctx.db.run(`INSERT INTO chat_pay (guild_id, user_id, day, paid, last_at, last_text) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id, user_id) DO UPDATE SET day = excluded.day, paid = excluded.paid, last_at = excluded.last_at, last_text = excluded.last_text`,
    g, ctx.user.id, today, paidToday + paid, ctx.now, clean.toLowerCase());
  if (paid > 0 && bump(ctx.db, ctx.user.id, 'chat_pay', paid) >= polygons(2500)) awardHere('chatterbox');
  return paid;
}

// ---------------------------------------------------------------- drop-ins

const WORDS = ['polygon', 'dividend', 'reserve', 'broker', 'marquez', 'bailout', 'shareholder', 'conglomerate', 'jackpot', 'lottery', 'bankrupt',
  'blackjack', 'minesweeper', 'rocket', 'derby', 'paycheck', 'overtime', 'promotion', 'savings', 'interest', 'portfolio', 'collectible', 'achievement', 'leaderboard'];
const PHRASES = ['todd is always watching', 'buy high sell low', 'the house always wins', 'i love my job', 'polygons please', 'stonks only go up', 'diamond hands', 'to the moon', 'marquez has the goods', 'pay me back'];
const TRIVIA: [string, string[], string][] = [
  ['Who runs the shop?', ['marquez'], 'Marquez'],
  ['How many Polygons does a daily give? (just the number)', [String(economy.dailyAmount / 100)], String(economy.dailyAmount / 100)],
  ['How many shares of one company can a broker manage at most?', ['25'], '25'],
  ['What happens to the market when the Polygon Reserve hits zero?', ['crash', 'acrash'], 'A crash'],
  ['What is the fee on a gift, in percent? (just the number)', ['5'], '5'],
  ['Which Rend-Sino game has you guess red or black, then higher or lower, then inside or outside, then the suit?', ['ridethebus', 'bus'], 'Ride the Bus']
];

export interface Question { q: string; answers: string[]; shown: string }

export function question(m: MarketData | null, rng: Rng): Question {
  const kinds = ['math', 'scramble', 'type', 'trivia', ...(m?.companies.length ? ['ticker', 'top'] : [])];
  const kind = rng.pick(kinds);
  if (kind === 'math') { const a = rng.int(3, 12), b = rng.int(3, 12), c = rng.int(1, 50); return { q: `Quick maths: **${a} × ${b} + ${c}**`, answers: [String(a * b + c)], shown: String(a * b + c) }; }
  if (kind === 'scramble') {
    const w = rng.pick(WORDS);
    let s = w;
    for (let i = 0; i < 10 && s === w; i++) s = rng.shuffle(w.split('')).join('');
    if (s === w) s = w.split('').reverse().join('');
    return { q: `Unscramble this: **${s.toUpperCase()}**`, answers: [w], shown: w };
  }
  if (kind === 'type') { const p = rng.pick(PHRASES); return { q: `First one to type **${p}** wins.`, answers: [norm(p)], shown: p }; }
  if (kind === 'ticker') { const c = rng.pick(m!.companies); return { q: `What is the ticker for **${c.name}**?`, answers: [norm(c.id)], shown: c.id }; }
  if (kind === 'top') {
    const top = [...m!.companies].sort((x, y) => Number(m!.prices[y.id]) - Number(m!.prices[x.id]))[0]!;
    return { q: 'Which main company\'s stock is the **most expensive** right now? (the ticker)', answers: [norm(top.id), norm(top.name)], shown: top.id };
  }
  const [q, answers, shown] = rng.pick(TRIVIA);
  return { q, answers: answers.map(norm), shown };
}

// Drop-ins last a minute, so they live in memory: a restart costs at most one drop-in.
interface Drop extends Question { pot: Cents; guildId: string; endsAt: number }
const active = new Map<string, Drop>();
const lastDrop = new Map<string, number>();

export const dropinsOff = (db: Db, g: string): boolean => db.meta(`dropins.off:${g}`) === '1';
export const dropinHome = (db: Db, g: string): string => db.meta(`dropins.channel:${g}`) ?? '';
export const setDropinsOff = (db: Db, g: string, off: boolean): void => db.setMeta(`dropins.off:${g}`, off ? '1' : '0');
export const setDropinHome = (db: Db, g: string, channelId: string): void => db.setMeta(`dropins.channel:${g}`, channelId);

/** Should TODD drop in here now? (rolls the chance, respects the gap, the switch and the home channel) */
export function shouldDrop(db: Db, g: string, channelId: string, now: number, rng: Rng): boolean {
  if (dropinsOff(db, g) || active.has(channelId)) return false;
  const home = dropinHome(db, g);
  if (home && home !== channelId) return false;
  if (now - (lastDrop.get(g) ?? 0) < CHATTER.drop.gapMs) return false;
  return rng.chance(CHATTER.drop.chance);
}

export function startDrop(m: MarketData | null, g: string, channelId: string, now: number, rng: Rng): Drop {
  const drop: Drop = { ...question(m, rng), pot: polygons(Math.round(rng.int(CHATTER.drop.potMin, CHATTER.drop.potMax) / 10) * 10), guildId: g, endsAt: now + CHATTER.drop.answerMs };
  active.set(channelId, drop);
  lastDrop.set(g, now);
  return drop;
}

/** Ends an unanswered drop-in. Returns it, or null if it was already answered. */
export function expireDrop(channelId: string, drop: Drop): Drop | null {
  if (active.get(channelId) !== drop) return null;
  active.delete(channelId);
  return drop;
}

/** Checks a message against a drop-in in its channel. Returns the win message, or null. */
export function answerDrop(ctx: Ctx, text: string): string | null {
  const drop = ctx.channelId ? active.get(ctx.channelId) : undefined;
  if (!drop || ctx.now > drop.endsAt || !drop.answers.includes(norm(text))) return null;
  active.delete(ctx.channelId!);
  const got = payFromReserve(ctx.db, economy.reserveStart, { to: wallet(ctx.guildId!, ctx.user.id), cents: drop.pot, reason: 'dropin', guildId: ctx.guildId, actorId: ctx.user.id, now: ctx.now });
  awardHere('quick_draw');
  bump(ctx.db, ctx.user.id, 'dropins_won');
  return `**${ctx.user.name}** answered first. The answer was **${drop.shown}**. **+${format(got)}**`;
}
