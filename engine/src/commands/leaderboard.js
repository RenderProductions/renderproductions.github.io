// r!leaderboard [category]: the top 10 in this server, with your own spot at the bottom.
// Categories: net worth (default), Polygons, shifts worked, casino winnings. Buttons switch between them.
const config = require('../config');
const economy = require('../economy');
const loans = require('../loans');
const { have, amt } = require('../format');
const { button, rows } = require('../buttons');

const MEDALS = ['🥇', '🥈', '🥉'];
const BOARDS = {
  worth:  { label: 'Net worth', emoji: '💎', color: 0xffe600, show: (v) => have(v) },
  cash:   { label: 'Polygons', emoji: '⬢', color: 0x57f287, show: (v) => have(v) },
  shifts: { label: 'Shifts worked', emoji: '💼', color: 0x5865f2, show: (v) => `${v.toLocaleString()} shift${v === 1 ? '' : 's'}` },
  casino: { label: 'Casino', emoji: '🎰', color: 0xeb459e, show: (v) => (v >= 0 ? `+${amt(v)}` : `−${amt(-v)}`) }
};
const ALIAS = { networth: 'worth', net: 'worth', nw: 'worth', polygons: 'cash', money: 'cash', balance: 'cash', work: 'shifts', jobs: 'shifts', gambling: 'casino', rendsino: 'casino' };

async function scores(ctx, board) {
  const db = ctx.db, g = ctx.guildId;
  const players = db.raw.prepare('SELECT user_id, username, cash, debt FROM players WHERE guild_id = ?').all(g)
    .filter((p) => p.user_id !== (ctx.client && ctx.client.user && ctx.client.user.id));
  if (board === 'cash') return players.map((p) => ({ id: p.user_id, name: p.username, v: p.cash }));
  if (board === 'shifts') {
    const s = new Map(db.raw.prepare('SELECT user_id, SUM(total) AS n FROM careers WHERE guild_id = ? GROUP BY user_id').all(g).map((r) => [r.user_id, r.n]));
    return players.map((p) => ({ id: p.user_id, name: p.username, v: s.get(p.user_id) || 0 }));
  }
  if (board === 'casino') {
    const s = new Map(db.raw.prepare('SELECT user_id, SUM(paid - wagered) AS n, SUM(played) AS k FROM gambling WHERE guild_id = ? GROUP BY user_id').all(g).map((r) => [r.user_id, r]));
    return players.filter((p) => s.has(p.user_id) && s.get(p.user_id).k > 0).map((p) => ({ id: p.user_id, name: p.username, v: s.get(p.user_id).n }));
  }
  const m = await ctx.market.get();
  return players.map((p) => {
    const c = { db, guildId: g, user: { id: p.user_id } };
    const gross = m ? economy.worth(c, m, p, p.user_id) : p.cash;
    return { id: p.user_id, name: p.username, v: gross - p.debt - loans.totalOwed(db, g, p.user_id) + loans.totalLent(db, g, p.user_id) };
  });
}

async function view(ctx, board) {
  const b = BOARDS[board];
  const list = (await scores(ctx, board)).sort((x, y) => y.v - x.v);
  const top = list.slice(0, 10);
  const lines = top.map((r, i) => {
    const me = r.id === ctx.user.id;
    const place = MEDALS[i] || `\`${String(i + 1).padStart(2, ' ')}.\``;
    return `${place} ${me ? '**➤ ' : '**'}${r.name || 'Unknown'}**${me ? ' (you)' : ''} · ${b.show(r.v)}`;
  });
  const mine = list.findIndex((r) => r.id === ctx.user.id);
  const you = mine >= 10 ? `\n\n**Your spot:** #${mine + 1} of ${list.length} · ${b.show(list[mine].v)}` : mine < 0 && board === 'casino' ? `\n\n-# You haven't placed a bet yet. Try \`${config.prefix}help casino\`.` : '';
  return {
    embeds: [{
      author: { name: ctx.guildName ? `${ctx.guildName} · Leaderboard` : 'Leaderboard' },
      title: `${b.emoji} ${b.label}`,
      description: (lines.length ? lines.join('\n') : 'Nobody here yet.') + you,
      footer: { text: `${list.length} player${list.length === 1 ? '' : 's'} · Balances are per server` },
      color: b.color
    }],
    components: rows(Object.keys(BOARDS).map((k) => button(BOARDS[k].label, `lb:${ctx.user.id}:${k}`, k === board ? 'blue' : 'grey', k === board, BOARDS[k].emoji)))
  };
}

module.exports = {
  name: 'leaderboard',
  aliases: ['lb', 'top', 'rich'],
  description: "This server's top players",
  usage: '[worth|polygons|shifts|casino]',
  options: [{ name: 'category', type: 'string', description: 'worth (default), polygons, shifts, or casino' }],
  buttonPrefix: 'lb',
  BOARDS,

  async run(ctx, args) {
    const t = String(args.category || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return view(ctx, BOARDS[t] ? t : ALIAS[t] || 'worth');
  },

  async onButton(ctx, [userId, board]) {
    if (!BOARDS[board]) return null;
    if (ctx.user.id !== userId) return { reply: await view(ctx, board) };
    return { update: await view(ctx, board) };
  }
};
