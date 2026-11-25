// The Fishy Deep: r!fish. Cast at one of six places, reel in the big ones, fill the Fishdex, chase records, mount
// a trophy, enter the Saturday tournament, and shop at Old Barnaby's. See src/fishing/.
import { awardHere, bump, sameDay } from '../achievements/achievements';
import { workBonus } from '../city/state';
import { economy } from '../config';
import { payFromReserve, payoutFactor } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format, polygons } from '../core/money';
import * as sessions from '../core/sessions';
import { cooldown, discordTime, easternHour, takeCooldown } from '../core/time';
import { emojiOr } from '../discord/emoji';
import { LINES, line, teaser } from '../discord/flavor';
import { itemE } from '../discord/icons';
import { embed } from '../discord/style';
import { hasPerk, perkLevel } from '../estate/estate';
import { isEvent } from '../events/world';
import { BOTTLES } from '../fishing/bottles';
import {
  BARNABY, TOURNEY, bagMax, buyGear, cantFish, dexOf, enter, logCatch, potOf, recordsOf, rodTier, standings, tourneyDay, trophyOf
} from '../fishing/docks';
import {
  FISHING, PLACES, RODS, SIZE_NAMES, SPECIES, addToBag, bagCount, bagOf, cast, dailyPrice, fmtLb, itemId, partOfDay, speciesAt, takeFromBag,
  type Bait, type Place
} from '../fishing/fishing';
import { REEL, bar, reelStep, startReel, type ReelState } from '../fishing/reel';
import { addItem, charges, count, items, takeItem, useEffect } from '../shop/inventory';
import { ITEMS, marquez } from '../shop/items';
import { addHeat, row as ugRow } from '../underground/underground';
import { me } from './shared';
import { barnaby, purchase } from './shop';
import type { Command, Ctx, ReplyObject, SessionReply } from './types';

const BLUE = 0x3ba7f2;
const fishE = (id: string) => itemE(itemId(id), SPECIES[id]?.emoji ?? '🐟');
const junkCount = (ctx: Ctx, g: string) => items(ctx.db, g, ctx.user.id).filter((r) => r.item.startsWith('fish_') && SPECIES[r.item.slice(5)]?.size === 0).reduce((s, r) => s + r.qty, 0);
const inBag = (ctx: Ctx, g: string) => bagCount(ctx.db, g, ctx.user.id) + junkCount(ctx, g);
const PLACE_WORDS: Record<string, Place> = { lake: 'lake', river: 'river', pier: 'pier', ocean: 'pier', sea: 'pier', deep: 'deep', boat: 'deep', sewer: 'sewer', sewers: 'sewer', ice: 'ice' };
/** Warehouse: sell at the best price of the last few days (3/5/7 by level), like crops. */
function bestPrice(ctx: Ctx, g: string, id: string): number {
  const lv = perkLevel(ctx.db, g, ctx.user.id, 'warehouse', ctx.now);
  const days = lv ? [3, 5, 7][Math.min(lv, 3) - 1]! : 1;
  let best = 0;
  for (let d = 0; d < days; d++) best = Math.max(best, dailyPrice(id, ctx.now - d * 86_400_000));
  return best;
}

export const fish: Command = {
  name: 'fish', aliases: ['cast', 'fishing'], description: 'Fish: r!fish [place] [bait], or bag, sell, shop, dex, records, mount, tournament', system: 'wallet', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: 'Blank for the Lake, or a place (river, pier, deep, sewer, ice) and bait, or: bag, sell, shop, dex…' }],
  run(ctx, args) {
    const words = String(args.action ?? args.bait ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const { guildId: g } = me(ctx);
    switch (words[0]) {
      case 'sell': return sellAll(ctx, g);
      case 'bag': case 'catch': case 'inv': case 'inventory': return bagView(ctx, g);
      case 'shop': case 'docks': case 'barnaby': return barnaby(ctx, g);
      case 'buy': return buy(ctx, g, words.slice(1).join(' '));
      case 'dex': case 'fishdex': case 'collection': return dex(ctx, g, words[1]);
      case 'records': case 'record': return records(ctx, g);
      case 'mount': case 'trophy': return mount(ctx, g, words.slice(1).join(' '));
      case 'places': case 'where': case 'map': return places(ctx, g);
      case 'tournament': case 'tourney': return tourney(ctx, g, words[1]);
      default: return castLine(ctx, g, words);
    }
  }
};
/** The old r!sellfish, now r!fish sell. */
export const sellfish: Command = {
  name: 'sellfish', aliases: ['sellcatch'], description: 'Sell your whole catch', system: 'wallet', guildOnly: true,
  run(ctx) { return sellAll(ctx, me(ctx).guildId); }
};

