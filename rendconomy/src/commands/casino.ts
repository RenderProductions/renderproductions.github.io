// The Rend-Sino's games. Instant games settle in one step; interactive ones keep their state in a stored
// session (kind "casino.<game>"), so their buttons survive restarts and each press is handled once.
import { isParty } from '../birthday/birthday';
import { bigNumber } from '../discord/icons';
import type { APIEmbed } from 'discord.js';
import { award, awardHere } from '../achievements/achievements';
import { CASINO, NAMES, ODDS, VIP, cardBack, checkBet, cardText, deck, freeSpinsLeft, happyHour, jackpotOf, mult, settle, takeBet, useFreeSpin, vipOf, winJackpot, type Card, type Game } from '../casino/core';
import { isBuilt } from '../estate/landmarks';
import { player } from '../core/economy';
import { economy } from '../config';
import { discordTime } from '../core/time';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { COLORS } from '../discord/style';
import { line, teaser } from '../discord/flavor';
import { emoji, emojiOr, hasEmoji, type EmojiKey } from '../discord/emoji';
import { useEffect } from '../shop/inventory';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

const card = (game: Game, lines: (string | null | false | undefined)[], tone: 'play' | 'win' | 'loss' | 'push' = 'play'): APIEmbed => ({
  title: NAMES[game],
  description: lines.filter((l) => l !== null && l !== false && l !== undefined).join('\n'),
  color: tone === 'win' ? 0x57f287 : tone === 'loss' ? COLORS.error : tone === 'push' ? 0xfee75c : COLORS.casino
});
const toneOf = (bet: Cents, paid: Cents) => (paid > bet ? 'win' : paid === bet ? 'push' : 'loss') as 'win' | 'loss' | 'push';
/** The closing lines of an instant game: what happened to the bet, a word from the house, the balance. */
function outcome(ctx: Ctx, _guildId: string, bet: Cents, paid: Cents, extra: string[]): string[] {
  const big = paid >= bet * 8;
  const verdict = paid > bet ? `🎉 **You win ${format(paid)}!** ${big ? line(ctx.rng, 'bigWin') : line(ctx.rng, 'win')}`
    : paid === bet ? `🤝 **Push.** Your ${format(bet)} comes back.`
    : paid > 0 ? `↩️ You get ${format(paid)} back of your ${format(bet)}.`
    : `💸 **You lose ${format(bet)}.** ${line(ctx.rng, 'loss')}`;
  return ['', verdict, ...extra];   // settle() adds the balance
}
const betOption = (game: Game) => ({ name: 'amount', type: 'string' as const, description: `Your bet, ${format(CASINO.minBet)} to ${format(CASINO.maxBet[game])}, or "max"`, required: true });

// ---------------------------------------------------------------- instant games

const SYMBOLS = ['🍒', '🍋', '🔔', '🔺', '💎'];
const TRIPLE: Record<string, number> = { '💎': 25, '🔺': 10, '🔔': 8, '🍋': 5, '🍒': 3 };
/** How a reel symbol is shown: the bot's own emoji once uploaded (the game itself works on the plain ones). */
const REEL: Record<string, EmojiKey> = { '🍒': 'cherry', '🍋': 'lemon', '🔔': 'bell', '🔺': 'triangle', '💎': 'diamond' };
const show = (sym: string): string => (sym === '🍒' && isParty() ? emojiOr('cake', '🎂') : emoji(REEL[sym]!));
/** Any text with reel symbols in it, shown with the bot's emojis. */
const showAll = (text: string): string => text.replace(/🍒|🍋|🔔|🔺|💎/gu, (s) => show(s));

export const slots: Command = {
  name: 'slots', aliases: ['slot'], description: 'Spin the Rend-Sino slot machine', system: 'casino', guildOnly: true,
  options: [betOption('slots')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'slots', args.amount);
      const [x, y, z] = [ctx.rng.pick(SYMBOLS), ctx.rng.pick(SYMBOLS), ctx.rng.pick(SYMBOLS)];
      const win = x === y && y === z ? bet * TRIPLE[x]! : x === y || y === z || x === z ? bet : 0;
      const r = settle(ctx, guildId, 'slots', bet, win);
      const jackpot = x === '💎' && y === '💎' && z === '💎' ? winJackpot(ctx, guildId, bet) : 0;
      const what = x === y && y === z ? (x === '💎' ? `${show('💎')} **DIAMONDS!** Three of a kind.${jackpot ? `\n## 💎 PROGRESSIVE JACKPOT: +${format(jackpot)}!` : ''}` : `Three ${show(x)}! Pays ${TRIPLE[x]}x.`) : win ? 'A pair.' : 'No match.';
      // The reels blur, then stop one at a time, left to right
      const blur = () => ctx.rng.pick(SYMBOLS);
      const frame = (a: string, b: string, c: string, text: string, ms: number) => ({ embeds: [card('slots', [`## [ ${show(a)} | ${show(b)} | ${show(c)} ]`, text])], ms });
      // a loss can be redeemed: one free spin of 15 reels, 7 of a kind wins the bet back
      const offer = win === 0 ? sessions.create(ctx.db, { kind: 'redeem.slots', guildId: ctx.guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { bet } as RD, ttlMs: REDEEM.windowMs, now: ctx.now }) : null;
      return {
        embeds: [card('slots', [`## [ ${show(x!)} | ${show(y!)} | ${show(z!)} ]`, what, ...outcome(ctx, guildId, bet, r.paid, r.lines),
          offer ? `-# ${emoji('slots')} **Redeem yourself:** one free spin of 15 reels. Land ${REDEEM.need} of a kind and your ${format(bet)} comes back.` : null,
          `-# 💎 Progressive jackpot: **${format(jackpotOf(ctx.db, guildId))}**${happyHour(ctx.db, ctx.now, guildId) ? ' · 🥂 Happy Hour' : ''}`], toneOf(bet, win))],
        ...(offer ? { buttons: [[{ label: 'Redeem yourself', emoji: '🙏', id: sessions.buttonId(offer.id, 'go'), style: 'primary' as const }]], session: offer.id, later: { ms: REDEEM.windowMs - 3000, edit: { buttons: [] } } } : {}),
        teaser: {
          ...frame(blur(), blur(), blur(), `${line(ctx.rng, 'reels')} ${emoji('slots')}`, 700),
          frames: [frame(x, blur(), blur(), 'The first reel stops...', 800), frame(x, y, blur(), x === y ? `Two ${show(x)}... 👀` : 'The second reel stops...', x === y ? 1200 : 800)]
        }
      };
    });
  }
};

