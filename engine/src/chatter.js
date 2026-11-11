// Chat pay and TODD drop-ins: the bot pays people for hanging out in the server.
//
// Chat pay: a few Polygons for talking, at most once a minute and up to a daily cap per server. Only for
// players who've used the bot, only for real messages (not commands, not the same thing twice). Paid from
// the Polygon Reserve, like work.
//
// Drop-ins: every so often, while a channel is busy, TODD barges in with a question. The first right answer
// wins the pot. Mods can switch them off for their server (r!dropin off).
const config = require('./config');
const reserve = require('./reserve');
const A = require('./achievements');
const { amt, day } = require('./format');

const RULES = {
  chat: { min: 5_00, max: 15_00, cooldownMs: 60_000, perDay: 300_00, minLength: 4 },
  drop: { chance: 0.03, gapMs: 45 * 60_000, answerMs: 60_000, potMin: 300_00, potMax: 800_00 }
};

const lastPaid = new Map();   // guild:user -> { at, text }
const lastDrop = new Map();   // guild -> ms
const active = new Map();     // channelId -> { answer, shown, pot, guildId, endsAt }

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];
const between = (lo, hi, rand) => lo + Math.floor(rand() * (hi - lo + 1));

// ---- chat pay ----
// Pays for one message if it counts. Returns the cents paid (0 if it didn't count).
function chatPay(db, guildId, user, text, now = Date.now(), rand = Math.random) {
  const R = RULES.chat;
  const clean = String(text || '').trim();
  if (clean.length < R.minLength || !/[a-z]/i.test(clean)) return 0;
  const key = `${guildId}:${user.id}`;
  const last = lastPaid.get(key);
  if (last && (now - last.at < R.cooldownMs || norm(last.text) === norm(clean))) return 0;
  const p = db.raw.prepare('SELECT chat_day, chat_earned FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, user.id);
  if (!p) return 0; // hasn't used the bot here yet
  const today = day(now);
  const earned = p.chat_day === today ? p.chat_earned : 0;
  if (earned >= R.perDay) return 0;
  lastPaid.set(key, { at: now, text: clean });
  const got = reserve.pay(db, Math.min(R.perDay - earned, between(R.min / 100, R.max / 100, rand) * 100));
  if (!got) return 0;
  db.tx(() => {
    db.addCash(guildId, user.id, got);
    db.updatePlayer(guildId, user.id, { chat_day: today, chat_earned: earned + got });
  });
  return got;
}
const chatToday = (db, guildId, userId, now = Date.now()) => {
  const p = db.raw.prepare('SELECT chat_day, chat_earned FROM players WHERE guild_id = ? AND user_id = ?').get(guildId, userId);
  return p && p.chat_day === day(now) ? p.chat_earned : 0;
};

// ---- drop-ins ----
const WORDS = ['polygon', 'dividend', 'reserve', 'broker', 'marquez', 'bailout', 'shareholder', 'conglomerate', 'jackpot',
  'lottery', 'bankrupt', 'blackjack', 'minesweeper', 'rocket', 'derby', 'paycheck', 'overtime', 'promotion', 'savings',
  'interest', 'portfolio', 'collectible', 'achievement', 'leaderboard', 'market', 'crash', 'rally'];
const PHRASES = ['todd is always watching', 'buy high sell low', 'the house always wins', 'i love my job', 'polygons please',
  'stonks only go up', 'diamond hands', 'to the moon', 'marquez has the goods', 'pay me back'];
const TRIVIA = [
  ['Who runs the shop?', 'marquez', 'Marquez'],
  ["How many Polygons does a daily give? (just the number)", () => String(config.dailyAmount / 100)],
  ['How many shares of one company can a broker manage at most?', '25'],
  ['What happens to the market when the Polygon Reserve hits zero?', 'crash', 'A crash'],
  ["What's the fee on a gift, in percent? (just the number)", '5'],
  ['Which Rend-Sino game has you guess red or black, then higher or lower, then inside or outside, then the suit?', ['ridethebus', 'bus'], 'Ride the Bus']
];

function scramble(word, rand) {
  for (let i = 0; i < 10; i++) {
    const a = word.split('');
    for (let j = a.length - 1; j > 0; j--) { const k = Math.floor(rand() * (j + 1)); [a[j], a[k]] = [a[k], a[j]]; }
    if (a.join('') !== word) return a.join('');
  }
  return word.split('').reverse().join('');
}

// Makes a question: { q, answers: [normalized], shown }
function question(m, rand = Math.random) {
  const kinds = ['math', 'scramble', 'type', 'trivia'];
  if (m && m.companies && m.companies.length) kinds.push('ticker', 'top');
  const kind = pick(kinds, rand);
  if (kind === 'math') {
    const a = between(3, 12, rand), b = between(3, 12, rand), c = between(1, 50, rand);
    return { q: `Quick maths: **${a} × ${b} + ${c}**`, answers: [String(a * b + c)], shown: String(a * b + c) };
  }
  if (kind === 'scramble') {
    const w = pick(WORDS, rand);
    return { q: `Unscramble this: **${scramble(w, rand).toUpperCase()}**`, answers: [w], shown: w };
  }
  if (kind === 'type') {
    const p = pick(PHRASES, rand);
    return { q: `First one to type **${p}** wins.`, answers: [norm(p)], shown: p };
  }
  if (kind === 'ticker') {
    const c = pick(m.companies, rand);
    return { q: `What's the ticker for **${c.name}**?`, answers: [norm(c.id)], shown: c.id };
  }
  if (kind === 'top') {
    const top = [...m.companies].sort((x, y) => Number(m.prices[y.id]) - Number(m.prices[x.id]))[0];
    return { q: "Which main company's stock is the **most expensive** right now? (the ticker)", answers: [norm(top.id), norm(top.name)], shown: top.id };
  }
  const [q, ans, shown] = pick(TRIVIA, rand);
  const list = [].concat(typeof ans === 'function' ? ans() : ans).map(norm);
  return { q, answers: list, shown: shown || list[0] };
}

const off = (db, guildId) => db.meta(`dropins_off:${guildId}`) === '1';
// The one channel TODD drops into (set by a mod with r!dropin here). Empty = any channel.
const home = (db, guildId) => db.meta(`dropins_channel:${guildId}`) || '';
function setHome(db, guildId, channelId) { db.setMeta(`dropins_channel:${guildId}`, channelId || ''); }
function setOff(db, guildId, isOff) { db.setMeta(`dropins_off:${guildId}`, isOff ? '1' : '0'); }

// Starts a drop-in in a channel. send(payload) posts in it. Returns the drop-in, or null.
async function startDrop(deps, guildId, channelId, send, now = Date.now(), rand = Math.random) {
  if (active.has(channelId)) return null;
  const m = deps.market ? await deps.market.get().catch(() => null) : null;
  const q = question(m, rand);
  const pot = Math.round(between(RULES.drop.potMin / 100, RULES.drop.potMax / 100, rand) / 10) * 1000;
  const drop = { ...q, pot, guildId, endsAt: now + RULES.drop.answerMs };
  active.set(channelId, drop);
  lastDrop.set(guildId, now);
  await send({
    embeds: [{
      author: { name: 'TODD has entered the chat', icon_url: 'https://renderproductions.github.io/bot/avatar.png' },
      title: '🖥️ DROP-IN!',
      description: `${q.q}\n\nFirst right answer wins **${amt(pot)}**. You have ${RULES.drop.answerMs / 1000} seconds.`,
      color: 0x38e1ff
    }],
    allowedMentions: { parse: [] }
  });
  const t = setTimeout(() => {
    if (active.get(channelId) !== drop) return;
    active.delete(channelId);
    Promise.resolve(send({ content: `🖥️ Time's up. Nobody got it. The answer was **${drop.shown}**. TODD keeps the Polygons.`, allowedMentions: { parse: [] } }))
      .catch((e) => console.error('[dropin]', e.message));
  }, RULES.drop.answerMs);
  if (t.unref) t.unref();
  return drop;
}

// Checks a message against a drop-in in its channel. Returns the reply for a winner, or null.
function answer(ctx, text) {
  const drop = active.get(ctx.channelId);
  if (!drop || !drop.answers.includes(norm(text))) return null;
  active.delete(ctx.channelId);
  ctx.db.player(ctx.guildId, ctx.user);
  const got = reserve.pay(ctx.db, drop.pot);
  ctx.db.addCash(ctx.guildId, ctx.user.id, got);
  A.award(ctx, 'quick_draw');
  A.bump(ctx, 'dropins_won');
  return A.attach(ctx, { content: `🎉 **${ctx.user.username}** got it! The answer was **${drop.shown}**. **+${amt(got)}**${reserve.note(ctx.db)}` });
}

// Any message (chat or a command) might bring TODD in, if this is a channel he's allowed in
async function maybeDrop(message, deps, now = Date.now(), rand = Math.random) {
  const h = home(deps.db, message.guildId);
  if (off(deps.db, message.guildId) || (h && h !== message.channelId)) return null;
  if (now - (lastDrop.get(message.guildId) || 0) < RULES.drop.gapMs || rand() >= RULES.drop.chance) return null;
  return startDrop(deps, message.guildId, message.channelId, (p) => message.channel.send(p), now, rand).catch((e) => { console.error('[dropin]', e.message); return null; });
}

// Called for every ordinary (non-command) message. Pays chat pay, and maybe starts a drop-in.
async function onMessage(message, deps, ctx, now = Date.now(), rand = Math.random) {
  const won = answer(ctx, message.content);
  if (won) return won;
  const got = chatPay(deps.db, message.guildId, message.author, message.content, now, rand);
  if (got) {
    const total = A.bump(ctx, 'chat_pay', got);
    if (total >= 2500_00) A.award(ctx, 'chatterbox');
  }
  await maybeDrop(message, deps, now, rand);
  // Achievements earned by chatting get announced quietly in a reply
  if (ctx.notes.length) return A.attach(ctx, null);
  return null;
}

module.exports = { RULES, chatPay, chatToday, question, startDrop, answer, onMessage, maybeDrop, off, setOff, home, setHome, active, lastDrop, lastPaid, norm };
