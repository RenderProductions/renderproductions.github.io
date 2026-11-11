// The Rend-Sino: shared rules and helpers for every gambling game.
// Bets go into the Polygon Reserve and winnings come out of it, paid in full. Every game has a small
// house edge, so over time the casino fills the reserve rather than draining it.
const config = require('./config');
const reserve = require('./reserve');
const { amt, have, parsePolygons } = require('./format');

const RULES = {
  minBet: 10_00,
  maxBet: { coinflip: 2500_00, dice: 2500_00, blackjack: 2500_00, bus: 2500_00, hilo: 2500_00, mines: 2500_00, rocket: 2500_00, derby: 1000_00, roulette: 2500_00 },
  cooldownMs: 3000,        // between games, per player
  sessionMs: 2 * 60 * 1000, // an unfinished game is forfeited after this
  hotStreak: 10,            // win this many in a row and TODD drags you out...
  banMs: 3 * 60 * 60 * 1000 // ...for 3 hours
};
const NAMES = { slots: '🎰 Slots', coinflip: '🪙 Coinflip', dice: '🎲 Dice', blackjack: '🃏 Blackjack', bus: '🚌 Ride the Bus',
  hilo: '🔼 Higher or Lower', mines: '💣 Minesweeper', rocket: '🚀 Rocket', derby: '🏇 Polygon Derby', lottery: '🎟️ Lottery', roulette: '🎡 Roulette' };

const last = new Map();     // "guild:user" -> ms of the last game
const sessions = new Map(); // "guild:user" -> the game in progress
const lastBet = new Map();  // "guild:user" -> the last bet taken (to tell a win from getting your bet back)

// ---- Hot streaks: win too many in a row and TODD throws you out for a while ----
// Kept in meta so a restart doesn't let anyone back in early.
const streakKey = (guildId, userId) => `casino_streak:${guildId}:${userId}`;
const banKey = (guildId, userId) => `casino_ban:${guildId}:${userId}`;
const winStreak = (db, guildId, userId) => Number(db.meta(streakKey(guildId, userId))) || 0;
function bannedUntil(db, guildId, userId, now = Date.now()) {
  const until = Number(db.meta(banKey(guildId, userId))) || 0;
  return until > now ? until : 0;
}
function banMessage(until) {
  return `🖥️ **TODD has his eye on you.** You were thrown out of the Rend-Sino for winning too much. Come back <t:${Math.floor(until / 1000)}:R>.`;
}
// result: 'win' | 'loss' | 'push'. Returns true if this win got them thrown out.
function streak(ctx, result, now = Date.now()) {
  if (!ctx.guildId || !ctx.user || result === 'push') return false;
  const db = ctx.db, k = streakKey(ctx.guildId, ctx.user.id);
  if (result === 'loss') { if (winStreak(db, ctx.guildId, ctx.user.id)) db.setMeta(k, '0'); return false; }
  const n = winStreak(db, ctx.guildId, ctx.user.id) + 1;
  if (n < RULES.hotStreak) { db.setMeta(k, String(n)); return false; }
  const until = now + RULES.banMs;
  db.setMeta(k, '0');
  db.setMeta(banKey(ctx.guildId, ctx.user.id), String(until));
  sessions.delete(`${ctx.guildId}:${ctx.user.id}`);
  require('./achievements').award(ctx, 'escorted_out');
  if (ctx.notes) ctx.notes.unshift(`🖥️ **TODD grabs you by the collar and drags you out of the Rend-Sino.** ${RULES.hotStreak} wins in a row? Nobody is THAT lucky. ` +
    `You keep your winnings, but you're banned from gambling until <t:${Math.floor(until / 1000)}:t> (<t:${Math.floor(until / 1000)}:R>).`);
  return true;
}

// Checks a bet and takes it. Returns { bet } or { error }.
function takeBet(ctx, game, raw) {
  const P = config.prefix;
  const p = ctx.db.player(ctx.guildId, ctx.user);
  const ban = bannedUntil(ctx.db, ctx.guildId, ctx.user.id);
  if (ban) return { error: banMessage(ban) };
  if (p.debt > 0) return { error: `🖥️ GAMBLING?!? With MY money?! NOT a CHANCE. You owe me **${amt(p.debt)}**. (\`${P}repay\`)` };
  const key = `${ctx.guildId}:${ctx.user.id}`;
  const s = sessions.get(key);
  if (s && Date.now() - s.at < RULES.sessionMs && s.game !== game) return { error: `🎲 Finish your ${NAMES[s.game]} game first.` };
  const wait = (last.get(key) || 0) + RULES.cooldownMs - Date.now();
  if (wait > 0) return { error: `🎲 Easy there. Next game in ${Math.ceil(wait / 1000)}s.` };
  const bet = String(raw || '').trim().toLowerCase() === 'all' ? Math.min(p.cash, RULES.maxBet[game]) : parsePolygons(raw);
  if (bet === null || bet === undefined) return { error: null };
  if (bet < RULES.minBet) return { error: `🎲 The minimum bet is ${amt(RULES.minBet)}.` };
  if (bet > RULES.maxBet[game]) return { error: `🎲 The maximum bet for ${NAMES[game]} is ${amt(RULES.maxBet[game])}.` };
  if (p.cash < bet) return { error: `🎲 You only have ${have(p.cash)}.` };
  ctx.db.tx(() => {
    ctx.db.addCash(ctx.guildId, ctx.user.id, -bet);
    reserve.take(ctx.db, bet);
    stat(ctx.db, ctx.guildId, ctx.user.id, game, { played: 1, wagered: bet });
  });
  last.set(key, Date.now());
  lastBet.set(key, bet);
  if (bet === RULES.maxBet[game]) require('./achievements').award(ctx, 'high_roller');
  return { bet };
}

