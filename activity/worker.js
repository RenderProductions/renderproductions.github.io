// The Rend-Conomy Activity's server: a Cloudflare Worker (Workers Paid plan). GitHub deploys it on its own
// whenever this file or wrangler.toml changes on main (.github/workflows/worker.yml). No more pasting.
//
// It does these jobs:
//   1. Serves the Activity itself (the files in /activity in the repo, from the branch in ACTIVITY_BRANCH,
//      or main)
//   2. Logs players in: swaps Discord's one-time code for a token (needs the client secret, so it
//      can't happen in the browser)
//   3. Passes commands between the site/Activity and the bot. The bot keeps a live connection (a WebSocket)
//      open to the Hub below; a command goes straight down it and the reply comes straight back, in the same
//      request. If the bot isn't connected, the old way still works: the command waits in the D1 database
//      and the bot picks it up when it next checks.
//   4. Lets the site use the same relay (only from the site itself), so players can play from it: their desk,
//      Marquez's shop, the farm, trades, odd jobs, the inbox and profile changes. Only the commands in
//      SITE_COMMANDS are accepted from the site (and the bot checks every one again).
//   6. Linked Roles: /linked-roles links a player, /bot/roles keeps their stats current on Discord.
//   5. Keeps the live feed: the bot pushes prices and the world event every 30 seconds (sent on to every open
//      page through the Hub, and kept for /api/live), and profiles whenever they change (/api/profiles).
//
// Settings on the Worker (Settings -> Variables and Secrets), never in this file:
//   DISCORD_CLIENT_ID      text    Render's Vision's Application ID
//   DISCORD_CLIENT_SECRET  secret  from the Developer Portal (OAuth2)
//   BOT_SECRET             secret  the same value as ACTIVITY_SECRET in the bot's .env
//   ACTIVITY_BRANCH        text    optional: serve the Activity from a test branch instead of main
// Bindings (set in wrangler.toml): the D1 database DB, and the Hub (a Durable Object) HUB.

import { DurableObject } from 'cloudflare:workers';

const REPO = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io';
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
const DATA = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io/data';
const DISCORD = 'https://discord.com/api/v10';

// ---------------------------------------------------------------- the Hub
// One Durable Object that holds the open connections: the bot's (tagged "bot") and every open page's live
// feed ("site"). It sleeps between messages (WebSocket hibernation), so idle connections cost nothing.
export class Hub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.waiting = new Map();   // job id -> function to call with the bot's reply
    this.recent = new Map();    // rate limits: user id -> times of their commands in the last minute
    this.seq = 0;
    // "ping" gets "pong" without waking the Hub up
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }
  bot() { return this.ctx.getWebSockets('bot').find((ws) => (ws.deserializeAttachment() || {}).ok); }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/bot' || path === '/site') {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [path.slice(1)]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    if (path === '/run') {
      const a = await req.json();
      const bot = this.bot();
      if (!bot) return Response.json({ offline: true }, { status: 503 });
      // At most 30 commands a minute per player; live updates ("__poll", a Rocket in flight) have their own 120
      const now = Date.now(), key = a.user_id + (a.poll ? ':poll' : '');
      const times = (this.recent.get(key) || []).filter((t) => t > now - 60_000);
      if (times.length >= (a.poll ? 120 : 30)) return Response.json({ error: 'slow down' }, { status: 429 });
      times.push(now);
      if (this.recent.size > 5000) this.recent.clear();
      this.recent.set(key, times);
      const id = `h${++this.seq}.${now}`;
      const result = await new Promise((resolve) => {
        const timer = setTimeout(() => { this.waiting.delete(id); resolve(null); }, 25_000);
        this.waiting.set(id, (r) => { clearTimeout(timer); this.waiting.delete(id); resolve(r); });
        try { bot.send(JSON.stringify({ type: 'run', action: { id, user_id: a.user_id, username: a.username, guild_id: a.guild_id, line: a.line, created: now } })); }
        catch { this.waiting.get(id)?.(undefined); }
      });
      if (result === undefined) return Response.json({ offline: true }, { status: 503 });
      if (result === null) return Response.json({ error: "The bot didn't answer in time. Try again." }, { status: 504 });
      return Response.json({ status: 'done', result });
    }
    if (path === '/broadcast') {
      const body = await req.text();
      for (const ws of this.ctx.getWebSockets('site')) { try { ws.send(body); } catch { /* gone */ } }
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  async webSocketMessage(ws, msg) {
    if (typeof msg !== 'string' || msg.length > 1_000_000) return;
    if (!this.ctx.getTags(ws).includes('bot')) return;   // pages only listen
    let m;
    try { m = JSON.parse(msg); } catch { return; }
    if (m.type === 'hello') {
      // The bot proves who it is with the shared secret before it gets any commands
      if (!this.env.BOT_SECRET || m.secret !== this.env.BOT_SECRET) { ws.close(4003, 'wrong secret'); return; }
      for (const old of this.ctx.getWebSockets('bot')) if (old !== ws) { try { old.close(4000, 'replaced'); } catch { /* gone */ } }
      ws.serializeAttachment({ ok: true });
      ws.send(JSON.stringify({ type: 'ready' }));
      return;
    }
    if (!(ws.deserializeAttachment() || {}).ok) return;
    if (m.type === 'result' && this.waiting.has(m.id)) this.waiting.get(m.id)(m.result ?? {});
  }
  async webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch { /* already closed */ } }
  async webSocketError(ws) { try { ws.close(1011, 'error'); } catch { /* already closed */ } }
}
const hub = (env) => env.HUB.get(env.HUB.idFromName('hub'));

