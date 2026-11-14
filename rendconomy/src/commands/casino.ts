// The Rend-Sino's games. Instant games settle in one step; interactive ones keep their state in a stored
// session (kind "casino.<game>"), so their buttons survive restarts and each press is handled once.
import type { APIEmbed } from 'discord.js';
import { awardHere } from '../achievements/achievements';
import { CASINO, NAMES, ODDS, cardText, deck, mult, settle, takeBet, type Card, type Game } from '../casino/core';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { COLORS } from '../discord/style';
import { useEffect } from '../shop/inventory';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

const card = (game: Game, lines: (string | null | false | undefined)[], tone: 'play' | 'win' | 'loss' | 'push' = 'play'): APIEmbed => ({
  title: NAMES[game],
  description: lines.filter((l) => l !== null && l !== false && l !== undefined).join('\n'),
  color: tone === 'win' ? 0x57f287 : tone === 'loss' ? COLORS.error : tone === 'push' ? 0xfee75c : COLORS.casino
});
const toneOf = (bet: Cents, paid: Cents) => (paid > bet ? 'win' : paid === bet ? 'push' : 'loss') as 'win' | 'loss' | 'push';
const betOption = (game: Game) => ({ name: 'amount', type: 'string' as const, description: `Your bet, ${format(CASINO.minBet)} to ${format(CASINO.maxBet[game])}, or "max"`, required: true });

// ---------------------------------------------------------------- instant games

const SYMBOLS = ['🍒', '🍋', '🔔', '🔺', '💎'];
const TRIPLE: Record<string, number> = { '💎': 25, '🔺': 10, '🔔': 8, '🍋': 5, '🍒': 3 };

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
      return { embeds: [card('slots', [`## ${x} ${y} ${z}`, `Bet: ${format(bet)} · Paid: ${format(r.paid)}`, ...r.lines], toneOf(bet, win))] };
    });
  }
};

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
      return { embeds: [card('coinflip', [`Called: **${side}**. Result: **${flip}**.`, win ? `Won ${format(r.paid)}.` : `Lost ${format(bet)}.`, ...r.lines], toneOf(bet, win))] };
    });
  }
};

export const dice: Command = {
  name: 'dice', description: 'Roll 1-100: bet it lands over or under your number', system: 'casino', guildOnly: true,
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
      return { embeds: [card('dice', [`Call: ${over ? 'over' : 'under'} ${n} (pays ${pays}x). Roll: **${roll}**.`, won ? `Won ${format(r.paid)}.` : `Lost ${format(bet)}.`, ...r.lines], toneOf(bet, win))] };
    });
  }
};

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const colorOf = (n: number) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
const dot = (n: number) => ({ green: '🟢', red: '🔴', black: '⚫' })[colorOf(n)];

function rouletteBet(raw: string): { label: string; pays: number; wins: (n: number) => boolean; straight?: boolean } | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (/^\d{1,2}$/.test(t) && Number(t) <= 36) { const k = Number(t); return { label: `${dot(k)} ${k}`, pays: 36, wins: (n) => n === k, straight: true }; }
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
  name: 'roulette', aliases: ['rl'], description: 'Bet on red, black, odd, even, low, high, a dozen, or a number', system: 'casino', guildOnly: true,
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
      return { embeds: [card('roulette', [`Bet: ${b.label} (pays ${b.pays}x). The ball lands on **${dot(n)} ${n}**.`, won ? `Won ${format(r.paid)}.` : `Lost ${format(bet)}.`, ...r.lines], toneOf(bet, win))] };
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
  const dealer = done ? `${showHand(st.dealer)} (**${handValue(st.dealer)}**)` : `${cardText(st.dealer[0]!)} \`??\``;
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
    return { label: done && bomb ? '💣' : open ? '💎' : '·', id: sessions.buttonId(s.id, String(i)), style: open ? 'success' : done && bomb ? 'danger' : 'secondary', disabled: done || open } as Button;
  }));
  const worth = Math.floor(st.bet * minesMult(st.count, st.open.length));
  if (!done) rows.push([btn(s, 'cash', st.open.length ? `Cash out ${format(worth)}` : 'Choose a tile', 'success', !st.open.length)]);
  return { embeds: [card('mines', [`Bombs: ${st.count} · Safe tiles: ${st.open.length}`, `Multiplier: ${mult(minesMult(st.count, st.open.length))} · Next tile: ${mult(minesMult(st.count, st.open.length + 1))}`, line && `\n${line}`], tone)], buttons: rows };
}

export const mines: Command = {
  name: 'mines', aliases: ['minesweeper'], description: 'Minesweeper: dodge the bombs, cash out before you hit one', system: 'casino', guildOnly: true,
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
export const crashPoint = (u: number, fuel = false): number => Math.min(ROCKET.cap, Math.max(1, (ROCKET.edge / Math.max(1e-9, u)) * (fuel ? 1.2 : 1)));

function rkView(s: sessions.Session<RK>, now: number, end?: { line: string; tone: 'win' | 'loss' }): ReplyObject {
  const m = end ? null : Math.min(rocketAt(s.state, now), s.state.crashAt);
  const shown = m ?? 0;
  return {
    embeds: [card('rocket', end ? [end.line] : [`## ${mult(shown)}`, `Bet: ${format(s.state.bet)} · Worth now: ${format(Math.floor(s.state.bet * shown))}`, 'Cash out before it crashes.'], end?.tone ?? 'play')],
    buttons: end ? [] : [[btn(s, 'cash', 'Cash out', 'success')]]
  };
}

export const rocket: Command = {
  name: 'rocket', aliases: ['moon'], description: 'Rocket: cash out before it crashes', system: 'casino', guildOnly: true,
  options: [betOption('rocket')],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'rocket', args.amount);
      const fuel = useEffect(ctx.db, guildId, ctx.user.id, 'fuel');
      const s = startGame<RK>(ctx, 'rocket', { bet, t0: ctx.now + 1000, crashAt: crashPoint(ctx.rng.next(), fuel) });
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
    if (m >= 10) awardHere('moon_shot');
    return { update: rkView(s, ctx.now, { line: [`Cashed out at ${mult(m)}: ${format(r.paid)}. It would have crashed at ${mult(s.state.crashAt)}.`, ...r.lines].join('\n'), tone: win > s.state.bet ? 'win' : 'loss' }) };
  });
}

// ---------------------------------------------------------------- odds

export const odds: Command = {
  name: 'odds', description: 'The real odds and house edge of every Rend-Sino game', system: 'casino',
  run() {
    return { embeds: [card('slots', (Object.keys(ODDS) as Game[]).map((g) => `**${NAMES[g]}**: ${ODDS[g]}`)), ].map((e) => ({ ...e, title: 'Rend-Sino odds' })) };
  }
};

export const casinoHandlers = {
  'casino.blackjack': onBlackjack,
  'casino.hilo': onHilo,
  'casino.mines': onMines,
  'casino.rocket': onRocket
};
