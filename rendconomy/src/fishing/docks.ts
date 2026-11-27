// The Fishy Deep: Chuck Alfrey's bait and tackle at the docks, the Fishdex, server records, trophies, and the
// Saturday fishing tournament.
import { award } from '../achievements/achievements';
import { economy } from '../config';
import type { Db } from '../core/db';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, ensureAccount, transfer, wallet } from '../core/ledger';
import { addMoment } from '../core/moments';
import { format, polygons, type Cents } from '../core/money';
import { DAY, dayKey } from '../core/time';
import { hasPerk } from '../estate/estate';
import { addInbox } from '../social/inbox';
import { addItem, count } from '../shop/inventory';
import { ITEMS } from '../shop/items';
import { FISHING, PLACES, RODS, SPECIES, speciesAt, type Place } from './fishing';

export const CHUCK = { name: 'Chuck Alfrey', gear: ['rod_fiberglass', 'rod_carbon', 'rod_polygon', 'cooler', 'boat'] };

// Chuck Alfrey: a weathered old fisherman in a yellow raincoat. Talkative, warm, rambling, superstitious. Has a story
// for everything (maybe a third are true), swears he saw the White Whale, keeps the records board in chalk, and
// talks to the fish. Marquez's opposite: he never stops talking. He and Marquez are friends; that's all he says.
export const CHUCK_LINES = {
  greet: [
    'Biting today! Always biting, for the patient.',
    'Saw the White Whale once. Big as a church. It winked at me! Nobody believes me.',
    'Rod\'s only half of it. The other half is you. The third half is luck. Don\'t do the math.',
    'Don\'t fish the sewer. I mean it. ...You\'re going to fish the sewer.',
    'Marquez sends his regards. He always does. Good man. Terrible fisherman.',
    'Never rename a boat. Never whistle on the pier. Never trust a fish that looks happy.',
    'Knock on the dock before you cast. Go on. ...Louder. The fish need to know you\'re polite.',
    'Rain\'s coming. I can feel it in my knee. Rain means the big ones come up to see what the fuss is.',
    'Caught a pike this long once. No, LONGER. Hold your arms out. Longer than that.',
    'You hear that? That\'s the lake. She\'s in a mood today. Use worms.',
    'Ah, you again! Come in, come in. Mind the bucket. Don\'t mind what\'s in it.',
    'I talk to the fish, you know. Sometimes I apologize to them. Sometimes they deserve it.'
  ],
  saturday: ['Saturday! Tournament day! Heaviest fish wins! I\'d enter, but it wouldn\'t be fair to you.', 'Chalkboard\'s wiped and ready. Tournament\'s on! Go get me something heavy.'],
  heat: ['You\'ve been down the alley. I can smell it on you. The fish can too.', 'Whatever you\'ve been up to after dark, wash it off before you cast. Fish are honest folk.'],
  night: ['Up late? Catfish are up too. Eels, worse. Bring a light.', 'Night fishing! Now we\'re talking. Keep your voice down, they\'re listening.'],
  handover: ['Treat it right and it\'ll treat you right!', 'There she is. Don\'t leave her in the sun.', 'That\'ll outlast you if you\'re kind to it. Ha!', 'Now you\'re a real angler. Well. Closer.'],
  boat: ['A boat! Now you\'re talking. Mind the Deep. The Deep minds you back.'],
  /** He greets you by your rank. */
  rank: {
    greenhorn: ['Fresh off the bus, greenhorn? Hold the rod by the OTHER end.', 'Greenhorn! Welcome, welcome. Don\'t fall in. Everybody falls in.'],
    deckhand: ['Ah, a Deckhand! Come, come. Tell me what got away.', 'There\'s my Deckhand! One page done. The rest won\'t fill themselves.'],
    skipper: ['Skipper! Pull up a crate. The good crate. Not that one.', 'Morning, Skipper. The fish have been talking about you.'],
    oldsalt: ['Old Salt! Sit, sit. You\'ve caught everything I have. Twice, probably.', 'Well, if it isn\'t an Old Salt. I\'ve got nothing left to teach you. I\'ll teach you anyway.']
  } as Record<string, string[]>,
  dex: ['Knew you had it in you!', 'Look at that! A whole page! I\'m putting it on the board.', 'Every last one. You\'ve got the patience. Or nothing better to do. Either way!']
};

