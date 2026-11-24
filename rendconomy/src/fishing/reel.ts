// The Fishy Deep: reeling in. Medium and bigger fish fight back. Each press is a round: Reel (progress up, tension
// up) or Let Out (tension down, progress down a little), and the fish does something too (pulls, rests, runs).
// Tension past what the rod holds: the line snaps. Progress to 100: landed. Progress to 0, or 60 seconds: it's gone.
import type { Rng } from '../core/rng';

export const REEL = { ms: 60_000, start: 25, reel: { progress: 17, tension: 12 }, letOut: { progress: -4, tension: -24 }, perStrength: 0.8 };

export interface ReelState { progress: number; tension: number; max: number; strength: number; last: string; rounds: number }
export type ReelMove = 'reel' | 'let';

export const startReel = (strength: number, maxTension: number): ReelState => ({ progress: REEL.start, tension: 20, max: maxTension, strength, last: 'It\'s on the line! It fights back.', rounds: 0 });

/** One round. Returns the new state and whether it ended. */
export function reelStep(st: ReelState, move: ReelMove, rng: Rng): { st: ReelState; end: null | 'landed' | 'snapped' | 'escaped' } {
  const s = { ...st, rounds: st.rounds + 1 };
  const k = s.strength;
  if (move === 'reel') { s.progress += REEL.reel.progress - k * REEL.perStrength; s.tension += REEL.reel.tension; }
  else { s.progress += REEL.letOut.progress; s.tension += REEL.letOut.tension; }
  // the fish's turn: stronger fish pull and run more
  const roll = rng.next();
  const pull = 0.2 + 0.04 * k, run = pull + 0.12 + 0.04 * k;
  if (roll < pull) { s.tension += 4 + 1.6 * k; s.progress -= 1 + k; s.last = 'It **pulls** hard! The line goes tight.'; }
  else if (roll < run) { s.progress -= 3 + k; s.tension += 2 + k; s.last = 'It **runs**, taking line with it.'; }
  else { s.tension -= 8; s.last = 'It **rests** for a moment.'; }
  s.tension = Math.max(0, Math.round(s.tension));
  s.progress = Math.min(100, Math.round(s.progress));
  if (s.tension >= s.max) return { st: s, end: 'snapped' };
  if (s.progress >= 100) return { st: s, end: 'landed' };
  if (s.progress <= 0) return { st: s, end: 'escaped' };
  return { st: s, end: null };
}

/** A bar of ten blocks. */
export const bar = (v: number, max: number, full = '🟩', hot = '🟥', empty = '⬛'): string => {
  const n = Math.max(0, Math.min(10, Math.round((v / max) * 10)));
  return (n >= 8 ? hot : full).repeat(n) + empty.repeat(10 - n);
};
