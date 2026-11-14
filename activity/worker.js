// The Rend-Conomy Activity's server: a Cloudflare Worker (free plan). Paste this whole file into the
// Worker's code editor (Workers & Pages -> rend-conomy -> Edit code) and click Deploy.
//
// It does three jobs:
//   1. Serves the Activity itself (the files in /activity in the repo, from the branch in ACTIVITY_BRANCH,
//      or main)
//   2. Logs players in: swaps Discord's one-time code for a token (needs the client secret, so it
//      can't happen in the browser)
//   3. Passes commands between the Activity and the bot through the D1 database. The Activity drops a
//      command in, the bot (which can't be reached from the internet) picks it up every couple of
//      seconds, runs it as that player, and leaves the reply for the Activity to collect.
//   4. Lets the site's profile page use the same relay (only from the site itself), so players can
//      customize their profile there. Only profile commands are accepted from the site.
//
// Settings on the Worker (Settings -> Variables and Secrets), never in this file:
//   DISCORD_CLIENT_ID      text    Render's Vision's Application ID
//   DISCORD_CLIENT_SECRET  secret  from the Developer Portal (OAuth2)
//   BOT_SECRET             secret  the same value as ACTIVITY_SECRET in the bot's .env
//   ACTIVITY_BRANCH        text    optional: serve the Activity from a test branch instead of main
// Binding: a D1 database named DB.

const REPO = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io';
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', png: 'image/png', svg: 'image/svg+xml', json: 'application/json' };
const DATA = 'https://raw.githubusercontent.com/RenderProductions/renderproductions.github.io/data';
const DISCORD = 'https://discord.com/api/v10';

let ready = false;
async function setup(env) {
  if (ready) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, username TEXT, guild_id TEXT NOT NULL,
    line TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new', result TEXT, created INTEGER NOT NULL)`).run();
  ready = true;
}

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

async function api(req, env, path, cors) {
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

  // Public market data (prices, the week's history, the world event), straight from the bot's data branch
  if (path === '/api/market' || path === '/api/week') {
    const r = await fetch(`${DATA}/${path === '/api/market' ? 'prices.json' : 'history-7d.json'}?t=${Date.now()}`, { cf: { cacheTtl: 30 } });
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  if (path === '/api/run' && req.method === 'POST') {
    const u = await user(req);
    if (!u) return out({ error: 'not logged in' }, 401);
    const { guild_id: g, line } = await req.json().catch(() => ({}));
    if (!/^\d{5,25}$/.test(String(g || '')) || !line || String(line).length > 200) return out({ error: 'bad request' }, 400);
    // from the site, only profile changes
    if (cors['Access-Control-Allow-Origin'] && !/^profile (theme|color|banner|frame|pin|reset|private)\b/i.test(String(line))) return out({ error: 'not allowed from the site' }, 403);
    await setup(env);
    // At most 30 commands a minute per player
    const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM actions WHERE user_id = ? AND created > ?').bind(u.id, Date.now() - 60_000).first();
    if (recent && recent.n >= 30) return out({ error: 'slow down' }, 429);
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
      await env.DB.prepare('DELETE FROM actions WHERE created < ?').bind(Date.now() - 3600_000).run();
      const { results } = await env.DB.prepare("SELECT id, user_id, username, guild_id, line FROM actions WHERE status = 'new' ORDER BY id LIMIT 25").all();
      if (results.length) await env.DB.prepare(`UPDATE actions SET status = 'taken' WHERE id IN (${results.map(() => '?').join(',')})`).bind(...results.map((r) => r.id)).run();
      return out({ actions: results });
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
  async fetch(req, env) {
    const url = new URL(req.url);
    // Discord's proxy may add /.proxy in front of paths
    const path = url.pathname.replace(/^\/\.proxy/, '') || '/';
    const cors = req.headers.get('Origin') === SITE && (path === '/api/run' || path === '/api/result')
      ? { 'Access-Control-Allow-Origin': SITE, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Vary': 'Origin' }
      : {};
    if (req.method === 'OPTIONS') return new Response(null, { status: cors['Access-Control-Allow-Origin'] ? 204 : 403, headers: cors });
    try {
      if (path.startsWith('/api/') || path.startsWith('/bot/')) return await api(req, env, path, cors);
      // Everything else is the Activity's own files, from the repo
      const file = path === '/' ? '/index.html' : path;
      if (!/^\/[a-z0-9._-]+$/i.test(file) || file === '/worker.js') return json({ error: 'not found' }, 404);
      const r = await fetch(`${REPO}/${env.ACTIVITY_BRANCH || 'main'}/activity${file}`, { cf: { cacheTtl: 60 } });
      if (!r.ok) return new Response('Not found', { status: 404 });
      const ext = file.split('.').pop().toLowerCase();
      return new Response(r.body, { headers: { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === 'html' ? 'no-cache' : 'public, max-age=300' } });
    } catch (e) {
      return json({ error: 'server error', detail: String(e && e.message || e) }, 500);
    }
  }
};
