// The Discord Activity (Trading Floor): the bot's side. The Activity can't reach the bot directly, so it
// leaves commands with the Cloudflare Worker (activity/worker.js). Every couple of seconds the bot picks
// them up, runs each one as that player in that server (only the commands on the list below), and
// sends back the reply. Needs ACTIVITY_URL and ACTIVITY_SECRET in .env; does nothing without them.
const config = require('./config');

// What the Activity is allowed to run
const ALLOWED = new Set(['balance', 'buy', 'sell', 'short', 'cover', 'dividends', 'daily', 'savings', 'event', 'leaderboard',
  'reserve', 'orders', 'order', 'gambling', 'coinflip', 'dice', 'roulette', 'slots', 'fish', 'achievements', 'backpay', 'market']);
// Games that need live buttons in chat, with a friendlier no
const CHAT_ONLY = { rocket: '🚀 Rocket', blackjack: '🃏 Blackjack', bus: '🚌 Ride the Bus', hilo: '🔼 Higher or Lower', mines: '💣 Minesweeper', derby: '🏇 The Derby', heist: '🦹 Heists', work: '💼 Work', gig: '🧰 Gigs' };
const POLL_MS = 2000;

// Turns a command's reply into plain data the Activity can draw (no buttons)
function toResult(out) {
  if (out && out._final) out = out._final;
  if (out == null) return { content: 'Done.' };
  if (typeof out === 'string') return { content: out };
  return { content: out.content || '', embeds: (out.embeds || []).map((e) => ({ title: e.title, description: e.description, fields: e.fields, color: e.color, footer: e.footer && e.footer.text })) };
}

// Runs one command from the Activity. Returns the result to send back.
async function runOne(deps, a) {
  const router = require('./router');
  const commands = require('./commands');
  const client = deps.client;
  const guild = client && client.guilds && client.guilds.cache.get(a.guild_id);
  if (!guild) return { content: "🖥️ Render's Vision isn't in this server, so there's nothing to trade here." };
  const member = await guild.members.fetch(a.user_id).catch(() => null);
  if (!member) return { content: "🖥️ You're not a member of this server." };
  const parsed = router.parsePrefix(config.prefix + String(a.line).replace(new RegExp('^' + config.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), ''));
  if (!parsed) return { content: '🖥️ Unknown command.' };
  if (CHAT_ONLY[parsed.cmd.name]) return { content: `${CHAT_ONLY[parsed.cmd.name]} needs live buttons, so play it in chat for now: \`${config.prefix}${parsed.cmd.name}\`.` };
  if (!ALLOWED.has(parsed.cmd.name)) return { content: `🖥️ \`${parsed.cmd.name}\` doesn't work from the Trading Floor. Use it in chat.` };
  const user = member.user;
  const ctx = router.makeCtx({ guildId: a.guild_id, channelId: 'activity', user, isMod: false, guildName: guild.name }, deps);
  const out = await router.runCommand(parsed.cmd, ctx, parsed.args);
  return toResult(out);
}

async function poll(deps) {
  const headers = { 'X-Bot-Secret': config.activitySecret, 'Content-Type': 'application/json' };
  const r = await fetch(`${config.activityUrl}/bot/actions`, { headers });
  if (!r.ok) throw new Error(`Worker said ${r.status}`);
  const { actions = [] } = await r.json();
  if (!actions.length) return 0;
  const results = [];
  for (const a of actions) {
    let result;
    try { result = await runOne(deps, a); } catch (e) { console.error('[activity]', e); result = { content: 'Something broke. It has been logged.' }; }
    results.push({ id: a.id, result });
  }
  await fetch(`${config.activityUrl}/bot/results`, { method: 'POST', headers, body: JSON.stringify({ results }) });
  return results.length;
}

function start(deps) {
  if (!config.activityUrl || !config.activitySecret) { console.log('[activity] ACTIVITY_URL / ACTIVITY_SECRET not set, so the Activity is off.'); return null; }
  let busy = false, failing = false;
  console.log('[activity] Listening for the Trading Floor at', config.activityUrl);
  return setInterval(async () => {
    if (busy) return;
    busy = true;
    try { await poll(deps); if (failing) console.log('[activity] Reconnected to the Worker'); failing = false; }
    catch (e) { if (!failing) console.error('[activity] Could not reach the Worker:', e.message); failing = true; }
    finally { busy = false; }
  }, POLL_MS).unref();
}

module.exports = { ALLOWED, toResult, runOne, poll, start };
