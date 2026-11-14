// Publishes the site's data files to the repo's "data" branch, as its only commit (so the branch never
// grows and the site never rebuilds). The file formats match what the old bot wrote, so the site's pages
// keep working unchanged: prices.json, player-companies.json, profiles.json, history-7d.json.
// Only the main bot publishes (PUBLISH_SITE_DATA=1 plus GITHUB_TOKEN).
import { ACHIEVEMENTS, BY_ID } from '../achievements/list';
import { rarityStats } from '../achievements/achievements';
import type { BotConfig } from '../config';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payoutFactor } from '../core/economy';
import { balance, RESERVE } from '../core/ledger';
import { load as loadMarket } from '../market/market';
import { COLLECTIBLES } from '../shop/items';
import { netWorth } from '../social/worth';
import { rankName } from '../work/jobs';

/** Lookups only the live Discord client can answer (server names, avatars). */
export interface Directory { serverName?: (id: string) => string | null; user?: (id: string) => { name: string; avatar: string | null } | null; servers?: () => number | null; botId?: () => string | null }

export function reserveSnapshot(db: Db) {
  const cents = balance(db, RESERVE);
  return { polygons: cents / 100, start: economy.reserveStart / 100, level: Math.round((cents / economy.reserveStart) * 1000) / 1000, payouts: Math.round(payoutFactor(db, economy.reserveStart) * 100) / 100 };
}

export function botStats(db: Db, dir: Directory = {}) {
  const one = <T>(sql: string) => db.get<T>(sql)!;
  return {
    servers: dir.servers?.() ?? null,
    players: one<{ n: number }>('SELECT COUNT(*) AS n FROM players').n,
    polygons: one<{ s: number }>("SELECT COALESCE(SUM(balance), 0) AS s FROM accounts WHERE kind = 'wallet'").s / 100,
    shifts: one<{ s: number }>('SELECT COALESCE(SUM(shifts), 0) AS s FROM careers').s,
    bets: one<{ s: number }>('SELECT COALESCE(SUM(played), 0) AS s FROM gambling').s,
    wagered: one<{ s: number }>('SELECT COALESCE(SUM(wagered), 0) AS s FROM gambling').s / 100,
    companies: 0,
    commands: Number(db.meta('commands_run') ?? 0)
  };
}

export function profilesSnapshot(db: Db, dir: Directory = {}) {
  const rar = rarityStats(db);
  const m = loadMarket(db);
  const achievements = ACHIEVEMENTS.map((a) => ({ id: a.id, cat: a.cat, rarity: a.rarity, secret: a.secret, pct: rar.pct(a.id), name: a.secret ? null : a.name, desc: a.secret ? null : a.desc }));
  const users: Record<string, { name: string; avatar: string | null; achievements: unknown[]; servers: unknown[] }> = {};
  const botId = dir.botId?.() ?? null;
  for (const p of db.all<{ guild_id: string; user_id: string; name: string | null; title: string | null; job: string | null }>('SELECT guild_id, user_id, name, title, job FROM players')) {
    if (p.user_id === botId) continue;
    const u = (users[p.user_id] ??= { name: p.name ?? 'Player', avatar: null, achievements: [], servers: [] });
    const career = p.job ? db.get<{ rank: number }>('SELECT rank FROM careers WHERE guild_id = ? AND user_id = ? AND ticker = ?', p.guild_id, p.user_id, p.job) : undefined;
    u.servers.push({
      server: dir.serverName?.(p.guild_id) ?? 'A RendConomy server',
      title: p.title,
      worth: netWorth(db, m, p.guild_id, p.user_id) / 100,
      job: p.job ? { ticker: p.job, rank: rankName(p.job, career?.rank ?? 0) } : null,
      shifts: db.get<{ s: number }>('SELECT COALESCE(SUM(shifts), 0) AS s FROM careers WHERE guild_id = ? AND user_id = ?', p.guild_id, p.user_id)!.s,
      bestHit: (db.get<{ b: number }>('SELECT COALESCE(MAX(biggest), 0) AS b FROM gambling WHERE guild_id = ? AND user_id = ?', p.guild_id, p.user_id)!.b) / 100,
      collectibles: db.all<{ item: string }>("SELECT item FROM inventory WHERE guild_id = ? AND user_id = ? AND qty > 0 AND item LIKE 'col_%'", p.guild_id, p.user_id).map((r) => r.item).filter((id) => COLLECTIBLES[id])
    });
  }
  for (const r of db.all<{ user_id: string; id: string; unlocked_at: number }>('SELECT user_id, id, unlocked_at FROM achievements ORDER BY unlocked_at')) {
    const u = users[r.user_id], a = BY_ID[r.id];
    if (u && a) u.achievements.push(a.secret ? [r.id, r.unlocked_at, a.name, a.desc] : [r.id, r.unlocked_at]);
  }
  for (const [id, u] of Object.entries(users)) {
    const live = dir.user?.(id);
    if (live) { u.name = live.name; u.avatar = live.avatar; }
    (u.servers as { worth: number }[]).sort((a, b) => b.worth - a.worth);
  }
  const collectibles = Object.values(COLLECTIBLES).map((c) => ({ id: c.id, name: c.name, emoji: c.emoji, desc: c.desc }));
  return { achievements, collectibles, players: rar.players, users };
}

