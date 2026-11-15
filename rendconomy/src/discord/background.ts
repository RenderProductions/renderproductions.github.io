// Things the bot does on its own while connected: shift reminder DMs, the Trading Floor relay, the
// little web API for the site, and a status that reacts to the market.
import { emoji, emojiOr } from './emoji';
import http from 'node:http';
import type { Client } from 'discord.js';
import { ActivityType } from 'discord.js';
import { find } from '../commands';
import type { BotConfig } from '../config';
import type { Db } from '../core/db';
import type { Rng } from '../core/rng';
import { MINUTE } from '../core/time';
import { load as loadMarket } from '../market/market';
import { netWorth } from '../social/worth';
import { execute, parsePrefix } from './router';
import { CROPS, plotsOf, simulate, weatherLog } from '../farming/farming';
import { count } from '../shop/inventory';
import { holidayTick, isHoliday, season } from '../holidays/holidays';
import { anyItem } from '../shop/items';
import { cryptoRng } from '../core/rng';

/** DMs players whose next shift is ready (for those with /job remind on). Restart-safe: kept in the database. */
export function startReminders(db: Db, client: Client, prefix: string): void {
  setInterval(() => {
    const now = Date.now();
    for (const r of db.all<{ key: string; value: string }>("SELECT key, value FROM meta WHERE key LIKE 'remind:%' AND value != '0'")) {
      if (Number(r.value) > now) continue;
      db.setMeta(r.key, 0);
      const [, guildId, userId] = r.key.split(':') as [string, string, string];
      const job = db.get<{ job: string | null }>('SELECT job FROM players WHERE guild_id = ? AND user_id = ?', guildId, userId)?.job;
      if (!job) continue;   // they quit since
      const server = client.guilds.cache.get(guildId)?.name;
      const text = `${emoji('work')} Your next shift at **${job}** is ready${server ? ` in **${server}**` : ''}. Clock in with \`${prefix}work\`.\n-# Turn these off with \`${prefix}job remind off\`.`;
      client.users.fetch(userId).then((u) => u.send({ content: text, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }
  }, MINUTE).unref();
}

/** Polygon Holidays: Secret Santa draws, DMs and Christmas deliveries. Quiet outside December and early January. */
export function startHolidays(db: Db, client: Client, prefix: string): void {
  const tick = () => {
    const now = Date.now();
    if (!isHoliday(now) && !db.get('SELECT 1 FROM santa WHERE year = ? AND delivered = 0 AND target_id IS NOT NULL LIMIT 1', season(now))) return;
    holidayTick(db, now, cryptoRng(), (userId, guildId, text) => {
      const server = client.guilds.cache.get(guildId)?.name ?? 'your server';
      client.users.fetch(userId).then((u) => u.send({ content: text(server), allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }, (id) => anyItem(id)?.name ?? id, prefix);
  };
  setInterval(tick, 5 * MINUTE).unref();
  setTimeout(tick, 30_000).unref();
}

/** DMs farmers (with /farm remind on) once a crop is ready. Looks ahead without saving, so nothing else changes. */
export function startFarmReminders(db: Db, client: Client, prefix: string): void {
  setInterval(() => {
    const now = Date.now(), weather = weatherLog(db);
    for (const f of db.all<{ guild_id: string; user_id: string }>('SELECT guild_id, user_id FROM farms WHERE remind = 1')) {
      const has = (item: string) => count(db, f.guild_id, f.user_id, item) > 0;
      const env = { sprinkler: has('sprinkler'), greenhouse: has('greenhouse'), scarecrow: has('scarecrow'), weather };
      const ready = plotsOf(db, f.guild_id, f.user_id).filter((p) => !p.reminded && !p.wilted).filter((p) => { const r = simulate(p, env, now); return !r.gone && r.plot.ready_at !== null; });
      if (!ready.length) continue;
      for (const p of ready) db.run('UPDATE farm_plots SET reminded = 1 WHERE guild_id = ? AND user_id = ? AND slot = ?', f.guild_id, f.user_id, p.slot);
      const what = ready.map((p) => `${emojiOr(p.crop, CROPS[p.crop]!.emoji)} ${CROPS[p.crop]!.name}`).join(', ');
      const server = client.guilds.cache.get(f.guild_id)?.name;
      const text = `${emoji('harvest')} Ready to harvest${server ? ` in **${server}**` : ''}: ${what}. Pick ${ready.length === 1 ? 'it' : 'them'} with \`${prefix}harvest\`.\n-# Turn these off with \`${prefix}farm remind off\`.`;
      client.users.fetch(f.user_id).then((u) => u.send({ content: text, allowedMentions: { parse: [] } })).catch(() => { /* DMs closed */ });
    }
  }, MINUTE).unref();
}

// ---------------------------------------------------------------- the Trading Floor (Discord Activity)

const ALLOWED = new Set(['farm', 'plant', 'water', 'harvest', 'sellcrops', 'fertilize', 'compost', 'buyplot', 'balance', 'buy', 'sell', 'short', 'cover', 'dividends', 'daily', 'savings', 'event', 'leaderboard', 'reserve', 'order', 'gambling',
  'coinflip', 'dice', 'roulette', 'slots', 'fish', 'achievements', 'market', 'compare', 'profile', 'history']);
const CHAT_ONLY: Record<string, string> = { rocket: 'Rocket', blackjack: 'Blackjack', bus: 'Ride the Bus', hilo: 'Higher or Lower', mines: 'Minesweeper', derby: 'The Derby', heist: 'Heists' };

/** Polls the Cloudflare Worker for commands sent from the Activity, runs them as that player, sends replies back. */
export function startActivity(db: Db, config: BotConfig, rng: Rng, client: Client): void {
  const url = process.env.ACTIVITY_URL ?? '', secret = process.env.ACTIVITY_SECRET ?? '';
  if (!url || !secret) { console.log('[activity] ACTIVITY_URL / ACTIVITY_SECRET not set, so the Trading Floor relay is off.'); return; }
  const headers = { 'X-Bot-Secret': secret, 'Content-Type': 'application/json' };
  let busy = false, failing = false;
  const runOne = async (a: { id: string; guild_id: string; user_id: string; line: string }) => {
    const guild = client.guilds.cache.get(a.guild_id);
    if (!guild) return { content: 'The bot is not in this server.' };
    const member = await guild.members.fetch(a.user_id).catch(() => null);
    if (!member) return { content: 'You are not a member of this server.' };
    const parsed = parsePrefix(config.prefix + String(a.line).replace(/^\S*?!/, ''), config.prefix);
    if (!parsed || 'unknown' in parsed) return { content: 'Unknown command.' };
    if (CHAT_ONLY[parsed.cmd.name]) return { content: `${CHAT_ONLY[parsed.cmd.name]} needs live buttons. Play it in chat: \`${config.prefix}${parsed.cmd.name}\`.` };
    if (!ALLOWED.has(parsed.cmd.name)) return { content: `\`${parsed.cmd.name}\` does not work from the Trading Floor. Use it in chat.` };
    const out = await execute(find(parsed.cmd.name)!, { db, config, rng, now: Date.now(), guildId: a.guild_id, channelId: 'activity', user: { id: member.user.id, name: member.user.globalName ?? member.user.username }, isOwner: false, isMod: false, notes: [] }, parsed.args);
    return { content: out.content ?? '', embeds: (out.embeds ?? []).map((e) => ({ title: e.title, description: e.description, fields: e.fields, color: e.color, footer: e.footer?.text })) };
  };
  setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const r = await fetch(`${url}/bot/actions`, { headers });
      if (!r.ok) throw new Error(`Worker said ${r.status}`);
      const { actions = [] } = (await r.json()) as { actions?: { id: string; guild_id: string; user_id: string; line: string }[] };
      if (actions.length) {
        const results = [];
        for (const a of actions) results.push({ id: a.id, result: await runOne(a).catch((e: unknown) => { console.error('[activity]', e); return { content: 'Something broke. It has been logged.' }; }) });
        await fetch(`${url}/bot/results`, { method: 'POST', headers, body: JSON.stringify({ results }) });
      }
      if (failing) console.log('[activity] Reconnected to the Worker');
      failing = false;
    } catch (e) { if (!failing) console.error('[activity] Could not reach the Worker:', (e as Error).message); failing = true; }
    finally { busy = false; }
  }, 2000).unref();
  console.log('[activity] Listening for the Trading Floor at', url);
}

// ---------------------------------------------------------------- the web API

/** GET /health and GET /api/leaderboard?guild=<id>, for the site. Only when PORT is set. */
export function startApi(db: Db, client: Client): void {
  const port = Number(process.env.PORT ?? 0);
  if (!port) return;
  const origins = ['https://renderproductions.github.io', 'http://localhost:4000'];
  http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://localhost');
    if (origins.includes(String(req.headers.origin))) res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin));
    res.setHeader('Content-Type', 'application/json');
    const send = (code: number, body: unknown) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    if (u.pathname === '/health') return send(200, { ok: true, discord: client.isReady() ? 'connected' : 'not connected' });
    if (u.pathname === '/api/leaderboard') {
      const g = u.searchParams.get('guild') ?? '';
      const m = loadMarket(db);
      const rows = db.all<{ user_id: string; name: string | null }>('SELECT user_id, name FROM players WHERE guild_id = ?', g)
        .map((p) => ({ name: p.name ?? 'Unknown', netWorth: netWorth(db, m, g, p.user_id) / 100 })).sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
      return send(200, { guild: g, players: rows });
    }
    send(404, { error: 'not found' });
  }).listen(port, () => console.log(`[api] listening on ${port}`));
}

// ---------------------------------------------------------------- status

/** A status that follows the market: crashes, booms, or the Reserve. */
export function startStatus(db: Db, client: Client): void {
  const set = () => {
    const m = loadMarket(db);
    const crash = m?.crash as { phase?: string } | null | undefined;
    const text = crash?.phase === 'crash' ? 'the market crash' : m?.boost ? 'a market boom' : m?.market?.status === 'open' ? 'the market' : 'the market (closed)';
    client.user?.setPresence({ activities: [{ name: text, type: ActivityType.Watching }], status: 'online' });
  };
  set();
  setInterval(set, 5 * MINUTE).unref();
}
