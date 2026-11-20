// Heists: a crew of 3 to 5 robs a company vault, TODD's stash, or the Polygon Reserve. Someone plans it in
// a channel; others join with a role (buttons). When the leader starts it, everyone pays a stake into the
// Reserve, then it plays out. Roles change the odds:
//   💻 Hacker  better odds, and the Reserve can't be cracked without one
//   🚗 Driver  if it goes wrong, the crew may still get away (no fine)
//   👀 Lookout better odds
//   💪 Muscle  a bit better odds, and a bigger haul
// Success: the haul is split evenly. Failure: stakes are lost, and if TODD catches the crew, a fine too.
// Hauls come out of the Polygon Reserve, so robbing it really does hurt everyone.
import { addMoment, compact } from '../core/moments';
import { LOOT, UG, dropLoot, useCharge } from '../underground/underground';
import { award } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';
import { HOUR, MINUTE } from '../core/time';
import { heistBonus } from '../events/world';
import { robTrain, trainsOf } from '../estate/estate';
import { addInbox } from '../social/inbox';

export const ROLES = {
  hacker: { emoji: '💻', label: 'Hacker', odds: 0.10, haul: 0 },
  driver: { emoji: '🚗', label: 'Driver', odds: 0.03, haul: 0 },
  lookout: { emoji: '👀', label: 'Lookout', odds: 0.08, haul: 0 },
  muscle: { emoji: '💪', label: 'Muscle', odds: 0.05, haul: 0.2 }
} as const;
export type Role = keyof typeof ROLES;
export const TARGETS = {
  vault: { label: 'a company vault', emoji: '🏦', odds: 0.45, stake: polygons(250), haul: [polygons(3000), polygons(6000)], needs: null, minLevel: 0 },
  stash: { label: "TODD's stash", emoji: '🖥️', odds: 0.40, stake: polygons(400), haul: [polygons(4000), polygons(9000)], needs: null, minLevel: 0 },
  reserve: { label: 'the Polygon Reserve', emoji: '🔶', odds: 0.25, stake: polygons(750), haul: [polygons(15_000), polygons(30_000)], needs: 'hacker', minLevel: 0.3 },
  // Oh My God, 2 in 1!: a freight train on the rails (takes up to half of what it carries)
  train: { label: 'a freight train', emoji: '🚂', odds: 0.5, stake: polygons(300), haul: [polygons(2000), polygons(8000)], needs: null, minLevel: 0 }
} as const;
export type Target = keyof typeof TARGETS;
export const HEIST = { minCrew: 3, maxCrew: 5, lobbyMs: 5 * MINUTE, serverGapMs: HOUR, playerGapMs: 6 * HOUR, caughtMs: 12 * HOUR, fine: 2, getaway: 0.5, noHacker: 0.2 };

export interface Member { id: string; name: string; role: Role }

export const playerCooldown = (db: Db, g: string, u: string, now = Date.now()): number => { const t = Number(db.meta(`heist.cd:${g}:${u}`) ?? 0); return t > now ? t : 0; };
export const serverReady = (db: Db, g: string, now = Date.now()): number => { const t = Number(db.meta(`heist.at:${g}`) ?? 0) + HEIST.serverGapMs; return t > now ? t : 0; };

export function heistOdds(target: Target, crew: Member[], bonus = 0): number {
  const T = TARGETS[target];
  let p = T.odds + bonus + Math.max(0, crew.length - HEIST.minCrew) * 0.03;
  const seen = new Set<Role>();
  for (const m of crew) { p += seen.has(m.role) ? ROLES[m.role].odds / 2 : ROLES[m.role].odds; seen.add(m.role); }
  if (T.needs && !seen.has(T.needs)) p -= HEIST.noHacker;
  return Math.max(0.05, Math.min(0.9, p));
}

export interface HeistResult { outcome: 'clean' | 'escaped' | 'caught' | 'short'; haul: Cents; each: Cents; crew: Member[]; dropped: Member[]; odds: number; picked?: boolean; loot?: { name: string; who: string; emoji: string; value: Cents }[] }