// ----- Redeem yourself (after a losing spin) -----
interface RD { bet: Cents }
export const REDEEM = { reels: 15, need: 7, windowMs: 60_000 };
/** Spins the 15 reels. Returns the board and its best run (the most common symbol). */
export function redeemSpin(pick: () => string): { board: string[]; best: string; count: number } {
  const board = Array.from({ length: REDEEM.reels }, pick);
  const counts = new Map<string, number>();
  for (const s of board) counts.set(s, (counts.get(s) ?? 0) + 1);
  const [best, count] = [...counts].sort((a, b) => b[1] - a[1] || TRIPLE[b[0]]! - TRIPLE[a[0]]!)[0]!;
  return { board, best, count };
}
function onRedeem(ctx: Ctx, s: sessions.Session<RD>, value: string): SessionReply {
  const no = notYours(ctx, s); if (no) return no;
  if (value !== 'go') return {};
  return ctx.db.tx(() => {
    if (!sessions.end(ctx.db, s.id)) return {};
    const bet = s.state.bet, g = s.guild_id!;
    const { board, best, count } = redeemSpin(() => ctx.rng.pick(SYMBOLS));
    const won = count >= REDEEM.need;
    const r = won ? settle(ctx, g, 'slots', bet, bet) : { paid: 0, lines: [] as string[] };
    if (won) awardHere('redemption_arc');
    // 5 columns x 3 rows, as plain emoji text so Discord shows it big; the columns stop left to right
    const blur = () => ctx.rng.pick(SYMBOLS);
    const grid = (cols: number) => [0, 1, 2].map((row) => [0, 1, 2, 3, 4].map((c) => show(c < cols ? board[row * 5 + c]! : blur())).join('')).join('\n');
    const frame = (cols: number, text: string): ReplyObject => ({ content: grid(cols), embeds: [card('slots', [`**Redeem yourself** · ${format(bet)} on the line`, text])], buttons: [] });
    const final: ReplyObject = {
      content: grid(5),
      embeds: [card('slots', [`**Redeem yourself** · ${format(bet)} on the line`,
        won ? `**${count} × ${show(best)}!** Redemption! Your ${format(bet)} comes back.` : `Best run: ${count} × ${show(best)}. ${count === REDEEM.need - 1 ? 'One short! So close.' : 'Not this time.'}`,
        ...(won ? [`-# Paid ${format(r.paid)}.`, ...r.lines.map((l) => `-# ${l}`)] : [`-# The house keeps the ${format(bet)}.`])], won ? 'win' : 'loss')],
      buttons: []
    };
    // the caption counts the best run among the columns that have stopped
    const sofar = (cols: number) => { const seen = board.filter((_, k) => k % 5 < cols); const m = new Map<string, number>(); for (const x of seen) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1])[0]!; };
    const frames = [1, 2, 3, 4].map((c) => { const [sym, n] = sofar(c); return frame(c, n >= 4 ? `${n} × ${show(sym)} so far... ${'👀'.repeat(Math.min(3, n - 3))}` : 'The reels spin...'); });
    let i = 0;
    return { update: { ...frame(0, `${show(blur())} Fifteen reels, one chance...`), live: { everyMs: 900, next: () => (i < frames.length ? frames[i++]! : i++ === frames.length ? final : null) } } };
  });
}

export const coinflip: Command = {
  name: 'coinflip', aliases: ['cf', 'flip'], description: 'Call heads or tails for 1.95x', system: 'casino', guildOnly: true,
  options: [betOption('coinflip'), { name: 'side', type: 'string', description: 'heads or tails (default heads)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const side = String(args.side ?? 'heads').trim().toLowerCase().startsWith('t') ? 'tails' : 'heads';
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'coinflip', args.amount);
      const flip = ctx.rng.chance(0.5) ? 'heads' : 'tails';
      const win = flip === side ? Math.round(bet * 1.95) : 0;
      const r = settle(ctx, guildId, 'coinflip', bet, win);
      return {
        embeds: [card('coinflip', [`You called **${side}**. It's... **${flip}!** ${flip === 'heads' ? '🙂' : '🦅'}`, ...outcome(ctx, guildId, bet, r.paid, r.lines)], toneOf(bet, win))],
        teaser: teaser(NAMES.coinflip, `You call **${side}**. ${line(ctx.rng, 'coinSpin')} ${emoji('coinflip')}`, COLORS.casino)
      };
    });
  }
};

export const dice: Command = {
  name: 'dice', aliases: ['roll'], description: 'Roll 1-100: bet it lands over or under your number', system: 'casino', guildOnly: true,
  options: [betOption('dice'), { name: 'call', type: 'string', description: 'over or under, then 5-95, e.g. "over 70"', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const m = /^(over|under|o|u)\s*(\d+)$/.exec(String(args.call ?? '').trim().toLowerCase());
    if (!m || Number(m[2]) < 5 || Number(m[2]) > 95) throw new GameError('dice.call', 'Call "over" or "under" a number from 5 to 95, for example `over 70`.');
    const over = m[1]!.startsWith('o'), n = Number(m[2]);
    const chance = over ? (100 - n) / 100 : (n - 1) / 100;
    const pays = Math.floor((0.96 / chance) * 100) / 100;
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'dice', args.amount);
      const roll = ctx.rng.int(1, 100);
      const won = over ? roll > n : roll < n;
      const win = won ? Math.round(bet * pays) : 0;
      const r = settle(ctx, guildId, 'dice', bet, win);
      const call = `You bet **${over ? 'over' : 'under'} ${n}** (${Math.round(chance * 100)}% chance, pays **${pays}x**).`;
      return {
        embeds: [card('dice', [call, bigNumber(String(roll)) ? `You rolled...\n## ${bigNumber(String(roll))}` : `You rolled... **${roll}!**`, ...outcome(ctx, guildId, bet, r.paid, r.lines)], toneOf(bet, win))],
        teaser: teaser(NAMES.dice, `${call}\n${line(ctx.rng, 'diceRoll')} ${emoji('dice')}`, COLORS.casino)
      };
    });
  }
};

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const dot = (n: number) => ({ green: '🟢', red: '🔴', black: '⚫' })[colorOf(n)];
/** A pocket: the bot's numbered pocket emoji once uploaded, else a coloured dot and the number. */
const pocket = (n: number): string => emojiOr(`r${n}`, `${dot(n)} ${n}`);
/** The pockets in the order they sit on a European wheel. */
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
/** Five pockets of the wheel around position i, the ball's pocket in the middle. */
function strip(i: number): string {
  const at = (k: number) => WHEEL[((k % WHEEL.length) + WHEEL.length) % WHEEL.length]!;
  return [-2, -1, 0, 1, 2].map((d) => { const v = at(i + d); return d === 0 ? `**[ ${pocket(v)} ]**` : pocket(v); }).join(hasEmoji('r0') ? ' ' : ' · ');
}

