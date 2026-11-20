// Linked Roles: servers can give out roles based on a player's real Rend-Conomy stats (Server Settings →
// Roles → Links → Render's Vision). Discord allows five stats per app, and they belong to the player, not to
// one server, so each is the player's best across every server they play in.
//
// The bot registers the five with Discord when it starts, and sends everyone's numbers to the Worker
// (private: not part of the public profiles feed). Players link at the Worker's /linked-roles page, and the
// Worker keeps their numbers up to date with Discord.
import type { Client } from 'discord.js';
import { ownedBy as companyOf } from '../companies/companies';
import type { Db } from '../core/db';
import { load as loadMarket } from '../market/market';
import { netWorth } from '../social/worth';

/** Discord's comparison types: 2 = at least this number, 5 = at least this many days ago, 7 = yes/no. */
export const ROLE_METADATA = [
  { key: 'networth', name: 'Net worth (Polygons)', description: 'Net worth in their richest server, at least', type: 2 },
  { key: 'achievements', name: 'Achievements', description: 'Achievements unlocked, at least', type: 2 },
  { key: 'properties', name: 'Properties', description: 'Buildings owned in one server (the city), at least', type: 2 },
  { key: 'company', name: 'Company founder', description: 'Runs a player company', type: 7 },
  { key: 'since', name: 'Days playing', description: 'Days since they started playing, at least', type: 5 }
] as const;

export interface RoleStats { name: string; networth: number; achievements: number; properties: number; company: number; since: string }

/** Everyone's five stats (whole Polygons; dates as ISO strings), keyed by user id. */
export function roleStats(db: Db, botId: string | null = null): Record<string, RoleStats> {
  const m = loadMarket(db);
  const out: Record<string, RoleStats> = {};
  for (const p of db.all<{ guild_id: string; user_id: string; name: string | null; joined_at: number }>('SELECT guild_id, user_id, name, joined_at FROM players')) {
    if (p.user_id === botId) continue;
    const s = (out[p.user_id] ??= { name: p.name ?? 'Player', networth: 0, achievements: 0, properties: 0, company: 0, since: new Date(p.joined_at).toISOString() });
    s.networth = Math.max(s.networth, Math.floor(netWorth(db, m, p.guild_id, p.user_id) / 100));
    if (new Date(p.joined_at).toISOString() < s.since) s.since = new Date(p.joined_at).toISOString();
  }
  for (const r of db.all<{ user_id: string; n: number }>('SELECT user_id, COUNT(*) AS n FROM achievements GROUP BY user_id')) if (out[r.user_id]) out[r.user_id]!.achievements = r.n;
  for (const r of db.all<{ owner_id: string; n: number }>("SELECT owner_id, MAX(c) AS n FROM (SELECT owner_id, COUNT(*) AS c FROM estates WHERE status = 'owned' GROUP BY guild_id, owner_id) GROUP BY owner_id")) if (out[r.owner_id]) out[r.owner_id]!.properties = r.n;
  for (const id of Object.keys(out)) out[id]!.company = companyOf(db, id) ? 1 : 0;
  return out;
}

/** Tells Discord which five stats the bot offers (safe to repeat; it replaces the list). */
export async function registerRoleMetadata(client: Client): Promise<void> {
  const app = client.application?.id;
  if (!app) return;
  try {
    await client.rest.put(`/applications/${app}/role-connections/metadata`, { body: ROLE_METADATA.map((m) => ({ ...m })) });
    console.log('[linked roles] Stats registered with Discord');
  } catch (e) { console.warn('[linked roles] Could not register the stats:', (e as Error).message); }
}
