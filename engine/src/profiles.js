// Public profiles for the site's "My profile" page: everyone who hasn't turned theirs private
// (r!profile private). Published to the data branch as profiles.json alongside the other site data.
const A = require('./achievements');
const jobs = require('./jobs');
const shop = require('./shop');
const botstats = require('./botstats');
const styles = require('./styles');

function snapshot(db, prices = null) {
  const client = botstats.client();
  const rar = A.rarity(db);
  const achievements = A.LIST.map((a) => ({
    id: a.id, cat: a.cat, rarity: a.rarity, secret: a.secret, pct: rar.pct(a.id),
    // Secrets stay secret: only the players who found one see what it is
    name: a.secret ? null : a.name, desc: a.secret ? null : a.desc
  }));
  const priv = new Set(db.raw.prepare("SELECT key FROM meta WHERE key LIKE 'private:%' AND value = '1'").all().map((r) => r.key.slice(8)));
  const users = {};
  const players = db.raw.prepare('SELECT * FROM players').all();
  const holdings = db.raw.prepare('SELECT guild_id, user_id, ticker, shares, wipe_seen FROM holdings WHERE shares > 0').all();
  const careers = db.raw.prepare('SELECT guild_id, user_id, ticker, rank, total FROM careers').all();
  const best = db.raw.prepare('SELECT guild_id, user_id, MAX(biggest) AS b FROM gambling GROUP BY guild_id, user_id').all();
  const inv = db.raw.prepare("SELECT guild_id, user_id, item FROM inventory WHERE qty > 0 AND item LIKE 'col_%'").all();
  const key = (g, u) => `${g}:${u}`;
  const by = (rows) => rows.reduce((m, r) => { const k = key(r.guild_id, r.user_id); (m[k] = m[k] || []).push(r); return m; }, {});
  const H = by(holdings), C = by(careers), I = by(inv);
  const B = Object.fromEntries(best.map((r) => [key(r.guild_id, r.user_id), r.b || 0]));
  const price = (t) => (prices && prices.prices ? Math.round(Number(prices.prices[t]) * 100) || 0 : 0);
  const wipes = (t) => Number((prices && prices.wipes && prices.wipes[t]) || 0);

  for (const p of players) {
    if (priv.has(p.user_id) || (client && client.user && p.user_id === client.user.id)) continue;
    const k = key(p.guild_id, p.user_id);
    const u = users[p.user_id] = users[p.user_id] || { name: p.username || 'Player', avatar: null, achievements: [], servers: [] };
    const stocks = (H[k] || []).reduce((s, h) => s + (h.wipe_seen >= wipes(h.ticker) ? h.shares * price(h.ticker) : 0), 0);
    const c = (C[k] || []).find((x) => x.ticker === p.job);
    const guild = client && client.guilds ? client.guilds.cache.get(p.guild_id) : null;
    u.servers.push({
      server: guild ? guild.name : 'A Rend-Conomy server',
      title: p.title || null,
      worth: (p.cash + stocks - p.debt) / 100,
      job: p.job ? { ticker: p.job, rank: jobs.rankName(p.job, c ? c.rank : 0) } : null,
      shifts: (C[k] || []).reduce((s, x) => s + x.total, 0),
      bestHit: (B[k] || 0) / 100,
      collectibles: (I[k] || []).map((r) => r.item).filter((id) => shop.COLLECTIBLES[id])
    });
  }
  for (const r of db.raw.prepare('SELECT user_id, id, unlocked_at FROM achievements ORDER BY unlocked_at').all()) {
    const u = users[r.user_id];
    const a = A.BY_ID[r.id];
    if (!u || !a) continue;
    u.achievements.push(a.secret ? [r.id, r.unlocked_at, a.name, a.desc] : [r.id, r.unlocked_at]);
  }
  for (const [id, u] of Object.entries(users)) {
    const cached = client && client.users ? client.users.cache.get(id) : null;
    if (cached) { u.avatar = cached.displayAvatarURL({ size: 128 }); u.name = cached.globalName || cached.username || u.name; }
    u.servers.sort((a, b) => b.worth - a.worth);
    // Their profile look, as checked names only (the site maps them to its own CSS)
    const st = styles.get(db, id), S = styles;
    const style = {};
    if (st.theme && (S.PRESETS[st.theme] || S.PAINTS[st.theme])) style.theme = st.theme;
    if (st.color && /^#[0-9a-f]{6}$/.test(st.color)) style.color = st.color;
    if (st.banner && S.BANNERS[st.banner]) style.banner = st.banner;
    if (st.frame && S.FRAMES[st.frame] && st.frame !== 'none') style.frame = st.frame;
    if (st.pin && shop.COLLECTIBLES[st.pin]) style.pin = st.pin;
    if (Object.keys(style).length) u.style = style;
  }
  const collectibles = Object.entries(shop.COLLECTIBLES).map(([id, c]) => ({ id, name: c.name, emoji: c.emoji, desc: c.desc }));
  return { achievements, collectibles, players: rar.players, users };
}

module.exports = { snapshot };