function rouletteBet(raw: string): { label: string; pays: number; wins: (n: number) => boolean; straight?: boolean } | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d{1,2}$/.test(t) && Number(t) <= 36) { const k = Number(t); return { label: pocket(k), pays: 36, wins: (n) => n === k, straight: true }; }
  const alias: Record<string, string> = { r: 'red', b: 'black', '1-18': 'low', '19-36': 'high', small: 'low', big: 'high', first: '1st', second: '2nd', third: '3rd' };
  const k = alias[t] ?? t;
  const simple: Record<string, [string, number, (n: number) => boolean]> = {
    red: ['🔴 red', 2, (n) => colorOf(n) === 'red'], black: ['⚫ black', 2, (n) => colorOf(n) === 'black'],
    odd: ['odd', 2, (n) => n > 0 && n % 2 === 1], even: ['even', 2, (n) => n > 0 && n % 2 === 0],
    low: ['low (1-18)', 2, (n) => n >= 1 && n <= 18], high: ['high (19-36)', 2, (n) => n >= 19],
    '1st': ['1st dozen', 3, (n) => n >= 1 && n <= 12], '2nd': ['2nd dozen', 3, (n) => n >= 13 && n <= 24], '3rd': ['3rd dozen', 3, (n) => n >= 25]
  };
  const s = simple[k];
  return s ? { label: s[0], pays: s[1], wins: s[2] } : null;
}

export const roulette: Command = {
  name: 'roulette', aliases: ['rl', 'wheel'], description: 'Bet on red, black, odd, even, low, high, a dozen, or a number', system: 'casino', guildOnly: true,
  options: [betOption('roulette'), { name: 'on', type: 'string', description: 'red, black, odd, even, low, high, 1st, 2nd, 3rd, or 0-36', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const b = rouletteBet(String(args.on ?? ''));
    if (!b) throw new GameError('roulette.on', 'Bet on red, black, odd, even, low, high, 1st, 2nd, 3rd, or a number from 0 to 36.');
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'roulette', args.amount);
      const n = ctx.rng.int(0, 36);
      const won = b.wins(n);
      const win = won ? bet * b.pays : 0;
      const r = settle(ctx, guildId, 'roulette', bet, win);
      if (won && b.straight) awardHere('straight_up');
      // The ball travels around the real wheel order, slowing down, then drops in
      const at = WHEEL.indexOf(n);
      const frame = (back: number, text: string, ms: number) => ({ embeds: [card('roulette', [`You bet on **${b.label}**.`, strip(at - back), text])], ms });
      return {
        embeds: [card('roulette', [`You bet on **${b.label}** (pays ${b.pays}x).`, strip(at), `The ball drops into... **${pocket(n)}!**`, ...outcome(ctx, guildId, bet, r.paid, r.lines)], toneOf(bet, win))],
        teaser: { ...frame(14 + ctx.rng.int(0, 5), `${line(ctx.rng, 'wheelSpin')} ${emoji('roulette')}`, 700), frames: [frame(5, 'Slowing down...', 800), frame(1, 'Almost...', 900)] }
      };
    });
  }
};

// ---------------------------------------------------------------- interactive games

function startGame<S>(ctx: Ctx, game: Game, state: S): sessions.Session<S> {
  return sessions.create(ctx.db, { kind: `casino.${game}`, guildId: ctx.guildId, channelId: ctx.channelId, userId: ctx.user.id, state, ttlMs: CASINO.sessionMs, now: ctx.now });
}
const notYours = (ctx: Ctx, s: sessions.Session) => (ctx.user.id !== s.user_id ? { notice: 'This game belongs to another player.' } : null);
const btn = (s: sessions.Session, value: string, label: string, style: Button['style'] = 'secondary', disabled = false): Button => ({ label, id: sessions.buttonId(s.id, value), style, disabled });

// ----- Blackjack -----
interface BJ { bet: Cents; deck: Card[]; hand: Card[]; dealer: Card[]; doubled: boolean }
const rankValue = (c: Card) => (c.r === 14 ? 11 : Math.min(10, c.r));
function handValue(h: Card[]): number {
  let v = h.reduce((s, c) => s + rankValue(c), 0), aces = h.filter((c) => c.r === 14).length;
  while (v > 21 && aces--) v -= 10;
  return v;
}
const natural = (h: Card[]) => h.length === 2 && handValue(h) === 21;
const showHand = (h: Card[]) => h.map(cardText).join(' ');

function bjView(s: sessions.Session<BJ>, line = '', done = false, tone: 'play' | 'win' | 'loss' | 'push' = 'play'): ReplyObject {
  const st = s.state;
  const dealer = done ? `${showHand(st.dealer)} (**${handValue(st.dealer)}**)` : `${cardText(st.dealer[0]!)} ${cardBack()}`;
  const buttons = done ? [] : [[btn(s, 'hit', 'Hit', 'primary'), btn(s, 'stand', 'Stand'), ...(st.hand.length === 2 && !st.doubled ? [btn(s, 'double', `Double (${format(st.bet)})`, 'success')] : [])]];
  return { embeds: [card('blackjack', [`**TODD:** ${dealer}`, `**You:** ${showHand(st.hand)} (**${handValue(st.hand)}**)`, `Bet: ${format(st.bet * (st.doubled ? 2 : 1))}`, line && `\n${line}`], tone)], buttons };
}

