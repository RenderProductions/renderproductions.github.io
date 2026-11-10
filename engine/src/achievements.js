// Achievements: earned once, kept forever, and they follow a player across every server.
// award(ctx, id) unlocks one and queues an announcement on the reply (ctx.notes), which the router adds.
// bump(ctx, key, by) counts things toward an achievement ("25 gigs") and returns the new total.
// Legendary ones come with a free Title for the server you unlocked them in.

const RARITY = {
  common:    { label: 'Common',    emoji: '⚪', order: 0 },
  rare:      { label: 'Rare',      emoji: '🔵', order: 1 },
  epic:      { label: 'Epic',      emoji: '🟣', order: 2 },
  legendary: { label: 'Legendary', emoji: '🟡', order: 3 }
};

const CATEGORIES = {
  start:     { label: 'Getting started', emoji: '🌱' },
  market:    { label: 'Market',          emoji: '📈' },
  jobs:      { label: 'Jobs',            emoji: '💼' },
  casino:    { label: 'Rend-Sino',       emoji: '🎰' },
  social:    { label: 'Social',          emoji: '🤝' },
  companies: { label: 'Companies',       emoji: '🏢' },
  secret:    { label: 'Secret',          emoji: '❓' }
};

// [id, name, what to do, category, rarity]
const LIST = [
  ['first_paycheck', 'First Paycheck', 'Work your first shift', 'start', 'common'],
  ['day_one', 'Day One', 'Claim a daily', 'start', 'common'],
  ['shareholder', 'Shareholder', 'Buy your first share', 'start', 'common'],
  ['diversified', 'Diversified', 'Own shares in all five companies at once', 'start', 'rare'],

  ['buy_the_dip', 'Buy the Dip', 'Buy shares during a market crash', 'market', 'rare'],
  ['diamond_hands', 'Diamond Hands', 'Hold shares from before a crash until its recovery is over', 'market', 'epic'],
  ['paper_hands', 'Paper Hands', 'Sell shares for half of what you paid, or less', 'market', 'common'],
  ['time_well_spent', 'Time Well Spent', 'Hold shares for a week, then sell them for more than you paid', 'market', 'rare'],
  ['wiped_out', 'Wiped Out', 'Lose shares to a bankruptcy', 'market', 'common'],
  ['dividend_collector', 'Dividend Collector', 'Collect ⬡ 1,000 in dividends', 'market', 'rare'],
  ['millionaire', 'Millionaire', 'Reach a net worth of ⬢ 1,000,000', 'market', 'legendary'],

  ['promoted', 'Promoted', 'Get promoted at a performance review', 'jobs', 'common'],
  ['top_of_the_ladder', 'Top of the Ladder', 'Reach the top rank at a company', 'jobs', 'epic'],
  ['perfect_review', 'Perfect Review', 'Score 10/10 at a performance review', 'jobs', 'rare'],
  ['rush_hour', 'Rush Hour', 'Clear 5 rush rounds in a row', 'jobs', 'epic'],
  ['team_player', 'Team Player', 'Work 10 team shifts', 'jobs', 'rare'],
  ['solidarity', 'Solidarity', 'Join a strike', 'jobs', 'common'],
  ['scab', 'Scab', 'Cross a picket line', 'jobs', 'common'],
  ['pink_slip', 'Pink Slip', 'Get laid off', 'jobs', 'common'],
  ['jack_of_all_trades', 'Jack of All Trades', 'Work at all five companies', 'jobs', 'rare'],
  ['gig_economy', 'Gig Economy', 'Do 25 gigs', 'jobs', 'rare'],

  ['beginners_luck', "Beginner's Luck", 'Win your first casino game', 'casino', 'common'],
  ['high_roller', 'High Roller', 'Place a maximum bet', 'casino', 'rare'],
  ['natural', 'Natural', 'Get a blackjack', 'casino', 'rare'],
  ['bus_driver', 'Bus Driver', 'Ride the Bus all four rounds', 'casino', 'epic'],
  ['field_cleared', 'Field Cleared', 'Clear a whole Minesweeper field', 'casino', 'epic'],
  ['moon_shot', 'Moon Shot', 'Cash out a Rocket at 10x or more', 'casino', 'epic'],
  ['photo_finish', 'Photo Finish', 'Win a Polygon Derby bet', 'casino', 'rare'],
  ['jackpot', 'Jackpot', 'Win the lottery', 'casino', 'legendary'],
  ['down_bad', 'Down Bad', 'Lose 10 casino games in a row', 'casino', 'rare'],

  ['generous', 'Generous', 'Gift ⬡ 1,000 in total', 'social', 'rare'],
  ['loan_shark', 'Loan Shark', 'Lend Polygons at 25% a day', 'social', 'rare'],
  ['debt_free', 'Debt Free', 'Pay TODD back in full', 'social', 'common'],
  ['merciful', 'Merciful', 'Forgive a loan', 'social', 'rare'],

  ['founder', 'Founder', 'Found a company', 'companies', 'rare'],
  ['going_public', 'Going Public', 'Take your company public', 'companies', 'epic'],
  ['conglomerate', 'Conglomerate', 'Grow your company into a Conglomerate', 'companies', 'legendary'],

  ['soon_friend', 'Soon, Friend', 'Find the number', 'secret', 'epic', true],
  ['tip_the_house', 'Tip the House', 'Try to give the house a gift', 'secret', 'rare', true]
].map(([id, name, desc, cat, rarity, secret = false]) => ({ id, name, desc, cat, rarity, secret }));
const BY_ID = Object.fromEntries(LIST.map((a) => [a.id, a]));