let ready = false;
let lastSweep = 0;
async function setup(env) {
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT, guild_id TEXT NOT NULL,
    line TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', result TEXT, created INTEGER NOT NULL)`).run();
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS live (k TEXT PRIMARY KEY, v TEXT NOT NULL, at INTEGER NOT NULL)').run();
  // Indexes, so lookups read only the rows they need instead of the whole table (D1 bills every row read)
  await env.DB.batch([
    env.DB.prepare('CREATE INDEX IF NOT EXISTS actions_status ON actions (status, id)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS actions_created ON actions (created)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS actions_user ON actions (user_id, created)'),
    // Linked Roles: each linked player's Discord tokens and the stats last sent for them
    env.DB.prepare('CREATE TABLE IF NOT EXISTS role_links (user_id TEXT PRIMARY KEY, access TEXT NOT NULL, refresh TEXT NOT NULL, expires INTEGER NOT NULL, pushed TEXT)'),
  ]);
  ready = true;
}
// What the site may ask the bot to do (the first word of the line). The bot checks again.
const SITE_COMMANDS = /^(__console|__chess|__press|__poll|underground|ug|property|estate|profile|balance|bal|daily|dividends|savings|buy|sell|short|cover|shop|purchase|inventory|inv|use|gift|trade|showcase|inbox|oddjob|farm|plant|water|harvest|sellcrops|fertilize|compost|buyplot|farmhand|achievements|market|history|loans|advent|santa)\b/i;

const SITE = 'https://renderproductions.github.io';
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

// Who's calling: checks their token with Discord (cached for a minute per token)
const who = new Map();
async function user(req) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const hit = who.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json();
  const out = { id: u.id, username: u.global_name || u.username };
  who.set(token, { user: out, until: Date.now() + 60_000 });
  if (who.size > 500) who.clear();
  return out;
}

