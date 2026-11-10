// Live stats about the bot itself, published with the site data so the bot page can show them.
const started = Date.now();
let presence = { status: 'online', activity: '' }; // updated by the status rotation
let client = null;

function setClient(c) { client = c; }
function setPresence(status, activity) { presence = { status, activity: String(activity || '') }; }

function count(db) {
  const one = (sql) => { try { return db.raw.prepare(sql).get() || {}; } catch (e) { return {}; } };
  const p = one('SELECT COUNT(*) AS players, COALESCE(SUM(cash), 0) AS cash FROM players');
  const w = one('SELECT COALESCE(SUM(total), 0) AS shifts FROM careers');
  const g = one('SELECT COALESCE(SUM(played), 0) AS bets, COALESCE(SUM(wagered), 0) AS wagered FROM gambling');
  const c = one('SELECT COUNT(*) AS n FROM pc_companies WHERE status IN (\'private\', \'public\')');
  return {
    servers: client && client.guilds ? client.guilds.cache.size : null,
    players: p.players || 0,
    polygons: (p.cash || 0) / 100,
    shifts: w.shifts || 0,
    bets: g.bets || 0,
    wagered: (g.wagered || 0) / 100,
    companies: c.n || 0,
    commands: Number(db.meta('commands_run')) || 0,
    online: new Date(started).toISOString(),
    status: presence.status,
    activity: presence.activity
  };
}

// Counts a command (called by the router)
function counted(db) { try { db.setMeta('commands_run', (Number(db.meta('commands_run')) || 0) + 1); } catch (e) { /* never block a command */ } }

module.exports = { setClient, setPresence, count, counted, started, client: () => client };
