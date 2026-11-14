// The rest of the Rend-Sino (Ride the Bus, the lottery, the Polygon Derby, stats), drop-in controls,
// DM receipts, and a secret.
import { award, awardHere } from '../achievements/achievements';
import { CASINO, NAMES, cardText, deck, mult, settle, takeBet, type Card } from '../casino/core';
import type { Db } from '../core/db';
import { GameError } from '../core/errors';
import { RESERVE, balance, ensureAccount, transfer, wallet } from '../core/ledger';
import { format, parseAmount, parseCount, polygons, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { dayKey, discordTime, nextReset, HOUR } from '../core/time';
import { COLORS, embed } from '../discord/style';
import { onTick } from '../market/market';
import { setDropinHome, setDropinsOff, dropinsOff, dropinHome } from '../social/chatter';
import { guildOf, me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

const btn = (s: sessions.Session, value: string, label: string, style: Button['style'] = 'secondary', disabled = false): Button => ({ label, id: sessions.buttonId(s.id, value), style, disabled });
const tone = (bet: Cents, paid: Cents) => (paid > bet ? 0x57f287 : paid === bet ? 0xfee75c : COLORS.error);

// ================================================================ Ride the Bus

interface Bus { bet: Cents; cards: Card[]; round: number; mult: number }
const EDGE = 0.96;
const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const ROUNDS: Record<number, { q: string; opts: [string, string][] }> = {
  1: { q: '**Round 1:** red or black?', opts: [['red', 'Red'], ['black', 'Black']] },
  2: { q: '**Round 2:** higher or lower than the first card?', opts: [['higher', 'Higher'], ['lower', 'Lower']] },
  3: { q: '**Round 3:** inside or outside the first two cards?', opts: [['inside', 'Inside'], ['outside', 'Outside']] },
  4: { q: '**Round 4:** which suit?', opts: [['hearts', '♥️ Hearts'], ['diamonds', '♦️ Diamonds'], ['clubs', '♣️ Clubs'], ['spades', '♠️ Spades']] }
};
function busRight(round: number, cards: Card[], guess: string): boolean {
  const c = cards[round - 1]!;
  if (round === 1) return (c.red ? 'red' : 'black') === guess;
  if (round === 2) return guess === 'higher' ? c.r > cards[0]!.r : c.r < cards[0]!.r;
  if (round === 3) { const lo = Math.min(cards[0]!.r, cards[1]!.r), hi = Math.max(cards[0]!.r, cards[1]!.r); return guess === 'inside' ? c.r > lo && c.r < hi : c.r < lo || c.r > hi; }
  return c.suit === guess;
}
/** What a guess multiplies by: 96% of the fair odds from the cards not yet seen. */
export function busStep(st: Bus, guess: string): number {
  const seen = st.cards.slice(0, st.round - 1);
  const left = deck((l) => [...l]).filter((c) => !seen.some((x) => x.r === c.r && x.suit === c.suit));
  const wins = left.filter((c) => busRight(st.round, [...seen, c], guess)).length;
  return wins ? (EDGE * left.length) / wins : 0;
}
function busView(s: sessions.Session<Bus>, line = '', done = false, color: number = COLORS.casino): ReplyObject {
  const st = s.state;
  const shown = st.cards.slice(0, st.round - 1).map(cardText).join(' ') || '`??`';
  const r = ROUNDS[st.round];
  const buttons: Button[][] = done || !r ? [] : [r.opts.map(([v, label]) => { const m = busStep(st, v); return btn(s, v, m ? `${label} (${mult(m)})` : label, 'primary', !m); }),
    ...(st.round > 1 ? [[btn(s, 'cash', `Cash out ${format(Math.floor(st.bet * st.mult))}`, 'success')]] : [])];
  return { embeds: [{ title: '🚌 Ride the Bus', color, description: [`Cards: ${shown}`, `Multiplier: ${mult(st.mult)} · Worth: ${format(Math.floor(st.bet * st.mult))}`, done ? '' : r?.q ?? '', line].filter(Boolean).join('\n') }], buttons };
}

export const bus: Command = {
  name: 'bus', aliases: ['ridethebus', 'rtb'], description: 'Ride the Bus: four guesses, cash out any time after the first', system: 'casino', guildOnly: true,
  options: [{ name: 'amount', type: 'string', description: `Your bet, ${format(CASINO.minBet)} to ${format(polygons(2500))}, or "max"`, required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const bet = takeBet(ctx, guildId, 'hilo', args.amount);
      const d = deck((l) => ctx.rng.shuffle(l));
      const s = sessions.create<Bus>(ctx.db, { kind: 'casino.bus', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { bet, cards: d.slice(0, 4), round: 1, mult: 1 }, ttlMs: CASINO.sessionMs, now: ctx.now });
      return { ...busView(s), session: s.id };
    });
  }
};

export function onBus(ctx: Ctx, s: sessions.Session<Bus>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: 'This game belongs to another player.' };
  return ctx.db.tx(() => {
    const st = s.state;
    if (value === 'cash') {
      if (st.round < 2 || !sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * st.mult);
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, win);
      return { update: busView(s, [`Cashed out: ${format(r.paid)}.`, ...r.lines].join('\n'), true, tone(st.bet, win)) };
    }
    const options = ROUNDS[st.round]?.opts.map(([v]) => v) ?? [];
    if (!options.includes(value)) return {};
    const step = busStep(st, value);
    const right = busRight(st.round, st.cards, value);
    st.round++;
    if (!right) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, 0);
      return { update: busView(s, [`Wrong. Lost ${format(st.bet)}.`, ...r.lines].join('\n'), true, COLORS.error) };
    }
    st.mult *= step;
    if (st.round > 4) {
      if (!sessions.end(ctx.db, s.id)) return {};
      const win = Math.floor(st.bet * st.mult);
      const r = settle(ctx, s.guild_id!, 'hilo', st.bet, win);
      awardHere('bus_driver');
      return { update: busView(s, [`All four right. Paid ${format(r.paid)}.`, ...r.lines].join('\n'), true, 0x57f287) };
    }
    sessions.save(ctx.db, s.id, st, CASINO.sessionMs, ctx.now);
    return { update: busView(s, 'Correct.') };
  });
}

