// Birthdays, switched on and off by the date alone (Eastern time), like Polygon Holidays.
//  - RendConomy Big Birthday Blowout!: November 9 to 15, every year. The bot came to The Render Room on
//    November 9, 2026. Everything below, plus a numbered candle, the time capsule and r!yearbook.
//  - Render Vision's Big Birthday!: August 17 to 19, every year (the developer's birthday, the 18th). The same
//    party without the bot's own birthday things.
// Both have a Birthday Bash day (chat pay x1.5 and a birthday bonus on dailies), a Party shelf at Marquez's,
// cake on the Slots reels, a jackpot top-up, Chuck's Party Fish, and a cake every server fills together.
import { museumCake } from '../museum/museum';
import { economy } from '../config';
import { award, has } from '../achievements/achievements';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { wallet } from '../core/ledger';
import { addMoment } from '../core/moments';
import { format, polygons, type Cents } from '../core/money';
import { currentRequest } from '../core/request';
import { DAY, dayKey } from '../core/time';
import { addInbox } from '../social/inbox';
import { jackpotOf } from '../casino/core';

export type PartyKind = 'bot' | 'dev';
export const BIRTHDAY = {
  bot: { month: 11, from: 9, to: 15, bash: 9, name: 'RendConomy Big Birthday Blowout!', short: 'Birthday Week', emoji: '🎂' },
  dev: { month: 8, from: 17, to: 19, bash: 18, name: 'Render Vision\'s Big Birthday!', short: 'Render Vision\'s Birthday', emoji: '🎈' },
  /** The bot's first day in The Render Room. */
  born: 2026,
  bashChat: 1.5,
  bashDaily: polygons(250),
  /** The server's cake: this many shifts, gigs, catches and harvests, plus more per active player. */
  cake: { bot: { base: 60, perPlayer: 15 }, dev: { base: 30, perPlayer: 8 } } as Record<PartyKind, { base: number; perPlayer: number }>,
  cakeReward: { bot: polygons(1000), dev: polygons(500) } as Record<PartyKind, Cents>,
  jackpotTopUp: { bot: polygons(10_000), dev: polygons(5000) } as Record<PartyKind, Cents>,
  partyFishChance: 0.05,
  capsuleMax: 140,
  /** A cake slice: a little gift from the Reserve when you eat it. */
  slice: [20, 250] as [number, number]
};

export interface Party { kind: PartyKind; year: number; day: number; key: string; name: string; short: string; emoji: string; bash: boolean; age: number; from: number; to: number; month: number }

// The owner's console can start a party early to try it out ("birthday bot" / "birthday dev" / "birthday off").
let forced: PartyKind | null = null;
export const forceParty = (kind: PartyKind | null): void => { forced = kind; };
export const forcedParty = (): PartyKind | null => forced;

/** The birthday party going on right now, if any. */
export function partyOf(now = Date.now()): Party | null {
  const k = dayKey(now), year = Number(k.slice(0, 4)), month = Number(k.slice(5, 7)), day = Number(k.slice(8, 10));
  for (const kind of ['bot', 'dev'] as PartyKind[]) {
    const B = BIRTHDAY[kind];
    // the first parties are in 2027 (RendConomy arrived on November 9, 2026)
    const on = forced === kind || (year > BIRTHDAY.born && month === B.month && day >= B.from && day <= B.to);
    if (!on) continue;
    const d = month === B.month && day >= B.from && day <= B.to ? day : B.bash;
    return { kind, year, day: d - B.from + 1, key: `${kind}-${year}`, name: B.name, short: B.short, emoji: B.emoji, bash: d === B.bash, age: Math.max(1, year - BIRTHDAY.born), from: B.from, to: B.to, month: B.month };
  }
  return null;
}
export const isParty = (now = Date.now()): boolean => !!partyOf(now);
/** How many of RendConomy's birthdays have started by now (Candle No. 1 to this one exist). */
export function birthdaysSoFar(now = Date.now()): number {
  const k = dayKey(now), y = Number(k.slice(0, 4));
  const n = (k.slice(5) >= `${String(BIRTHDAY.bot.month).padStart(2, '0')}-${String(BIRTHDAY.bot.from).padStart(2, '0')}` ? y : y - 1) - BIRTHDAY.born;
  return Math.max(0, n, forced === 'bot' ? partyOf(now)!.age : 0);
}
/** Whether any birthday party has started yet (the Party Hat exists from the first one). */
export const partiesStarted = (now = Date.now()): boolean => dayKey(now) >= `${BIRTHDAY.born + 1}-08-17` || !!forced;
export const isBash = (now = Date.now()): boolean => !!partyOf(now)?.bash;
/** The bot's own birthday week (the candle, the time capsule and the yearbook). */
export const isBotBirthday = (now = Date.now()): boolean => partyOf(now)?.kind === 'bot';