// ================================================================ casting

function castLine(ctx: Ctx, g: string, words: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const { wallet } = me(ctx);
  let place: Place = 'lake';
  if (words[0] && PLACE_WORDS[words[0]]) place = PLACE_WORDS[words.shift()!]!;
  const why = cantFish(ctx.db, g, ctx.user.id, place, ctx.now);
  if (why) throw new GameError('fish.place', why.replace(/`([a-z])/g, `\`${P}$1`));
  if (inBag(ctx, g) >= bagMax(ctx.db, g, ctx.user.id)) throw new GameError('fish.full', `Your bag is full (${bagMax(ctx.db, g, ctx.user.id)}). Sell your catch with \`${P}fish sell\`${count(ctx.db, g, ctx.user.id, 'cooler') ? '' : `, or get a Cooler from ${BARNABY.name}`}.`);
  if (sessions.active(ctx.db, 'reel', g, ctx.user.id, ctx.now)) throw new GameError('fish.reeling', 'You\'ve already got one on the line! Reel it in first.');
  // the bait
  const want = words.join(' ');
  let bait: Bait = 'bait', using = 'bait', baitRow: number | null = null;
  if (want) {
    if (/^worms?$/.test(want)) {
      if (!count(ctx.db, g, ctx.user.id, 'worm')) throw new GameError('fish.bait', `You have no Worms. Compost junk to get some: \`${P}farm compost\`.`);
      bait = 'worm'; using = 'worm';
    } else if (/^carrots?$/.test(want)) {
      if (!count(ctx.db, g, ctx.user.id, 'crop_carrot')) throw new GameError('fish.bait', `You have no Carrots. Grow some: \`${P}farm plant carrot\`.`);
      bait = 'carrot'; using = 'carrot';
    } else if (/^lure$/.test(want)) {
      if (!charges(ctx.db, g, ctx.user.id, 'lure')) throw new GameError('fish.bait', 'You have no Lure on.');
      bait = 'lure'; using = 'lure';
    } else if (/^bait$/.test(want)) bait = 'bait';
    else {
      const f = Object.values(SPECIES).find((s) => s.id === want || s.name.toLowerCase() === want || s.name.toLowerCase().includes(want));
      const rowf = f ? bagOf(ctx.db, g, ctx.user.id).filter((r) => r.species === f.id).sort((a, b) => a.lb - b.lb)[0] : undefined;
      if (!f || f.size === 0 || f.size === 4 || !rowf) throw new GameError('fish.bait', 'Choose a small, medium or large fish from your bag as bait, or worm, carrot, or lure.');
      bait = f.size as 1 | 2 | 3; using = f.id; baitRow = rowf.id;
    }
  } else if (charges(ctx.db, g, ctx.user.id, 'lure') > 0) { bait = 'lure'; using = 'lure'; }
  const frenzy = isEvent(ctx.db, 'fish_frenzy', undefined, ctx.now);
  const shed = bait === 'bait' && hasPerk(ctx.db, g, ctx.user.id, 'shack');
  const beacon = bait === 'bait' && hasPerk(ctx.db, g, ctx.user.id, 'lighthouse');
  if (bait === 'bait' && !shed && balance(ctx.db, wallet) < FISHING.bait) throw new GameError('funds.short', `Bait costs ${format(FISHING.bait)}.`);
  if (!takeCooldown(ctx.db, 'fish', `${g}:${ctx.user.id}`, frenzy ? 90_000 : FISHING.cooldownMs, ctx.now)) {
    throw new GameError('fish.cooldown', `The fish need a moment. Cast again ${discordTime(cooldown(ctx.db, 'fish', `${g}:${ctx.user.id}`, ctx.now).until)}.`);
  }
  return ctx.db.tx(() => {
    let spent: string;
    if (bait === 'bait' && shed) spent = `${emojiOr('prop_shack', '🛖')} Bait from your Bait Shed: free`;
    else if (bait === 'bait') { transfer(ctx.db, { from: wallet, to: RESERVE, cents: FISHING.bait, reason: 'fish.bait', guildId: g, actorId: ctx.user.id, now: ctx.now }); spent = `🪱 Bait: −${format(FISHING.bait)}`; }
    else if (bait === 'lure') { useEffect(ctx.db, g, ctx.user.id, 'lure'); const left = charges(ctx.db, g, ctx.user.id, 'lure'); spent = `🪝 Lure: ${left} ${left === 1 ? 'cast' : 'casts'} left`; }
    else if (bait === 'worm') { takeItem(ctx.db, g, ctx.user.id, 'worm'); spent = `${itemE('worm', '🪱')} A Worm on the hook. ${count(ctx.db, g, ctx.user.id, 'worm')} left.`; }
    else if (bait === 'carrot') { takeItem(ctx.db, g, ctx.user.id, 'crop_carrot'); spent = '🥕 You used a Carrot as bait. The fish seem curious.'; }
    else { takeFromBag(ctx.db, baitRow!); spent = `${fishE(using)} You used a ${SPECIES[using]!.name} as bait.`; }
    const heat = place === 'sewer' ? (ugRow(ctx.db, g, ctx.user.id, ctx.now), addHeat(ctx.db, g, ctx.user.id, 3, ctx.now)) : [];
    const cond = { rodTier: rodTier(ctx.db, g, ctx.user.id), hour: easternHour(ctx.now), rain: isEvent(ctx.db, 'rain', undefined, ctx.now), storm: isEvent(ctx.db, 'storm', undefined, ctx.now), luck: workBonus(ctx.db, g, 'fishing', ctx.now) };
    const r = cast(place, (frenzy || beacon) && bait === 'bait' ? 'lure' : bait, cond, ctx.rng);
    sameDay(ctx.db, ctx.user.id, 'fish', ctx.now);
    const P = ctx.config.prefix;
    const pl = PLACES[place];
    const foot = [spent, ...heat, place === 'sewer' ? '-# 🕳️ The Sewer: +3 Heat.' : null, `-# ${pl.emoji} ${pl.name} · Bag: ${inBag(ctx, g)} / ${bagMax(ctx.db, g, ctx.user.id)} · \`${P}fish bag\` · \`${P}fish sell\``,
      frenzy ? '-# 🐟 Fish Frenzy: the fish are biting like a lure is on.' : beacon ? `-# ${emojiOr('prop_lighthouse', '🗼')} Your Lighthouse's Beacon draws the bigger fish in.` : null];
    const card = (text: string, color = BLUE): ReplyObject => ({ embeds: [{ title: `🎣 Fishing · ${pl.name}`, color, description: [text, '', ...foot].filter((x) => x !== null).join('\n') }] });
    const tease = teaser(`🎣 Fishing · ${pl.name}`, CATCH_TEASE(using), BLUE);
    if (r.kind === 'nothing') return { ...card(`🌊 ${line(ctx.rng, 'fishNothing')}`), teaser: tease };
    if (r.kind === 'snag') return { ...card('🪢 **Your line snagged on something!** You yank it free, but the bait is gone.', 0xed4245), teaser: tease };
    if (r.kind === 'wallet') {
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: r.cents, reason: 'fish.wallet', guildId: g, actorId: ctx.user.id, now: ctx.now });
      return { ...card(`👛 **You reeled in a soggy wallet!** There's **${format(paid)}** inside. Finders keepers.`, 0xf0b232), teaser: tease };
    }
    if (r.kind === 'chest') {
      const roll = ctx.rng.next();
      if (roll < 0.6) {
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: polygons(ctx.rng.int(200, 2000)), reason: 'fish.chest', guildId: g, actorId: ctx.user.id, now: ctx.now });
        awardHere('sunken_treasure');
        return { ...card(`🧰 **A treasure chest!** Barnacles, rust, and **${format(paid)}** in old Polygons.`, 0xf0b232), teaser: tease };
      }
      const it = ctx.rng.pick(['lure', 'mystery', 'coffee', 'worm']);
      const n = it === 'worm' ? 5 : 1;
      addItem(ctx.db, g, ctx.user.id, it, n);
      awardHere('sunken_treasure');
      return { ...card(`🧰 **A treasure chest!** Inside: ${n > 1 ? `${n} ` : 'a '}**${itemE(it, ITEMS[it]!.emoji)} ${ITEMS[it]!.name}${n > 1 ? 's' : ''}**, still dry somehow.`, 0xf0b232), teaser: tease };
    }
    if (r.kind === 'bottle') {
      awardHere('message_in_a_bottle');
      return { ...card(`🍾 **A message in a bottle.** The paper is soft and the ink has run, but you can make it out:\n> *${ctx.rng.pick(BOTTLES)}*`, 0x9b59b6), teaser: tease };
    }
    if (r.kind === 'junk') {
      const f = SPECIES[r.id]!;
      addItem(ctx.db, g, ctx.user.id, itemId(r.id));
      return { ...card(`${fishE(r.id)} You pulled up a **${f.name}**. Marquez might give you ${format(polygons(f.value))} for it, or compost it: \`${P}farm compost\`.`), teaser: tease };
    }
    const f = SPECIES[r.id]!;
    if (f.size <= 1) return { ...card(land(ctx, g, r.id, r.lb, r.giant, place, using)), teaser: tease };
    // medium and bigger fight back
    const tier = Math.max(0, cond.rodTier);
    const s = sessions.create<ReelFish>(ctx.db, { kind: 'reel', guildId: g, channelId: ctx.channelId, userId: ctx.user.id, ttlMs: REEL.ms, now: ctx.now,
      state: { ...startReel(f.strength + (r.giant ? 0.5 : 0), RODS[tier]!.tension), id: r.id, lb: r.lb, giant: r.giant, place, using, until: ctx.now + REEL.ms } });
    return { ...reelView(s, ctx), session: s.id, teaser: tease };
  });
}
const CATCH_TEASE = (using: string) => (using === 'carrot' ? 'You tie a Carrot to the hook and cast it out... 🌊' : using === 'worm' ? 'You thread a worm onto the hook and cast... 🌊'
  : SPECIES[using] ? `You hook the ${SPECIES[using]!.name} and cast it out... 🌊` : 'You cast your line... 🌊');

