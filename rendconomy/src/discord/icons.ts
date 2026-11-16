// Which RendConomy emoji stands for what. Each falls back to a standard emoji until the bot's own are uploaded.
// Shop items and catches use their item id as the emoji name (rc_coffee, rc_fish_minnow, rc_seed_carrot...).
import { CATEGORIES, RARITY, type Category, type Rarity } from '../achievements/list';
import type { System } from '../commands/types';
import { emojiOr } from './emoji';

export const rarityE = (r: Rarity): string => emojiOr(`rarity_${r}`, RARITY[r].emoji);
export const lockedE = (): string => emojiOr('locked', '🔒');
export const itemE = (id: string, fallback: string): string => emojiOr(id, fallback);

const CATEGORY_KEY: Record<string, string> = {
  start: 'start', market: 'stonks', jobs: 'work', casino: 'slots', social: 'social', companies: 'company', heists: 'heist',
  fishing: 'fishing', farming: 'farm', holiday: 'holiday', mastery: 'mastery', secret: 'secret'
};
export const categoryE = (c: Category): string => emojiOr(CATEGORY_KEY[c] ?? c, CATEGORIES[c].emoji);

const SECTION_KEY: Record<System, string> = {
  wallet: 'polygon', farm: 'farm', social: 'social', work: 'work', market: 'stonks', casino: 'slots', reserve: 'reserve', general: 'general', admin: 'admin'
};
export const sectionE = (s: System, fallback: string): string => emojiOr(SECTION_KEY[s], fallback);

// ---------------------------------------------------------------- big numbers ("Business, Numbers, Working!")
// Frameless gold digits (rc_n0…rc_n9) plus . x % + - K M. Only worth it where Discord shows emojis jumbo:
// a message whose text is nothing but emojis. Returns null if any of them isn't uploaded yet.
const NUM_KEY: Record<string, string> = { '.': 'ndot', x: 'nx', '%': 'npct', '+': 'nplus', '-': 'nminus', K: 'nk', M: 'nm' };
export function bigNumber(text: string): string | null {
  const parts: string[] = [];
  for (const ch of text) {
    const key = /\d/.test(ch) ? `n${ch}` : NUM_KEY[ch];
    if (!key) return null;
    const e = emojiOr(key, '');
    if (!e) return null;
    parts.push(e);
  }
  return parts.length ? parts.join('') : null;
}
/** Polygons as a short number for the big digits: 450, 4.5K, 1.25M (cents dropped). */
export function compactPolygons(cents: number): string {
  const p = Math.floor(Math.abs(cents) / 100);
  const trim = (s: string) => s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (p >= 1_000_000) return trim((p / 1_000_000).toFixed(2)) + 'M';
  if (p >= 10_000) return trim((p / 1_000).toFixed(1)) + 'K';
  if (p >= 1_000) return trim((p / 1_000).toFixed(2)) + 'K';
  return String(p);
}