function bjFinish(ctx: Ctx, s: sessions.Session<BJ>): ReplyObject {
  const st = s.state;
  const total = st.bet * (st.doubled ? 2 : 1);
  const you = handValue(st.hand);
  let win = 0, line: string;
  if (you > 21) line = `Bust. Lost ${format(total)}.`;
  else {
    while (handValue(st.dealer) < 17) st.dealer.push(st.deck.pop()!);
    const d = handValue(st.dealer);
    if (natural(st.hand) && !natural(st.dealer)) { win = Math.round(st.bet * 2.5); line = `**Blackjack.** Won ${format(win)}.`; awardHere('natural'); }
    else if (d > 21 || you > d) { win = total * 2; line = `${d > 21 ? 'TODD busts.' : 'You beat TODD.'} Won ${format(win)}.`; }
    else if (you === d) { win = total; line = 'Push. The bet is returned.'; }
    else line = `TODD wins with ${d}. Lost ${format(total)}.`;
  }
  const r = settle(ctx, s.guild_id!, 'blackjack', total, win);
  return bjView(s, [line, ...r.lines].join('\n'), true, toneOf(total, win));
}

export const blackjack: Command = {
  name: 'blackjack', aliases: ['bj', '21'], description: 'Blackjack against TODD: hit, stand or double', system: 'casino', guildOnly: true,
  options: [betOption('blackjack')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'blackjack', args.amount);
      const d = deck((l) => ctx.rng.shuffle(l));
      const s = startGame<BJ>(ctx, 'blackjack', { bet, deck: d, hand: [d.pop()!, d.pop()!], dealer: [d.pop()!, d.pop()!], doubled: false });
      sessions.save(ctx.db, s.id, s.state);
      if (natural(s.state.hand)) { sessions.end(ctx.db, s.id); return bjFinish(ctx, s); }
      return { ...bjView(s), session: s.id };
    });
  }
};

function onBlackjack(ctx: Ctx, s: sessions.Session<BJ>, value: string): SessionReply {
  const no = notYours(ctx, s); if (no) return no;
  return ctx.db.tx(() => {
    const st = s.state;
    if (value === 'double') {
      if (st.hand.length !== 2 || st.doubled) return {};
      const w = wallet(s.guild_id!, ctx.user.id);
      if (balance(ctx.db, w) < st.bet) return { notice: `Doubling requires ${format(st.bet)}.` };
      transfer(ctx.db, { from: w, to: RESERVE, cents: st.bet, reason: 'casino.bet', guildId: s.guild_id, actorId: ctx.user.id, now: ctx.now, note: { game: 'blackjack', double: true } });
      st.doubled = true;
      st.hand.push(st.deck.pop()!);
      if (!sessions.end(ctx.db, s.id)) return {};
      return { update: bjFinish(ctx, s) };
    }
    if (value === 'hit') {
      st.hand.push(st.deck.pop()!);
      if (handValue(st.hand) >= 21) { if (!sessions.end(ctx.db, s.id)) return {}; return { update: bjFinish(ctx, s) }; }
      sessions.save(ctx.db, s.id, st, CASINO.sessionMs, ctx.now);
      return { update: bjView(s) };
    }
    if (!sessions.end(ctx.db, s.id)) return {};
    return { update: bjFinish(ctx, s) };
  });
}

// ----- Higher or Lower -----
interface HL { bet: Cents; deck: Card[]; card: Card; streak: number; mult: number }
function hlOdds(st: HL) {
  const hi = st.deck.filter((c) => c.r > st.card.r).length, lo = st.deck.filter((c) => c.r < st.card.r).length;
  return { higher: hi ? (0.96 * (hi + lo)) / hi : 0, lower: lo ? (0.96 * (hi + lo)) / lo : 0 };
}
function hlView(s: sessions.Session<HL>, line = '', done = false, tone: 'play' | 'win' | 'loss' | 'push' = 'play'): ReplyObject {
  const st = s.state, o = hlOdds(st);
  const buttons = done ? [] : [[
    btn(s, 'higher', o.higher ? `Higher (${mult(o.higher)})` : 'Higher', 'primary', !o.higher),
    btn(s, 'lower', o.lower ? `Lower (${mult(o.lower)})` : 'Lower', 'primary', !o.lower),
    btn(s, 'cash', `Cash out ${format(Math.floor(st.bet * st.mult))}`, 'success', st.streak === 0)
  ]];
  return { embeds: [card('hilo', [`## ${cardText(st.card)}`, `Streak: ${st.streak} · Multiplier: ${mult(st.mult)} · Worth: ${format(Math.floor(st.bet * st.mult))}`, 'Ties lose.', line && `\n${line}`], tone)], buttons };
}

export const hilo: Command = {
  name: 'hilo', aliases: ['higherlower', 'hl'], description: 'Higher or Lower: build a streak, cash out before you miss', system: 'casino', guildOnly: true,
  options: [betOption('hilo')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'hilo', args.amount);
      const d = deck((l) => ctx.rng.shuffle(l));
      const s = startGame<HL>(ctx, 'hilo', { bet, deck: d, card: d.pop()!, streak: 0, mult: 1 });
      sessions.save(ctx.db, s.id, s.state);
      return { ...hlView(s), session: s.id };
    });
  }
};

function onHilo(ctx: Ctx, s: sessions.Session<HL>, value: string): SessionReply {
  const no = notYours(ctx, s); if (no) return no;
  return ctx.db.tx(() => {
    const st = s.state;
    if (value === 'cash') {
      if (st.streak === 0 || !sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * st.mult);
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, win);
      return { update: hlView(s, [`Cashed out at ${mult(st.mult)}: ${format(r.paid)}.`, ...r.lines].join('\n'), true, toneOf(st.bet, win)) };
    }
    if (value !== 'higher' && value !== 'lower') return {};
    const o = hlOdds(st);
    const next = st.deck.pop()!;
    const right = value === 'higher' ? next.r > st.card.r : next.r < st.card.r;
    const prev = st.card;
    st.card = next;
    if (!right) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, 0);
      return { update: hlView(s, [`${cardText(prev)} → ${cardText(next)}. Wrong. Lost ${format(st.bet)}.`, ...r.lines].join('\n'), true, 'loss') };
    }
    st.streak++;
    st.mult = Math.min(100, st.mult * o[value]);
    if (st.deck.length < 2 || st.mult >= 100) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * st.mult);
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, win);
      return { update: hlView(s, [`Maximum reached. Paid ${format(r.paid)}.`, ...r.lines].join('\n'), true, 'win') };
    }
    sessions.save(ctx.db, s.id, st, CASINO.sessionMs, ctx.now);
    return { update: hlView(s, `${cardText(prev)} → ${cardText(next)}. Correct.`) };
  });
}