/** When the next party starts (for "see you on..." lines). */
export function nextParty(now = Date.now()): { kind: PartyKind; at: string } {
  const k = dayKey(now), year = Number(k.slice(0, 4));
  const dates = (['bot', 'dev'] as PartyKind[]).flatMap((kind) => [year, year + 1, year + 2].filter((y) => y > BIRTHDAY.born).map((y) => ({ kind, d: `${y}-${String(BIRTHDAY[kind].month).padStart(2, '0')}-${String(BIRTHDAY[kind].from).padStart(2, '0')}` })))
    .filter((x) => x.d > k).sort((a, b) => a.d.localeCompare(b.d));
  const n = dates[0]!;
  const B = BIRTHDAY[n.kind];
  return { kind: n.kind, at: `${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][B.month]} ${B.from}` };
}

// ---------------------------------------------------------------- the cake (one per server per party)

const cakeTargetKey = (g: string, key: string) => `birthday.cake.target:${g}:${key}`;
const cakeDoneKey = (g: string, key: string) => `birthday.cake.done:${g}:${key}`;

/** How many pieces the server's cake needs: fixed when the first piece goes in. */
export function cakeTarget(db: Db, g: string, p: Party, now = Date.now()): number {
  const saved = db.meta(cakeTargetKey(g, p.key));
  if (saved) return Number(saved);
  const players = db.get<{ n: number }>('SELECT COUNT(DISTINCT user_id) AS n FROM activity WHERE guild_id = ? AND day > ?', g, dayKey(now - 7 * DAY))!.n;
  const C = BIRTHDAY.cake[p.kind];
  const t = Math.round((C.base + C.perPlayer * Math.max(1, players)) * museumCake(db, g, now));   // the museum's Birthday Wing: 20% fewer
  db.setMeta(cakeTargetKey(g, p.key), String(t));
  return t;
}
export function cakeOf(db: Db, g: string, p: Party, now = Date.now()): { have: number; target: number; done: boolean; helpers: number } {
  const r = db.get<{ have: number; helpers: number }>('SELECT COALESCE(SUM(pieces), 0) AS have, COUNT(*) AS helpers FROM birthday_cake WHERE guild_id = ? AND party = ?', g, p.key)!;
  return { have: r.have, helpers: r.helpers, target: cakeTarget(db, g, p, now), done: !!db.meta(cakeDoneKey(g, p.key)) };
}
export const myPieces = (db: Db, g: string, u: string, p: Party): number =>
  db.get<{ pieces: number }>('SELECT pieces FROM birthday_cake WHERE guild_id = ? AND party = ? AND user_id = ?', g, p.key, u)?.pieces ?? 0;

/**
 * Adds to the server's cake (a shift, a gig, a catch or a harvest during a party). When it fills, everyone who
 * helped gets the reward and Blow Out the Candles. Returns the line to show, if the cake just filled.
 */
export function addCake(db: Db, g: string, u: string, pieces: number, now = Date.now()): string {
  const p = partyOf(now);
  if (!p || pieces <= 0) return '';
  return db.tx(() => {
    const target = cakeTarget(db, g, p, now);
    if (db.meta(cakeDoneKey(g, p.key))) return '';
    db.run(`INSERT INTO birthday_cake (guild_id, party, user_id, pieces) VALUES (?, ?, ?, ?)
      ON CONFLICT (guild_id, party, user_id) DO UPDATE SET pieces = pieces + excluded.pieces`, g, p.key, u, pieces);
    const have = db.get<{ n: number }>('SELECT COALESCE(SUM(pieces), 0) AS n FROM birthday_cake WHERE guild_id = ? AND party = ?', g, p.key)!.n;
    if (have < target) return '';
    db.setMeta(cakeDoneKey(g, p.key), String(now));
    const helpers = db.all<{ user_id: string }>('SELECT user_id FROM birthday_cake WHERE guild_id = ? AND party = ?', g, p.key).map((r) => r.user_id);
    let mine = 0;
    for (const h of helpers) {
      const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, h), cents: BIRTHDAY.cakeReward[p.kind], reason: 'birthday.cake', guildId: g, actorId: h, now });
      if (h === u) mine = paid;
      award(db, g, h, 'blow_out_the_candles', now);
      if (h !== u) addInbox(db, h, g, '🎂 The cake is done!', `Your server finished its birthday cake (${p.name}). Thanks for helping: ${format(paid)}.`, now);
    }
    addMoment(`🎂 A server just blew out its birthday candles`, now);
    return `🎂 **That's the last piece. The cake is done!** Everyone who helped (${helpers.length}) gets **${format(mine || BIRTHDAY.cakeReward[p.kind])}**. Make a wish!`;
  });
}

