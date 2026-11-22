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
//   7. Story of Varandia: keeps players' characters and GMs' campaigns (/api/v/...), and posts rolls to a
//      campaign's Discord webhook. Only the site may call it.
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
const SITE_COMMANDS = /^(__console|__chess|__press|__poll|underground|ug|property|estate|landmark|vip|profile|balance|bal|daily|dividends|savings|buy|sell|short|cover|shop|purchase|inventory|inv|use|gift|trade|showcase|inbox|oddjob|farm|plant|water|harvest|sellcrops|fertilize|compost|buyplot|farmhand|achievements|market|history|loans|advent|santa)\b/i;

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

  // ---- Story of Varandia ----
  if (path.startsWith('/api/v/')) return await varandia(req, env, path, out);

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


// ---------------------------------------------------------------- Story of Varandia
// Characters belong to whoever saved them first (their Discord id). A character can sit in one campaign;
// that campaign's GM can read and edit it too. Campaigns are joined with a six-letter code. A campaign can
// have a Discord webhook (kept here, never sent back to players): rolls from its characters are posted there.
let vReady = false;
async function vSetup(env) {
  if (vReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS v_chars (id TEXT PRIMARY KEY, owner TEXT NOT NULL, owner_name TEXT, name TEXT NOT NULL, campaign TEXT, data TEXT NOT NULL, updated INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS v_chars_owner ON v_chars (owner)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS v_chars_campaign ON v_chars (campaign)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS v_camps (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, gm TEXT NOT NULL, gm_name TEXT, name TEXT NOT NULL, intro TEXT, webhook TEXT, created INTEGER NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS v_camps_gm ON v_camps (gm)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS v_pics (id TEXT PRIMARY KEY, img BLOB NOT NULL, updated INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS v_screens (camp TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS v_fights (camp TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)'),
  ]);
  vReady = true;
}
const vId = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const vCharOut = (r) => ({ id: r.id, owner: r.owner, ownerName: r.owner_name, name: r.name, campaign: r.campaign, updated: r.updated, data: JSON.parse(r.data) });
const vCampOut = (c, isGm) => ({ id: c.id, name: c.name, intro: c.intro || '', gm: c.gm, gmName: c.gm_name, isGm, code: isGm ? c.code : undefined, hasWebhook: !!c.webhook, webhook: isGm ? (c.webhook || '') : undefined, created: c.created });
// ---- how a roll looks in Discord
const vCol = { gm: 0x8b6b4a, stat: 0x8b6b4a, attack: 0x8f9ba8, weapon: 0x8f9ba8, init: 0x6f7f8f, die: 0x8b6b4a, heal: 0x4caf6a, tonic: 0x3aa6a0, rest: 0x5b6fa8, level: 0xf1c40f, note: 0x6e1f17,
  fire: 0xe8642c, water: 0x3b8fd9, ice: 0x9fdcf5, earth: 0x9c7442, air: 0xb4c6d4, lightning: 0xf2c92b, nature: 0x4caf50, poison: 0x8bc34a, light: 0xf7e8a6, dark: 0x5b3f9e, evil: 0x8b0a1a };
const vIcon = { gm: '🎲', stat: '🎲', attack: '⚔️', weapon: '⚔️', init: '⏱️', die: '🎲', heal: '🧪', tonic: '🧪', rest: '🌙', level: '⭐', note: '📜',
  fire: '🔥', water: '🌊', ice: '❄️', earth: '🪨', air: '🌪️', lightning: '⚡', nature: '🌿', poison: '☠️', light: '☀️', dark: '🌑', evil: '🩸', chaotic: '🌀' };
const vClean = (v, n) => String(v == null ? '' : v).replace(/[@`*_~|#<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);
const vNum = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.round(+v));
function vHsl(h) { const S = 0.6, L = 0.55, a = S * Math.min(L, 1 - L), f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); }; return (f(0) << 16) | (f(8) << 8) | f(4); }
// The Render Room's Rune Seal emoji (custom emoji show in descriptions and field values, not titles or footers)
const vSealIds = Object.fromEntries('fire:1574195685253714010 water:1574195429179129988 ice:1574195644258717728 earth:1574195793659957391 air:1574196004129865828 lightning:1574195530089766942 nature:1574195495104942080 poison:1574195459889701044 light:1574195574448857098 dark:1574195831823798404 evil:1574195761116094514 chaotic:1574195972358013008 d4:1574195905093959780 d6:1574195864551817435 d8:1574195338288439466 d10:1574195304130158712 d12:1574195239437078729 d20:1574195191244660816 nat20:1574194971152617492 nat1:1574195003201429555 str:1574194786276085780 dur:1574195155987079238 spd:1574194877816774767 cha:1574195381481250887 int:1574195042585940098 per:1574194909357936671 sta:1574194845906640996 health:1574195119949615254 defense:1574194712485830797 init:1574194684014764106 taint:1574194627303579679 blood:1574194738947563540 surge:1574194653291614289'.split(' ').map((x) => x.split(':')));
const vSeal = (k) => (vSealIds[k] ? '<:v_' + k + ':' + vSealIds[k] + '>' : /^d\d+$/.test(k) ? vSeal('d20') : '');
const vStatKey = { Strength: 'str', Durability: 'dur', Speed: 'spd', Charisma: 'cha', Intelligence: 'int', Perception: 'per', Stamina: 'sta' };
function vEmbed(i, line, campName, pic) {
  i = i && typeof i === 'object' ? i : {};
  const kind = ['stat', 'attack', 'weapon', 'init', 'die', 'heal', 'tonic', 'rest', 'level', 'spell', 'gm', 'turn'].includes(i.kind) ? i.kind : 'note';
  if (kind === 'turn') {
    // the initiative order, with whoever's up marked
    const order = (Array.isArray(i.order) ? i.order : []).slice(0, 30).map((x) => (x && x.cur ? '▶ **' + vClean(x.name, 40) + '**' : '-# ' + vClean(x && x.name, 40)) + (vNum(x && x.init) != null ? ' · ' + vNum(x.init) : ''));
    return { color: 0x5e6f80, title: 'Initiative', description: '## ' + vSeal('init') + ' ' + (vClean(i.title, 80) || 'Initiative') + '\n' + (vClean(i.text, 200) ? vClean(i.text, 200) + '\n' : '') + order.join('\n'), footer: { text: campName }, timestamp: new Date().toISOString() };
  }
  const el = kind === 'spell' ? (vClean(i.element, 12) in vIcon ? vClean(i.element, 12) : 'chaotic') : null;
  const die = vNum(i.die), bonus = vNum(i.bonus), total = vNum(i.total), nat20 = die === 20 && i.sides == null, nat1 = die === 1 && i.sides == null;
  const color = el ? (el === 'chaotic' ? vHsl(Math.floor(Math.random() * 360)) : vCol[el]) : vCol[kind];
  // which seal leads the post
  const sides = vNum(i.sides);
  const sealKey = el ? el : kind === 'stat' ? (vStatKey[vClean(i.stat, 20)] || 'd20') : kind === 'die' ? ('d' + (sides || 20)) : kind === 'attack' ? 'd20' : kind === 'gm' ? (sides ? 'd' + sides : ((String(i.rolled || '').match(/^\d*d(\d+)/) || [])[1] ? 'd' + String(i.rolled).match(/^\d*d(\d+)/)[1] : 'd20'))
    : kind === 'init' ? 'init' : kind === 'heal' ? 'health' : kind === 'tonic' ? 'sta' : '';
  const lead = sealKey ? vSeal(sealKey) + ' ' : '';
  const title = vClean(i.title, 80) || 'A roll';
  const e = { color, fields: [], timestamp: new Date().toISOString() };
  const lines = [];
  // the headline
  e.title = kind === 'spell' ? 'Casts ' + title : kind === 'weapon' ? '⚔️ Attacks with ' + title : (lead ? '' : vIcon[kind] + ' ') + title;
  if (nat20) { e.color = 0xf1c40f; lines.push('### ' + vSeal('nat20') + ' NATURAL 20' + (kind === 'stat' ? ' · ' + vClean(i.stat, 20) + ' earns a training mark' : kind === 'weapon' ? ' · critical hit, damage dice doubled' : '')); }
  if (nat1) { e.color = 0x2b0f0f; lines.push('### ' + vSeal('nat1') + ' NATURAL 1'); }
  if (total != null && kind !== 'heal' && kind !== 'tonic') {
    const what = kind === 'spell' ? 'vs Need ' + (vNum(i.need) ?? '?') : vClean(i.what, 20);
    lines.push('# ' + lead + total + (what ? ' ' + what : ''));
    if (i.rolled) lines.push('-# ' + vClean(i.rolled, 120));
    else if (die != null) lines.push('-# ' + (sides ? 'd' + sides : 'd20') + ' rolled ' + die + (bonus ? (bonus < 0 ? ' − ' + Math.abs(bonus) : ' + ' + bonus) : '') + (i.notes ? ' · ' + vClean(i.notes, 60) : ''));
  }
  if (kind === 'heal' || kind === 'tonic') { lines.push('# ' + lead + '+' + (total ?? '?') + ' ' + vClean(i.what, 20)); if (i.dice) lines.push('-# rolled ' + vClean(i.dice, 30)); }
  if (kind === 'level' || kind === 'rest' || kind === 'note') lines.push(vClean(i.text || (kind === 'note' ? line : ''), 300));
  // the details
  if (kind === 'weapon' && vNum(i.dmg) != null) e.fields.push({ name: 'Damage', value: '🗡️ **' + vNum(i.dmg) + '** ' + vClean(i.dmgType, 20) + (i.dice ? '\n-# ' + vClean(i.dice, 30) : ''), inline: true });
  if (kind === 'spell') {
    e.fields.push(i.ok ? { name: 'Cast!', value: '✅ ' + (i.damage ? 'Damage: ' + vClean(i.damage, 40) : 'It works.'), inline: true }
                       : { name: 'Fizzled', value: '💨 ' + (vClean(i.fail, 80) || 'The magic slips away.'), inline: true });
    e.fields.push({ name: 'Cost', value: vSeal('sta') + ' ' + (vNum(i.stamina) || 0) + ' Stamina' + (vNum(i.blood) ? '\n' + vSeal('blood') + ' ' + vNum(i.blood) + ' blood' : ''), inline: true });
    if (i.surge && typeof i.surge === 'object') { e.fields.push({ name: 'CHAOS SURGE (' + (vNum(i.surge.n) ?? '?') + ')', value: vSeal('surge') + ' ' + (vClean(i.surge.text, 200) || '…'), inline: false }); }
  }
  // the big portrait for the big moments
  if (pic && (nat20 || (i.surge && kind === 'spell'))) e.thumbnail = { url: pic };
  // the state of things, at the bottom of the post (footers can't show custom emoji)
  const st = [];
  if (vNum(i.hp) != null) st.push(vSeal('health') + ' ' + vNum(i.hp) + '/' + (vNum(i.maxHp) ?? '?'));
  if (vNum(i.sta) != null) st.push(vSeal('sta') + ' ' + vNum(i.sta) + '/' + (vNum(i.maxSta) ?? '?') + ' Stamina');
  if (vNum(i.exhaustion)) st.push('Exhaustion ' + vNum(i.exhaustion));
  if (vNum(i.taint)) st.push(vSeal('taint') + ' Taint ' + vNum(i.taint));
  if (st.length) lines.push('-# ' + st.join(' · '));
  e.description = lines.filter(Boolean).join('\n').slice(0, 2000) || vClean(line, 300);
  e.footer = { text: String(campName || '').slice(0, 200) };
  return e;
}
// Discord won't take a webhook name with these words in it
const vHookName = (n, fallback) => String(n || '').replace(/discord|clyde/gi, '').replace(/[@#:`]/g, '').trim().slice(0, 80) || fallback;
const vRolls = new Map();   // user id -> times of rolls posted in the last minute

async function varandia(req, env, path, out) {
  // portraits are plain pictures anyone can load (Discord fetches them for the webhook's avatar)
  const pm = path.match(/^\/api\/v\/pic\/([a-z0-9]{4,32})$/);
  if (pm && req.method === 'GET') {
    await vSetup(env);
    const p = await env.DB.prepare('SELECT img FROM v_pics WHERE id = ?').bind(pm[1]).first();
    if (!p) return new Response('not found', { status: 404 });
    // D1 hands BLOBs back as a plain array of numbers, not bytes
    const img = typeof p.img === 'string' ? Uint8Array.from(atob(p.img), (ch) => ch.charCodeAt(0)) : new Uint8Array(p.img);
    return new Response(img, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' } });
  }
  const u = await user(req);
  if (!u) return out({ error: 'not logged in' }, 401);
  await vSetup(env);
  const body = req.method === 'GET' || req.method === 'DELETE' ? {} : await req.json().catch(() => ({}));
  const m = path.match(/^\/api\/v\/(chars|camps)(?:\/([a-z0-9]{4,32}))?$/);
  const camp = (id) => env.DB.prepare('SELECT * FROM v_camps WHERE id = ?').bind(id).first();
  const charRow = (id) => env.DB.prepare('SELECT * FROM v_chars WHERE id = ?').bind(id).first();
  async function canEdit(row) {
    if (row.owner === u.id) return true;
    if (!row.campaign) return false;
    const c = await camp(row.campaign);
    return !!c && c.gm === u.id;
  }

  // ---- portraits (a small JPEG made in the browser)
  if (pm && (req.method === 'PUT' || req.method === 'DELETE')) {
    const row = await charRow(pm[1]);
    if (!row || !(await canEdit(row))) return out({ error: 'not found' }, 404);
    if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM v_pics WHERE id = ?').bind(pm[1]).run(); return out({ ok: true }); }
    const mm = String(body.img || '').match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
    if (!mm || mm[1].length > 200_000) return out({ error: 'bad picture' }, 400);
    const bytes = Uint8Array.from(atob(mm[1]), (ch) => ch.charCodeAt(0));
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return out({ error: 'bad picture' }, 400);
    await env.DB.prepare('INSERT INTO v_pics (id, img, updated) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET img = excluded.img, updated = excluded.updated').bind(pm[1], bytes, Date.now()).run();
    return out({ ok: true });
  }

  // ---- characters
  if (m && m[1] === 'chars' && !m[2] && req.method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM v_chars WHERE owner = ? ORDER BY updated DESC LIMIT 200').bind(u.id).all();
    return out({ chars: rows.results.map(vCharOut) });
  }
  if (m && m[1] === 'chars' && m[2]) {
    const row = await charRow(m[2]);
    if (req.method === 'GET') {
      if (!row || !(await canEdit(row))) return out({ error: 'not found' }, 404);
      return out(vCharOut(row));
    }
    if (req.method === 'PUT') {
      const data = body.data;
      const text = JSON.stringify(data || null);
      if (!data || typeof data !== 'object' || text.length > 200_000) return out({ error: 'bad character' }, 400);
      const name = String(data.name || 'Unnamed').slice(0, 60);
      if (!row) {
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM v_chars WHERE owner = ?').bind(u.id).first();
        if (n && n.n >= 200) return out({ error: 'too many characters' }, 400);
        await env.DB.prepare('INSERT INTO v_chars (id, owner, owner_name, name, campaign, data, updated) VALUES (?, ?, ?, ?, NULL, ?, ?)').bind(m[2], u.id, u.username, name, text, Date.now()).run();
      } else {
        if (!(await canEdit(row))) return out({ error: 'not yours' }, 403);
        await env.DB.prepare('UPDATE v_chars SET name = ?, data = ?, updated = ? WHERE id = ?').bind(name, text, Date.now(), m[2]).run();
      }
      return out(vCharOut(await charRow(m[2])));
    }
    if (req.method === 'DELETE') {
      if (!row) return out({ ok: true });
      if (row.owner !== u.id) return out({ error: 'not yours' }, 403);
      await env.DB.batch([env.DB.prepare('DELETE FROM v_chars WHERE id = ?').bind(m[2]), env.DB.prepare('DELETE FROM v_pics WHERE id = ?').bind(m[2])]);
      return out({ ok: true });
    }
  }

  // ---- campaigns
  if (m && m[1] === 'camps' && !m[2] && req.method === 'GET') {
    const mine = await env.DB.prepare('SELECT * FROM v_camps WHERE gm = ? ORDER BY created DESC LIMIT 50').bind(u.id).all();
    const joined = await env.DB.prepare('SELECT DISTINCT c.* FROM v_camps c JOIN v_chars ch ON ch.campaign = c.id WHERE ch.owner = ? AND c.gm != ? LIMIT 50').bind(u.id, u.id).all();
    return out({ camps: mine.results.map((c) => vCampOut(c, true)).concat(joined.results.map((c) => vCampOut(c, false))) });
  }
  if (m && m[1] === 'camps' && !m[2] && req.method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return out({ error: 'needs a name' }, 400);
    const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM v_camps WHERE gm = ?').bind(u.id).first();
    if (n && n.n >= 20) return out({ error: 'too many campaigns' }, 400);
    const id = vId(10), code = vId(6).toUpperCase();
    await env.DB.prepare('INSERT INTO v_camps (id, code, gm, gm_name, name, intro, webhook, created) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)').bind(id, code, u.id, u.username, name, String(body.intro || '').slice(0, 8000), Date.now()).run();
    return out(vCampOut(await camp(id), true));
  }
  if (m && m[1] === 'camps' && m[2]) {
    const c = await camp(m[2]);
    if (!c) return out({ error: 'not found' }, 404);
    const isGm = c.gm === u.id;
    if (req.method === 'GET') {
      const chars = await env.DB.prepare('SELECT * FROM v_chars WHERE campaign = ? ORDER BY name LIMIT 50').bind(c.id).all();
      if (!isGm && !chars.results.some((r) => r.owner === u.id)) return out({ error: 'not found' }, 404);
      const f = await env.DB.prepare('SELECT data FROM v_fights WHERE camp = ?').bind(c.id).first();
      // players only see NPCs the GM has shown them, and only who they are, not their numbers
      const list = chars.results.map(vCharOut).filter((ch) => isGm || !ch.data.npc || !ch.data.hidden).map((ch) => {
        if (isGm || !ch.data.npc) return ch;
        const d = ch.data;
        return Object.assign({}, ch, { data: { npc: true, name: d.name, title: d.title, race: d.race, cls: d.cls, level: d.level, pic: d.pic, look: d.look } });
      });
      return out({ camp: vCampOut(c, isGm), chars: list, fight: f ? JSON.parse(f.data) : null });
    }
    if (!isGm) return out({ error: 'only the GM can do that' }, 403);
    if (req.method === 'PUT') {
      const hook = body.webhook == null ? c.webhook : String(body.webhook).trim();
      if (hook && !/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(hook)) return out({ error: 'that isn’t a Discord webhook link' }, 400);
      await env.DB.prepare('UPDATE v_camps SET name = ?, intro = ?, webhook = ? WHERE id = ?')
        .bind(String(body.name == null ? c.name : body.name).trim().slice(0, 80) || c.name, String(body.intro == null ? (c.intro || '') : body.intro).slice(0, 8000), hook || null, c.id).run();
      return out(vCampOut(await camp(c.id), true));
    }
    if (req.method === 'DELETE') {
      await env.DB.batch([env.DB.prepare('UPDATE v_chars SET campaign = NULL WHERE campaign = ?').bind(c.id), env.DB.prepare('DELETE FROM v_camps WHERE id = ?').bind(c.id)]);
      return out({ ok: true });
    }
  }

  // ---- joining and leaving
  if (path === '/api/v/join' && req.method === 'POST') {
    // players join with the code; the GM can add their own NPCs straight to a campaign they run
    const c = body.camp ? await camp(String(body.camp)) : await env.DB.prepare('SELECT * FROM v_camps WHERE code = ?').bind(String(body.code || '').trim().toUpperCase()).first();
    if (!c || (body.camp && c.gm !== u.id)) return out({ error: 'no campaign has that code' }, 404);
    const row = await charRow(String(body.char || ''));
    if (!row || row.owner !== u.id) return out({ error: 'save that character to your account first' }, 400);
    await env.DB.prepare('UPDATE v_chars SET campaign = ? WHERE id = ?').bind(c.id, row.id).run();
    return out({ camp: vCampOut(c, c.gm === u.id) });
  }
  if (path === '/api/v/leave' && req.method === 'POST') {
    const row = await charRow(String(body.char || ''));
    if (!row) return out({ ok: true });
    const c = row.campaign && await camp(row.campaign);
    if (row.owner !== u.id && !(c && c.gm === u.id)) return out({ error: 'not yours' }, 403);
    await env.DB.prepare('UPDATE v_chars SET campaign = NULL WHERE id = ?').bind(row.id).run();
    return out({ ok: true });
  }

  // ---- a roll, posted to the campaign's Discord channel
  if (path === '/api/v/roll' && req.method === 'POST') {
    const row = await charRow(String(body.char || ''));
    if (!row || !(await canEdit(row))) return out({ error: 'not found' }, 404);
    const c = row.campaign && await camp(row.campaign);
    if (!c || !c.webhook) return out({ error: 'no channel for this campaign' }, 400);
    const now = Date.now(), times = (vRolls.get(u.id) || []).filter((t) => t > now - 60_000);
    if (times.length >= 20) return out({ error: 'slow down' }, 429);
    times.push(now); vRolls.set(u.id, times); if (vRolls.size > 2000) vRolls.clear();
    const line = String(body.line || '').replace(/[@`]/g, '').slice(0, 300);
    if (!line) return out({ error: 'nothing to post' }, 400);
    const pic = JSON.parse(row.data).pic;
    const picUrl = pic ? new URL(req.url).origin + '/api/v/pic/' + row.id + '?v=' + Number(pic) : undefined;
    const r = await fetch(c.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      username: vHookName(row.name, 'A traveller'), allowed_mentions: { parse: [] }, avatar_url: picUrl,
      embeds: [vEmbed(body.info, line, c.name.slice(0, 100), picUrl)]
    }) });
    if (!r.ok) return out({ error: 'Discord refused the post', detail: r.status }, 502);
    return out({ ok: true });
  }

  // ---- the GM screen: rolls as anyone, and a few saved ones per campaign
  const sm = path.match(/^\/api\/v\/screen\/([a-z0-9]{4,32})$/);
  if (sm) {
    const c = await camp(sm[1]);
    if (!c || c.gm !== u.id) return out({ error: 'not found' }, 404);
    if (req.method === 'GET') {
      const r = await env.DB.prepare('SELECT data FROM v_screens WHERE camp = ?').bind(c.id).first();
      const d = r ? JSON.parse(r.data) : [];
      return out(Array.isArray(d) ? { saved: d, npcs: [] } : { saved: d.saved || [], npcs: d.npcs || [] });
    }
    if (req.method === 'PUT') {
      const saved = (Array.isArray(body.saved) ? body.saved : []).slice(0, 40).map((x) => ({ who: String(x && x.who || '').slice(0, 60), what: String(x && x.what || '').slice(0, 60), dice: String(x && x.dice || '').slice(0, 40) })).filter((x) => x.dice);
      const n = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : Math.max(-9999, Math.min(99999, Math.round(+v))));
      const npcs = (Array.isArray(body.npcs) ? body.npcs : []).slice(0, 40).map((x) => ({ name: String(x && x.name || '').slice(0, 60), hp: n(x && x.hp), maxHp: n(x && x.maxHp), sta: n(x && x.sta), maxSta: n(x && x.maxSta), ini: n(x && x.ini) })).filter((x) => x.name);
      await env.DB.prepare('INSERT INTO v_screens (camp, data, updated) VALUES (?, ?, ?) ON CONFLICT(camp) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(c.id, JSON.stringify({ saved, npcs }), Date.now()).run();
      return out({ saved, npcs });
    }
  }
  // ---- initiative: the GM keeps the order, everyone in the campaign can read it (with the campaign)
  const fm = path.match(/^\/api\/v\/fight\/([a-z0-9]{4,32})$/);
  if (fm && (req.method === 'PUT' || req.method === 'DELETE')) {
    const c = await camp(fm[1]);
    if (!c || c.gm !== u.id) return out({ error: 'not found' }, 404);
    if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM v_fights WHERE camp = ?').bind(c.id).run(); return out({ fight: null }); }
    const f = body.fight && typeof body.fight === 'object' ? body.fight : null;
    const n = (v) => (v === '' || v == null || !Number.isFinite(+v) ? null : Math.max(-999, Math.min(999, Math.round(+v))));
    if (!f) return out({ error: 'bad fight' }, 400);
    const list = (Array.isArray(f.list) ? f.list : []).slice(0, 40).map((x) => ({
      id: String(x && x.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 32), kind: ['pc', 'npc', 'extra'].includes(x && x.kind) ? x.kind : 'extra',
      name: String(x && x.name || '').slice(0, 60), char: x && x.char ? String(x.char).replace(/[^a-z0-9]/gi, '').slice(0, 32) : undefined,
      init: n(x && x.init), spd: n(x && x.spd), out: !!(x && x.out) })).filter((x) => x.id && x.name);
    const fight = { round: Math.max(1, n(f.round) || 1), current: String(f.current || '').slice(0, 32), started: Number.isFinite(+f.started) && +f.started > 0 ? +f.started : Date.now(), list };
    await env.DB.prepare('INSERT INTO v_fights (camp, data, updated) VALUES (?, ?, ?) ON CONFLICT(camp) DO UPDATE SET data = excluded.data, updated = excluded.updated').bind(c.id, JSON.stringify(fight), Date.now()).run();
    return out({ fight });
  }
  if (path === '/api/v/gmroll' && req.method === 'POST') {
    const c = await camp(String(body.camp || ''));
    if (!c || c.gm !== u.id) return out({ error: 'not found' }, 404);
    if (!c.webhook) return out({ error: 'no channel for this campaign' }, 400);
    const now = Date.now(), times = (vRolls.get(u.id) || []).filter((t) => t > now - 60_000);
    if (times.length >= 30) return out({ error: 'slow down' }, 429);
    times.push(now); vRolls.set(u.id, times);
    const line = String(body.line || '').replace(/[@`]/g, '').slice(0, 300);
    const info = Object.assign({ hp: null, maxHp: null, sta: null, maxSta: null }, body.info && typeof body.info === 'object' ? body.info : {}, { kind: body.kind === 'turn' ? 'turn' : 'gm', exhaustion: null, taint: null });
    const r = await fetch(c.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      username: vHookName(body.who, 'The GM'), allowed_mentions: { parse: [] }, embeds: [vEmbed(info, line, c.name.slice(0, 100))]
    }) });
    if (!r.ok) return out({ error: 'Discord refused the post', detail: r.status }, 502);
    return out({ ok: true });
  }
  return out({ error: 'not found' }, 404);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Discord's proxy may add /.proxy in front of paths
    const path = url.pathname.replace(/^\/\.proxy/, '') || '/';
    const cors = req.headers.get('Origin') === SITE && (path === '/api/run' || path === '/api/result' || path.startsWith('/api/v/'))
      ? { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS', 'Vary': 'Origin' }
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