export function historySnapshot(db: Db) {
  const hourly: Record<string, [number, number][]> = {};
  for (const r of db.all<{ ticker: string; hour: number; price: number }>('SELECT ticker, hour, price FROM price_history ORDER BY hour')) (hourly[r.ticker] ??= []).push([r.hour, Math.round(r.price * 100) / 100]);
  return { updated: new Date().toISOString(), hourly, event: null };
}

/** Every file, as text. */
export function siteFiles(db: Db, dir: Directory = {}): Record<string, string> {
  const now = new Date().toISOString();
  const files: Record<string, string> = {
    'player-companies.json': JSON.stringify({ updated: now, companies: [], closed: [], levels: [], reserve: reserveSnapshot(db), bot: botStats(db, dir), rules: {} }, null, 1),
    'profiles.json': JSON.stringify({ updated: now, ...profilesSnapshot(db, dir) }),
    'history-7d.json': JSON.stringify(historySnapshot(db))
  };
  const m = loadMarket(db);
  if (m) files['prices.json'] = JSON.stringify(m);
  return files;
}

async function gh<T>(config: BotConfig, path: string, opts: { method?: string; body?: unknown } = {}): Promise<T | null> {
  const res = await fetch(`https://api.github.com${path}`, {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${config.githubToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rendconomy-bot', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

let last = '';
/** Writes the files as the single commit on the data branch. Returns false if nothing changed. */
export async function publish(db: Db, config: BotConfig, dir: Directory = {}): Promise<boolean> {
  if (!config.publish) return false;
  const files = siteFiles(db, dir);
  const fingerprint = JSON.stringify(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v.replace(/"updated":"[^"]*"/, '')])));
  if (fingerprint === last) return false;
  const repo = config.githubRepo;
  const tree = await gh<{ sha: string }>(config, `/repos/${repo}/git/trees`, { method: 'POST', body: { tree: await Promise.all(Object.entries(files).map(async ([path, content]) => {
    const blob = (await gh<{ sha: string }>(config, `/repos/${repo}/git/blobs`, { method: 'POST', body: { content, encoding: 'utf-8' } }))!;
    return { path, mode: '100644', type: 'blob', sha: blob.sha };
  })) } });
  const commit = await gh<{ sha: string }>(config, `/repos/${repo}/git/commits`, { method: 'POST', body: { message: 'Update site data', tree: tree!.sha, parents: [] } });
  const ref = `heads/${config.dataBranch}`;
  if (await gh(config, `/repos/${repo}/git/ref/${ref}`)) await gh(config, `/repos/${repo}/git/refs/${ref}`, { method: 'PATCH', body: { sha: commit!.sha, force: true } });
  else await gh(config, `/repos/${repo}/git/refs`, { method: 'POST', body: { ref: `refs/${ref}`, sha: commit!.sha } });
  last = fingerprint;
  return true;
}

/** Publishes 30 seconds after start, then every 10 minutes. Errors are logged, never fatal. */
export function startPublishing(db: Db, config: BotConfig, dir: Directory): void {
  if (!config.publish) { console.log('[publish] Site publishing is off (set PUBLISH_SITE_DATA=1 and GITHUB_TOKEN on the main bot only).'); return; }
  const run = () => publish(db, config, dir).then((did) => did && console.log('[publish] Site data updated')).catch((e: unknown) => console.error('[publish]', (e as Error).message));
  setTimeout(run, 30_000).unref();
  setInterval(run, 10 * 60_000).unref();
}
