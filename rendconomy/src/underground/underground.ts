// No Questions Asked: the Underground. The Connector (a red suit, a wide red hat, one red eye and one blue)
// squats in one of the server's condemned lots every night from 10 PM to 4 AM Eastern, or in the most run-down
// place on the map if nothing's condemned (its owner loses half that day's rent). Some nights there's a password,
// which he leaves by hijacking one of TODD's drop-ins.
//
// Everything shady adds Heat (0–100, shown as five stars). Heat cools by 10 a day, but every piece of hot loot
// you hold adds 5. Each shady action can bring a TODD raid, likelier the hotter you are: contraband and hot loot
// confiscated, a fine to the Reserve, Heat back to two stars. Hit 100 and you're locked out for two nights.
import { award } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { addMoment } from '../core/moments';
import { polygons, type Cents } from '../core/money';
import { DAY, HOUR, dayKey, easternAt, easternHour, nextDay, previousDay } from '../core/time';
import { lotsOf, type Lot } from '../estate/estate';
import { roll } from '../farming/farming';

export const UG = {
  opens: 22, closes: 4,                 // Eastern hours
  passwordChance: 1 / 3,
  heatPerDay: -10, heatPerLootDay: 5,
  raidFine: 0.1, raidFineMax: polygons(5_000), raidHeat: 40,
  lockoutNights: 2,
  lootChance: 0.35,
  fenceFresh: 0.5, fenceCool: 0.9, coolDays: 3, fenceHeat: 5, launderHeat: 3, launderMs: DAY,
  smuggleMin: polygons(500), smuggleMax: polygons(10_000), smuggleMs: 2 * HOUR, smuggleHeat: 10, smuggleCaughtHeat: 20,
  snitchCost: polygons(250), snitchReward: polygons(500), snitchShare: 0.1, snitchMiss: 30, snitchStars: 3,
  diceGames: 5, diceCatch: 0.1, diceSave: 0.3, lockpickOdds: 0.15, rumor: 0.03,
  crewBelow: 75, crewCooldown: 3 * DAY,
  cleanHands: polygons(50_000)
};

export type ContrabandId = 'loaded_dice' | 'fake_id' | 'lockpick' | 'insider_tip' | 'rumor_mill' | 'smoke_bomb' | 'squatter_crew';
export interface Contraband { id: ContrabandId; name: string; price: Cents; heat: number; desc: string; usage: string }
const cb = (id: ContrabandId, name: string, price: number, heat: number, desc: string, usage = ''): Contraband => ({ id, name, price: polygons(price), heat, desc, usage });
export const CONTRABAND: Record<ContrabandId, Contraband> = {
  loaded_dice: cb('loaded_dice', 'Loaded Dice', 1_500, 15, 'Better odds for your next 5 casino games. TODD might spot them.'),
  fake_id: cb('fake_id', 'Fake ID', 2_000, 10, 'Skip a casino ban (now, or the next time TODD throws you out).'),
  lockpick: cb('lockpick', 'Lockpick Set', 1_200, 10, '+15% success on your next heist.'),
  insider_tip: cb('insider_tip', 'Insider Tip', 2_500, 5, 'Where a stock is heading in the next hour. Usually right.', '[ticker]'),
  rumor_mill: cb('rumor_mill', 'Rumor Mill', 5_000, 20, 'Nudge a company\'s price 3% up or down. Once per company a day here.', '<ticker> <up|down>'),
  smoke_bomb: cb('smoke_bomb', 'Smoke Bomb', 3_000, 10, 'Refuse your next buyout bid without paying the fee.'),
  squatter_crew: cb('squatter_crew', 'Squatter Crew', 4_000, 25, 'Squatters into someone else\'s place (under 75%). One a day.', '<lot>')
};
export const ALIASES: Record<string, ContrabandId> = {
  dice: 'loaded_dice', loaded: 'loaded_dice', loadeddice: 'loaded_dice', id: 'fake_id', fakeid: 'fake_id', fake: 'fake_id',
  lockpick: 'lockpick', lockpicks: 'lockpick', pick: 'lockpick', picks: 'lockpick', tip: 'insider_tip', insider: 'insider_tip', insidertip: 'insider_tip',
  rumor: 'rumor_mill', rumour: 'rumor_mill', rumormill: 'rumor_mill', smoke: 'smoke_bomb', bomb: 'smoke_bomb', smokebomb: 'smoke_bomb',
  crew: 'squatter_crew', squatters: 'squatter_crew', squattercrew: 'squatter_crew'
};

