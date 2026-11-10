// "Your next shift is ready" DMs, for players who turned them on with r!job remind on.
// Timers live in memory; restore() puts them back after a restart.
const jobs = require('./jobs');
const config = require('./config');

const timers = new Map(); // "guild:user" -> timeout

function schedule(deps, guildId, userId, at) {
  const key = `${guildId}:${userId}`;
  clearTimeout(timers.get(key));
  const wait = Math.max(1000, at - Date.now());
  timers.set(key, setTimeout(() => fire(deps, guildId, userId), wait).unref());
}

function cancel(guildId, userId) {
  const key = `${guildId}:${userId}`;
  clearTimeout(timers.get(key));
  timers.delete(key);
}

async function fire(deps, guildId, userId) {
  timers.delete(`${guildId}:${userId}`);
  try {
    const p = deps.db.raw.prepare('SELECT * FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
    if (!p || !p.remind || !p.job) return;
    if (p.last_work + jobs.WORK_COOLDOWN_MS > Date.now() + 5000) return; // they worked again since; a newer timer has it
    const client = deps.client;
    if (!client || !client.users) return;
    const user = await client.users.fetch(userId);
    const guild = client.guilds && client.guilds.cache && client.guilds.cache.get(guildId);
    await user.send({
      content: `⏰ Your next shift at **${p.job}** is ready${guild ? ` in **${guild.name}**` : ''}. Clock in with \`${config.prefix}work\`.\n-# Turn these off with \`${config.prefix}job remind off\`.`,
      allowedMentions: { parse: [] }
    });
  } catch (e) { /* closed DMs or the bot left: nothing to do */ }
}

// After a restart: everyone who wants reminders and is still on a cooldown
function restore(deps) {
  const rows = deps.db.raw.prepare('SELECT guild_id, user_id, last_work FROM players WHERE remind = 1 AND job IS NOT NULL AND last_work > ?')
    .all(Date.now() - jobs.WORK_COOLDOWN_MS);
  for (const r of rows) schedule(deps, r.guild_id, r.user_id, r.last_work + jobs.WORK_COOLDOWN_MS);
  return rows.length;
}

module.exports = { schedule, cancel, restore, timers };
