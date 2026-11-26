// Publishing ("crossposting") in announcement channels, so servers that follow the channel get the post too.
// Discord allows 10 publishes per channel per hour (people and bots together), so the bot keeps to
// PUBLISH.perHour and leaves the rest for a person to publish by hand. Messages it can't publish stay posted
// in the channel as normal; only followers miss them.
import { ChannelType, Routes, type Client } from 'discord.js';

export const PUBLISH = { perHour: 8, windowMs: 3_600_000 };

let client: Client | null = null;
const recent = new Map<string, number[]>();

export function setPublisher(c: Client): void { client = c; }

/** Takes a slot from the channel's hourly allowance; false when it's used up. */
export function takeSlot(channelId: string, now = Date.now(), book = recent): boolean {
  const list = (book.get(channelId) ?? []).filter((t) => now - t < PUBLISH.windowMs);
  if (list.length >= PUBLISH.perHour) { book.set(channelId, list); return false; }
  list.push(now); book.set(channelId, list);
  return true;
}

/**
 * Publishes a message if its channel is an announcement channel. The bot needs Send Messages to publish
 * its own posts, and Manage Messages to publish a webhook's.
 */
export async function publish(channelId: string, messageId: string): Promise<boolean> {
  if (!client || !channelId || !messageId) return false;
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || ch.type !== ChannelType.GuildAnnouncement) return false;
  if (!takeSlot(channelId)) { console.log(`[publish] hourly limit reached in ${channelId}; left unpublished`); return false; }
  try {
    await client.rest.post(Routes.channelMessageCrosspost(channelId, messageId));
    return true;
  } catch (e) {
    console.error('[publish]', e instanceof Error ? e.message : e, '(does the bot have Manage Messages in that channel?)');
    return false;
  }
}

/** Posts to a webhook and publishes the message. Webhooks can't publish their own posts; the bot does it. */
export async function postHook(url: string, body: unknown): Promise<boolean> {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Webhook replied ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const msg = (await res.json().catch(() => null)) as { id?: string; channel_id?: string } | null;
  if (msg?.id && msg.channel_id) void publish(msg.channel_id, msg.id);
  return true;
}