/** A fish comes in: into the bag, the Fishdex, the records, the achievements. Returns the text. */
function land(ctx: Ctx, g: string, id: string, lb: number, giant: boolean, place: Place, using: string): string {
  const f = SPECIES[id]!;
  const b = addToBag(ctx.db, g, ctx.user.id, id, lb, ctx.now);
  const log = logCatch(ctx.db, g, ctx.user.id, id, lb, ctx.now);
  awardHere('first_catch');
  if (bump(ctx.db, ctx.user.id, 'fish_caught') >= 200) awardHere('fish_in_the_sea');
  if (id === 'whale') awardHere('moby_dick');
  if (id === 'catfish') awardHere('meow');
  if (place === 'sewer') awardHere('ninja_fishies');
  if (f.size === 1 && lb > 20) awardHere('big_bertha');
  if (SPECIES[using] && f.size > SPECIES[using]!.size) awardHere('bigger_fish');
  if (using === 'carrot') awardHere('full_circle');
  const P = ctx.config.prefix;
  return [
    `${fishE(id)} **You caught a${giant ? ' GIANT' : /^[AEIOU]/.test(f.name) ? 'n' : ''} ${f.name}!** ${fmtLb(lb)}, ${SIZE_NAMES[f.size]!.toLowerCase()}, worth about ${format(Math.floor(b.value * dailyPrice(id, ctx.now)))} today.${LINES.fishBig[f.size] ?? ''}`,
    giant ? '😲 That is *not* a normal size for one of those.' : null,
    log.first ? `📖 **New in your Fishdex!**` : null,
    log.record ? `🏆 **Server record!** The heaviest ${f.name} anyone here has caught${log.prevRecord ? ` (the old one was ${fmtLb(log.prevRecord)})` : ''}.` : null,
    log.placeDone ? `🎉 **${PLACES[log.placeDone].name} is complete in your Fishdex!** ${format(PLACES[log.placeDone].dexReward)} from ${BARNABY.name}: "Knew you had it in you."` : null,
    log.dexDone ? '🌟 **You caught every fish there is.** The whole Fishdex.' : null,
    f.size === 4 ? `-# Word travels fast. *${marquez(id === 'whale' ? 'whale' : 'koi', ctx.rng)}*` : null,
    tourneyDay(ctx.now) && ctx.db.get('SELECT 1 FROM fish_tourney WHERE guild_id = ? AND day = ? AND user_id = ?', g, tourneyDay(ctx.now), ctx.user.id) ? `-# 🏆 Tournament: your best today is ${fmtLb(ctx.db.get<{ lb: number }>('SELECT lb FROM fish_tourney WHERE guild_id = ? AND day = ? AND user_id = ?', g, tourneyDay(ctx.now), ctx.user.id)!.lb)}. \`${P}fish tournament\`` : null
  ].filter(Boolean).join('\n');
}