// ----- Minesweeper -----
interface MS { bet: Cents; bombs: number[]; count: number; open: number[] }
const SIZE = 16;
export const minesMult = (bombs: number, safe: number): number => {
  if (!safe) return 1;
  let m = 0.96;
  for (let i = 0; i < safe; i++) m *= (SIZE - i) / (SIZE - bombs - i);
  return m;
};
function msView(s: sessions.Session<MS>, line = '', done = false, tone: 'play' | 'win' | 'loss' | 'push' = 'play'): ReplyObject {
  const st = s.state;
  const rows: Button[][] = [];
  for (let r = 0; r < 4; r++) rows.push(Array.from({ length: 4 }, (_, c) => {
    const i = r * 4 + c, open = st.open.includes(i), bomb = st.bombs.includes(i);
    const face = done && bomb ? ['mines', '💣'] : open ? ['diamond', '💎'] : ['tile', '·'];
    const own = hasEmoji(face[0]!);
    return { label: own ? '' : face[1]!, emoji: own ? emojiOr(face[0]!, face[1]!) : undefined, id: sessions.buttonId(s.id, String(i)), style: open ? 'success' : done && bomb ? 'danger' : 'secondary', disabled: done || open } as Button;
  }));
  const worth = Math.floor(st.bet * minesMult(st.count, st.open.length));
  if (!done) rows.push([btn(s, 'cash', st.open.length ? `Cash out ${format(worth)}` : 'Choose a tile', 'success', !st.open.length)]);
  return { embeds: [card('mines', [`Bombs: ${st.count} · Safe tiles: ${st.open.length}`, `Multiplier: ${mult(minesMult(st.count, st.open.length))} · Next tile: ${mult(minesMult(st.count, st.open.length + 1))}`, line && `\n${line}`], tone)], buttons: rows };
}

export const mines: Command = {
  name: 'mines', aliases: ['minesweeper', 'ms'], description: 'Minesweeper: dodge the bombs, cash out before you hit one', system: 'casino', guildOnly: true,
  options: [betOption('mines'), { name: 'bombs', type: 'integer', description: 'Bombs on the 4x4 field, 1 to 12 (default 3)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const count = args.bombs === undefined ? 3 : Number(args.bombs);
    if (!Number.isInteger(count) || count < 1 || count > 12) throw new GameError('mines.bombs', 'Choose between 1 and 12 bombs.');
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'mines', args.amount);
      const bombs = ctx.rng.shuffle(Array.from({ length: SIZE }, (_, i) => i)).slice(0, count);
      const s = startGame<MS>(ctx, 'mines', { bet, bombs, count, open: [] });
      return { ...msView(s), session: s.id };
    });
  }
};

function onMines(ctx: Ctx, s: sessions.Session<MS>, value: string): SessionReply {
  const no = notYours(ctx, s); if (no) return no;
  return ctx.db.tx(() => {
    const st = s.state;
    if (value === 'cash') {
      if (!st.open.length || !sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * minesMult(st.count, st.open.length));
      const r = settle(ctx, s.guild_id!, 'mines', st.bet, win);
      return { update: msView(s, [`Cashed out: ${format(r.paid)}.`, ...r.lines].join('\n'), true, toneOf(st.bet, win)) };
    }
    const i = Number(value);
    if (!Number.isInteger(i) || i < 0 || i >= SIZE || st.open.includes(i)) return {};
    if (st.bombs.includes(i)) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const r = settle(ctx, s.guild_id!, 'mines', st.bet, 0);
      return { update: msView(s, [`A bomb. Lost ${format(st.bet)}.`, ...r.lines].join('\n'), true, 'loss') };
    }
    st.open.push(i);
    if (st.open.length === SIZE - st.count) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * minesMult(st.count, st.open.length));
      const r = settle(ctx, s.guild_id!, 'mines', st.bet, win);
      awardHere('field_cleared');
      return { update: msView(s, [`Field cleared. Paid ${format(r.paid)}.`, ...r.lines].join('\n'), true, 'win') };
    }
    sessions.save(ctx.db, s.id, st, CASINO.sessionMs, ctx.now);
    return { update: msView(s) };
  });
}

// ----- Rocket -----
interface RK { bet: Cents; t0: number; crashAt: number }
const ROCKET = { edge: 0.96, cap: 50, growth: 0.06, frameMs: 1500 };
const rocketAt = (st: RK, now: number) => Math.exp((ROCKET.growth * Math.max(0, now - st.t0)) / 1000);
export const crashPoint = (u: number, fuel = false, cap = ROCKET.cap): number => Math.min(cap, Math.max(1, (ROCKET.edge / Math.max(1e-9, u)) * (fuel ? 1.2 : 1)));

function rkView(s: sessions.Session<RK>, now: number, end?: { line: string; tone: 'win' | 'loss'; at?: number }): ReplyObject {
  const m = end ? null : Math.min(rocketAt(s.state, now), s.state.crashAt);
  const shown = m ?? 0;
  // the multiplier in big gold digits at the top of the card; at the end, where it stopped
  const top = `## ${bigNumber(mult(m ?? end?.at ?? s.state.crashAt)) ?? mult(m ?? end?.at ?? s.state.crashAt)}`;
  return {
    embeds: [card('rocket', end ? [top, end.line] : [top, `Bet: ${format(s.state.bet)} · Worth now: ${format(Math.floor(s.state.bet * shown))}`, 'Cash out before it crashes.'], end?.tone ?? 'play')],
    buttons: end ? [] : [[btn(s, 'cash', 'Cash out', 'success')]]
  };
}

