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