// ================================================================ reeling in

interface ReelFish extends ReelState { id: string; lb: number; giant: boolean; place: Place; using: string; until: number }
function reelView(s: sessions.Session<ReelFish>, ctx: Ctx, done = false, text = ''): ReplyObject {
  const st = s.state, f = SPECIES[st.id]!;
  const pl = PLACES[st.place];
  return {
    embeds: [{ title: `🎣 Fish on! · ${pl.name}`, color: done ? BLUE : 0xf0b232, description: (text || [
      `Something ${f.size >= 4 ? '**enormous**' : f.size === 3 ? '**big**' : 'heavy'} is on the line.`,
      `-# ${st.last}`, '',
      `**Line in:** ${bar(st.progress, 100)} ${st.progress}%`,
      `**Tension:** ${bar(st.tension, st.max, '🟨', '🟥')} ${st.tension} / ${st.max}`, '',
      `Reel it in before the line snaps. Gone ${discordTime(st.until, 'R')}.`
    ].join('\n')) }],
    buttons: done ? [] : [[
      { label: 'Reel', emoji: '🎣', id: sessions.buttonId(s.id, 'reel'), style: 'success' },
      { label: 'Let out', emoji: '🪢', id: sessions.buttonId(s.id, 'let'), style: 'secondary' }
    ]]
  };
}
export function onReelButton(ctx: Ctx, s: sessions.Session<ReelFish>, value: string): SessionReply {
  if (s.user_id !== ctx.user.id) return { notice: 'That\'s someone else\'s fish.' };
  if (value !== 'reel' && value !== 'let') return {};
  return ctx.db.tx(() => {
    const f = SPECIES[s.state.id]!;
    if (ctx.now > s.state.until) {
      if (!sessions.end(ctx.db, s.id)) return {};
      if (f.size >= 4) awardHere('one_that_got_away');
      return { update: reelView(s, ctx, true, `⏱️ You took too long. The ${f.size >= 4 ? '**legend**' : 'fish'} spits the hook and is gone.`) };
    }
    const { st, end } = reelStep(s.state, value, ctx.rng);
    const next: ReelFish = { ...s.state, ...st };
    if (!end) { sessions.save(ctx.db, s.id, next); return { update: reelView({ ...s, state: next }, ctx) }; }
    if (!sessions.end(ctx.db, s.id)) return {};
    if (end === 'landed') return { update: reelView({ ...s, state: next }, ctx, true, land(ctx, s.guild_id!, next.id, next.lb, next.giant, next.place, next.using)) };
    if (f.size >= 4) awardHere('one_that_got_away');
    return { update: reelView({ ...s, state: next }, ctx, true, end === 'snapped'
      ? `💥 **SNAP!** The line breaks. Somewhere out there, a ${f.size >= 4 ? 'legend' : 'fish'} swims off with your hook.`
      : `🌊 It shakes loose and is gone. ${f.size >= 3 ? 'That was a big one, too.' : 'Next time.'}`) };
  });
}