export const rocket: Command = {
  name: 'rocket', aliases: ['moon', 'crashgame'], description: 'Rocket: cash out before it crashes', system: 'casino', guildOnly: true,
  options: [betOption('rocket')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'rocket', args.amount);
      const fuel = useEffect(ctx.db, guildId, ctx.user.id, 'fuel');
      // Build It and They Will Come: a server with the Rocket landmark flies to 100x
      const s = startGame<RK>(ctx, 'rocket', { bet, t0: ctx.now + 1000, crashAt: crashPoint(ctx.rng.next(), fuel, isBuilt(ctx.db, guildId, 'rocket') ? 100 : ROCKET.cap) });
      const db = ctx.db;
      return {
        ...rkView(s, ctx.now), session: s.id,
        live: { everyMs: ROCKET.frameMs, next: () => {
          const now = Date.now();
          const live = sessions.get<RK>(db, s.id, now);
          if (!live) return null;
          if (rocketAt(live.state, now) >= live.state.crashAt) {
            // It crashed before they cashed out: settle the loss (exactly once)
            if (!sessions.end(db, s.id)) return null;
            const r = db.tx(() => settle({ ...ctx, now }, guildId, 'rocket', bet, 0));
            return rkView(live, now, { line: [`Crashed at ${mult(live.state.crashAt)}. Lost ${format(bet)}.`, ...r.lines].join('\n'), tone: 'loss' });
          }
          return rkView(live, now);
        } }
      };
    });
  }
};

function onRocket(ctx: Ctx, s: sessions.Session<RK>, value: string): SessionReply {
  const no = notYours(ctx, s); if (no) return no;
  if (value !== 'cash') return {};
  return ctx.db.tx(() => {
    if (!sessions.end(ctx.db, s.id)) return {};
    const at = rocketAt(s.state, ctx.now);
    if (at >= s.state.crashAt) {
      const r = settle(ctx, s.guild_id!, 'rocket', s.state.bet, 0);
      return { update: rkView(s, ctx.now, { line: [`Crashed at ${mult(s.state.crashAt)} before the cash-out. Lost ${format(s.state.bet)}.`, ...r.lines].join('\n'), tone: 'loss' }) };
    }
    const m = Math.floor(at * 100) / 100;
    const win = Math.floor(s.state.bet * m);
    const r = settle(ctx, s.guild_id!, 'rocket', s.state.bet, win);
    ctx.big = undefined;   // the Rocket keeps its multiplier up top, not the winnings
    if (m >= 10) awardHere('moon_shot');
    return { update: rkView(s, ctx.now, { line: [`Cashed out at ${mult(m)}: ${format(r.paid)}. It would have crashed at ${mult(s.state.crashAt)}.`, ...r.lines].join('\n'), tone: win > s.state.bet ? 'win' : 'loss', at: m }) };
  });
}

// ---------------------------------------------------------------- Make Gambling Fun Again: VIP

export const vip: Command = {
  name: 'vip', aliases: ['viplounge', 'freespin', 'jackpot'], description: 'Your VIP level, the progressive jackpot, and your daily free spin', system: 'casino', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: 'Blank to look, or: spin' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    return ctx.db.tx(() => {
      const v = vipOf(ctx.db, guildId, ctx.user.id);
      const left = freeSpinsLeft(ctx.db, guildId, ctx.user.id, ctx.now);
      if (/^(spin|free|claim)$/i.test(String(args.action ?? '').trim())) {
        if (!v.tier) throw new GameError('vip.none', `Free spins are for VIPs. Bet ${format(VIP[0]!.at)} in the Rend-Sino to reach ${VIP[0]!.emoji} Bronze (you're at ${format(v.wagered)}).`);
        if (!left) throw new GameError('vip.used', `You've had today's free spin. Another tomorrow${happyHour(ctx.db, ctx.now, guildId) ? '' : ' (two during Happy Hour)'}.`);
        useFreeSpin(ctx.db, guildId, ctx.user.id, ctx.now);
        const stake = v.tier.spin;
        const [x, y, z] = [ctx.rng.pick(SYMBOLS), ctx.rng.pick(SYMBOLS), ctx.rng.pick(SYMBOLS)];
        const win = x === y && y === z ? stake * TRIPLE[x]! : x === y || y === z || x === z ? stake : 0;
        const w = wallet(guildId, ctx.user.id);
        if (win > 0) transfer(ctx.db, { from: RESERVE, to: w, cents: Math.min(win, balance(ctx.db, RESERVE)), reason: 'casino.free', guildId, actorId: ctx.user.id, now: ctx.now });
        const jackpot = x === '💎' && y === '💎' && z === '💎' ? winJackpot(ctx, guildId, stake) : 0;
        return { embeds: [card('slots', [
          `${v.tier.emoji} **${v.tier.name} free spin** · ${format(stake)} on the house`,
          `## [ ${show(x!)} | ${show(y!)} | ${show(z!)} ]`,
          win ? `🎉 **You win ${format(win)}!**` : 'No match. It was free, so nothing lost.',
          jackpot ? `## 💎 PROGRESSIVE JACKPOT: +${format(jackpot)}!` : null,
          `-# Balance: ${format(balance(ctx.db, w))}`
        ], win ? 'win' : 'play')] };
      }
      const bar = v.next ? Math.min(1, (v.wagered - (v.tier?.at ?? 0)) / (v.next.at - (v.tier?.at ?? 0))) : 1;
      const n = Math.round(bar * 12);
      return { embeds: [card('slots', [
        `## ${emojiOr('jackpot', '💎')} ${format(jackpotOf(ctx.db, guildId))}`,
        'The **progressive jackpot**: every bet in this server adds to it. Three 💎 on Slots win it (all of it at the max bet).',
        happyHour(ctx.db, ctx.now, guildId) ? '🥂 **Happy Hour!** The jackpot grows 3x as fast and VIPs get a second free spin.' : null,
        '',
        v.tier ? `**VIP:** ${v.tier.emoji} **${v.tier.name}** · daily free spin worth ${format(v.tier.spin)}` : '**VIP:** not yet',
        `Bet here so far: ${format(v.wagered)}${v.next ? ` · ${v.next.emoji} ${v.next.name} at ${format(v.next.at)}` : ' · the top level'}`,
        `\`${'▰'.repeat(n)}${'▱'.repeat(12 - n)}\``,
        v.tier ? (left ? `🎰 ${left === 1 ? 'A free spin is' : `${left} free spins are`} waiting: \`${P}vip spin\`` : '-# Today\'s free spin is used.') : null,
        '',
        ...VIP.map((t, i) => `${t.emoji} ${i <= v.level ? `**${t.name}**` : t.name} · ${format(t.at)} bet · free spin ${format(t.spin)}`)
      ])].map((e) => ({ ...e, title: `${emojiOr('vip', '🥂')} The VIP Lounge` })) };
    });
  }
};