export type LootKind = 'ring' | 'art' | 'gem' | 'crate';
export const LOOT: Record<LootKind, { name: string; emoji: string; value: [number, number] }> = {
  ring: { name: 'a stolen ring', emoji: 'hot_ring', value: [800, 800] },
  art: { name: 'a stolen painting', emoji: 'hot_art', value: [1_500, 1_500] },
  gem: { name: 'a stolen gem', emoji: 'hot_gem', value: [3_000, 3_000] },
  crate: { name: 'a crate of something', emoji: 'hot_crate', value: [500, 4_000] }
};

export const PASSWORDS = ['velvet', 'deadbolt', 'redeye', 'blueeye', 'sidedoor', 'cellar', 'crowbar', 'lowtide', 'stray', 'lamplight', 'hushhush', 'ashcan',
  'blackcat', 'tincan', 'nightjar', 'backroom', 'redhat', 'gutterball', 'quietcoin', 'smokestack', 'bricklayer', 'coldcase', 'redsuit', 'neonrat'];

// ---------------------------------------------------------------- the night
/** The night this instant belongs to (the date it started on), or null between 4 AM and 10 PM. */
export function nightKey(now: number): string | null {
  const h = easternHour(now);
  if (h >= UG.opens) return dayKey(now);
  if (h < UG.closes) return previousDay(dayKey(now));
  return null;
}
export const nightOpens = (night: string): number => easternAt(night, UG.opens);
export const nightCloses = (night: string): number => easternAt(nextDay(night), UG.closes);
/** When the Underground next opens (now, if it's open). */
export function nextOpen(now: number): number {
  const n = nightKey(now);
  if (n) return nightOpens(n);
  return nightOpens(dayKey(now));
}

const seedOf = (s: string): number => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
export const isPasswordNight = (guildId: string, night: string): boolean => roll(seedOf(`pw:${guildId}`), nightOpens(night)) < UG.passwordChance;
export const passwordFor = (guildId: string, night: string): string => PASSWORDS[Math.floor(roll(seedOf(`word:${guildId}`), nightOpens(night)) * PASSWORDS.length)]!;
/** Four of the seven pieces of contraband, different each night. */
export function stockFor(guildId: string, night: string): ContrabandId[] {
  const ids = Object.keys(CONTRABAND) as ContrabandId[];
  const scored = ids.map((id, i) => ({ id, r: roll(seedOf(`stock:${guildId}:${id}`), nightOpens(night) + i * 1000) }));
  return scored.sort((a, b) => a.r - b.r).slice(0, 4).map((x) => x.id).sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
}

export interface Night { night: string; lot: number; where: 'condemned' | 'rundown' | 'empty'; password: string | null; posted: boolean }
/** Tonight's details for a server, picked the first time anyone looks (the lot stays put all night). */
export function tonight(db: Db, guildId: string, now: number): Night | null {
  const night = nightKey(now);
  if (!night) return null;
  const saved = db.meta(`ug.night:${guildId}`);
  if (saved) { try { const n = JSON.parse(saved) as Night; if (n.night === night) return n; } catch { /* pick again */ } }
  const lots = lotsOf(db, guildId, now);
  const pick = <T>(list: T[], salt: string): T => list[Math.floor(roll(seedOf(`${salt}:${guildId}`), nightOpens(night)) * list.length)]!;
  const condemned = lots.filter((l) => l.status === 'auction');
  const owned = lots.filter((l) => l.status === 'owned');
  let lot: Lot, where: Night['where'];
  if (condemned.length) { lot = pick(condemned, 'lot'); where = 'condemned'; }
  else if (owned.length) {
    const worst = Math.min(...owned.map((l) => l.condition));
    lot = pick(owned.filter((l) => l.condition === worst), 'lot'); where = 'rundown';
    // the owner loses half that day's rent (estate.ts checks ug.hosts)
    const hosts = hostsOf(db, guildId).filter((h) => h.until > now - 7 * DAY);
    hosts.push({ lot: lot.lot, from: nightOpens(night), until: nightCloses(night) });
    db.setMeta(`ug.hosts:${guildId}`, JSON.stringify(hosts));
  } else { lot = pick(lots.filter((l) => l.status === 'bank'), 'lot'); where = 'empty'; }
  const n: Night = { night, lot: lot.lot, where, password: isPasswordNight(guildId, night) ? passwordFor(guildId, night) : null, posted: false };
  db.setMeta(`ug.night:${guildId}`, JSON.stringify(n));
  return n;
}
export function hostsOf(db: Db, guildId: string): { lot: number; from: number; until: number }[] {
  try { return JSON.parse(db.meta(`ug.hosts:${guildId}`) ?? '[]'); } catch { return []; }
}
/** For a password night: the Connector's message has gone out. */
export function markPosted(db: Db, guildId: string, n: Night): void {
  db.setMeta(`ug.night:${guildId}`, JSON.stringify({ ...n, posted: true }));
}
/** Is there a password tonight that hasn't been posted yet? (From 8 PM, so it goes out before he opens.) */
export function passwordToPost(db: Db, guildId: string, now: number): Night | null {
  const h = easternHour(now);
  const early = h >= 20 && h < UG.opens;
  const at = early ? nightOpens(dayKey(now)) + 1 : now;   // before 10 PM, look ahead to tonight
  const n = tonight(db, guildId, at);
  return n && n.password && !n.posted ? n : null;
}

