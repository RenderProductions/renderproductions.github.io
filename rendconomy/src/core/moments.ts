// Big moments the bot's status can shout about: a huge casino win, a jackpot, a heist, a Monopoly.
// Kept in memory (a restart just starts fresh). The status shows every server the bot is in, so a moment
// never names a player or a server: it's always "someone".
export interface Moment { text: string; at: number; shown: boolean }

const moments: Moment[] = [];
let listener: (() => void) | null = null;

/** Records a moment (newest first, at most 12) and nudges the status to show it soon. */
export function addMoment(text: string, now = Date.now()): void {
  moments.unshift({ text: text.slice(0, 128), at: now, shown: false });
  if (moments.length > 12) moments.length = 12;
  try { listener?.(); } catch { /* the status will catch up on its next turn */ }
}
/** The newest moment that hasn't been shown yet and isn't stale; marks it shown. */
export function takeMoment(now = Date.now(), maxAgeMs = 10 * 60_000): Moment | null {
  const m = moments.find((x) => !x.shown && now - x.at <= maxAgeMs) ?? null;
  if (m) m.shown = true;
  return m;
}
export const onMoment = (fn: (() => void) | null): void => { listener = fn; };
export const recentMoments = (): readonly Moment[] => moments;
export const clearMoments = (): void => { moments.length = 0; };

/** ⬡12.4K-style amounts for status lines. */
export function compact(cents: number): string {
  const p = Math.floor(Math.abs(cents) / 100);
  const trim = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (p >= 1_000_000) return `⬡${trim((p / 1_000_000).toFixed(2))}M`;
  if (p >= 10_000) return `⬡${trim((p / 1_000).toFixed(1))}K`;
  return `⬡${p.toLocaleString('en-US')}`;
}