// ================================================================ the bag, selling

function bagView(ctx: Ctx, g: string): ReplyObject {
  const P = ctx.config.prefix;
  const fishRows = bagOf(ctx.db, g, ctx.user.id);
  const junk = items(ctx.db, g, ctx.user.id).filter((r) => r.item.startsWith('fish_') && SPECIES[r.item.slice(5)]?.size === 0);
  const factor = payoutFactor(ctx.db, economy.reserveStart);
  const worth = Math.floor((fishRows.reduce((s, r) => s + r.value * bestPrice(ctx, g, r.species), 0) + junk.reduce((s, r) => s + polygons(SPECIES[r.item.slice(5)]!.value) * r.qty, 0)) * factor);
  const lure = charges(ctx.db, g, ctx.user.id, 'lure'), worms = count(ctx.db, g, ctx.user.id, 'worm');
  const t = trophyOf(ctx.db, g, ctx.user.id);
  return { embeds: [{ title: '🎣 Your catch', color: BLUE, description: [
    ...(fishRows.length ? fishRows.slice(0, 25).map((r) => `${fishE(r.species)} **${SPECIES[r.species]!.name}** · ${fmtLb(r.lb)} · ${format(Math.floor(r.value * bestPrice(ctx, g, r.species)))}`) : ['No fish yet. Go cast a line!']),
    fishRows.length > 25 ? `-# …and ${fishRows.length - 25} more` : null,
    junk.length ? `Junk: ${junk.map((r) => `${fishE(r.item.slice(5))} ${SPECIES[r.item.slice(5)]!.name} × ${r.qty}`).join(', ')}` : null,
    '',
    worth ? `Today it would all sell for **${format(worth)}**.` : null,
    `${inBag(ctx, g)} / ${bagMax(ctx.db, g, ctx.user.id)} in your bag${lure ? ` · 🪝 Lure: ${lure}` : ''}${worms ? ` · 🪱 Worms: ${worms}` : ''}`,
    t ? `🏆 On your wall: a ${fmtLb(t.lb)} ${SPECIES[t.species]?.name}` : null,
    `-# \`${P}fish sell\` · \`${P}fish mount <fish>\` · \`${P}fish <small fish>\` uses it as bait`
  ].filter((x) => x !== null).join('\n') }] };
}