// ---------------------------------------------------------------- Chuck's ranks: what he calls you, by Fishdex pages done

export const CHUCK_RANKS = [
  { id: 'greenhorn', name: 'Greenhorn', pages: 0 },
  { id: 'deckhand', name: 'Deckhand', pages: 1 },
  { id: 'skipper', name: 'Skipper', pages: 3 },
  { id: 'oldsalt', name: 'Old Salt', pages: Infinity }   // the whole Fishdex
];
/** How many places' Fishdex pages are complete, out of how many. */
export function pagesDone(db: Db, g: string, u: string): { done: number; of: number } {
  const caught = new Set(db.all<{ species: string }>('SELECT species FROM fishdex WHERE guild_id = ? AND user_id = ?', g, u).map((r) => r.species));
  const places = Object.keys(PLACES) as Place[];
  return { done: places.filter((p) => speciesAt(p).every((s) => caught.has(s.id))).length, of: places.length };
}
export function chuckRank(db: Db, g: string, u: string): (typeof CHUCK_RANKS)[number] {
  const { done, of } = pagesDone(db, g, u);
  if (done >= of) return CHUCK_RANKS[3]!;
  return [...CHUCK_RANKS].reverse().find((r) => done >= r.pages)!;
}

// ---------------------------------------------------------------- gear

/** The best rod you own (-1: none). */
export function rodTier(db: Db, g: string, u: string): number {
  let best = -1;
  for (const r of RODS) if (count(db, g, u, r.id) > 0) best = Math.max(best, r.tier);
  return best;
}
export const bagMax = (db: Db, g: string, u: string): number => (count(db, g, u, 'cooler') > 0 ? FISHING.coolerMax : FISHING.bagMax);

/** Why you can't fish here (null: you can). */
export function cantFish(db: Db, g: string, u: string, place: Place, now = Date.now()): string | null {
  const tier = rodTier(db, g, u);
  if (tier < 0) return 'You need a rod. Marquez sells Bamboo Rods: `shop tackle`.';
  if (place === 'river' && tier < 1) return `The River needs a Fiberglass Rod or better. ${CHUCK.name} sells them: \`fish shop\`.`;
  if (place === 'pier' && tier < 2 && !hasPerk(db, g, u, 'lighthouse')) return `The Pier needs a Carbon Rod or better, or your own Lighthouse. \`fish shop\``;
  if (place === 'deep' && !count(db, g, u, 'boat')) return `The Deep is too far out to cast from shore. You need a Boat: \`fish shop\`.`;
  if (place === 'ice' && new Date(now - 5 * 3600_000).getUTCMonth() !== 11) return 'The lake only freezes in December.';
  return null;
}

export function buyGear(db: Db, g: string, u: string, id: string, now = Date.now()): { name: string; price: Cents } {
  const it = ITEMS[id];
  if (!it || !CHUCK.gear.includes(id)) throw new GameError('docks.none', `${CHUCK.name} doesn't sell that. \`fish shop\` shows what he has.`);
  if (count(db, g, u, id) > 0) throw new GameError('docks.have', `You already have a ${it.name}.`);
  const price = it.price!;
  if (balance(db, wallet(g, u)) < price) throw new GameError('funds.short', `A ${it.name} is ${format(price)}. You have ${format(balance(db, wallet(g, u)))}.`);
  transfer(db, { from: wallet(g, u), to: RESERVE, cents: price, reason: 'fish.gear', guildId: g, actorId: u, now, note: { item: id } });
  addItem(db, g, u, id);
  if (id === 'rod_polygon') award(db, g, u, 'top_of_the_line', now);
  return { name: it.name, price };
}

