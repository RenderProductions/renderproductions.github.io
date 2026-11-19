// The bot's own emojis. Upload the images in bot/emojis/ to the Developer Portal (your application ->
// Emojis) under the same names (rc_new, rc_changed, ...). On startup the bot looks them up by name, so no
// IDs need copying. Until an emoji is uploaded, the plain Unicode one stands in.
// Custom emojis show in message text, embed descriptions and field values, but not in embed titles.
// On startup the bot also uploads any rc_*.png in bot/emojis/ it doesn't have yet (EMOJI_SYNC=0 turns that off).
import fs from 'node:fs';
import path from 'node:path';
import type { Client } from 'discord.js';

export const FALLBACK = {
  // answers
  yes: '✅', no: '❌', time: '⌛',
  // slot reels
  cherry: '🍒', lemon: '🍋', bell: '🔔', triangle: '🔺', diamond: '💎',
  // update posts
  new: '🆕', changed: '🔧', fixed: '🩹', hotfix: '🔥', removed: '🗑️',
  // money
  polygon: '⬡', daily: '🌅', reserve: '🏦', savings: '🐷', receipt: '🧾',
  // work
  work: '💼', gig: '🛠️', promoted: '🎉',
  // market
  stonks: '📈', crash: '📉', up: '▲', down: '▼', quickadd: '⚡', company: '🏢', broker: '👔',
  // the Rend-Sino
  slots: '🎰', coinflip: '🪙', dice: '🎲', roulette: '🎡', blackjack: '🃏', mines: '💣', rocket: '🚀', hilo: '🔼',
  // fishing, the shop, TODD
  fishing: '🎣', shop: '🛍️', todd: '🖥️',
  // farming
  farm: '🌾', wateringcan: '💧', harvest: '🧺', newplot: '🪧', fertilizer: '🧪', greenhouse: '🏡', farmhand: '🧑‍🌾', compost: '♻️', scarecrow: '🧑‍🌾', crow: '🐦‍⬛', rain: '🌧️', storm: '⛈️',
  // people
  gift: '🎁', loan: '📜', heist: '🦹', lottery: '🎟️',
  // real estate
  connector: '🎩', heat: '★', heat_off: '☆', raid: '🚨',
  property: '🏠', repair: '🔨', tax: '🧾', bid: '✉️', auction: '🔨', sold: '🪧', key: '🔑', evict: '🚪', squatter: '🛌', fullset: '👑',
  // progress
  achievement: '🏆', leaderboard: '🏅', event: '🌐'
} as const;
export type EmojiKey = keyof typeof FALLBACK;

const custom: Record<string, string> = {};

export const emoji = (k: EmojiKey): string => custom[k] ?? FALLBACK[k];
/** For families of emojis (roulette pockets r0..r36, cards like cah or c10s): the bot's emoji, or a fallback. */
export const emojiOr = (name: string, fallback: string): string => custom[name] ?? fallback;
export const hasEmoji = (name: string): boolean => name in custom;

export const EMOJI_DIR = path.join(__dirname, '..', '..', '..', '..', 'bot', 'emojis');

/** For tests, and for the startup lookup below. */
export function setCustomEmojis(list: { name: string | null; id: string; animated?: boolean | null }[]): string[] {
  const found: string[] = [];
  for (const e of list) {
    const k = e.name?.startsWith('rc_') ? e.name.slice(3) : null;
    if (k) { custom[k] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`; found.push(k); }
  }
  return found;
}

/**
 * Uploads every rc_*.png in bot/emojis/ that the application doesn't have yet, one at a time
 * (discord.js waits out rate limits), then reloads. Returns how many were added.
 */
export async function syncAppEmojis(client: Client<true>, dir = EMOJI_DIR, log: (m: string) => void = console.log): Promise<number> {
  let files: string[];
  try { files = fs.readdirSync(dir).filter((f) => /^rc_[a-z0-9_]{1,29}\.png$/.test(f)); } catch { return 0; }
  const have = new Set((await client.application.emojis.fetch()).map((e) => e.name));
  const missing = files.filter((f) => !have.has(f.slice(0, -4)));
  if (!missing.length) return 0;
  log(`[emoji] uploading ${missing.length} new emojis...`);
  let added = 0;
  for (const f of missing) {
    try { await client.application.emojis.create({ attachment: path.join(dir, f), name: f.slice(0, -4) }); added++; }
    catch (e) { log(`[emoji] could not upload ${f}: ${(e as Error).message}`); }
  }
  await loadAppEmojis(client);
  log(`[emoji] uploaded ${added} of ${missing.length}.`);
  return added;
}

/** Fetches the application's emojis once the bot is ready. */
export async function loadAppEmojis(client: Client<true>): Promise<string[]> {
  try {
    const list = await client.application.emojis.fetch();
    return setCustomEmojis([...list.values()].map((e) => ({ name: e.name, id: e.id, animated: e.animated })));
  } catch (e) {
    console.error('[emoji] could not load application emojis:', (e as Error).message);
    return [];
  }
}