// ---------------------------------------------------------------- Make Gambling Fun Again: the blackjack table
// Up to 5 players at one table against TODD. Everyone bets the table's stake; hands are played in turn, each
// with 45 seconds before TODD stands for you; then TODD plays out his hand and every seat is paid like solo
// blackjack (2x, 2.5x on a blackjack, the bet back on a tie).
export const TABLE = { seats: 5, turnMs: 45_000, lobbyMs: 2 * 60_000, tableMs: 10 * 60_000, tickMs: 5_000 };
interface Seat { id: string; name: string; hand: Card[]; doubled: boolean; done: boolean; paid?: number; line?: string }
interface TB { bet: Cents; phase: 'lobby' | 'play' | 'done'; seats: Seat[]; dealer: Card[]; deck: Card[]; turn: number; deadline: number; notes?: string[] }

/** (advance() changes the phase, which TypeScript can't see through) */
const phaseOf = (st: TB): TB['phase'] => st.phase;
const seatCtx = (ctx: Ctx, seat: Seat, now = ctx.now): Ctx => ({ ...ctx, now, user: { ...ctx.user, id: seat.id, name: seat.name }, notes: [], big: undefined });

function tableView(s: sessions.Session<TB>, line = ''): ReplyObject {
  const st = s.state;
  const done = st.phase === 'done';
  const dealer = st.phase === 'lobby' ? 'waiting for players' : done ? `${showHand(st.dealer)} (**${handValue(st.dealer)}**)` : `${cardText(st.dealer[0]!)} ${cardBack()}`;
  const rows = st.seats.map((p, i) => {
    if (st.phase === 'lobby') return `🪑 **${p.name}**${i === 0 ? ' · host' : ''}`;
    const turn = st.phase === 'play' && i === st.turn ? '👉 ' : '';
    const v = handValue(p.hand);
    return `${turn}**${p.name}:** ${showHand(p.hand)} (**${v}**)${p.doubled ? ' · doubled' : ''}${done && p.line ? ` · ${p.line}` : v > 21 ? ' · bust' : p.done ? ' · stands' : ''}`;
  });
  const cur = st.seats[st.turn];
  const buttons: Button[][] = st.phase === 'lobby'
    ? [[btn(s, 'sit', `Sit down (${format(st.bet)})`, 'primary', st.seats.length >= TABLE.seats), btn(s, 'leave', 'Leave'), btn(s, 'deal', 'Deal', 'success'), btn(s, 'close', 'Close the table', 'danger')]]
    : st.phase === 'play' ? [[btn(s, 'hit', 'Hit', 'primary'), btn(s, 'stand', 'Stand'), ...(cur && cur.hand.length === 2 && !cur.doubled ? [btn(s, 'double', `Double (${format(st.bet)})`, 'success')] : [])]] : [];
  return { embeds: [card('blackjack', [
    `**Table stakes:** ${format(st.bet)} · ${st.seats.length}/${TABLE.seats} seats`,
    `**TODD:** ${dealer}`, '',
    ...rows,
    st.phase === 'lobby' ? `\n-# Sit down to play. The host deals when everyone's in (the table closes ${discordTime(s.expires_at)}).` : null,
    st.phase === 'play' && cur ? `\n-# ${cur.name}'s turn. TODD stands for them ${discordTime(st.deadline)}.` : null,
    ...(st.notes ?? []).map((n) => `-# ${n}`),
    line && `\n${line}`
  ], done ? 'push' : 'play')].map((e) => ({ ...e, title: `${emojiOr('table', '🃏')} The Blackjack Table` })), buttons };
}

/** Moves to the next seat that still has a hand to play; when nobody does, TODD plays and everyone is paid. */
function advance(ctx: Ctx, s: sessions.Session<TB>): void {
  const st = s.state;
  while (st.turn < st.seats.length && (st.seats[st.turn]!.done || handValue(st.seats[st.turn]!.hand) >= 21)) { st.seats[st.turn]!.done = true; st.turn++; }
  st.deadline = ctx.now + TABLE.turnMs;
  if (st.turn < st.seats.length) return;
  // TODD plays, if anyone is still standing
  if (st.seats.some((p) => handValue(p.hand) <= 21)) while (handValue(st.dealer) < 17) st.dealer.push(st.deck.pop()!);
  const d = handValue(st.dealer), g = s.guild_id!;
  const party = st.seats.length >= 3;
  for (const p of st.seats) {
    const total = st.bet * (p.doubled ? 2 : 1), you = handValue(p.hand);
    let win = 0;
    if (you > 21) p.line = 'bust';
    else if (natural(p.hand) && !natural(st.dealer)) { win = Math.round(st.bet * 2.5); p.line = `**blackjack**, +${format(win)}`; }
    else if (d > 21 || you > d) { win = total * 2; p.line = `wins ${format(win)}`; }
    else if (you === d) { win = total; p.line = 'push'; }
    else p.line = 'loses';
    const pc = seatCtx(ctx, p);
    settle(pc, g, 'blackjack', total, win);
    p.paid = win;
    if (win > total && party) award(ctx.db, g, p.id, 'house_party', ctx.now);
  }
  st.phase = 'done';
}

export const table: Command = {
  name: 'table', aliases: ['bjtable', 'blackjacktable', 'tables'], description: 'Open a blackjack table: up to 5 players against TODD', system: 'casino', guildOnly: true,
  options: [betOption('blackjack')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      if (ctx.db.get("SELECT 1 FROM sessions WHERE kind = 'table' AND channel_id = ? AND expires_at > ?", ctx.channelId, ctx.now)) throw new GameError('table.live', 'There\'s already a table open in this channel.');
      // the stake is checked like any bet (bans, limits); everyone pays it when the cards are dealt
      const bet = checkBet(ctx, guildId, 'blackjack', args.amount);
      const s = sessions.create<TB>(ctx.db, { kind: 'table', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { bet, phase: 'lobby', seats: [{ id: ctx.user.id, name: ctx.user.name, hand: [], doubled: false, done: false }], dealer: [], deck: [], turn: 0, deadline: 0 }, ttlMs: TABLE.lobbyMs, now: ctx.now });
      return { ...tableView(s), session: s.id };
    });
  }
};