// ---------------------------------------------------------------- the Fishdex and records

/** Logs a catch: the Fishdex, the server record, the tournament. Returns what was new. */
export function logCatch(db: Db, g: string, u: string, species: string, lb: number, now = Date.now()): { first: boolean; record: boolean; prevRecord: number | null; placeDone: Place | null; dexDone: boolean } {
  const f = SPECIES[species]!;
  const had = db.get<{ caught: number; best_lb: number }>('SELECT caught, best_lb FROM fishdex WHERE guild_id = ? AND user_id = ? AND species = ?', g, u, species);
  db.run(`INSERT INTO fishdex (guild_id, user_id, species, caught, best_lb, first_at) VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT (guild_id, user_id, species) DO UPDATE SET caught = caught + 1, best_lb = MAX(best_lb, excluded.best_lb)`, g, u, species, lb, now);
  const rec = db.get<{ lb: number }>('SELECT lb FROM fish_records WHERE guild_id = ? AND species = ?', g, species);
  const record = f.size > 0 && (!rec || lb > rec.lb);
  if (record) db.run('INSERT OR REPLACE INTO fish_records (guild_id, species, user_id, lb, at) VALUES (?, ?, ?, ?, ?)', g, species, u, lb, now);
  // the tournament: your heaviest fish today, if you entered
  db.run('UPDATE fish_tourney SET species = ?, lb = ?, at = ? WHERE guild_id = ? AND day = ? AND user_id = ? AND lb < ?', species, lb, now, g, tourneyDay(now), u, lb);
  let placeDone: Place | null = null, dexDone = false;
  if (!had && f.size > 0 && f.place !== 'any') {
    const place = f.place as Place;
    const caught = new Set(db.all<{ species: string }>('SELECT species FROM fishdex WHERE guild_id = ? AND user_id = ?', g, u).map((r) => r.species));
    if (speciesAt(place).every((s) => caught.has(s.id))) {
      placeDone = place;
      payFromReserve(db, economy.reserveStart, { to: wallet(g, u), cents: PLACES[place].dexReward, reason: 'fish.dex', guildId: g, actorId: u, now, note: { place } });
    }
    if (Object.values(SPECIES).filter((s) => s.size > 0 && !s.event).every((s) => caught.has(s.id))) { dexDone = true; award(db, g, u, 'gotta_catch_em_all', now); }
  }
  return { first: !had, record, prevRecord: rec?.lb ?? null, placeDone, dexDone };
}
export const dexOf = (db: Db, g: string, u: string) =>
  db.all<{ species: string; caught: number; best_lb: number }>('SELECT species, caught, best_lb FROM fishdex WHERE guild_id = ? AND user_id = ?', g, u);
export const recordsOf = (db: Db, g: string) => db.all<{ species: string; user_id: string; lb: number; at: number }>('SELECT * FROM fish_records WHERE guild_id = ?', g);

// ---------------------------------------------------------------- trophies

export const trophyOf = (db: Db, g: string, u: string) => db.get<{ species: string; lb: number; at: number }>('SELECT species, lb, at FROM fish_trophies WHERE guild_id = ? AND user_id = ?', g, u) ?? null;

// ---------------------------------------------------------------- the Saturday tournament

export const TOURNEY = { entry: polygons(100), seed: polygons(2500), split: [0.6, 0.3, 0.1] };
const pot = (g: string, day: string) => `fishtourney:${g}:${day}`;
/** The tournament's day key if `now` is a Saturday (Eastern), else null. */
export function tourneyDay(now: number): string | null {
  const k = dayKey(now);
  return new Date(`${k}T12:00:00Z`).getUTCDay() === 6 ? k : null;
}
export const potOf = (db: Db, g: string, day: string): Cents => balance(db, pot(g, day));
export const standings = (db: Db, g: string, day: string) =>
  db.all<{ user_id: string; species: string | null; lb: number }>('SELECT user_id, species, lb FROM fish_tourney WHERE guild_id = ? AND day = ? ORDER BY lb DESC, at', g, day);