// ================================================================ lottery

export const LOTTERY = { price: polygons(50), maxTickets: 20, potShare: 0.9 };
const potAccount = (g: string) => `lottery:${g}`;
/** The Sunday (Eastern) of the next draw, and when it happens: Sunday 8 PM Eastern. */
export function nextDraw(now: number): { key: string; at: number } {
  for (let i = 0; i < 8; i++) {
    const t = now + i * 24 * HOUR;
    const key = dayKey(t);
    if (new Date(`${key}T12:00:00Z`).getUTCDay() !== 0) continue;
    const at = nextReset(Date.parse(`${key}T12:00:00Z`)) - 4 * HOUR; // Monday 12 AM minus 4 hours: 8 PM Sunday, through DST
    if (at > now) return { key, at };
  }
  throw new Error('No Sunday found');
}

let announce: (guildId: string, text: string) => void = () => {};
export const setLotteryAnnouncer = (fn: (guildId: string, text: string) => void): void => { announce = fn; };

/** Draws every lottery whose time has come. */
export function drawLotteries(db: Db, now: number, pick: (weights: [string, number][]) => string): void {
  const due = db.all<{ guild_id: string; draw: string }>('SELECT DISTINCT guild_id, draw FROM lottery');
  for (const { guild_id: g, draw } of due) {
    const at = nextReset(Date.parse(`${draw}T12:00:00Z`)) - 4 * HOUR;
    if (now < at) continue;
    const tickets = db.all<{ user_id: string; tickets: number }>('SELECT user_id, tickets FROM lottery WHERE guild_id = ? AND draw = ?', g, draw);
    db.tx(() => {
      const pot = balance(db, potAccount(g));
      const winner = pick(tickets.map((t) => [t.user_id, t.tickets]));
      if (pot > 0) transfer(db, { from: potAccount(g), to: wallet(g, winner), cents: pot, reason: 'lottery.win', guildId: g, actorId: winner, now });
      db.run('DELETE FROM lottery WHERE guild_id = ? AND draw = ?', g, draw);
      award(db, g, winner, 'jackpot', now);
      announce(g, `**Lottery draw.** ${tickets.reduce((s, t) => s + t.tickets, 0)} tickets were sold. The winner is <@${winner}>, who takes the pot of **${format(pot)}**.`);
    });
  }
}