/** Plays a heist out: stakes, the roll, the haul or the fines. Members who can't pay the stake are left behind. */
export function runHeist(db: Db, g: string, target: Target, members: Member[], rng: Rng, now = Date.now()): HeistResult {
  const T = TARGETS[target];
  const crew: Member[] = [], dropped: Member[] = [];
  for (const m of members) (balance(db, wallet(g, m.id)) >= T.stake ? crew : dropped).push(m);
  if (crew.length < HEIST.minCrew) return { outcome: 'short', haul: 0, each: 0, crew, dropped, odds: 0 };
  let odds = heistOdds(target, crew, heistBonus(db, now));
  return db.tx(() => {
    // No Questions Asked: a Lockpick Set in the crew (everyone who has one uses it up)
    let picked = false;
    for (const m of crew) if (useCharge(db, g, m.id, 'lockpick')) picked = true;
    if (picked) odds = Math.min(0.9, odds + UG.lockpickOdds);
    const loot: NonNullable<HeistResult['loot']> = [];
    for (const m of crew) transfer(db, { from: wallet(g, m.id), to: RESERVE, cents: T.stake, reason: 'heist.stake', guildId: g, actorId: m.id, now });
    db.setMeta(`heist.at:${g}`, now);
    let outcome: HeistResult['outcome'], haul = 0, each = 0;
    if (rng.next() < odds) {
      outcome = 'clean';
      const muscle = crew.some((m) => m.role === 'muscle') ? 1 + ROLES.muscle.haul : 1;
      const want = Math.round((T.haul[0] + rng.next() * (T.haul[1] - T.haul[0])) * muscle);
      // Robbing the Reserve takes straight from it (no shrinking); a train gives up what's on it; anything else is a normal payout
      if (target === 'train') {
        const ids = new Set(crew.map((m) => m.id));
        const trains = trainsOf(db, g, now).sort((a, b) => (b.cents - b.robbed) - (a.cents - a.robbed));
        const f = trains.find((x) => !ids.has(x.user_id)) ?? trains[0];
        haul = f ? robTrain(db, f, want) : 0;
        if (f && haul > 0) addInbox(db, f.user_id, g, 'Train robbery!', `🤠 **Your freight train was robbed!** A crew got away with ${format(haul)} of what it carried. The rest still arrives on time.`, now);
      } else haul = target === 'reserve' ? Math.min(want, balance(db, RESERVE)) : Math.floor(want * Math.min(1, balance(db, RESERVE) / want));
      each = Math.floor(haul / crew.length);
      for (const m of crew) {
        if (target === 'reserve') { if (each > 0) transfer(db, { from: RESERVE, to: wallet(g, m.id), cents: each, reason: 'heist.haul', guildId: g, actorId: m.id, now }); }
        else payFromReserve(db, economy.reserveStart, { to: wallet(g, m.id), cents: each, reason: 'heist.haul', guildId: g, actorId: m.id, now });
        award(db, g, m.id, 'crew_up', now);
        const hot = dropLoot(db, g, m.id, now, () => rng.next());
        if (hot) loot.push({ name: LOOT[hot.kind].name, who: m.name, emoji: LOOT[hot.kind].emoji, value: hot.value });
        if (target === 'reserve') award(db, g, m.id, 'inside_job', now);
        if (target === 'train') award(db, g, m.id, 'great_train_robbery', now);
        if (crew.length === HEIST.maxCrew && (Object.keys(ROLES) as Role[]).every((r) => crew.some((x) => x.role === r))) award(db, g, m.id, 'dream_team', now);
      }
    } else if (crew.some((m) => m.role === 'driver') && rng.chance(HEIST.getaway)) {
      outcome = 'escaped';
    } else {
      outcome = 'caught';
      for (const m of crew) {
        const fine = Math.min(balance(db, wallet(g, m.id)), T.stake * HEIST.fine);
        if (fine > 0) transfer(db, { from: wallet(g, m.id), to: RESERVE, cents: fine, reason: 'heist.fine', guildId: g, actorId: m.id, now });
        award(db, g, m.id, 'red_handed', now);
      }
    }
    for (const m of crew) db.setMeta(`heist.cd:${g}:${m.id}`, now + (outcome === 'caught' ? HEIST.caughtMs : HEIST.playerGapMs));
    addMoment(outcome === 'clean' ? `🦹 A heist on ${T.label} just got away with ${compact(haul)}` : outcome === 'caught' ? '🚔 A heist crew just got caught red-handed' : '🚗 A heist crew just made a clean getaway (with nothing)', now);
    db.run('INSERT INTO heist_log (guild_id, target, crew, outcome, haul, at) VALUES (?, ?, ?, ?, ?, ?)', g, target, JSON.stringify(crew.map((m) => [m.id, m.role, m.name])), outcome, haul, now);
    return { outcome, haul, each, crew, dropped, odds, picked, loot };
  });
}

export const recentHeists = (db: Db, g: string, n = 5) => db.all<{ target: string; outcome: string; haul: number; at: number; crew: string }>('SELECT * FROM heist_log WHERE guild_id = ? ORDER BY at DESC LIMIT ?', g, n);
