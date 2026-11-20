// The Rend-Sino: rules every game shares. Bets go into the Reserve and winnings come out of it, paid
// in full. Every game has a stated house edge (see /odds), so over time the casino refills the Reserve.
import { addMoment, compact } from '../core/moments';
import { emojiOr } from '../discord/emoji';
import { bigNumber, compactPolygons } from '../discord/icons';
import { award, bump, getProgress, setProgress } from '../achievements/achievements';
import { isEvent } from '../events/world';
import type { Ctx } from '../commands/types';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, parseAmount, polygons, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { HOUR, MINUTE, dayKey, discordTime, takeCooldown } from '../core/time';
import type { Db } from '../core/db';
import { useEffect } from '../shop/inventory';
import { UG, useCharge } from '../underground/underground';

export type Game = 'slots' | 'coinflip' | 'dice' | 'roulette' | 'blackjack' | 'hilo' | 'mines' | 'rocket';

export const CASINO = {
  minBet: polygons(10),
  /** A win at least this far above the bet shows in big digits. */
  bigWin: polygons(100), statusWin: polygons(5_000),
  maxBet: { slots: polygons(1000), coinflip: polygons(2500), dice: polygons(2500), roulette: polygons(2500), blackjack: polygons(2500), hilo: polygons(2500), mines: polygons(2500), rocket: polygons(2500) } as Record<Game, Cents>,
  cooldownMs: 3000,
  /** An unfinished game is forfeited after this. */
  sessionMs: 2 * MINUTE,
  /** Win this many in a row and TODD throws you out... */
  hotStreak: 10,
  /** ...for this long. */
  banMs: 3 * HOUR
};

export const NAMES: Record<Game, string> = {
  slots: '🎰 Slots', coinflip: '🪙 Coinflip', dice: '🎲 Dice', roulette: '🎡 Roulette',
  blackjack: '🃏 Blackjack', hilo: '🔼 Higher or Lower', mines: '💣 Minesweeper', rocket: '🚀 Rocket'
};

/** The house edge and payout rules, for /odds. Every number here matches the code. */
export const ODDS: Record<Game, string> = {
  slots: 'Three of a kind: 🍒 3x · 🍋 5x · 🔔 8x · 🔺 10x · 💎 25x. Any pair returns the bet. Three 💎 also win the **progressive jackpot** (all of it at the max bet, a share of it below). Lose, and **Redeem yourself** spins 15 reels: 7 of a kind (about 9%) wins the bet back. Expected return: 93.2% before the jackpot.',
  coinflip: 'A correct call pays 1.95x. Expected return: 97.5%.',
  dice: 'Pays 96% of the fair odds for the chosen range. Expected return: 96%.',
  roulette: 'Red/black, odd/even, low/high pay 2x; dozens pay 3x; a single number pays 36x. The green 0 is the edge. Expected return: 97.3%.',
  blackjack: 'A win pays 2x, a blackjack 2.5x, a tie returns the bet. TODD stands on 17. Expected return: about 99% with good play.',
  hilo: 'Each correct guess multiplies by 96% of its fair odds (capped at 100x). Expected return: 96% per guess.',
  mines: 'Each safe tile multiplies by 96% of its fair odds. Expected return: 96%.',
  rocket: 'The chance of reaching a multiplier x is 96% ÷ x (capped at 50x, or 100x in a server that built the Rocket). Expected return: 96%.'
};

const subject = (ctx: Ctx) => `${ctx.guildId}:${ctx.user.id}`;