function sellAll(ctx: Ctx, g: string): ReplyObject {
  const { wallet } = me(ctx);
  const fishRows = bagOf(ctx.db, g, ctx.user.id);
  const junk = items(ctx.db, g, ctx.user.id).filter((r) => r.item.startsWith('fish_') && SPECIES[r.item.slice(5)]?.size === 0);
  if (!fishRows.length && !junk.length) throw new GameError('fish.empty', 'Your bag is empty.');
  return ctx.db.tx(() => {
    let total = 0;
    const lines = new Map<string, { n: number; cents: number }>();
    for (const r of fishRows) {
      const v = Math.floor(r.value * bestPrice(ctx, g, r.species));
      total += v; takeFromBag(ctx.db, r.id);
      const l = lines.get(r.species) ?? { n: 0, cents: 0 }; l.n++; l.cents += v; lines.set(r.species, l);
    }
    for (const r of junk) {
      const v = polygons(SPECIES[r.item.slice(5)]!.value) * r.qty;
      total += v; takeItem(ctx.db, g, ctx.user.id, r.item, r.qty);
      lines.set(r.item.slice(5), { n: r.qty, cents: v });
    }
    const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: total, reason: 'fish.sell', guildId: g, actorId: ctx.user.id, now: ctx.now });
    const n = [...lines.values()].reduce((s, l) => s + l.n, 0);
    const wh = perkLevel(ctx.db, g, ctx.user.id, 'warehouse', ctx.now);
    return { embeds: [embed('wallet', '🧺 Catch sold', [`*${marquez('catch', ctx.rng)}*`, '',
      ...[...lines.entries()].slice(0, 20).map(([id, l]) => `${fishE(id)} ${SPECIES[id]!.name} × ${l.n}: ${format(l.cents)}`), '',
      `He pays **${format(paid)}** for ${n} ${n === 1 ? 'thing' : 'things'}.${wh ? ` ${emojiOr('prop_warehouse', '📦')} Your Warehouse kept them fresh: the best price of the last ${[3, 5, 7][Math.min(wh, 3) - 1]} days.` : ''}`,
      `-# Balance: ${format(balance(ctx.db, wallet))} · fish prices change every day`])] };
  });
}