/** For the live feed (the site's confetti and the birthday page): the party, and every server's cake. */
export function birthdaySnapshot(db: Db, now = Date.now()): { kind: PartyKind; name: string; age: number; bash: boolean; day: number; to: number; month: number; cakes: Record<string, { have: number; target: number; done: boolean; helpers: number }> } | null {
  const p = partyOf(now);
  if (!p) return null;
  return { kind: p.kind, name: p.name, age: p.age, bash: p.bash, day: p.day, to: p.to, month: p.month, cakes: cakeSnapshot(db, now) ?? {} };
}

/** For the live feed: the cake in every server that's working on one. */
export function cakeSnapshot(db: Db, now = Date.now()): Record<string, { have: number; target: number; done: boolean; helpers: number }> | null {
  const p = partyOf(now);
  if (!p) return null;
  const out: Record<string, { have: number; target: number; done: boolean; helpers: number }> = {};
  for (const r of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM birthday_cake WHERE party = ?', p.key)) out[r.guild_id] = cakeOf(db, r.guild_id, p, now);
  return out;
}

// ---------------------------------------------------------------- Party Animal

const PARTY_BITS = { slice: 1, dropin: 2, fish: 4 } as const;
/** Party Animal: eat a cake slice, win a TODD drop-in and land a Party Fish in the same party. */
export function partyDid(db: Db, g: string, u: string, what: keyof typeof PARTY_BITS, now = Date.now()): void {
  const p = partyOf(now);
  if (!p) return;
  const key = `party_${p.key}`;
  const was = db.get<{ value: number }>('SELECT value FROM progress WHERE user_id = ? AND key = ?', u, key)?.value ?? 0;
  const v = was | PARTY_BITS[what];
  if (v !== was) db.run('INSERT INTO progress (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value', u, key, v);
  if (v === 7 && !has(db, u, 'party_animal')) award(db, g, u, 'party_animal', now);
}

/** Being around for a birthday: Year One, Year Two... (the bot's own birthday week), and Party Guest. */
export function partyGuest(db: Db, g: string, u: string, now = Date.now()): void {
  const p = partyOf(now);
  if (!p) return;
  if (!has(db, u, 'party_guest')) award(db, g, u, 'party_guest', now);
  if (p.kind === 'bot' && p.age >= 1 && p.age <= YEARS) { const id = `year_${p.age}`; if (!has(db, u, id)) award(db, g, u, id, now); }
}
/** Year achievements exist for this many birthdays; add more as the years go by. */
export const YEARS = 5;

// ---------------------------------------------------------------- the Party shelf

/** What's on Marquez's Party shelf right now: Cake Slices and the Party Hat at every party, plus the numbered
 *  Candle for the age RendConomy is turning on its own birthday. */
export function onPartyShelf(id: string, now = Date.now()): boolean {
  const p = partyOf(now);
  if (!p) return false;
  if (id === 'cake' || id === 'col_partyhat') return true;
  const m = /^col_candle(\d+)$/.exec(id);
  return !!m && p.kind === 'bot' && Number(m[1]) === p.age;
}

// ---------------------------------------------------------------- the cake slice

export function eatSlice(db: Db, g: string, u: string, rnd: () => number, now = Date.now()): Cents {
  const [lo, hi] = BIRTHDAY.slice;
  const cents = polygons(lo + Math.floor(rnd() * (hi - lo + 1)));
  const paid = payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents, reason: 'birthday.slice', guildId: g, actorId: u, now });
  partyDid(db, g, u, 'slice', now);
  return paid;
}

// ---------------------------------------------------------------- the time capsule (the bot's birthday only)