export function bannedUntil(ctx: Ctx, guildId: string): number {
  const until = ctx.db.get<{ ban_until: number }>('SELECT ban_until FROM casino WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id)?.ban_until ?? 0;
  return until > ctx.now ? until : 0;
}

// ---------------------------------------------------------------- Make Gambling Fun Again
/** The progressive jackpot: every bet in the server feeds it; three diamonds on Slots win it. */
export const JACKPOT = { seed: polygons(10_000), cut: 0.01, happyCut: 0.03 };
export const jackpotOf = (db: Db, guildId: string): Cents => Number(db.meta(`casino.jackpot:${guildId}`) ?? JACKPOT.seed);
export const happyHour = (db: Db, now: number): boolean => isEvent(db, 'happy_hour', undefined, now);
/** Pays the jackpot (a share of it below the max Slots bet) and starts it again from the seed. */
export function winJackpot(ctx: Ctx, guildId: string, bet: Cents): Cents {
  const pot = jackpotOf(ctx.db, guildId);
  const want = Math.floor(pot * Math.min(1, bet / CASINO.maxBet.slots));
  const cents = Math.min(want, balance(ctx.db, RESERVE));
  if (cents > 0) transfer(ctx.db, { from: RESERVE, to: wallet(guildId, ctx.user.id), cents, reason: 'casino.jackpot', guildId, actorId: ctx.user.id, now: ctx.now });
  ctx.db.setMeta(`casino.jackpot:${guildId}`, String(Math.max(JACKPOT.seed, pot - cents)));
  award(ctx.db, guildId, ctx.user.id, 'progressive', ctx.now);
  addMoment(`💎 Someone just hit the progressive jackpot for ${compact(cents)}`, ctx.now);
  return cents;
}

/** VIP levels, by everything you've ever bet in this server. Each comes with a daily free spin on Slots. */
export const VIP = [
  { name: 'Bronze', emoji: '🥉', at: polygons(25_000), spin: polygons(50) },
  { name: 'Silver', emoji: '🥈', at: polygons(100_000), spin: polygons(100) },
  { name: 'Gold', emoji: '🥇', at: polygons(500_000), spin: polygons(250) },
  { name: 'Platinum', emoji: '💿', at: polygons(2_000_000), spin: polygons(500) },
  { name: 'Diamond', emoji: '💎', at: polygons(10_000_000), spin: polygons(1_000) }
];
export const wageredBy = (db: Db, guildId: string, userId: string): Cents =>
  db.get<{ n: number | null }>('SELECT SUM(wagered) AS n FROM gambling WHERE guild_id = ? AND user_id = ?', guildId, userId)?.n ?? 0;
/** The VIP level (-1: not a VIP yet), what's been wagered and the next level. */
export function vipOf(db: Db, guildId: string, userId: string): { level: number; tier: (typeof VIP)[number] | null; wagered: Cents; next: (typeof VIP)[number] | null } {
  const wagered = wageredBy(db, guildId, userId);
  let level = -1;
  VIP.forEach((t, i) => { if (wagered >= t.at) level = i; });
  return { level, tier: VIP[level] ?? null, wagered, next: VIP[level + 1] ?? null };
}
/** Free spins left today (one a day, two during Happy Hour). */
export function freeSpinsLeft(db: Db, guildId: string, userId: string, now: number): number {
  if (vipOf(db, guildId, userId).level < 0) return 0;
  const r = db.get<{ free_day: string | null; free_used: number }>('SELECT free_day, free_used FROM casino WHERE guild_id = ? AND user_id = ?', guildId, userId);
  const used = r?.free_day === dayKey(now) ? r.free_used : 0;
  return Math.max(0, (happyHour(db, now) ? 2 : 1) - used);
}
export function useFreeSpin(db: Db, guildId: string, userId: string, now: number): void {
  db.run('INSERT OR IGNORE INTO casino (guild_id, user_id) VALUES (?, ?)', guildId, userId);
  const r = db.get<{ free_day: string | null; free_used: number }>('SELECT free_day, free_used FROM casino WHERE guild_id = ? AND user_id = ?', guildId, userId)!;
  const today = dayKey(now);
  db.run('UPDATE casino SET free_day = ?, free_used = ? WHERE guild_id = ? AND user_id = ?', today, r.free_day === today ? r.free_used + 1 : 1, guildId, userId);
}

/** Checks that may refuse gambling (loans add one: no gambling while you owe TODD). */
const gates: ((ctx: Ctx, guildId: string) => string | null)[] = [];
export const addGamblingGate = (fn: (ctx: Ctx, guildId: string) => string | null): void => { gates.push(fn); };

/** The live casino game this player has, if any. */
export function activeGame(ctx: Ctx): sessions.Session | null {
  const row = ctx.db.get<{ id: string }>("SELECT id FROM sessions WHERE user_id = ? AND guild_id = ? AND kind LIKE 'casino.%' AND expires_at > ?", ctx.user.id, ctx.guildId, ctx.now);
  return row ? sessions.get(ctx.db, row.id, ctx.now) : null;
}

/** Checks and takes a bet (into the Reserve). Returns the bet in cents. */
export function takeBet(ctx: Ctx, guildId: string, game: Game, raw: string | number | undefined): Cents {
  const bet = checkBet(ctx, guildId, game, raw);
  if (!takeCooldown(ctx.db, 'casino', subject(ctx), CASINO.cooldownMs, ctx.now)) throw new GameError('casino.cooldown', 'One moment between games.');
  const w = wallet(guildId, ctx.user.id), max = CASINO.maxBet[game];
  transfer(ctx.db, { from: w, to: RESERVE, cents: bet, reason: 'casino.bet', guildId, actorId: ctx.user.id, now: ctx.now, note: { game } });
  afterBet(ctx, guildId, game, bet);
  if (bet === max) award(ctx.db, guildId, ctx.user.id, 'high_roller', ctx.now);
  return bet;
}

/** Everything takeBet checks (bans, gates, a game in progress, limits, funds) without taking anything. */
export function checkBet(ctx: Ctx, guildId: string, game: Game, raw: string | number | undefined): Cents {
  let ban = bannedUntil(ctx, guildId);
  // No Questions Asked: a Fake ID gets you past TODD
  if (ban && useCharge(ctx.db, guildId, ctx.user.id, 'fake_id')) {
    ctx.db.run('UPDATE casino SET ban_until = 0 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
    ctx.notes.push(`${emojiOr('fake_id', '🪪')} You show TODD a Fake ID. He squints at it for a long time, then lets you in.`);
    ban = 0;
  }
  if (ban) throw new GameError('casino.banned', `TODD has barred you from the Rend-Sino for winning too much. You may return ${discordTime(ban)}.`);
  for (const g of gates) { const no = g(ctx, guildId); if (no) throw new GameError('casino.gate', no); }
  if (activeGame(ctx)) throw new GameError('casino.busy', 'Finish your current game first.');
  const w = wallet(guildId, ctx.user.id);
  const max = CASINO.maxBet[game];
  const bet = parseAmount(raw, { all: Math.min(balance(ctx.db, w), max), max, min: CASINO.minBet });
  if (balance(ctx.db, w) < bet) throw new GameError('funds.short', `Insufficient Polygons. The balance is ${format(balance(ctx.db, w))}.`);
  return bet;
}

/** Everything a bet feeds: the stats (and VIP), the jackpot, Fun Again. */
export function afterBet(ctx: Ctx, guildId: string, game: Game, bet: Cents): void {
  const before = vipOf(ctx.db, guildId, ctx.user.id).level;
  stat(ctx, guildId, game, { played: 1, wagered: bet });
  const after = vipOf(ctx.db, guildId, ctx.user.id);
  if (after.level > before && after.tier) {
    ctx.notes.push(`${after.tier.emoji} **VIP: ${after.tier.name}!** You've bet ${format(after.tier.at)} here. Your daily free spin is worth ${format(after.tier.spin)}: \`${ctx.config.prefix}vip spin\``);
    if (after.level === VIP.length - 1) award(ctx.db, guildId, ctx.user.id, 'high_society', ctx.now);
  }
  const cut = Math.floor(bet * (happyHour(ctx.db, ctx.now) ? JACKPOT.happyCut : JACKPOT.cut));
  if (cut > 0) ctx.db.setMeta(`casino.jackpot:${guildId}`, String(jackpotOf(ctx.db, guildId) + cut));
  const today = Number(dayKey(ctx.now).replace(/-/g, ''));
  setProgress(ctx.db, ctx.user.id, `played_${game}`, today);
  if ((Object.keys(NAMES) as Game[]).every((g) => getProgress(ctx.db, ctx.user.id, `played_${g}`) === today)) award(ctx.db, guildId, ctx.user.id, 'fun_again', ctx.now);
}

/**
 * Pays out a finished game (the bet included, if it comes back). Applies a Platinum Chip, counts the
 * win streak (TODD's ban) and the achievements. Returns the extra lines for the reply.
 */
export function settle(ctx: Ctx, guildId: string, game: Game, bet: Cents, payout: Cents): { paid: Cents; lines: string[] } {
  const lines: string[] = [];
  // No Questions Asked: Loaded Dice (five games of better odds, if TODD doesn't spot them)
  if (useCharge(ctx.db, guildId, ctx.user.id, 'dice')) {
    if (ctx.rng.next() < UG.diceCatch) {
      ctx.db.run('UPDATE underground SET dice = 0 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
      const until = ctx.now + CASINO.banMs;
      ctx.db.run('INSERT OR IGNORE INTO casino (guild_id, user_id) VALUES (?, ?)', guildId, ctx.user.id);
      ctx.db.run('UPDATE casino SET ban_until = ? WHERE guild_id = ? AND user_id = ?', until, guildId, ctx.user.id);
      lines.push(`${emojiOr('loaded_dice', '🎲')} **TODD spots the Loaded Dice.** He takes them and shows you the door until ${discordTime(until, 't')}.`);
    } else if (payout < bet && ctx.rng.next() < UG.diceSave) {
      payout = bet;
      lines.push(`${emojiOr('loaded_dice', '🎲')} The Loaded Dice roll your way: your bet comes back.`);
    }
  }
  let paid = Math.max(0, Math.round(payout));
  if (paid > 0 && useEffect(ctx.db, guildId, ctx.user.id, 'chip')) { paid = Math.round(paid * 1.04); lines.push('Platinum Chip: +4%.'); }
  if (paid > 0) transfer(ctx.db, { from: RESERVE, to: wallet(guildId, ctx.user.id), cents: paid, reason: 'casino.win', guildId, actorId: ctx.user.id, now: ctx.now, note: { game } });
  stat(ctx, guildId, game, { paid, biggest: paid });

  const result = payout > bet ? 'win' : payout === bet ? 'push' : 'loss';
  // a real win gets its amount in big gold digits above the result
  if (paid - bet >= CASINO.bigWin) ctx.big = bigNumber('+' + compactPolygons(paid - bet)) ?? undefined;
  if (paid - bet >= CASINO.statusWin) addMoment(`🎰 Someone just won ${compact(paid - bet)} on ${NAMES[game]}`, ctx.now);
  if (paid > 0) { award(ctx.db, guildId, ctx.user.id, 'beginners_luck', ctx.now); setProgress(ctx.db, ctx.user.id, 'loss_streak', 0); }
  else if (bump(ctx.db, ctx.user.id, 'loss_streak') >= 10) award(ctx.db, guildId, ctx.user.id, 'down_bad', ctx.now);

  if (result !== 'push') {
    ctx.db.run('INSERT OR IGNORE INTO casino (guild_id, user_id) VALUES (?, ?)', guildId, ctx.user.id);
    if (result === 'loss') ctx.db.run('UPDATE casino SET win_streak = 0 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
    else {
      ctx.db.run('UPDATE casino SET win_streak = win_streak + 1 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
      const n = ctx.db.get<{ win_streak: number }>('SELECT win_streak FROM casino WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id)!.win_streak;
      // Happy Hour: TODD looks the other way
      if (n >= CASINO.hotStreak && !happyHour(ctx.db, ctx.now)) {
        const until = ctx.now + CASINO.banMs;
        ctx.db.run('UPDATE casino SET win_streak = 0, ban_until = ? WHERE guild_id = ? AND user_id = ?', until, guildId, ctx.user.id);
        award(ctx.db, guildId, ctx.user.id, 'escorted_out', ctx.now);
        lines.push(`**TODD escorts you out of the Rend-Sino.** ${CASINO.hotStreak} wins in a row is not luck. You keep your winnings, but gambling is closed to you until ${discordTime(until, 't')} (${discordTime(until)}).`);
      }
    }
  }
  lines.push(`Balance: ${format(balance(ctx.db, wallet(guildId, ctx.user.id)))}`);
  return { paid, lines };
}

function stat(ctx: Ctx, guildId: string, game: string, s: { played?: number; wagered?: number; paid?: number; biggest?: number }): void {
  ctx.db.run('INSERT OR IGNORE INTO gambling (guild_id, user_id, game) VALUES (?, ?, ?)', guildId, ctx.user.id, game);
  ctx.db.run('UPDATE gambling SET played = played + ?, wagered = wagered + ?, paid = paid + ?, biggest = MAX(biggest, ?) WHERE guild_id = ? AND user_id = ? AND game = ?',
    s.played ?? 0, s.wagered ?? 0, s.paid ?? 0, s.biggest ?? 0, guildId, ctx.user.id, game);
}

export const mult = (m: number): string => `${(Math.floor(m * 100) / 100).toFixed(2)}x`;

// ---------------------------------------------------------------- cards
export interface Card { r: number; suit: string; icon: string; red: boolean }
const SUITS: [string, string, boolean][] = [['hearts', '♥️', true], ['diamonds', '♦️', true], ['clubs', '♣️', false], ['spades', '♠️', false]];
const FACE: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
export function deck(shuffle: <T>(l: readonly T[]) => T[]): Card[] {
  const d: Card[] = [];
  for (const [suit, icon, red] of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, suit, icon, red });
  return shuffle(d);
}
/** A card: the bot's card emoji (cah, c10s...) once uploaded, else rank and suit as text. */
export const cardText = (c: Card): string => emojiOr(`c${(FACE[c.r] ?? String(c.r)).toLowerCase()}${c.suit[0]}`, `\`${FACE[c.r] ?? c.r}${c.icon}\``);
export const cardBack = (): string => emojiOr('cardback', '`??`');
