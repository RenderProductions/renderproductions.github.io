// The bot's own emojis. Upload the images in bot/emojis/ to the Developer Portal (your application ->
// Emojis) under the same names (rc_new, rc_changed, ...). On startup the bot looks them up by name, so no
// IDs need copying. Until an emoji is uploaded, the plain Unicode one stands in.
// Custom emojis show in message text, embed descriptions and field values, but not in embed titles.
import type { Client } from 'discord.js';

export const FALLBACK = { new: '🆕', changed: '🔧', fixed: '🩹', hotfix: '🔥', removed: '🗑️' } as const;
export type EmojiKey = keyof typeof FALLBACK;

const custom: Partial<Record<EmojiKey, string>> = {};

export const emoji = (k: EmojiKey): string => custom[k] ?? FALLBACK[k];

/** For tests, and for the startup lookup below. */
export function setCustomEmojis(list: { name: string | null; id: string; animated?: boolean | null }[]): string[] {
  const found: string[] = [];
  for (const e of list) {
    const k = e.name?.startsWith('rc_') ? (e.name.slice(3) as EmojiKey) : null;
    if (k && k in FALLBACK) { custom[k] = `<${e.animated ? 'a' : ''}:${e.name}:${e.id}>`; found.push(k); }
  }
  return found;
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