function onTable(ctx: Ctx, s: sessions.Session<TB>, value: string): SessionReply {
  const st = s.state, g = s.guild_id!;
  const host = ctx.user.id === s.user_id;
  return ctx.db.tx(() => {
    if (st.phase === 'lobby') {
      if (value === 'sit') {
        if (st.seats.some((p) => p.id === ctx.user.id)) return { notice: 'You already have a seat.' };
        if (st.seats.length >= TABLE.seats) return { notice: 'The table is full.' };
        player(ctx.db, g, ctx.user.id, economy.startingCash, ctx.now);
        if (balance(ctx.db, wallet(g, ctx.user.id)) < st.bet) return { notice: `You need ${format(st.bet)} to sit down.` };
        st.seats.push({ id: ctx.user.id, name: ctx.user.name, hand: [], doubled: false, done: false });
        sessions.save(ctx.db, s.id, st);
        return { update: tableView(s) };
      }
      if (value === 'leave') {
        if (host) return { notice: 'The host can\'t leave. Close the table instead.' };
        st.seats = st.seats.filter((p) => p.id !== ctx.user.id);
        sessions.save(ctx.db, s.id, st);
        return { update: tableView(s) };
      }
      if (value === 'close') { if (!host) return { notice: 'Only the host can close the table.' }; if (!sessions.end(ctx.db, s.id)) return {}; return { update: { ...tableView(s, 'The table is closed.'), buttons: [] } }; }
      if (value !== 'deal') return {};
      if (!host) return { notice: 'The host deals.' };
      // everyone pays the stake now (anyone who can't, or isn't allowed to gamble, is left out)
      const seated: Seat[] = [], left: string[] = [];
      for (const p of st.seats) {
        try { takeBet(seatCtx(ctx, p), g, 'blackjack', (st.bet / 100).toFixed(2)); seated.push(p); } catch (e) { if (e instanceof GameError) left.push(`${p.name} (${e.message})`); else throw e; }
      }
      if (!seated.length) { sessions.end(ctx.db, s.id); return { update: { ...tableView(s, `Nobody could play: ${left.join(', ')}. The table is closed.`), buttons: [] } }; }
      const d = deck((l) => ctx.rng.shuffle(l));
      for (const p of seated) p.hand = [d.pop()!, d.pop()!];
      Object.assign(st, { seats: seated, phase: 'play', deck: d, dealer: [d.pop()!, d.pop()!], turn: 0, notes: left.length ? [`Left out (couldn't play): ${left.join(', ')}`] : [] });
      for (const p of st.seats) if (natural(p.hand)) p.done = true;
      advance(ctx, s);
      if (phaseOf(st) === 'done') { sessions.end(ctx.db, s.id); return { update: tableView(s, 'Dealt, and done in one.') }; }
      sessions.save(ctx.db, s.id, st, TABLE.tableMs, ctx.now);
      // TODD stands for anyone who takes too long, even if nobody presses anything
      const db = ctx.db, base = ctx;
      return { update: { ...tableView(s), live: { everyMs: TABLE.tickMs, next: () => {
        const now = Date.now();
        return db.tx(() => {
          const live = sessions.get<TB>(db, s.id, now);
          if (!live) return null;
          if (live.state.phase !== 'play') return null;
          if (now < live.state.deadline) return tableView(live);
          const c = { ...base, now };
          live.state.seats[live.state.turn]!.done = true;
          advance(c, live);
          if (phaseOf(live.state) === 'done') { sessions.end(db, s.id); return tableView(live, 'TODD collects the cards.'); }
          sessions.save(db, s.id, live.state, TABLE.tableMs, now);
          return tableView(live);
        });
      } } } };
    }
    if (st.phase !== 'play') return {};
    // someone ran out of time: TODD stands for them first
    if (ctx.now >= st.deadline) { st.seats[st.turn]!.done = true; advance(ctx, s); }
    const cur = st.seats[st.turn];
    if (st.phase === 'play' && cur && cur.id !== ctx.user.id) { sessions.save(ctx.db, s.id, st, TABLE.tableMs, ctx.now); return st.seats.some((p) => p.id === ctx.user.id) ? { notice: `It's ${cur.name}'s turn.`, update: tableView(s) } : { notice: 'You\'re not at this table.' }; }
    if (st.phase === 'play' && cur) {
      if (value === 'double') {
        if (cur.hand.length !== 2 || cur.doubled) return {};
        const w = wallet(g, cur.id);
        if (balance(ctx.db, w) < st.bet) return { notice: `Doubling requires ${format(st.bet)}.` };
        transfer(ctx.db, { from: w, to: RESERVE, cents: st.bet, reason: 'casino.bet', guildId: g, actorId: cur.id, now: ctx.now, note: { game: 'blackjack', double: true, table: true } });
        cur.doubled = true; cur.hand.push(st.deck.pop()!); cur.done = true;
      } else if (value === 'hit') { cur.hand.push(st.deck.pop()!); if (handValue(cur.hand) >= 21) cur.done = true; }
      else if (value === 'stand') cur.done = true;
      else return {};
      if (cur.done) advance(ctx, s); else st.deadline = ctx.now + TABLE.turnMs;
    }
    if (phaseOf(st) === 'done') { if (!sessions.end(ctx.db, s.id)) return {}; return { update: tableView(s, 'TODD collects the cards.') }; }
    sessions.save(ctx.db, s.id, st, TABLE.tableMs, ctx.now);
    return { update: tableView(s) };
  });
}

// ---------------------------------------------------------------- odds

export const odds: Command = {
  name: 'odds', aliases: ['payouts'], description: 'The real odds and house edge of every Rend-Sino game', system: 'casino',
  run() {
    return { embeds: [card('slots', (Object.keys(ODDS) as Game[]).map((g) => `**${NAMES[g]}**: ${showAll(ODDS[g])}`)), ].map((e) => ({ ...e, title: 'Rend-Sino odds' })) };
  }
};

export const casinoHandlers = {
  'casino.blackjack': onBlackjack,
  'table': onTable,
  'casino.hilo': onHilo,
  'casino.mines': onMines,
  'casino.rocket': onRocket,
  'redeem.slots': onRedeem
};