function mount(ctx: Ctx, g: string, want: string): ReplyObject {
  const P = ctx.config.prefix;
  const f = Object.values(SPECIES).find((s) => s.size > 0 && (s.id === want || s.name.toLowerCase() === want || s.name.toLowerCase().includes(want)));
  if (!want || !f) throw new GameError('fish.mount', `Mount which fish? \`${P}fish mount <fish>\` puts your heaviest one of that kind on your profile.`);
  const best = bagOf(ctx.db, g, ctx.user.id).filter((r) => r.species === f.id).sort((a, b) => b.lb - a.lb)[0];
  if (!best) throw new GameError('fish.mount', `You don't have a ${f.name} in your bag.`);
  return ctx.db.tx(() => {
    const old = trophyOf(ctx.db, g, ctx.user.id);
    takeFromBag(ctx.db, best.id);
    ctx.db.run('INSERT OR REPLACE INTO fish_trophies (guild_id, user_id, species, lb, at) VALUES (?, ?, ?, ?, ?)', g, ctx.user.id, f.id, best.lb, ctx.now);
    awardHere('trophy_wall');
    return { embeds: [embed('wallet', '🏆 Mounted', [`Your **${fmtLb(best.lb)} ${f.name}** ${fishE(f.id)} goes up on the wall. It's on your profile now.`, old ? `-# It replaces your ${fmtLb(old.lb)} ${SPECIES[old.species]?.name}, which goes in the bin.` : null])] };
  });
}

// ================================================================ the docks, the Fishdex, records, places, tournament

