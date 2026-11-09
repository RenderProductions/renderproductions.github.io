// A tiny web API so site pages can ask the bot for live data.
//   GET /health                      -> { ok: true }
//   GET /api/leaderboard?guild=<id>  -> top 10 players by net worth in that server
// Only the site's own origin is allowed to call it from a browser.
const http = require('http');
const config = require('./config');

const ALLOWED_ORIGINS = ['https://renderproductions.github.io', 'http://localhost:4000'];

function leaderboard(db, market, m, guildId) {
  const worth = new Map();
  for (const p of db.guildPlayers(guildId)) worth.set(p.user_id, { name: p.username || 'Unknown', cash: p.cash, stocks: 0 });
  for (const h of db.guildHoldings(guildId)) {
    const row = worth.get(h.user_id);
    const q = m && market.quote(m, h.ticker);
    if (row && q) row.stocks += h.shares * q.priceCents;
  }
  return [...worth.values()]
    .map((r) => ({ name: r.name, netWorth: (r.cash + r.stocks) / 100 }))
    .sort((a, b) => b.netWorth - a.netWorth)
    .slice(0, 10);
}

function start({ db, market }) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Content-Type', 'application/json');

    const send = (code, body) => { res.statusCode = code; res.end(JSON.stringify(body)); };
    try {
      if (url.pathname === '/health') return send(200, { ok: true });
      if (url.pathname === '/api/leaderboard') {
        const guild = url.searchParams.get('guild');
        if (!/^\d{5,25}$/.test(guild || '')) return send(400, { error: 'guild must be a server ID' });
        let m = null;
        try { m = await market.get(); } catch (e) { /* cash-only ranking */ }
        return send(200, { guild, players: leaderboard(db, market, m, guild) });
      }
      send(404, { error: 'not found' });
    } catch (e) {
      console.error('[api]', e);
      send(500, { error: 'server error' });
    }
  });
  server.listen(config.port, () => console.log(`[api] Listening on port ${config.port}`));
  return server;
}

module.exports = { start, leaderboard };
