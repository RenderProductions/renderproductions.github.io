// The weekly lottery, one per server. Tickets are bought all week; the draw is Sunday at 8 PM Eastern.
// 90% of every ticket goes into the pot, 10% to the Polygon Reserve. One ticket, one chance.
const config = require('./config');
const reserve = require('./reserve');
const casino = require('./casino');
const { day, amt } = require('./format');

const RULES = { price: 50_00, maxTickets: 20, potShare: 0.9, drawHour: 20 };
const parts = (ms) => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: config.timeZone, weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false });
  const o = Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { weekday: o.weekday, hour: Number(o.hour) % 24, minute: Number(o.minute) };
};
// When the draw for a given Sunday happens (ms), found by stepping through that day
function drawTime(key) {
  const start = Date.parse(key + 'T00:00:00Z');
  for (let t = start; t < start + 36 * 3600000; t += 15 * 60000) {
    const p = parts(t);
    if (day(t) === key && p.hour === RULES.drawHour && p.minute === 0) return t;
  }
  return start + 25 * 3600000;
}
// The next draw (its Sunday date), from now
function nextDraw(now = Date.now()) {
  for (let i = 0; i < 8; i++) {
    const t = now + i * 86400000;
    const key = day(t);
    if (parts(t).weekday === 'Sun' && drawTime(key) > now) return key;
  }
  return day(now + 7 * 86400000);
}

const potKey = (g) => `lotto_pot:${g}`;
const pot = (db, g) => Number(db.meta(potKey(g))) || 0;
const tickets = (db, g, draw, userId) => {
  const r = db.raw.prepare('SELECT tickets FROM lottery WHERE guild_id = ? AND draw = ? AND user_id = ?').get(g, draw, userId);
  return r ? r.tickets : 0;
};
const sold = (db, g, draw) => db.raw.prepare('SELECT COALESCE(SUM(tickets), 0) AS n, COUNT(*) AS players FROM lottery WHERE guild_id = ? AND draw = ?').get(g, draw);

function buy(ctx, n, now = Date.now()) {
  const draw = nextDraw(now);
  const have = tickets(ctx.db, ctx.guildId, draw, ctx.user.id);
  if (have + n > RULES.maxTickets) return { error: `🎟️ You can hold at most ${RULES.maxTickets} tickets per draw. You have ${have}.` };
  const cost = n * RULES.price;
  const p = ctx.db.player(ctx.guildId, ctx.user);
  if (p.debt > 0) return { error: `🖥️ Lottery tickets? With MY money? Pay me back first. (\`${config.prefix}repay\`)` };
  if (p.cash < cost) return { error: `🎟️ ${n} ticket${n === 1 ? '' : 's'} cost ${amt(cost)}. You don't have that.` };
  ctx.db.tx(() => {
    ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
    const toPot = Math.round(cost * RULES.potShare);
    reserve.take(ctx.db, cost - toPot);
    ctx.db.setMeta(potKey(ctx.guildId), pot(ctx.db, ctx.guildId) + toPot);
    ctx.db.raw.prepare('INSERT OR IGNORE INTO lottery (guild_id, draw, user_id, username) VALUES (?, ?, ?, ?)').run(ctx.guildId, draw, ctx.user.id, ctx.user.username);
    ctx.db.raw.prepare('UPDATE lottery SET tickets = tickets + ?, username = ? WHERE guild_id = ? AND draw = ? AND user_id = ?').run(n, ctx.user.username, ctx.guildId, draw, ctx.user.id);
    casino.stat(ctx.db, ctx.guildId, ctx.user.id, 'lottery', { played: n, wagered: cost });
    ctx.db.setMeta(`lotto_ch:${ctx.guildId}`, ctx.channelId); // the results go where people buy
  });
  return { draw, owned: have + n, cost };
}

// Runs every draw that's due. Returns what happened (for logs and tests).
async function tick(deps, now = Date.now(), random = Math.random) {
  const due = deps.db.raw.prepare('SELECT DISTINCT guild_id, draw FROM lottery WHERE draw <= ?').all(day(now));
  const out = [];
  for (const { guild_id: g, draw } of due) {
    if (drawTime(draw) > now) continue;
    const rows = deps.db.raw.prepare('SELECT * FROM lottery WHERE guild_id = ? AND draw = ? AND tickets > 0').all(g, draw);
    const total = rows.reduce((s, r) => s + r.tickets, 0);
    let x = random() * total, win = rows[0];
    for (const r of rows) { x -= r.tickets; if (x < 0) { win = r; break; } }
    const prize = pot(deps.db, g);
    deps.db.tx(() => {
      deps.db.raw.prepare('DELETE FROM lottery WHERE guild_id = ? AND draw = ?').run(g, draw);
      if (!win) return;
      deps.db.setMeta(potKey(g), 0);
      deps.db.player(g, { id: win.user_id, username: win.username });
      deps.db.addCash(g, win.user_id, prize);
      casino.stat(deps.db, g, win.user_id, 'lottery', { paid: prize, biggest: prize });
    });
    if (!win) continue;
    out.push({ guild: g, draw, winner: win.user_id, name: win.username, prize, tickets: win.tickets, total });
    const unlock = require('./achievements').award({ db: deps.db, guildId: g }, 'jackpot', win.user_id);
    const text = `🎟️ **THE LOTTERY HAS BEEN DRAWN!** ${total} ticket${total === 1 ? '' : 's'} were in the drum...\n` +
      `🎉 **${win.username}** wins the pot of **${amt(prize)}** with ${win.tickets} ticket${win.tickets === 1 ? '' : 's'}!\n` +
      `-# The next draw is Sunday at 8 PM Eastern. \`${config.prefix}lottery buy <tickets>\``;
    const client = deps.client;
    try {
      const ch = client && client.channels ? await client.channels.fetch(deps.db.meta(`lotto_ch:${g}`)) : null;
      if (ch) await ch.send({ content: text, allowedMentions: { parse: [] } });
      const u = client && client.users ? await client.users.fetch(win.user_id) : null;
      if (u) await u.send(`🎟️ You won the lottery! **${amt(prize)}** is in your balance.${unlock ? '\n\n' + unlock : ''}`);
    } catch (e) { console.error('[lottery] Could not announce:', e.message); }
  }
  return out;
}

module.exports = { RULES, nextDraw, drawTime, pot, tickets, sold, buy, tick };