const has = (db, userId, id) => !!db.raw.prepare('SELECT 1 FROM achievements WHERE user_id = ? AND id = ?').get(userId, id);
const unlocked = (db, userId) => db.raw.prepare('SELECT id, guild_id, unlocked_at FROM achievements WHERE user_id = ? ORDER BY unlocked_at').all(userId).filter((r) => BY_ID[r.id]);

// Unlocks an achievement. Returns the announcement line, or '' if they already had it.
function award(ctx, id, userId = ctx.user && ctx.user.id) {
  const a = BY_ID[id];
  if (!a || !userId || !ctx.db) return '';
  const r = ctx.db.raw.prepare('INSERT OR IGNORE INTO achievements (user_id, id, guild_id, unlocked_at) VALUES (?, ?, ?, ?)').run(userId, id, ctx.guildId || null, Date.now());
  if (!r.changes) return '';
  let line = `🏆 **Achievement unlocked:** ${RARITY[a.rarity].emoji} **${a.name}**: ${a.desc}`;
  if (a.rarity === 'legendary' && ctx.guildId) {
    ctx.db.player(ctx.guildId, { id: userId });
    ctx.db.addItem(ctx.guildId, userId, 'title', 1);
    line += '\n🏷️ Legendary reward: a free **Title**. Set it with `r!settitle`.';
  }
  if (ctx.notes && (!ctx.user || ctx.user.id === userId)) ctx.notes.push(line);
  return line;
}

// Counters toward achievements
function bump(ctx, key, by = 1, userId = ctx.user.id) {
  ctx.db.raw.prepare('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = value + excluded.value').run(userId, key, by);
  return get(ctx.db, userId, key);
}
function set(ctx, key, value, userId = ctx.user.id) {
  ctx.db.raw.prepare('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value').run(userId, key, value);
}
function get(db, userId, key) {
  const r = db.raw.prepare('SELECT value FROM progress WHERE user_id = ? AND key = ?').get(userId, key);
  return r ? r.value : 0;
}

// How many players have each achievement, out of how many players there are
function rarity(db) {
  const players = (db.raw.prepare('SELECT COUNT(DISTINCT user_id) AS n FROM players').get() || {}).n || 0;
  const counts = Object.fromEntries(db.raw.prepare('SELECT id, COUNT(*) AS n FROM achievements GROUP BY id').all().map((r) => [r.id, r.n]));
  return { players, counts, pct: (id) => (players ? Math.round(((counts[id] || 0) / players) * 1000) / 10 : 0) };
}

// The last crash's window, from the bot's market settings (for Diamond Hands)
function lastCrash(db) {
  try {
    const c = JSON.parse(db.meta('mk_crash') || '{}');
    if (!c.start) return null;
    const t0 = Date.parse(c.start), H = 3600000;
    return { start: t0, end: t0 + ((c.tremorHours || 2) + (c.crashHours || 48) + (c.recoveryHours || 72)) * H };
  } catch (e) { return null; }
}

// Turns the queued announcements into part of a reply
function attach(ctx, out) {
  if (!ctx || !ctx.notes || !ctx.notes.length) return out;
  const text = ctx.notes.splice(0).join('\n');
  if (out == null) return text;
  if (typeof out === 'string') return `${out}\n\n${text}`;
  return { ...out, content: out.content ? `${out.content}\n\n${text}` : text };
}

module.exports = { LIST, BY_ID, RARITY, CATEGORIES, award, bump, set, get, has, unlocked, rarity, lastCrash, attach };