export const lottery: Command = {
  name: 'lottery', aliases: ['lotto'], description: 'The weekly lottery: tickets ⬡50, drawn Sunday 8 PM Eastern', system: 'casino', guildOnly: true,
  options: [{ name: 'tickets', type: 'string', description: 'How many tickets to buy (leave out to see the pot)' }],
  run(ctx, args) {
    const { guildId, wallet: w } = me(ctx);
    const d = nextDraw(ctx.now);
    ctx.db.setMeta(`lottery.channel:${guildId}`, ctx.channelId ?? '');
    const mine = () => ctx.db.get<{ tickets: number }>('SELECT tickets FROM lottery WHERE guild_id = ? AND draw = ? AND user_id = ?', guildId, d.key, ctx.user.id)?.tickets ?? 0;
    const head: string[] = [];
    if (args.tickets !== undefined && args.tickets !== '') {
      const n = parseCount(args.tickets, { max: LOTTERY.maxTickets - mine(), all: LOTTERY.maxTickets - mine() });
      ctx.db.tx(() => {
        ensureAccount(ctx.db, potAccount(guildId), 'escrow', guildId, null, ctx.now);
        const cost = n * LOTTERY.price, pot = Math.round(cost * LOTTERY.potShare);
        transfer(ctx.db, { from: w, to: potAccount(guildId), cents: pot, reason: 'lottery.ticket', guildId, actorId: ctx.user.id, now: ctx.now });
        transfer(ctx.db, { from: w, to: RESERVE, cents: cost - pot, reason: 'lottery.ticket', guildId, actorId: ctx.user.id, now: ctx.now });
        ctx.db.run('INSERT INTO lottery (guild_id, draw, user_id, tickets) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id, draw, user_id) DO UPDATE SET tickets = tickets + excluded.tickets', guildId, d.key, ctx.user.id, n);
      });
      head.push(`Bought ${n} ${n === 1 ? 'ticket' : 'tickets'} for ${format(n * LOTTERY.price)}.`);
    }
    const total = ctx.db.get<{ n: number }>('SELECT COALESCE(SUM(tickets), 0) AS n FROM lottery WHERE guild_id = ? AND draw = ?', guildId, d.key)!.n;
    const m = mine();
    return { embeds: [embed('casino', '🎟️ The weekly lottery', [...head,
      `Pot: **${format(balance(ctx.db, potAccount(guildId)))}**`, `Draw: ${discordTime(d.at, 'f')} (${discordTime(d.at)})`,
      `Your tickets: ${m} of ${LOTTERY.maxTickets}${total ? ` · your chance: ${Math.round((m / total) * 1000) / 10}%` : ''}`,
      `-# 90% of every ticket goes into the pot, 10% to the Reserve. One ticket, one chance.`])] };
  }
};

// ================================================================ Polygon Derby

const HORSES: [string, string, string][] = [['🛡️', 'Modsworth', 'RRM'], ['🧀', 'Nacho Libre', 'NACH'], ['🧱', 'Brickhouse', 'BLU'], ['📊', 'Spreadsheet', 'BNW'], ['👾', 'Glitch', 'BSTG']];
export const DERBY = { bettingMs: 45_000, frames: 8, frameMs: 1500, track: 14, edge: 0.92 };
interface Derby { odds: number[]; p: number[]; bets: { user: string; name: string; horse: number; bet: Cents }[]; pos: number[]; phase: 'betting' | 'racing' | 'done'; startsAt: number; frame: number; winner: number }

function derbyView(st: Derby, line = ''): ReplyObject {
  const lanes = HORSES.map(([e, n], i) => `\`${i + 1}\` \`🏁${'·'.repeat(Math.max(0, DERBY.track - st.pos[i]!))}${e}${'·'.repeat(st.pos[i]!)}\` **${n}** · ${st.odds[i]}x`);
  const bets = st.bets.length ? st.bets.map((b) => `**${b.name}**: ${format(b.bet)} on ${HORSES[b.horse]![1]}`) : ['No bets yet.'];
  return { embeds: [{ title: '🏇 The Polygon Derby', color: COLORS.casino, description: [...lanes, '', ...bets, '', st.phase === 'betting' ? `Bets close ${discordTime(st.startsAt)}. Bet with \`/derby <horse> <amount>\`.` : line].join('\n') }] };
}