// ---------------------------------------------------------------- players and Heat
export interface Row {
  guild_id: string; user_id: string; heat: number; heat_at: number; locked_until: number; entered: string | null;
  dice: number; fake_id: number; lockpick: number; smoke: number; raids: number; fenced: number; runs_ok: number; spent: number;
  crew_day: string | null; snitch_day: string | null; smuggle_stake: number; smuggle_until: number | null; smuggle_mult: number | null; smuggle_night: string | null;
}
export interface Loot { id: number; guild_id: string; user_id: string; kind: LootKind; value: number; got_at: number; launder_until: number | null; launder_lot: number | null }

export function row(db: Db, g: string, u: string, now: number): Row {
  db.run('INSERT OR IGNORE INTO underground (guild_id, user_id, heat_at) VALUES (?, ?, ?)', g, u, now);
  return db.get<Row>('SELECT * FROM underground WHERE guild_id = ? AND user_id = ?', g, u)!;
}
export const lootOf = (db: Db, g: string, u: string): Loot[] => db.all<Loot>('SELECT * FROM hot_loot WHERE guild_id = ? AND user_id = ? ORDER BY id', g, u);
export const stars = (heat: number): number => Math.min(5, Math.ceil(Math.max(0, heat) / 20));
/** The chance a shady action brings a raid, by stars: 0, 2%, 8%, 18%, 32%, 50%. */
export const raidChance = (heat: number): number => 2 * stars(heat) ** 2 / 100;

/** Brings Heat up to date: cools 10 a day, plus 5 a day for each piece of hot loot held (not being laundered). */
export function heatNow(db: Db, g: string, u: string, now: number): number {
  const r = row(db, g, u, now);
  const days = Math.floor((now - r.heat_at) / DAY);
  if (days <= 0) return r.heat;
  const held = db.get<{ n: number }>('SELECT COUNT(*) AS n FROM hot_loot WHERE guild_id = ? AND user_id = ? AND launder_until IS NULL', g, u)!.n;
  const heat = Math.max(0, Math.min(100, r.heat + days * (UG.heatPerDay + UG.heatPerLootDay * held)));
  db.run('UPDATE underground SET heat = ?, heat_at = ? WHERE guild_id = ? AND user_id = ?', heat, r.heat_at + days * DAY, g, u);
  return heat;
}
/** Adds Heat; at 100 you're locked out for two nights. Returns lines for the reply. */
export function addHeat(db: Db, g: string, u: string, amount: number, now: number): string[] {
  const before = heatNow(db, g, u, now);
  const heat = Math.max(0, Math.min(100, before + amount));
  db.run('UPDATE underground SET heat = ? WHERE guild_id = ? AND user_id = ?', heat, g, u);
  const out: string[] = [];
  if (stars(heat) >= 5) award(db, g, u, 'most_wanted', now);
  if (heat >= 100 && before < 100) {
    // tonight (or the night that's on) counts as the first of the two
    let n = nightKey(now) ?? dayKey(now);
    for (let i = 1; i < UG.lockoutNights; i++) n = nextDay(n);
    const until = nightCloses(n);
    db.run('UPDATE underground SET locked_until = ? WHERE guild_id = ? AND user_id = ?', until, g, u);
    out.push('**You\'re too hot.** The Connector won\'t deal with you for two nights.');
  }
  return out;
}

export interface Raid { fine: Cents; lost: string[] }
/** TODD raids a player: contraband and hot loot confiscated, a fine, Heat back down to two stars. */
export function raid(db: Db, g: string, u: string, now: number): Raid {
  const r = row(db, g, u, now);
  const lost: string[] = [];
  if (r.dice) lost.push('Loaded Dice'); if (r.fake_id) lost.push('Fake ID'); if (r.lockpick) lost.push('Lockpick Set'); if (r.smoke) lost.push('Smoke Bomb');
  for (const l of lootOf(db, g, u)) lost.push(LOOT[l.kind].name.replace(/^an? /, ''));
  db.run('DELETE FROM hot_loot WHERE guild_id = ? AND user_id = ?', g, u);
  const w = wallet(g, u);
  const fine = Math.min(Math.floor(balance(db, w) * UG.raidFine), UG.raidFineMax);
  if (fine > 0) transfer(db, { from: w, to: RESERVE, cents: fine, reason: 'ug.fine', guildId: g, actorId: u, now });
  db.run('UPDATE underground SET dice = 0, fake_id = 0, lockpick = 0, smoke = 0, heat = ?, raids = raids + 1 WHERE guild_id = ? AND user_id = ?', UG.raidHeat, g, u);
  award(db, g, u, 'busted', now);
  addMoment('🚔 TODD just busted someone', now);
  return { fine, lost };
}
/** After a shady action: maybe a raid. */
export function maybeRaid(db: Db, g: string, u: string, now: number, rand: () => number): Raid | null {
  return rand() < raidChance(heatNow(db, g, u, now)) ? raid(db, g, u, now) : null;
}

