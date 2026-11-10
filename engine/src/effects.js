// Item effects in play for a player in one server (stored as JSON on the player): counters like
// { chip: 5, stopwatch: 3, fuel: 1, wrap: 1 } and timers like { divBoostUntil: <ms> }.
function get(db, guildId, userId) {
  const p = db.raw.prepare('SELECT effects FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  try { return JSON.parse((p && p.effects) || '{}') || {}; } catch (e) { return {}; }
}
function save(db, guildId, userId, fx) { db.updatePlayer(guildId, userId, { effects: JSON.stringify(fx) }); }
function add(db, guildId, userId, key, n) { const fx = get(db, guildId, userId); fx[key] = (fx[key] || 0) + n; save(db, guildId, userId, fx); return fx[key]; }
// Uses one charge of a counter. Returns true if there was one.
function take(db, guildId, userId, key) {
  const fx = get(db, guildId, userId);
  if (!(fx[key] > 0)) return false;
  fx[key] -= 1;
  if (!fx[key]) delete fx[key];
  save(db, guildId, userId, fx);
  return true;
}
function setTimer(db, guildId, userId, key, until) { const fx = get(db, guildId, userId); fx[key] = until; save(db, guildId, userId, fx); }
const active = (db, guildId, userId, key, now = Date.now()) => (get(db, guildId, userId)[key] || 0) > now;
// Uses up one passive item from the inventory (Insurance, Hard Hat, Reference Letter). True if there was one.
function usePassive(db, guildId, userId, item) {
  if (db.itemCount(guildId, userId, item) <= 0) return false;
  db.addItem(guildId, userId, item, -1);
  return true;
}
module.exports = { get, save, add, take, setTimer, active, usePassive };
