// The Rend-Sino: rules every game shares. Bets go into the Reserve and winnings come out of it, paid
// in full. Every game has a stated house edge (see /odds), so over time the casino refills the Reserve.
import { awardHere, bump, setProgress } from '../achievements/achievements';
import type { Ctx } from '../commands/types';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, parseAmount, polygons, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { HOUR, MINUTE, discordTime, takeCooldown } from '../core/time';
import { useEffect } from '../shop/inventory';

export type Game = 'slots' | 'coinflip' | 'dice' | 'roulette' | 'blackjack' | 'hilo' | 'mines' | 'rocket';

export const CASINO = {
  minBet: polygons(10),
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
  slots: 'Three of a kind: 🍒 3x · 🍋 5x · 🔔 8x · 🔺 10x · 💎 25x. Any pair returns the bet. Expected return: 88.8%.',
  coinflip: 'A correct call pays 1.95x. Expected return: 97.5%.',
  dice: 'Pays 96% of the fair odds for the chosen range. Expected return: 96%.',
  roulette: 'Red/black, odd/even, low/high pay 2x; dozens pay 3x; a single number pays 36x. The green 0 is the edge. Expected return: 97.3%.',
  blackjack: 'A win pays 2x, a blackjack 2.5x, a tie returns the bet. TODD stands on 17. Expected return: about 99% with good play.',
  hilo: 'Each correct guess multiplies by 96% of its fair odds (capped at 100x). Expected return: 96% per guess.',
  mines: 'Each safe tile multiplies by 96% of its fair odds. Expected return: 96%.',
  rocket: 'The chance of reaching a multiplier x is 96% ÷ x (capped at 50x). Expected return: 96%.'
};

const subject = (ctx: Ctx) => `${ctx.guildId}:${ctx.user.id}`;

export function bannedUntil(ctx: Ctx, guildId: string): number {
  const until = ctx.db.get<{ ban_until: number }>('SELECT ban_until FROM casino WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id)?.ban_until ?? 0;
  return until > ctx.now ? until : 0;
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
  const ban = bannedUntil(ctx, guildId);
  if (ban) throw new GameError('casino.banned', `TODD has barred you from the Rend-Sino for winning too much. You may return ${discordTime(ban)}.`);
  for (const g of gates) { const no = g(ctx, guildId); if (no) throw new GameError('casino.gate', no); }
  if (activeGame(ctx)) throw new GameError('casino.busy', 'Finish your current game first.');
  const w = wallet(guildId, ctx.user.id);
  const max = CASINO.maxBet[game];
  const bet = parseAmount(raw, { all: Math.min(balance(ctx.db, w), max), max, min: CASINO.minBet });
  if (balance(ctx.db, w) < bet) throw new GameError('funds.short', `Insufficient Polygons. The balance is ${format(balance(ctx.db, w))}.`);
  if (!takeCooldown(ctx.db, 'casino', subject(ctx), CASINO.cooldownMs, ctx.now)) throw new GameError('casino.cooldown', 'One moment between games.');
  transfer(ctx.db, { from: w, to: RESERVE, cents: bet, reason: 'casino.bet', guildId, actorId: ctx.user.id, now: ctx.now, note: { game } });
  stat(ctx, guildId, game, { played: 1, wagered: bet });
  if (bet === max) awardHere('high_roller');
  return bet;
}

/**
 * Pays out a finished game (the bet included, if it comes back). Applies a Platinum Chip, counts the
 * win streak (TODD's ban) and the achievements. Returns the extra lines for the reply.
 */
export function settle(ctx: Ctx, guildId: string, game: Game, bet: Cents, payout: Cents): { paid: Cents; lines: string[] } {
  const lines: string[] = [];
  let paid = Math.max(0, Math.round(payout));
  if (paid > 0 && useEffect(ctx.db, guildId, ctx.user.id, 'chip')) { paid = Math.round(paid * 1.04); lines.push('Platinum Chip: +4%.'); }
  if (paid > 0) transfer(ctx.db, { from: RESERVE, to: wallet(guildId, ctx.user.id), cents: paid, reason: 'casino.win', guildId, actorId: ctx.user.id, now: ctx.now, note: { game } });
  stat(ctx, guildId, game, { paid, biggest: paid });

  const result = payout > bet ? 'win' : payout === bet ? 'push' : 'loss';
  if (paid > 0) { awardHere('beginners_luck'); setProgress(ctx.db, ctx.user.id, 'loss_streak', 0); }
  else if (bump(ctx.db, ctx.user.id, 'loss_streak') >= 10) awardHere('down_bad');

  if (result !== 'push') {
    ctx.db.run('INSERT OR IGNORE INTO casino (guild_id, user_id) VALUES (?, ?)', guildId, ctx.user.id);
    if (result === 'loss') ctx.db.run('UPDATE casino SET win_streak = 0 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
    else {
      ctx.db.run('UPDATE casino SET win_streak = win_streak + 1 WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
      const n = ctx.db.get<{ win_streak: number }>('SELECT win_streak FROM casino WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id)!.win_streak;
      if (n >= CASINO.hotStreak) {
        const until = ctx.now + CASINO.banMs;
        ctx.db.run('UPDATE casino SET win_streak = 0, ban_until = ? WHERE guild_id = ? AND user_id = ?', until, guildId, ctx.user.id);
        awardHere('escorted_out');
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
export const cardText = (c: Card): string => `\`${FACE[c.r] ?? c.r}${c.icon}\``;