// ---------------------------------------------------------------- Linked Roles
// Servers can give out roles from a player's real stats (Server Settings → Roles → Links → Render's Vision).
// The player links once here (Discord sends them to /linked-roles from the role's requirements); after that,
// whenever the bot sends new stats (/bot/roles), every linked player whose numbers changed is updated.
// The five stats are registered by the bot (src/site/roles.ts).
const roleMeta = (s) => ({ networth: s ? s.networth : 0, achievements: s ? s.achievements : 0, properties: s ? s.properties : 0, company: s ? s.company : 0, ...(s && s.since ? { since: s.since } : {}) });
async function discordToken(env, params, origin) {
  const r = await fetch(`${DISCORD}/oauth2/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, ...params, ...(params.grant_type === 'authorization_code' ? { redirect_uri: `${origin}/linked-roles/callback` } : {}) })
  });
  const d = await r.json().catch(() => ({}));
  return r.ok && d.access_token ? d : null;
}
async function rolesNow(env) {
  const row = await env.DB.prepare("SELECT v FROM live WHERE k = 'roles'").first();
  try { return row ? JSON.parse(row.v) : {}; } catch { return {}; }
}
/** Sends one player's stats to Discord (refreshing their token first if it's old). False if the link is dead. */
async function pushRole(env, link, stats) {
  let access = link.access;
  if (link.expires < Date.now() + 60_000) {
    const t = await discordToken(env, { grant_type: 'refresh_token', refresh_token: link.refresh });
    if (!t) { await env.DB.prepare('DELETE FROM role_links WHERE user_id = ?').bind(link.user_id).run(); return false; }
    access = t.access_token;
    await env.DB.prepare('UPDATE role_links SET access = ?, refresh = ?, expires = ? WHERE user_id = ?').bind(t.access_token, t.refresh_token, Date.now() + t.expires_in * 1000, link.user_id).run();
  }
  const meta = roleMeta(stats);
  const r = await fetch(`${DISCORD}/users/@me/applications/${env.DISCORD_CLIENT_ID}/role-connection`, {
    method: 'PUT', headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_name: 'Rend-Conomy', platform_username: String(stats ? stats.name : 'New player').slice(0, 100), metadata: meta })
  });
  if (r.status === 401) { await env.DB.prepare('DELETE FROM role_links WHERE user_id = ?').bind(link.user_id).run(); return false; }
  if (r.ok) await env.DB.prepare('UPDATE role_links SET pushed = ? WHERE user_id = ?').bind(JSON.stringify(meta), link.user_id).run();
  return r.ok;
}
async function updateAllRoles(env, stats) {
  const { results = [] } = await env.DB.prepare('SELECT * FROM role_links').all();
  let n = 0;
  for (const link of results) {
    if (link.pushed === JSON.stringify(roleMeta(stats[link.user_id]))) continue;
    if (++n > 200) break;   // the rest go next time
    await pushRole(env, link, stats[link.user_id]).catch(() => {});
  }
}
function rolePage(title, lines, ok) {
  const c = ok ? '#3ddc84' : '#ff4d4d';
  return new Response(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} | Rend-Conomy</title>
<link rel="icon" href="${SITE}/favicon.ico"><link href="https://fonts.googleapis.com/css2?family=VT323&family=IBM+Plex+Mono&display=swap" rel="stylesheet">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#05070d;color:#c9d1e0;font:15px/1.6 "IBM Plex Mono",monospace}
.box{max-width:520px;margin:24px;padding:28px 30px;border:1px solid ${c};box-shadow:0 0 22px -6px ${c};background:#0b1220;position:relative}
.box:after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(transparent 0 2px,rgba(0,0,0,.25) 2px 3px)}
h1{font:44px/1 VT323,monospace;color:${c};margin:0 0 14px;letter-spacing:2px;text-shadow:0 0 10px ${c}}a{color:${c}}p{margin:.6em 0}</style></head>
<body><main class="box"><h1>${title}</h1>${lines.map((l) => `<p>${l}</p>`).join('')}</main></body></html>`, { status: ok ? 200 : 400, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function linkedRoles(req, env, path, url) {
  if (path === '/linked-roles') {
    const state = crypto.randomUUID();
    const go = new URL('https://discord.com/oauth2/authorize');
    go.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: `${url.origin}/linked-roles/callback`, response_type: 'code', scope: 'identify role_connections.write', state, prompt: 'consent' }).toString();
    return new Response(null, { status: 302, headers: { Location: go.toString(), 'Set-Cookie': `lr_state=${state}; Path=/linked-roles; HttpOnly; Secure; SameSite=Lax; Max-Age=600` } });
  }
  // the callback
  const cookie = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)lr_state=([^;]+)/);
  if (!url.searchParams.get('code') || !cookie || cookie[1] !== url.searchParams.get('state'))
    return rolePage('Hmm.', ['That link didn\'t come from here, or it expired. Go back to Discord and try linking again.'], false);
  const t = await discordToken(env, { grant_type: 'authorization_code', code: url.searchParams.get('code') }, url.origin);
  if (!t) return rolePage('Discord said no.', ['Couldn\'t finish linking. Go back to Discord and try again.'], false);
  const me = await fetch(`${DISCORD}/users/@me`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => null);
  if (!me || !me.id) return rolePage('Hmm.', ['Discord didn\'t say who you are. Try again.'], false);
  await setup(env);
  const link = { user_id: me.id, access: t.access_token, refresh: t.refresh_token, expires: Date.now() + t.expires_in * 1000 };
  await env.DB.prepare('INSERT INTO role_links (user_id, access, refresh, expires, pushed) VALUES (?, ?, ?, ?, NULL) ON CONFLICT (user_id) DO UPDATE SET access = excluded.access, refresh = excluded.refresh, expires = excluded.expires, pushed = NULL')
    .bind(link.user_id, link.access, link.refresh, link.expires).run();
  const stats = (await rolesNow(env))[me.id];
  const ok = await pushRole(env, link, stats);
  if (!ok) return rolePage('Almost.', ['You\'re linked, but Discord didn\'t take your stats yet. They\'ll be sent again the next time they change.'], true);
  const fmt = (n) => Number(n).toLocaleString('en-US');
  return rolePage('Linked!', [
    `You're connected, ${String(me.global_name || me.username).replace(/[<>&]/g, '')}. Head back to Discord and your roles will catch up in a moment.`,
    stats ? `Your stats: <b>⬡${fmt(stats.networth)}</b> net worth · <b>${fmt(stats.achievements)}</b> achievements · <b>${fmt(stats.properties)}</b> properties${stats.company ? ' · company founder' : ''}.` : 'You haven\'t played yet, so everything starts at zero. Try <code>r!daily</code>!',
    'They update on their own as you play. <a href="' + SITE + '/profile/">Your profile</a>'
  ], true);
}