/** Uses one charge of a piece of contraband (for the casino, heists and property). */
export function useCharge(db: Db, g: string, u: string, what: 'dice' | 'fake_id' | 'lockpick' | 'smoke'): boolean {
  const r = db.get<Record<string, number>>(`SELECT ${what} AS n FROM underground WHERE guild_id = ? AND user_id = ?`, g, u);
  if (!r || !r.n) return false;
  db.run(`UPDATE underground SET ${what} = ${what} - 1 WHERE guild_id = ? AND user_id = ?`, g, u);
  return true;
}
export const charges = (db: Db, g: string, u: string, what: 'dice' | 'fake_id' | 'lockpick' | 'smoke'): number =>
  db.get<Record<string, number>>(`SELECT ${what} AS n FROM underground WHERE guild_id = ? AND user_id = ?`, g, u)?.n ?? 0;

/** A heist went clean: maybe a piece of hot loot. */
export function dropLoot(db: Db, g: string, u: string, now: number, rand: () => number): Loot | null {
  if (rand() >= UG.lootChance) return null;
  const kinds = Object.keys(LOOT) as LootKind[];
  const kind = kinds[Math.floor(rand() * kinds.length)]!;
  const [lo, hi] = LOOT[kind].value;
  const value = polygons(Math.round((lo + rand() * (hi - lo)) / 50) * 50);
  db.run('INSERT INTO hot_loot (guild_id, user_id, kind, value, got_at) VALUES (?, ?, ?, ?, ?)', g, u, kind, value, now);
  row(db, g, u, now);
  return db.get<Loot>('SELECT * FROM hot_loot WHERE id = last_insert_rowid()')!;
}
/** What the Connector pays for a piece: 50% fresh, rising to 90% after three days. */
export const fencePrice = (l: Loot, now: number): Cents => Math.floor(l.value * (UG.fenceFresh + (UG.fenceCool - UG.fenceFresh) * Math.min(1, (now - l.got_at) / (UG.coolDays * DAY))));

export type Settled = { kind: 'laundered'; cents: Cents; what: string } | { kind: 'smuggled'; cents: Cents; mult: number } | { kind: 'caught'; stake: Cents };
/** Finishes laundering and smuggling runs that are done. */
export function settlePlayer(db: Db, g: string, u: string, now: number): Settled[] {
  const out: Settled[] = [];
  for (const l of db.all<Loot>('SELECT * FROM hot_loot WHERE guild_id = ? AND user_id = ? AND launder_until IS NOT NULL AND launder_until <= ?', g, u, now)) {
    const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents: l.value, reason: 'ug.launder', guildId: g, actorId: u, now });
    db.run('DELETE FROM hot_loot WHERE id = ?', l.id);
    out.push({ kind: 'laundered', cents: paid, what: LOOT[l.kind].name });
  }
  const r = row(db, g, u, now);
  if (r.smuggle_until && r.smuggle_until <= now && r.smuggle_stake > 0) {
    const mult = r.smuggle_mult ?? 0;
    db.run('UPDATE underground SET smuggle_stake = 0, smuggle_until = NULL, smuggle_mult = NULL WHERE guild_id = ? AND user_id = ?', g, u);
    if (mult > 0) {
      const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents: Math.floor(r.smuggle_stake * mult), reason: 'ug.smuggle', guildId: g, actorId: u, now });
      db.run('UPDATE underground SET runs_ok = runs_ok + 1 WHERE guild_id = ? AND user_id = ?', g, u);
      if (r.runs_ok + 1 >= 10) award(db, g, u, 'smugglers_run', now);
      out.push({ kind: 'smuggled', cents: paid, mult });
    } else {
      addHeat(db, g, u, UG.smuggleCaughtHeat, now);
      out.push({ kind: 'caught', stake: r.smuggle_stake });
    }
  }
  return out;
}

/** Erasing a player clears their Underground record. */
export function releasePlayer(db: Db, g: string, u: string): void {
  db.run('DELETE FROM underground WHERE guild_id = ? AND user_id = ?', g, u);
  db.run('DELETE FROM hot_loot WHERE guild_id = ? AND user_id = ?', g, u);
}