export const derby: Command = {
  name: 'derby', aliases: ['race', 'horses'], description: 'The Polygon Derby: start a race or bet on a horse', system: 'casino', guildOnly: true,
  options: [{ name: 'horse', type: 'string', description: 'A horse (name, number or ticker) to bet on; leave out to start a race' }, { name: 'amount', type: 'string', description: 'Your bet' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const live = ctx.db.get<{ id: string }>("SELECT id FROM sessions WHERE kind = 'derby' AND channel_id = ? AND expires_at > ?", ctx.channelId, ctx.now);
    if (!args.horse) {
      if (live) throw new GameError('derby.live', 'A race is already running in this channel.');
      const w = HORSES.map(() => 0.4 + ctx.rng.next() * 1.6);
      const sum = w.reduce((a, b) => a + b, 0);
      const p = w.map((x) => x / sum);
      const st: Derby = { p, odds: p.map((x) => Math.max(1.1, Math.floor((DERBY.edge / x) * 10) / 10)), bets: [], pos: HORSES.map(() => 0), phase: 'betting', startsAt: ctx.now + DERBY.bettingMs, frame: 0, winner: -1 };
      const s = sessions.create<Derby>(ctx.db, { kind: 'derby', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: st, ttlMs: DERBY.bettingMs + (DERBY.frames + 4) * DERBY.frameMs, now: ctx.now });
      const db = ctx.db, rng = ctx.rng, base = { ...ctx };
      return { ...derbyView(st), session: s.id, live: { everyMs: DERBY.frameMs, next: () => {
        const now = Date.now();
        const cur = sessions.get<Derby>(db, s.id, now);
        if (!cur) return null;
        const d = cur.state;
        if (d.phase === 'betting') { if (now < d.startsAt) return derbyView(d); d.phase = 'racing'; d.winner = rng.pickWeighted(d.p.map((x, i) => [i, x] as const)); }
        if (d.phase === 'racing') {
          d.frame++;
          d.pos = d.pos.map((x, i) => Math.min(DERBY.track, x + (i === d.winner ? 2 : rng.int(0, 2))));
          if (d.frame >= DERBY.frames) {
            d.pos[d.winner] = DERBY.track;
            if (!sessions.end(db, s.id)) return null;
            const lines = db.tx(() => d.bets.map((b) => {
              const win = b.horse === d.winner ? Math.floor(b.bet * d.odds[d.winner]!) : 0;
              const c: Ctx = { ...base, now, user: { id: b.user, name: b.name }, notes: [] };
              settle(c, guildId, 'roulette', b.bet, win);
              if (win) award(db, guildId, b.user, 'photo_finish', now);
              return win ? `**${b.name}** won ${format(win)}.` : null;
            }).filter(Boolean) as string[]);
            const [e, n] = HORSES[d.winner]!;
            return derbyView(d, [`${e} **${n}** wins at ${d.odds[d.winner]}x.`, ...(lines.length ? lines : ['No winning bets.'])].join('\n'));
          }
          sessions.save(db, s.id, d);
          return derbyView(d, 'They are off.');
        }
        return null;
      } } };
    }
    if (!live) throw new GameError('derby.none', `No race is taking bets here. Start one with \`${ctx.config.prefix}derby\`.`);
    const s = sessions.get<Derby>(ctx.db, live.id, ctx.now)!;
    if (s.state.phase !== 'betting' || ctx.now >= s.state.startsAt) throw new GameError('derby.closed', 'Bets are closed for this race.');
    const t = String(args.horse).trim().toLowerCase();
    const horse = /^[1-5]$/.test(t) ? Number(t) - 1 : HORSES.findIndex(([, n, tk]) => n.toLowerCase().startsWith(t) || tk.toLowerCase() === t);
    if (horse < 0) throw new GameError('derby.horse', `Choose a horse: ${HORSES.map(([e, n], i) => `${i + 1} ${e} ${n}`).join(', ')}.`);
    if (s.state.bets.some((b) => b.user === ctx.user.id)) throw new GameError('derby.once', 'One bet per race.');
    return ctx.db.tx(() => {
      const bet = parseAmount(args.amount, { all: Math.min(balance(ctx.db, wallet(guildId, ctx.user.id)), polygons(2500)), max: polygons(2500), min: CASINO.minBet });
      transfer(ctx.db, { from: wallet(guildId, ctx.user.id), to: RESERVE, cents: bet, reason: 'casino.bet', guildId, actorId: ctx.user.id, now: ctx.now, note: { game: 'derby' } });
      s.state.bets.push({ user: ctx.user.id, name: ctx.user.name, horse, bet });
      sessions.save(ctx.db, s.id, s.state);
      return { embeds: [embed('casino', 'Bet placed', [`${format(bet)} on ${HORSES[horse]![0]} **${HORSES[horse]![1]}** at ${s.state.odds[horse]}x.`])] };
    });
  }
};

// ================================================================ stats, drop-ins, receipts, a secret

export const gambling: Command = {
  name: 'gambling', aliases: ['casinostats', 'casino', 'gamblestats'], description: 'Your Rend-Sino record, game by game', system: 'casino', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const rows = ctx.db.all<{ game: string; played: number; wagered: number; paid: number; biggest: number }>('SELECT * FROM gambling WHERE guild_id = ? AND user_id = ? ORDER BY played DESC', guildId, ctx.user.id);
    const t = rows.reduce((a, r) => ({ played: a.played + r.played, wagered: a.wagered + r.wagered, paid: a.paid + r.paid }), { played: 0, wagered: 0, paid: 0 });
    return { embeds: [embed('casino', `Rend-Sino record: ${ctx.user.name}`, [
      ...(rows.length ? rows.map((r) => `**${NAMES[r.game as keyof typeof NAMES] ?? r.game}** · ${r.played} played · wagered ${format(r.wagered)} · paid ${format(r.paid)} · best ${format(r.biggest)}`) : ['No games played.']),
      '', `Total: ${t.played} games · ${t.paid >= t.wagered ? 'up' : 'down'} ${format(Math.abs(t.paid - t.wagered))}`])] };
  }
};

