// Profile looks: what a player's profile card looks like on the site (and its color in /profile).
// Styles follow a player to every server. The Customizer Kit unlocks any accent color, the preset themes
// and the basic banners. Profile Paints unlock fancy themes, one each. Legendary or mythic achievements
// unlock the crown banner and the glowing frame. The site draws these from names, never raw CSS.
import { getProgress, setProgress, unlocked } from '../achievements/achievements';
import { BY_ID } from '../achievements/list';
import type { Db } from '../core/db';

export const PRESETS: Record<string, { label: string; hex: string }> = {
  gold: { label: 'Gold', hex: '#ffe600' }, market: { label: 'Market green', hex: '#3ddc84' }, rrm: { label: 'Render Room red', hex: '#ff5c61' },
  nach: { label: 'Nacho orange', hex: '#ff9f1c' }, blu: { label: 'BLU blue', hex: '#4da3ff' }, bnw: { label: 'BNW teal', hex: '#2ee6c5' },
  bstg: { label: 'BSTG purple', hex: '#b46cff' }, bot: { label: 'Blurple', hex: '#8c9bff' }, games: { label: 'Arcade pink', hex: '#ff4fd8' }, notes: { label: 'Cyan', hex: '#38e1ff' }
};
export const PAINTS: Record<string, { label: string; hex: string; emoji: string }> = {
  holo: { label: 'Holographic', hex: '#c9a7ff', emoji: '🌈' }, terminal: { label: 'TODD Terminal', hex: '#33ff66', emoji: '🖥️' },
  sunset: { label: 'Sunset', hex: '#ff7a59', emoji: '🌇' }, void: { label: 'Void', hex: '#e8e8e8', emoji: '🕳️' }, goldrush: { label: 'Gold Rush', hex: '#ffcf33', emoji: '🪙' }
};
export const BANNERS: Record<string, string> = { gradient: 'Gradient', scanlines: 'Scanlines', honeycomb: 'Honeycomb', grid: 'Grid', stars: 'Stars', crown: 'Crown (legendary achievements)' };
export const FRAMES: Record<string, string> = { none: 'None', glow: 'Glow (legendary achievements)' };
const LEGENDARY_ONLY = new Set(['crown', 'glow']);

export interface Style { theme?: string; color?: string; banner?: string; frame?: string; pin?: string }

export const getStyle = (db: Db, userId: string): Style => { try { return JSON.parse(db.meta(`style:${userId}`) ?? '{}') as Style; } catch { return {}; } };
const save = (db: Db, userId: string, s: Style) => db.setMeta(`style:${userId}`, JSON.stringify(s));
export const hasKit = (db: Db, userId: string): boolean => getProgress(db, userId, 'customizer') > 0;
export const ownsPaint = (db: Db, userId: string, id: string): boolean => getProgress(db, userId, `paint_${id}`) > 0;
export const unlockKit = (db: Db, userId: string): void => setProgress(db, userId, 'customizer', 1);
export const unlockPaint = (db: Db, userId: string, id: string): void => setProgress(db, userId, `paint_${id}`, 1);
const legendary = (db: Db, userId: string) => unlocked(db, userId).some((r) => ['legendary', 'mythic'].includes(BY_ID[r.id]?.rarity ?? ''));

/** What a player may pick from, for the site's customizer. */
export function looksFor(db: Db, userId: string): { kit: boolean; paints: string[]; legendary: boolean } {
  return { kit: hasKit(db, userId), paints: Object.keys(PAINTS).filter((id) => ownsPaint(db, userId, id)), legendary: legendary(db, userId) };
}

/** The accent color as a number, for embeds. */
export function styleColor(db: Db, userId: string, fallback: number): number {
  const s = getStyle(db, userId);
  const hex = s.color ?? (s.theme ? (PRESETS[s.theme] ?? PAINTS[s.theme])?.hex : undefined);
  return hex ? parseInt(hex.slice(1), 16) : fallback;
}

/** Changes one setting. Returns a confirmation, or throws a message for the player. */
export function setStyle(db: Db, userId: string, what: string, value: string, prefix: string): string {
  const s = getStyle(db, userId);
  const v = value.trim().toLowerCase();
  if (what === 'reset') { save(db, userId, {}); return 'Your profile has been reset to the default look.'; }
  if (what === 'pin') { if (!v || v === 'none') { delete s.pin; save(db, userId, s); return 'Nothing is pinned.'; } s.pin = v; save(db, userId, s); return 'Collectible pinned.'; }
  if (!hasKit(db, userId)) throw new Error(`A Profile Customizer Kit is required. Marquez sells them: \`${prefix}shop profile\`.`);
  if (what === 'color') {
    const m = /^#?([0-9a-f]{6})$/.exec(v);
    if (!m) throw new Error('Colors are six-digit hex codes, for example `#ff4fd8`.');
    s.color = `#${m[1]}`; if (s.theme && PAINTS[s.theme]) delete s.theme; save(db, userId, s);
    return `Your profile color is now **#${m[1]}**.`;
  }
  if (what === 'theme') {
    if (PRESETS[v]) { s.theme = v; delete s.color; save(db, userId, s); return `Your profile theme is now **${PRESETS[v]!.label}**.`; }
    if (PAINTS[v]) {
      if (!ownsPaint(db, userId, v)) throw new Error(`**${PAINTS[v]!.label}** is a Profile Paint. Buy it from Marquez, then use it.`);
      s.theme = v; delete s.color; save(db, userId, s); return `Your profile theme is now **${PAINTS[v]!.label}**.`;
    }
    throw new Error(`Themes: ${Object.keys(PRESETS).join(', ')}, or a Profile Paint you own (${Object.keys(PAINTS).join(', ')}).`);
  }
  if (what === 'banner' || what === 'frame') {
    const list = what === 'banner' ? BANNERS : FRAMES;
    if (!list[v]) throw new Error(`${what === 'banner' ? 'Banners' : 'Frames'}: ${Object.keys(list).join(', ')}.`);
    if (LEGENDARY_ONLY.has(v) && !legendary(db, userId)) throw new Error('That one is reserved for players with a legendary or mythic achievement.');
    s[what] = v; save(db, userId, s);
    return `Your profile ${what} is now **${list[v]}**.`;
  }
  throw new Error(`Use \`${prefix}profile color|theme|banner|frame|pin|reset <value>\`.`);
}
