// Heists (Heists & Schemes): a crew of 3 to 5 robs a company vault, TODD's stash, or the Polygon Reserve.
// Someone plans it in a channel; others join with a role. When the leader starts it, everyone pays a stake
// (gear, bribes) into the reserve, then it plays out. Roles change the odds:
//   💻 Hacker   better odds, and the Polygon Reserve can't be cracked without one
//   🚗 Driver   if it goes wrong, the crew might still get away (no fine)
//   👀 Lookout  better odds
//   💪 Muscle   a bit better odds, and a bigger haul
// Success: the haul is split evenly. Failure: stakes are lost, and if TODD catches the crew, a fine too.
// Hauls come out of the Polygon Reserve, so robbing it really does hurt everyone.
const reserve = require('./reserve');

const ROLES = {
  hacker:  { emoji: '💻', label: 'Hacker',  odds: 0.10 },
  driver:  { emoji: '🚗', label: 'Driver',  odds: 0.03 },
  lookout: { emoji: '👀', label: 'Lookout', odds: 0.08 },
  muscle:  { emoji: '💪', label: 'Muscle',  odds: 0.05, haul: 0.2 }
};
const TARGETS = {
  vault:   { label: 'a company vault', emoji: '🏦', odds: 0.45, stake: 250_00, haul: [3000_00, 6000_00] },
  stash:   { label: "TODD's stash",    emoji: '🖥️', odds: 0.40, stake: 400_00, haul: [4000_00, 9000_00] },
  reserve: { label: 'the Polygon Reserve', emoji: '🔶', odds: 0.25, stake: 750_00, haul: [15000_00, 30000_00], needs: 'hacker', minLevel: 0.3 }
};
const RULES = {
  minCrew: 3, maxCrew: 5,
  lobbyMs: 5 * 60 * 1000,
  serverGapMs: 60 * 60 * 1000,        // one heist per server per hour
  playerGapMs: 6 * 60 * 60 * 1000,    // per player, after any heist
  caughtMs: 12 * 60 * 60 * 1000,      // per player, after getting caught
  fine: 2,                            // times the stake, when caught
  getaway: 0.5,                       // chance a driver gets a failed crew away clean
  noHacker: 0.2                       // odds lost hitting the reserve without a hacker
};

const lobbies = new Map(); // channelId -> lobby

const playerKey = (g, u) => `heist_cd:${g}:${u}`;
const serverKey = (g) => `heist_at:${g}`;
const cooldown = (db, g, u, now = Date.now()) => { const t = Number(db.meta(playerKey(g, u))) || 0; return t > now ? t : 0; };
const serverReady = (db, g, now = Date.now()) => { const t = (Number(db.meta(serverKey(g))) || 0) + RULES.serverGapMs; return t > now ? t : 0; };

// The odds a crew pulls it off
function odds(target, crew, bonus = 0) {
  const T = TARGETS[target];
  let p = T.odds + bonus + Math.max(0, crew.length - RULES.minCrew) * 0.03;
  const seen = {};
  for (const m of crew) { const r = ROLES[m.role]; p += seen[m.role] ? r.odds / 2 : r.odds; seen[m.role] = true; }
  if (T.needs && !seen[T.needs]) p -= RULES.noHacker;
  return Math.max(0.05, Math.min(0.9, p));
}

// Plays a heist out. Charges stakes, rolls, pays or fines. crew: [{ id, name, role }]
// Returns { outcome: 'clean'|'escaped'|'caught', haul, each, dropped, crew, odds }
function run(db, guildId, lobby, random = Math.random, now = Date.now()) {
  const T = TARGETS[lobby.target];
  // Stakes: anyone who can't pay is left behind
  const crew = [], dropped = [];
  for (const m of lobby.crew) {
    const p = db.player(guildId, { id: m.id, username: m.name });
    if (p.cash >= T.stake && !(p.debt > 0)) crew.push(m); else dropped.push(m);
  }
  if (crew.length < RULES.minCrew) return { outcome: 'short', crew, dropped };
  const chance = odds(lobby.target, crew, require('./worldEvents').heistBonus(db));
  const roll = random();
  return db.tx(() => {
    for (const m of crew) { db.addCash(guildId, m.id, -T.stake); reserve.take(db, T.stake); }
    db.setMeta(serverKey(guildId), String(now));
    let outcome, haul = 0, each = 0;
    if (roll < chance) {
      outcome = 'clean';
      const muscle = crew.some((m) => m.role === 'muscle') ? 1 + ROLES.muscle.haul : 1;
      const want = Math.round((T.haul[0] + random() * (T.haul[1] - T.haul[0])) * muscle);
      // The reserve itself: taken straight out (it doesn't shrink). Anything else is a payout like any other.
      haul = lobby.target === 'reserve' ? Math.min(want, Math.max(0, reserve.get(db))) : reserve.pay(db, want);
      if (lobby.target === 'reserve') reserve.spend(db, haul);
      each = Math.floor(haul / crew.length);
      for (const m of crew) db.addCash(guildId, m.id, each);
    } else if (crew.some((m) => m.role === 'driver') && random() < RULES.getaway) {
      outcome = 'escaped';
    } else {
      outcome = 'caught';
      for (const m of crew) {
        const p = db.player(guildId, { id: m.id });
        const fine = Math.min(p.cash, T.stake * RULES.fine);
        db.addCash(guildId, m.id, -fine);
        reserve.take(db, fine);
      }
    }
    for (const m of crew) db.setMeta(playerKey(guildId, m.id), String(now + (outcome === 'caught' ? RULES.caughtMs : RULES.playerGapMs)));
    db.raw.prepare('INSERT INTO heist_log (guild_id, target, crew, outcome, haul, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(guildId, lobby.target + (lobby.ticker ? `:${lobby.ticker}` : ''), JSON.stringify(crew.map((m) => [m.id, m.role, m.name])), outcome, haul, now);
    return { outcome, haul, each, crew, dropped, odds: chance };
  });
}

const recent = (db, guildId, n = 5) => db.raw.prepare('SELECT * FROM heist_log WHERE guild_id = ? ORDER BY at DESC LIMIT ?').all(guildId, n);

module.exports = { ROLES, TARGETS, RULES, lobbies, odds, run, cooldown, serverReady, recent };