export const dropin: Command = {
  name: 'dropin', aliases: ['dropins', 'chatpay'], description: 'Moderators: TODD drop-ins on, off, only here, or anywhere', system: 'admin', guildOnly: true,
  options: [{ name: 'setting', type: 'string', description: 'on, off, here, or anywhere' }],
  run(ctx, args) {
    const g = guildOf(ctx);
    const v = String(args.setting ?? '').trim().toLowerCase();
    if (v && !ctx.isMod) throw new GameError('mod.only', 'This command is restricted to moderators (Manage Server).');
    if (v === 'on' || v === 'off') setDropinsOff(ctx.db, g, v === 'off');
    else if (v === 'here') setDropinHome(ctx.db, g, ctx.channelId ?? '');
    else if (v === 'anywhere') setDropinHome(ctx.db, g, '');
    else if (v) throw new GameError('dropin.setting', 'Use on, off, here, or anywhere.');
    const home = dropinHome(ctx.db, g);
    return { embeds: [embed('admin', 'TODD drop-ins', [dropinsOff(ctx.db, g) ? 'Drop-ins are **off** in this server.' : `Drop-ins are **on**, ${home ? `only in <#${home}>` : 'in any busy channel'}.`])] };
  }
};

export const receipts: Command = {
  name: 'receipts', aliases: ['receipt'], description: 'DMs about filled orders, broker reports and margin calls: on or off', system: 'wallet',
  options: [{ name: 'setting', type: 'string', description: 'on or off' }],
  run(ctx, args) {
    const v = String(args.setting ?? '').trim().toLowerCase();
    if (v === 'on' || v === 'off') ctx.db.setMeta(`receipts.off:${ctx.user.id}`, v === 'off' ? '1' : '0');
    const off = ctx.db.meta(`receipts.off:${ctx.user.id}`) === '1';
    return { content: `DM receipts are **${off ? 'off' : 'on'}**. Use \`${ctx.config.prefix}receipts ${off ? 'on' : 'off'}\` to change it.`, ephemeral: true };
  }
};

export const notFound: Command = {
  name: '404', description: 'Not found.', system: 'general', hidden: true,
  run(ctx) {
    const lucky = ctx.rng.chance(0.25);
    let dm = lucky ? '75.40' : 'Soon, friend.';
    if (lucky) { const line = award(ctx.db, ctx.guildId, ctx.user.id, 'soon_friend', ctx.now); ctx.notes.length = 0; if (line) dm += `\n${line}`; }
    return { silent: true, deleteTrigger: true, dm };
  }
};

let installed = false;
export function installExtras(): void {
  if (installed) return;
  installed = true;
  onTick((db, _m, now, rng) => drawLotteries(db, now, (w) => rng.pickWeighted(w)));
}