function buy(ctx: Ctx, g: string, want: string): ReplyObject {
  // bait and the Bamboo Rod come off the truck like Marquez's stock
  const tackle = Object.values(ITEMS).find((i) => i.shelf === 'tackle' && i.ready && (i.id === want || i.name.toLowerCase() === want || i.name.toLowerCase().startsWith(want) || (want === 'bamboo' && i.id === 'rod')));
  if (want && tackle) return purchase.run(ctx, { item: tackle.id }) as ReplyObject;
  const id = BARNABY.gear.find((x) => x === want || ITEMS[x]!.name.toLowerCase() === want || ITEMS[x]!.name.toLowerCase().startsWith(want) || x.replace('rod_', '') === want);
  if (!want || !id) throw new GameError('docks.none', `Buy what? \`${ctx.config.prefix}fish shop\` shows ${BARNABY.name}'s gear.`);
  const r = ctx.db.tx(() => buyGear(ctx.db, g, ctx.user.id, id, ctx.now));
  return { embeds: [embed('wallet', `⚓ ${r.name}`, [`${BARNABY.name} hands it over. *"Treat it right and it'll treat you right."*`, `-# −${format(r.price)}. ${id === 'boat' ? `Head out with \`${ctx.config.prefix}fish deep\`.` : id === 'rod_fiberglass' ? `The River's open: \`${ctx.config.prefix}fish river\`.` : id === 'rod_carbon' ? `The Pier's open: \`${ctx.config.prefix}fish pier\`.` : ''}`])] };
}
function places(ctx: Ctx, g: string): ReplyObject {
  const P = ctx.config.prefix;
  return { embeds: [embed('wallet', '🗺️ Where to fish', [
    ...(Object.values(PLACES).map((p) => { const why = cantFish(ctx.db, g, ctx.user.id, p.id, ctx.now); return `${p.emoji} **${p.name}** (\`${P}fish ${p.id}\`): ${p.desc} ${why ? `🔒 ${p.needs}` : '✅'}`; })),
    '', `-# It's ${partOfDay(easternHour(ctx.now))} on the water. Some fish only bite at night or in the morning.`
  ])] };
}
function dex(ctx: Ctx, g: string, which?: string): ReplyObject {
  const P = ctx.config.prefix;
  const have = new Map(dexOf(ctx.db, g, ctx.user.id).map((r) => [r.species, r]));
  const all = Object.values(SPECIES).filter((s) => s.size > 0);
  const place = which ? PLACE_WORDS[which] : undefined;
  const list = (place ? [place] : (Object.keys(PLACES) as Place[]));
  return { embeds: [embed('wallet', `📖 Fishdex · ${all.filter((s) => have.has(s.id)).length} of ${all.length}`, list.flatMap((p) => [
    `**${PLACES[p].emoji} ${PLACES[p].name}** · ${speciesAt(p).filter((s) => have.has(s.id)).length} / ${speciesAt(p).length} · completing it pays ${format(PLACES[p].dexReward)}`,
    speciesAt(p).map((s) => (have.has(s.id) ? `${fishE(s.id)} ${s.name} (${fmtLb(have.get(s.id)!.best_lb)})` : `❔ ${'?'.repeat(Math.min(8, s.name.length))}`)).join(' · '), ''
  ]).concat([`-# \`${P}fish dex <place>\` for one place · \`${P}fish records\` for the server's heaviest`]))] };
}
function records(ctx: Ctx, g: string): ReplyObject {
  const recs = recordsOf(ctx.db, g).sort((a, b) => SPECIES[b.species]!.size - SPECIES[a.species]!.size || b.lb - a.lb);
  return { embeds: [embed('wallet', '🏆 Server records', recs.length ? recs.slice(0, 30).map((r) => `${fishE(r.species)} **${SPECIES[r.species]?.name}**: ${fmtLb(r.lb)} by <@${r.user_id}>`) : ['No records yet. Be the first.'])] };
}
function tourney(ctx: Ctx, g: string, word?: string): ReplyObject {
  const P = ctx.config.prefix;
  const day = tourneyDay(ctx.now);
  if (word === 'join' || word === 'enter') {
    const r = enter(ctx.db, g, ctx.user.id, ctx.now);
    return { embeds: [embed('wallet', '🏆 Entered!', [`You're in the fishing tournament. The pot is **${format(r.pot)}** so far, plus ${format(TOURNEY.seed)} from the Reserve at the end.`, 'Your heaviest single fish today counts. Top 3 split the pot 60 / 30 / 10.'])] };
  }
  if (!day) return { embeds: [embed('wallet', '🏆 Fishing tournament', ['Every **Saturday** (Eastern time). Enter for ' + format(TOURNEY.entry) + `, then your heaviest single fish that day counts. The Reserve adds ${format(TOURNEY.seed)}, and the top 3 split the pot 60 / 30 / 10.`, `-# \`${P}fish tournament join\` on Saturday.`])] };
  const rows = standings(ctx.db, g, day);
  return { embeds: [embed('wallet', `🏆 Today's tournament · pot ${format(potOf(ctx.db, g, day) + TOURNEY.seed)}`, [
    ...(rows.length ? rows.slice(0, 10).map((r, i) => `${['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`} <@${r.user_id}>: ${r.lb ? `${fmtLb(r.lb)} ${SPECIES[r.species ?? '']?.name ?? ''}` : 'nothing yet'}`) : ['Nobody has entered yet.']),
    '', `-# Entry ${format(TOURNEY.entry)}: \`${P}fish tournament join\`. Ends at midnight Eastern.`
  ])] };
}