export function enter(db: Db, g: string, u: string, now = Date.now()): { day: string; pot: Cents } {
  const day = tourneyDay(now);
  if (!day) throw new GameError('tourney.closed', 'The fishing tournament runs on Saturdays (Eastern time). Come back then.');
  if (db.get('SELECT 1 FROM fish_tourney WHERE guild_id = ? AND day = ? AND user_id = ?', g, day, u)) throw new GameError('tourney.in', 'You\'re already entered. Go catch something heavy.');
  if (balance(db, wallet(g, u)) < TOURNEY.entry) throw new GameError('funds.short', `Entry is ${format(TOURNEY.entry)}.`);
  return db.tx(() => {
    ensureAccount(db, pot(g, day), 'escrow', g, null, now);
    transfer(db, { from: wallet(g, u), to: pot(g, day), cents: TOURNEY.entry, reason: 'fish.tourney', guildId: g, actorId: u, now });
    db.run('INSERT INTO fish_tourney (guild_id, day, user_id) VALUES (?, ?, ?)', g, day, u);
    return { day, pot: potOf(db, g, day) };
  });
}

/** Pays out any finished tournament: the Reserve's seed plus the entries, top 3 by their heaviest single fish. */
export function settleTourneys(db: Db, now = Date.now()): { guildId: string; day: string; winners: { user_id: string; paid: Cents; lb: number; species: string | null }[] }[] {
  const out: ReturnType<typeof settleTourneys> = [];
  for (const r of db.all<{ guild_id: string; day: string }>('SELECT DISTINCT guild_id, day FROM fish_tourney')) {
    if (tourneyDay(now) === r.day || Date.parse(`${r.day}T12:00:00Z`) > now) continue;
    if (db.meta(`fishtourney.done:${r.guild_id}:${r.day}`)) continue;
    db.tx(() => {
      db.setMeta(`fishtourney.done:${r.guild_id}:${r.day}`, '1');
      const id = pot(r.guild_id, r.day);
      ensureAccount(db, id, 'escrow', r.guild_id, null, now);
      const fished = standings(db, r.guild_id, r.day).filter((x) => x.lb > 0);
      if (!fished.length) {   // nobody caught anything: entries back
        for (const e of standings(db, r.guild_id, r.day)) if (balance(db, id) >= TOURNEY.entry) transfer(db, { from: id, to: wallet(r.guild_id, e.user_id), cents: TOURNEY.entry, reason: 'fish.tourney.refund', guildId: r.guild_id, now });
        out.push({ guildId: r.guild_id, day: r.day, winners: [] });
        return;
      }
      payFromReserve(db, economy.reserveStart, { to: id, cents: TOURNEY.seed, reason: 'fish.tourney.seed', guildId: r.guild_id, now });
      const total = balance(db, id);
      const winners: ReturnType<typeof settleTourneys>[number]['winners'] = [];
      fished.slice(0, 3).forEach((w, i) => {
        const share = i === Math.min(fished.length, 3) - 1 ? balance(db, id) : Math.floor(total * TOURNEY.split[i]!);
        if (share > 0) transfer(db, { from: id, to: wallet(r.guild_id, w.user_id), cents: share, reason: 'fish.tourney.win', guildId: r.guild_id, now });
        winners.push({ user_id: w.user_id, paid: share, lb: w.lb, species: w.species });
        addInbox(db, w.user_id, r.guild_id, 'Fishing tournament', `You placed **#${i + 1}** in the tournament with a ${w.lb} lb ${SPECIES[w.species ?? '']?.name ?? 'fish'}: ${format(share)}.`, now);
        if (i === 0) award(db, r.guild_id, w.user_id, 'reel_champion', now);
      });
      addMoment('🏆 A server just crowned its fishing champion', now);
      out.push({ guildId: r.guild_id, day: r.day, winners });
    });
  }
  return out;
}
export { DAY };