async function api(req, env, path, cors, ctx) {
  const out = (data, status = 200) => json(data, status, cors);   // only the site gets cross-origin headers
  // ---- for the Activity ----
  if (path === '/api/config') return out({ clientId: env.DISCORD_CLIENT_ID });

  if (path === '/api/token' && req.method === 'POST') {
    const { code } = await req.json().catch(() => ({}));
    if (!code) return out({ error: 'no code' }, 400);
    const r = await fetch(`${DISCORD}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) return out({ error: 'Discord said no', detail: data.error || r.status }, 400);
    return out({ access_token: data.access_token });
  }

  // The live feed (prices, changes, the world event), pushed by the bot every 30 seconds. Public.
  if (path === '/api/live') {
    await setup(env);
    const row = await env.DB.prepare("SELECT v, at FROM live WHERE k = 'feed'").first();
    return new Response(row ? row.v : '{}', { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }

  // Live profiles (everyone's achievements, worth, looks...), pushed by the bot whenever they change. Public.
  if (path === '/api/profiles') {
    await setup(env);
    const row = await env.DB.prepare("SELECT v, at FROM live WHERE k = 'profiles'").first();
    if (!row) return new Response('{"error":"not yet"}', { status: 404, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    return new Response(row.v, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' } });
  }

  // Public market data (prices, the week's history, the world event), straight from the bot's data branch
  if (path === '/api/market' || path === '/api/week') {
    const r = await fetch(`${DATA}/${path === '/api/market' ? 'prices.json' : 'history-7d.json'}?t=${Date.now()}`, { cf: { cacheTtl: 30 } });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  if (path === '/api/run' && req.method === 'POST') {
    const u = await user(req);
    if (!u) return out({ error: 'not logged in' }, 401);
    const { guild_id: g, line } = await req.json().catch(() => ({}));
    if (!/^\d{5,25}$/.test(String(g || '')) || !line || String(line).length > (/^__(console|chess) /.test(String(line)) ? 1200 : 200)) return out({ error: 'bad request' }, 400);
    // from the site, only the site's commands
    if (cors['Access-Control-Allow-Origin'] && !SITE_COMMANDS.test(String(line))) return out({ error: 'not allowed from the site' }, 403);
    const poll = String(line).startsWith('__poll ');
    // Straight to the bot if it's connected; the reply comes back in this same request
    if (env.HUB) {
      const r = await hub(env).fetch('https://hub/run', { method: 'POST', body: JSON.stringify({ user_id: u.id, username: u.username, guild_id: g, line: String(line), poll }) });
      if (r.status !== 503) return out(await r.json(), r.status);
    }
    // Otherwise it waits in D1 for the bot to pick up
    await setup(env);
    // At most 30 commands a minute per player; live updates ("__poll", a Rocket in flight) have their own 120
    const recent = await env.DB.prepare(`SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND created > ? AND line ${poll ? '' : 'NOT '}LIKE '\\_\\_poll %' ESCAPE '\\'`).bind(u.id, Date.now() - 60_000).first();
    if (recent && recent.n >= (poll ? 120 : 30)) return out({ error: 'slow down' }, 429);
    const r = await env.DB.prepare('INSERT INTO actions (user_id, username, guild_id, line, created) VALUES (?, ?, ?, ?, ?)')
      .bind(u.id, u.username, g, String(line), Date.now()).run();
    return out({ id: r.meta.last_row_id });
  }

  if (path === '/api/result') {
    const u = await user(req);
    if (!u) return out({ error: 'not logged in' }, 401);
    await setup(env);
    const id = Number(new URL(req.url).searchParams.get('id'));
    const row = await env.DB.prepare('SELECT status, result FROM actions WHERE id = ? AND user_id = ?').bind(id, u.id).first();
    if (!row) return out({ error: 'not found' }, 404);
    return out({ status: row.status, result: row.result ? JSON.parse(row.result) : null });
  }

  // ---- for the bot ----
  if (path.startsWith('/bot/')) {
    if (!env.BOT_SECRET || req.headers.get('X-Bot-Secret') !== env.BOT_SECRET) return out({ error: 'no' }, 403);
    await setup(env);
    if (path === '/bot/actions') {
      // Hand over new commands, and tidy up anything older than an hour
      if (Date.now() - lastSweep > 10 * 60_000) {
        lastSweep = Date.now();
        await env.DB.prepare('DELETE FROM actions WHERE created < ?').bind(Date.now() - 3600_000).run();
      }
      const { results } = await env.DB.prepare("SELECT id, user_id, username, guild_id, line, created FROM actions WHERE status = 'new' ORDER BY id LIMIT 25").all();
      if (results.length) await env.DB.prepare(`UPDATE actions SET status = 'taken' WHERE id IN (${results.map(() => '?').join(',')})`).bind(...results.map((r) => r.id)).run();
      return out({ actions: results });
    }
    if (path === '/bot/live' && req.method === 'POST') {
      const body = await req.text();
      if (body.length > 50_000) return out({ error: 'too big' }, 413);
      await env.DB.prepare("INSERT INTO live (k, v, at) VALUES ('feed', ?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(body, Date.now()).run();
      if (env.HUB) await hub(env).fetch('https://hub/broadcast', { method: 'POST', body }).catch(() => {});   // to every open page
      return out({ ok: true });
    }
    if (path === '/bot/profiles' && req.method === 'POST') {
      const body = await req.text();
      if (body.length > 1_800_000) return out({ error: 'too big' }, 413);
      await env.DB.prepare("INSERT INTO live (k, v, at) VALUES ('profiles', ?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(body, Date.now()).run();
      return out({ ok: true });
    }
    if (path === '/bot/roles' && req.method === 'POST') {
      const body = await req.text();
      if (body.length > 2_000_000) return out({ error: 'too big' }, 413);
      await env.DB.prepare("INSERT INTO live (k, v, at) VALUES ('roles', ?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(body, Date.now()).run();
      let stats = {};
      try { stats = JSON.parse(body); } catch { /* keep {} */ }
      if (ctx) ctx.waitUntil(updateAllRoles(env, stats).catch(() => {})); else await updateAllRoles(env, stats);
      return out({ ok: true });
    }
    if (path === '/bot/results' && req.method === 'POST') {
      const { results = [] } = await req.json().catch(() => ({}));
      if (results.length) await env.DB.batch(results.map((r) => env.DB.prepare("UPDATE actions SET status = 'done', result = ? WHERE id = ?").bind(JSON.stringify(r.result).slice(0, 20000), r.id)));
      return out({ ok: true });
    }
  }
  return out({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Discord's proxy may add /.proxy in front of paths
    const path = url.pathname.replace(/^\/\.proxy/, '') || '/';
    const cors = req.headers.get('Origin') === SITE && (path === '/api/run' || path === '/api/result')
      ? { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    try {
      // The live connections: the bot's (it proves itself once connected) and the pages' live feed (anyone)
      if (path === '/ws/bot' || path === '/ws/live') {
        if (!env.HUB) return json({ error: 'no hub yet' }, 503);
        if ((req.headers.get('Upgrade') || '').toLowerCase() !== 'websocket') return json({ error: 'WebSockets only' }, 426);
        return await hub(env).fetch(path === '/ws/bot' ? 'https://hub/bot' : 'https://hub/site', req);
      }
      if (path === '/linked-roles' || path === '/linked-roles/callback') return await linkedRoles(req, env, path, url);
      if (path.startsWith('/api/') || path.startsWith('/bot/')) return await api(req, env, path, cors, ctx);
      // The bot's emojis (rc_*.png), for showing them in the Activity
      if (/^\/emojis\/rc_[a-z0-9_]{1,40}\.png$/.test(path)) {
        const r = await fetch(`${REPO}/${env.ACTIVITY_BRANCH || 'main'}/bot${path}`, { cf: { cacheTtl: 3600 } });
        return r.ok ? new Response(r.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } }) : new Response('Not found', { status: 404 });
      }
      // Everything else is the Activity's own files, from the repo
      const file = path === '/' ? '/index.html' : path;
      if (!/^\/[a-z0-9._-]+$/i.test(file) || file === '/worker.js' || file === '/wrangler.toml') return json({ error: 'not found' }, 404);
      const r = await fetch(`${REPO}/${env.ACTIVITY_BRANCH || 'main'}/activity${file}`, { cf: { cacheTtl: 60 } });
      if (!r.ok) return new Response('Not found', { status: 404 });
      const ext = file.split('.').pop().toLowerCase();
      return new Response(r.body, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=300' } });
    } catch (e) {
      return json({ error: 'server error', detail: String(e && e.message || e) }, 500);
    }
  }
};