// Pays out (the bet included, if it's coming back). Returns the player's Polygons after.
function payout(ctx, game, cents) {
  cents = Math.max(0, Math.round(cents));
  // The hot streak counts wins against the bet (before any chip bonus). The derby pays out for others: skip it.
  const bet = lastBet.get(`${ctx.guildId}:${ctx.user.id}`);
  if (game !== 'derby' && ctx.notes && bet) streak(ctx, cents > bet ? 'win' : cents === bet ? 'push' : 'loss');
  // A Platinum Chip charge: this game pays 4% more (no house edge)
  if (ctx.guildId && require('./effects').take(ctx.db, ctx.guildId, ctx.user.id, 'chip') && cents > 0) cents = Math.round(cents * 1.04);
  ctx.db.tx(() => {
    if (cents) {
      ctx.db.addCash(ctx.guildId, ctx.user.id, cents);
      reserve.spend(ctx.db, cents);
    }
    stat(ctx.db, ctx.guildId, ctx.user.id, game, { paid: cents, biggest: cents });
  });
  // Achievements: the first win, and a losing streak
  const A = require('./achievements');
  if (cents > 0) { A.award(ctx, 'beginners_luck'); A.set(ctx, 'loss_streak', 0); }
  else if (A.bump(ctx, 'loss_streak') >= 10) A.award(ctx, 'down_bad');
  return ctx.db.player(ctx.guildId, ctx.user).cash;
}

function stat(db, guildId, userId, game, { played = 0, wagered = 0, paid = 0, biggest = 0 }) {
  db.raw.prepare('INSERT OR IGNORE INTO gambling (guild_id, user_id, game) VALUES (?, ?, ?)').run(guildId, userId, game);
  db.raw.prepare('UPDATE gambling SET played = played + ?, wagered = wagered + ?, paid = paid + ?, biggest = MAX(biggest, ?) WHERE guild_id = ? AND user_id = ? AND game = ?')
    .run(played, wagered, paid, biggest, guildId, userId, game);
}
const stats = (db, guildId, userId) => db.raw.prepare('SELECT * FROM gambling WHERE guild_id = ? AND user_id = ? ORDER BY played DESC').all(guildId, userId);

// Sessions: one interactive game at a time
const keyOf = (ctx) => `${ctx.guildId}:${ctx.user.id}`;
function start(ctx, game, state) { const s = { game, at: Date.now(), id: Math.random().toString(36).slice(2, 8), ...state }; sessions.set(keyOf(ctx), s); return s; }
function get(ctx, game, id) {
  const s = sessions.get(keyOf(ctx));
  if (!s || s.game !== game || (id && s.id !== id)) return null;
  if (Date.now() - s.at > RULES.sessionMs) { sessions.delete(keyOf(ctx)); return null; }
  s.at = Date.now();
  return s;
}
const end = (ctx) => sessions.delete(keyOf(ctx));

// Cards: 2-14 (11 J, 12 Q, 13 K, 14 A) and four suits
const SUITS = [['hearts', '♥️', 'red'], ['diamonds', '♦️', 'red'], ['clubs', '♣️', 'black'], ['spades', '♠️', 'black']];
const FACE = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
function deck(random = Math.random) {
  const d = [];
  for (const [suit, icon, color] of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, suit, icon, color });
  for (let i = d.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
const card = (c) => `\`${FACE[c.r] || c.r}${c.icon}\``;
const mult = (x) => `${(Math.floor(x * 100) / 100).toFixed(2)}x`;
const usage = (game, how) => `${NAMES[game]} Usage: \`${config.prefix}${how}\``;
const footer = () => ({ text: `Max bet per game shown in ${config.prefix}gambling · Bets fill the Polygon Reserve` });

module.exports = { RULES, NAMES, streak, winStreak, bannedUntil, banMessage, lastBet, takeBet, payout, stat, stats, start, get, end, sessions, last, deck, card, mult, usage, footer, SUITS };