export interface Capsule { guild_id: string; user_id: string; year: number; text: string; at: number; told: number }
export const capsuleOf = (db: Db, g: string, u: string, year: number): Capsule | undefined =>
  db.get<Capsule>('SELECT * FROM birthday_capsule WHERE guild_id = ? AND user_id = ? AND year = ?', g, u, year);
/** Seals (or rewrites) this year's line. */
export function sealCapsule(db: Db, g: string, u: string, text: string, now = Date.now()): void {
  const p = partyOf(now);
  if (!p || p.kind !== 'bot') throw new Error('not the bot\'s birthday');
  db.run(`INSERT INTO birthday_capsule (guild_id, user_id, year, text, at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (guild_id, user_id, year) DO UPDATE SET text = excluded.text, at = excluded.at`, g, u, p.year, text, now);
  if (!has(db, u, 'sealed_with_care')) award(db, g, u, 'sealed_with_care', now);
}
/** Last year's capsule for a server: opened at this year's birthday. */
export const openedCapsules = (db: Db, g: string, year: number): Capsule[] =>
  db.all<Capsule>('SELECT * FROM birthday_capsule WHERE guild_id = ? AND year = ? ORDER BY at', g, year);

export type Send = (userId: string, guildId: string, text: (server: string) => string) => void;
/** Every few minutes during the bot's birthday: DMs everyone their line from last year. */
export function capsuleTick(db: Db, now: number, send: Send): void {
  const p = partyOf(now);
  if (!p || p.kind !== 'bot') return;
  for (const c of db.all<Capsule>('SELECT * FROM birthday_capsule WHERE year = ? AND told = 0', p.year - 1)) {
    db.run('UPDATE birthday_capsule SET told = 1 WHERE guild_id = ? AND user_id = ? AND year = ?', c.guild_id, c.user_id, c.year);
    send(c.user_id, c.guild_id, (s) => `🕰️ **Your time capsule from last year** in **${s}** just opened:\n> ${c.text}\nHappy birthday, RendConomy. Write next year's with \`r!birthday capsule <your line>\`.`);
  }
}

// ---------------------------------------------------------------- party start (once per party)

/**
 * Runs on every market tick: at the start of a party, tops up each server's progressive jackpot once, and
 * returns what to announce (the party starting, then the Birthday Bash) the first time each happens.
 */
export function partyTick(db: Db, now: number): string[] {
  const p = partyOf(now);
  if (!p) return [];
  const out: string[] = [];
  if (!db.meta(`birthday.started:${p.key}`)) {
    db.setMeta(`birthday.started:${p.key}`, String(now));
    for (const r of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM players')) {
      db.setMeta(`casino.jackpot:${r.guild_id}`, String(jackpotOf(db, r.guild_id) + BIRTHDAY.jackpotTopUp[p.kind]));
    }
    out.push(p.kind === 'bot'
      ? `🎂 **${p.name}** RendConomy is ${p.age} today! Birthday Week runs until November ${p.to}: a Party shelf at Marquez's, cake on the Slots reels, ${format(BIRTHDAY.jackpotTopUp.bot)} more in every jackpot, Chuck's Party Fish, and a cake to fill together. \`r!birthday\``
      : `🎈 **${p.name}** It's the developer's birthday, so everyone's invited: until August ${p.to}, a Party shelf at Marquez's, cake on the Slots reels, ${format(BIRTHDAY.jackpotTopUp.dev)} more in every jackpot, Chuck's Party Fish, and a cake to fill together. \`r!birthday\``);
    addMoment(`${p.emoji} ${p.name}`, now);
  }
  if (p.bash && !db.meta(`birthday.bash:${p.key}`)) {
    db.setMeta(`birthday.bash:${p.key}`, String(now));
    out.push(`🎉 **Birthday Bash!** All day today: chat pay is **x${BIRTHDAY.bashChat}**, and every daily comes with a **${format(BIRTHDAY.bashDaily)}** birthday bonus.`);
  }
  return out;
}

/** The birthday line for anything that just happened in a request (a catch, a shift): adds to the cake. */
export function cakeHere(pieces = 1): string {
  const req = currentRequest();
  if (!req || !req.guildId || !isParty(req.now)) return '';
  const line = addCake(req.db, req.guildId, req.userId, pieces, req.now);
  partyGuest(req.db, req.guildId, req.userId, req.now);
  if (line) req.notes.push(line);
  return line;
}

