// Oh My God, 2 in 1!: r!property. The city map, building, upgrading, selling and tearing down, repairs, buyout bids,
// auctions, Storefronts, the Ballroom, freight trains, Goods, and the server's landmarks.
import { addMoment, compact } from '../core/moments';
import { award, awardHere, bump } from '../achievements/achievements';
import { alive, getCompany } from '../companies/companies';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet as walletOf } from '../core/ledger';
import { format, parseAmount, type Cents } from '../core/money';
import { DAY, HOUR, dayKey, discordTime } from '../core/time';
import { emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import {
  ESTATE, KINDS, KIND_ORDER, SIZE, TILES, around, buyout, clearLot, dayRent, distance, effects, goodsPerDay, isEdge, lastShipment, lotAt, lotsOf,
  minBid, newLot, ownedBy, parseTile, partyUntil, perkLevel, placeBid, refundBid, rentAt, repairCost, saveLot, salvagePrice, sellPrice, settle, ship, startParty, taxRate,
  tileName, trainsOf, upgradeCost, upgradeMs, upkeepAt, value, type EstateNews, type Kind, type Lot
} from '../estate/estate';
import { LANDMARKS, MIN_DONATION, current, donate, donors, finished, isBuilt, STATUE_RENT } from '../estate/landmarks';
import { CROPS, rollSale } from '../farming/farming';
import { WHOLESALE, allowance, boughtToday, buyWholesale, findCrop, wholesalePrice } from '../estate/wholesale';
import { count, takeItem } from '../shop/inventory';
import { addInbox } from '../social/inbox';
import { useCharge } from '../underground/underground';
import { basket, coldDays } from './farming';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';

export const kindE = (k: Kind): string => emojiOr(`prop_${k}`, KINDS[k].emoji);
const pct = (c: number): string => `${Math.round(Math.max(0, c))}%`;
const stars = (l: Lot): string => (KINDS[l.kind].maxLevel > 1 ? ` ${'★'.repeat(l.level)}${'☆'.repeat(KINDS[l.kind].maxLevel - l.level)}` : '');
const nameOf = (db: Ctx['db'], guildId: string, id: string | null, meId?: string): string => {
  if (!id) return 'nobody';
  if (id === meId) return 'you';
  return db.get<{ name: string }>('SELECT name FROM players WHERE guild_id = ? AND user_id = ?', guildId, id)?.name ?? 'someone';
};
/** A tile on the map. */
export function tile(l: Lot | undefined, now: number): string {
  if (!l) return emojiOr('tile_empty', '🟩');
  if (l.status === 'auction') return emojiOr('lot_condemned', '🏚️');
  if (l.build_until > now) return emojiOr('construction', '🚧');
  if (l.squatters) return emojiOr('squatter', '🛌');
  return kindE(l.kind);
}
const where = (l: Pick<Lot, 'lot'>): string => `**${tileName(l.lot)}**`;

/** Settles the server, tells the other people involved (inbox), and returns the lines for this player. */
function catchUp(ctx: Ctx, guildId: string): { lots: Lot[]; news: string[] } {
  const events = settle(ctx.db, guildId, ctx.now);
  const news = tellAll(ctx.db, guildId, events, ctx.config.prefix, ctx.user.id, ctx.now);
  return { lots: lotsOf(ctx.db, guildId, ctx.now), news };
}

/** What finishing a building unlocks. */
const BUILT_AWARDS: Partial<Record<Kind, string>> = { park: 'green_space', station: 'all_aboard', factory: 'smokestack', barn: 'old_macdonald', police: 'law_and_order' };

/**
 * What settling turned up, in words. Anything about someone other than `me` goes to their inbox; the lines
 * about `me` are returned for the reply. Also used by the background pass (me = null: everything to inboxes).
 */
export function tellAll(db: Ctx['db'], guildId: string, events: EstateNews[], P: string, me: string | null, now = Date.now()): string[] {
  const mine: string[] = [];
  const paid = new Map<string, { rent: Cents; charges: Cents; days: number; short: boolean; goods: number }>();
  const say = (userId: string, title: string, line: string) => { if (userId === me) mine.push(line); else addInbox(db, userId, guildId, title, line, now); };
  for (const e of events) {
    if (e.kind === 'paid') {
      const p = paid.get(e.userId) ?? { rent: 0, charges: 0, days: 0, short: false, goods: 0 };
      p.rent += e.rent; p.charges += e.charges; p.days = Math.max(p.days, e.days); p.short ||= e.short; p.goods += e.goods;
      paid.set(e.userId, p);
    } else if (e.kind === 'built') {
      say(e.userId, 'Construction finished', `${kindE(e.what)} **Your ${KINDS[e.what].name} on ${tileName(e.lot)} is ${e.level > 1 ? `upgraded to level ${e.level}` : 'finished'}.** ${KINDS[e.what].perk}: ${KINDS[e.what].perkText}.`);
      award(db, guildId, e.userId, 'groundbreaking', now);
      const a = BUILT_AWARDS[e.what];
      if (a) award(db, guildId, e.userId, a, now);
      checkOwnership(db, guildId, e.userId, now);
    } else if (e.kind === 'squatters') {
      say(e.userId, 'Squatters!', `${emojiOr('squatter', '🛌')} **Squatters moved into ${tileName(e.lot)}.** No rent until they're gone: \`${P}property evict ${tileName(e.lot)}\`, or repair it to ${ESTATE.squatClearAt}%.`);
    } else if (e.kind === 'condemned') {
      say(e.userId, 'Condemned', `${emojiOr('lot_condemned', '🏚️')} **Your ${KINDS[e.what].name} on ${tileName(e.lot)} was condemned.** It fell apart, so the bank took it (and paid you ${format(e.payout)}). It's up for auction for ${ESTATE.auctionHours} hours; if nobody bids, it's torn down.`);
      award(db, guildId, e.userId, 'condemned', now);
      addMoment(`🏚️ A ${KINDS[e.what].name} was just condemned`, now);
    } else if (e.kind === 'auction_won') {
      say(e.userId, 'Auction won', `${emojiOr('sold', '🪧')} **You won the auction for ${tileName(e.lot)}** for ${format(e.cents)}. It needs work: it's at ${ESTATE.auctionCondition}%.`);
      checkOwnership(db, guildId, e.userId, now);
    } else if (e.kind === 'bought_out') {
      say(e.userId, 'Bought out', `${emojiOr('sold', '🪧')} **${tileName(e.lot)} was bought out** for ${format(e.cents)}. Nobody answered the bid in time, so it went through.`);
      say(e.buyerId, 'Your bid went through', `${emojiOr('key', '🔑')} **Your bid for ${tileName(e.lot)} went through.** It's yours, for ${format(e.cents)}.`);
      checkOwnership(db, guildId, e.buyerId, now);
    } else if (e.kind === 'freight') {
      say(e.userId, 'Freight delivered', `${emojiOr('freight', '🚂')} **Your freight train arrived.** ${[e.crops ? `${e.crops} ${e.crops === 1 ? 'crop' : 'crops'}` : null, e.goods ? `${e.goods} Goods` : null].filter(Boolean).join(' and ')} sold for **${format(e.cents)}**.${e.robbed ? ` ${emojiOr('heist', '🦹')} Robbers got away with ${format(e.robbed)} of it on the way.` : ''}`);
    }
  }
  for (const [userId, p] of paid) {
    if (p.goods > 0 && bump(db, userId, 'goods_made', p.goods) >= 1000) award(db, guildId, userId, 'industrial_revolution', now);
    if (!p.rent && !p.charges && !p.goods) continue;
    const line = `${emojiOr('receipt', '🧾')} Since you last looked: **+${format(p.rent)}** rent, **−${format(p.charges)}** upkeep and tax${p.goods ? `, ${emojiOr('goods', '📦')} **+${p.goods} Goods**` : ''}${p.short ? ' (you couldn\'t cover it all, so your buildings wore down faster)' : ''}.`;
    if (userId === me) mine.push(line);
    else if (p.short) addInbox(db, userId, guildId, 'Upkeep unpaid', `${emojiOr('tax', '🧾')} You couldn't cover your property upkeep and tax, so your buildings are wearing down faster. \`${P}property\``, now);
  }
  return mine;
}

/** Three of one kind in a row (across or down), all yours? */
function threeInARow(mine: Lot[]): boolean {
  const at = new Map(mine.map((l) => [l.lot, l.kind] as const));
  for (const l of mine) {
    const x = (l.lot - 1) % SIZE;
    if (x <= SIZE - 3 && at.get(l.lot + 1) === l.kind && at.get(l.lot + 2) === l.kind) return true;
    if (at.get(l.lot + SIZE) === l.kind && at.get(l.lot + 2 * SIZE) === l.kind) return true;
  }
  return false;
}

/** The ownership achievements, for whoever just gained or finished a building. */
export function checkOwnership(db: Ctx['db'], guildId: string, userId: string, now = Date.now()): string[] {
  const lots = lotsOf(db, guildId);
  const mine = ownedBy(lots, userId);
  const done = mine.filter((l) => l.build_until <= now);
  const notes: string[] = [];
  const give = (id: string) => { const s = award(db, guildId, userId, id, now); if (s) notes.push(s); };
  if (mine.length >= 1) give('first_home');
  if (mine.length >= 3) give('landlord');
  if (mine.length >= 10) give('urban_sprawl');
  if (mine.length >= 16) give('monopoly');
  if (done.some((l) => l.kind === 'mansion')) give('lord_of_the_manor');
  if (threeInARow(mine)) give('full_house');
  if (done.some((l) => l.level >= 3)) give('skyline');
  if (KIND_ORDER.every((k) => done.some((l) => l.kind === k))) give('mogul');
  const mineAt = new Set(mine.map((l) => l.lot));
  if (mine.some((l) => { const n = around(l.lot); return n.length >= 3 && n.every((t) => mineAt.has(t)); })) give('good_neighbors');
  const stations = done.filter((l) => l.kind === 'station');
  if (stations.length && mine.filter((l) => l.kind !== 'station' && stations.some((s) => distance(s.lot, l.lot) <= ESTATE.railRange)).length >= 8) give('transcontinental');
  if (notes.some((n) => n.includes('Monopoly, Baby!'))) addMoment('🏙️ Someone owns a quarter of a whole city. Monopoly, baby!', now);
  else if (notes.some((n) => n.includes('Mogul'))) addMoment('🎩 Someone owns one of every building in town', now);
  return notes;
}

const tileArg = (ctx: Ctx, raw: unknown): number => {
  const t = parseTile(raw);
  if (!t) throw new GameError('estate.tile', `Pick a tile like **C4** (columns A–H, rows 1–8). See the map: \`${ctx.config.prefix}property map\`.`);
  return t;
};
const KIND_WORDS: Record<string, Kind> = {
  house: 'shack', home: 'shack', hut: 'shack', apartments: 'apartment', flat: 'apartment', flats: 'apartment', store: 'shop', 'corner shop': 'shop', cornershop: 'shop',
  railroad: 'station', railway: 'station', train: 'station', rail: 'station', 'train station': 'station', trainstation: 'station', plant: 'factory',
  bankbranch: 'bank', 'bank branch': 'bank', branch: 'bank', storage: 'warehouse', garden: 'park', 'police station': 'police', policestation: 'police', cops: 'police', precinct: 'police'
};
export function findKind(raw: string): Kind | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t in KINDS) return t as Kind;
  if (KIND_WORDS[t]) return KIND_WORDS[t]!;
  return KIND_ORDER.find((k) => [KINDS[k].name, KINDS[k].plural].some((n) => n.toLowerCase() === t)) ?? KIND_ORDER.find((k) => t.length >= 3 && k.startsWith(t)) ?? null;
}
const mineOnly = (ctx: Ctx, l: Lot | undefined, t: number): Lot => {
  if (!l || l.status !== 'owned' || l.owner_id !== ctx.user.id) throw new GameError('estate.notyours', `${tileName(t)} isn't yours.`);
  return l;
};
const finishedOnly = (ctx: Ctx, l: Lot): void => {
  if (l.build_until > ctx.now) throw new GameError('estate.building', `${tileName(l.lot)} is still under construction (done ${discordTime(l.build_until)}).`);
};

function summary(ctx: Ctx, guildId: string, lots: Lot[], news: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const mine = ownedBy(lots, ctx.user.id);
  const bonus = isBuilt(ctx.db, guildId, 'statue') ? STATUE_RENT : 0;
  if (!mine.length) {
    const open = TILES - lots.length;
    return { embeds: [embed('property', `${emojiOr('property', '🏠')} Your property`, [
      ...news,
      'You don\'t own any buildings yet.',
      '',
      `${open} of ${TILES} tiles on the map are open land. Pick one and build: \`${P}property build C4 shack\`.`,
      `See the map with \`${P}property map\`, and what each building does with \`${P}property buildings\`.`
    ])] };
  }
  const rate = taxRate(mine.length);
  let rent = 0, upkeep = 0, tax = 0, goods = 0;
  const rows = mine.map((l) => {
    const fx = effects(lots, l, ctx.now);
    const busy = l.build_until > ctx.now;
    const r = busy ? 0 : dayRent(l, fx, bonus);
    if (!busy) { rent += r; upkeep += upkeepAt(l.kind, l.level); tax += Math.floor(value(l) * rate); goods += goodsPerDay(l); }
    const tags = [
      busy ? `${emojiOr('construction', '🚧')} ${l.level > 1 ? 'upgrading' : 'building'}, done ${discordTime(l.build_until)}` : null,
      l.squatters ? `${emojiOr('squatter', '🛌')} squatters` : null,
      l.bidder_id ? `${emojiOr('bid', '✉️')} bid ${format(l.bid_cents)} (answer by ${discordTime(l.bid_until!)})` : null,
      l.shield_until > ctx.now ? `🛡️ shielded until ${discordTime(l.shield_until, 'f')}` : null,
      l.kind === 'shop' && l.storefront ? `storefront: ${l.storefront}` : null,
      !busy && fx.notes.length ? fx.notes.join(' ') : null
    ].filter(Boolean);
    const earns = busy ? '' : l.kind === 'factory' ? ` · ${goodsPerDay(l)} Goods/day` : r ? ` · ${format(r)}/day` : '';
    return `${tile(l, ctx.now)} ${where(l)} ${KINDS[l.kind].name}${stars(l)} · ${pct(l.condition)}${earns}${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
  });
  return { embeds: [embed('property', `${emojiOr('property', '🏠')} Your property`, [
    ...news,
    ...(news.length ? [''] : []),
    ...rows,
    '',
    `Rent **${format(rent)}**/day · upkeep **${format(upkeep)}** · tax **${format(tax)}** (${(rate * 100).toFixed(1).replace(/\.0$/, '')}% for ${mine.length} ${mine.length === 1 ? 'building' : 'buildings'})${goods ? ` · ${emojiOr('goods', '📦')} ${goods} Goods/day` : ''}`,
    `Net: **${rent - upkeep - tax >= 0 ? '+' : '−'}${format(Math.abs(rent - upkeep - tax))}** a day, before repairs.`,
    bonus ? `-# 🗿 The TODD Statue adds ${STATUE_RENT * 100}% rent to every building here.` : null,
    `-# \`${P}property map\` · \`${P}property build <tile> <building>\` · \`${P}property upgrade <tile>\` · \`${P}property repair all\` · \`${P}property info <tile>\``
  ])] };
}

/** The 8×8 grid as emoji, with column letters across the top and row numbers down the side. */
export function gridText(lots: Lot[], now: number): string {
  const letters = ['🇦', '🇧', '🇨', '🇩', '🇪', '🇫', '🇬', '🇭'];
  const nums = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
  const rows = [`⬛${letters.join('​')}`];
  for (let y = 0; y < SIZE; y++) rows.push(nums[y] + Array.from({ length: SIZE }, (_, x) => tile(lotAt(lots, y * SIZE + x + 1), now)).join(''));
  return rows.join('\n');
}

function mapView(ctx: Ctx, guildId: string, lots: Lot[], news: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const built = finished(ctx.db, guildId);
  const owners = new Set(lots.filter((l) => l.status === 'owned').map((l) => l.owner_id));
  const counts = KIND_ORDER.map((k) => [k, lots.filter((l) => l.kind === k && l.status === 'owned').length] as const).filter(([, n]) => n);
  const auctions = lots.filter((l) => l.status === 'auction');
  const trains = trainsOf(ctx.db, guildId, ctx.now);
  return { embeds: [embed('property', `${emojiOr('property', '🏠')} The city`, [
    ...news, ...(news.length ? [''] : []),
    built.length ? `**Skyline:** ${built.map((l) => `${emojiOr(`landmark_${l.id}`, l.emoji)} ${l.name}`).join(' · ')}` : null,
    gridText(lots, ctx.now), '',
    lots.length ? `${lots.length} of ${TILES} tiles built on, by ${owners.size} ${owners.size === 1 ? 'player' : 'players'}: ${counts.map(([k, n]) => `${kindE(k)} ${n}`).join(' ')}` : `Open land, all ${TILES} tiles. Be the first to build: \`${P}property build C4 shack\`.`,
    ...auctions.map((l) => `${emojiOr('auction', '🔨')} ${where(l)} condemned ${KINDS[l.kind].name} at auction: ${l.bidder_id ? `top bid ${format(l.bid_cents)}` : `from ${format(minBid(l))}`}, ends ${discordTime(l.auction_until!)}`),
    trains.length ? `${emojiOr('freight', '🚂')} ${trains.length} freight ${trains.length === 1 ? 'train is' : 'trains are'} on the rails right now.` : null,
    '',
    `-# \`${P}property info <tile>\` · \`${P}property build <tile> <building>\` · \`${P}property buildings\` · \`${P}property landmark\``
  ])] };
}

function buildingsView(ctx: Ctx): ReplyObject {
  const P = ctx.config.prefix;
  return { embeds: [embed('property', '🏗️ What you can build', [
    `Every building costs its price plus **${format(ESTATE.land)}** for the land, and takes real time to build. Most can be upgraded twice (rent ×1.6, then ×2.4).`, '',
    ...KIND_ORDER.map((k) => {
      const K = KINDS[k];
      const money = K.rent ? `${format(K.rent)}/day rent` : k === 'factory' ? `${ESTATE.goodsPerDay} Goods/day` : 'no rent';
      return `${kindE(k)} **${K.name}** · ${format(K.price)} · ${money} · upkeep ${format(K.upkeep)} · ${K.buildHours}h\n-# ${K.perk}: ${K.perkText}.`;
    }),
    '',
    '**Neighbors** (the 8 tiles around): 🌳 Park +15% each (up to 2) · 🏭 Factory −15% each and faster wear (not on Stations, Factories, Warehouses) · 🚉 a Station within 2 tiles +10% · 🏪 Shops +5% per home next door · 🚓 no squatters next to a Police Station.',
    `-# \`${P}property build <tile> <building>\`, like \`${P}property build D5 park\``
  ])] };
}

function info(ctx: Ctx, guildId: string, lots: Lot[], t: number): ReplyObject {
  const P = ctx.config.prefix;
  const l = lotAt(lots, t);
  const near = around(t).map((x) => lotAt(lots, x)).filter((x): x is Lot => !!x);
  const nearLine = near.length ? `Next door: ${near.map((x) => `${tile(x, ctx.now)} ${tileName(x.lot)}`).join(' · ')}` : 'Nothing next door yet.';
  if (!l) {
    return { embeds: [embed('property', `${tileName(t)}: open land`, [
      `${emojiOr('tile_empty', '🟩')} Nobody has built here. Build anything: \`${P}property build ${tileName(t)} <building>\` (\`${P}property buildings\` lists them).`,
      isEdge(t) ? '🌊 On the edge of the map: a Lighthouse can go here.' : null,
      '', nearLine
    ])] };
  }
  const K = KINDS[l.kind];
  const fx = effects(lots, l, ctx.now);
  const bonus = isBuilt(ctx.db, guildId, 'statue') ? STATUE_RENT : 0;
  const next = upgradeCost(l);
  return { embeds: [embed('property', `${tileName(t)}: ${K.name}${stars(l)}`, [
    `${tile(l, ctx.now)} Worth **${format(value(l))}** · ${K.rent ? `rent up to **${format(rentAt(l.kind, l.level))}**/day` : l.kind === 'factory' ? `**${ESTATE.goodsPerDay * l.level}** Goods/day` : 'no rent'} · upkeep **${format(upkeepAt(l.kind, l.level))}**/day`,
    `**${K.perk}:** ${K.perkText}.`,
    '',
    l.status === 'auction'
      ? `Condemned and at auction until ${discordTime(l.auction_until!)}. ${l.bidder_id ? `Top bid ${format(l.bid_cents)}.` : 'No bids yet.'} Next bid at least **${format(minBid(l))}**: \`${P}property bid ${tileName(t)} <amount>\``
      : `Owned by **${nameOf(ctx.db, guildId, l.owner_id, ctx.user.id)}** · condition ${pct(l.condition)}${l.squatters ? ' · squatters' : ''}${l.build_until > ctx.now ? ` · ${emojiOr('construction', '🚧')} under construction until ${discordTime(l.build_until)}` : ` · earning ${format(dayRent(l, fx, bonus))}/day`}.`,
    fx.notes.length ? `Neighbors: ${fx.notes.join(' · ')}` : null,
    nearLine,
    l.status === 'owned' && l.owner_id === ctx.user.id && next !== null ? `-# Upgrade to level ${l.level + 1}: ${format(next)}, ${Math.round(upgradeMs(l.kind) / HOUR * 10) / 10}h · \`${P}property upgrade ${tileName(t)}\`` : null,
    l.status === 'owned' && l.owner_id !== ctx.user.id
      ? (l.shield_until > ctx.now ? `🛡️ Shielded from bids until ${discordTime(l.shield_until)}.` : `A buyout bid has to be at least **${format(minBid(l))}**${l.bidder_id ? ` (there's one open at ${format(l.bid_cents)})` : ''}.`)
      : null
  ])] };
}

function landmarkView(ctx: Ctx, guildId: string, top: string[] = []): ReplyObject {
  const P = ctx.config.prefix;
  const built = finished(ctx.db, guildId);
  const c = current(ctx.db, guildId);
  const bar = (x: number) => { const n = Math.round(Math.min(1, x) * 12); return '▰'.repeat(n) + '▱'.repeat(12 - n); };
  const lines: (string | null)[] = [
    ...top, ...(top.length ? [''] : []),
    'The whole server builds these together, one after another. Every Polygon donated leaves the economy for good, and every finished landmark gives everyone here a perk.', '',
    ...LANDMARKS.map((l, i) => {
      const done = built.some((b) => b.id === l.id);
      const now = c?.idx === i;
      return `${emojiOr(`landmark_${l.id}`, l.emoji)} **${l.name}** · ${format(l.cost)}${done ? ' · ✅ **built**' : now ? ' · **funding now**' : ' · locked'}\n-# ${l.perk}`;
    })
  ];
  if (c) {
    const top5 = donors(ctx.db, guildId, c.idx);
    lines.push('', `**${c.l.name}**: ${bar(c.funded / c.l.cost)} ${format(c.funded)} of ${format(c.l.cost)} (${Math.floor(c.funded / c.l.cost * 100)}%)`);
    if (top5.length) lines.push(`Top donors: ${top5.map((d, i) => `${i + 1}. ${nameOf(ctx.db, guildId, d.user_id, ctx.user.id)} ${compact(d.cents)}`).join(' · ')}`);
    lines.push(`-# \`${P}property landmark donate <amount>\``);
  } else lines.push('', '🎉 All three landmarks stand over this server. Nothing left to build... for now.');
  return { embeds: [embed('property', '🏟️ Build It and They Will Come', lines)] };
}

export const property: Command = {
  name: 'property', aliases: ['estate', 'realestate', 'prop', 'properties', 'lots', 'city', 'build'], system: 'property', guildOnly: true,
  description: 'The city: your buildings, the map, building and upgrading, freight, bids, auctions and landmarks',
  options: [
    { name: 'action', type: 'string', description: 'Blank for yours, or: map, buildings, build, upgrade, sell, teardown, repair, wholesale, evict, bid, accept, refuse, storefront, party, freight, goods, landmark, info' },
    { name: 'lot', type: 'string', description: 'A tile like C4 (or "all" for repair)' },
    { name: 'amount', type: 'string', description: 'For build or teardown: the building. For bid or donate: Polygons. For storefront: a company ticker' }
  ],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix;
    let action = String(args.action ?? '').trim().toLowerCase();
    // "r!property c4" or "r!build c4 park"
    if (parseTile(action)) { args = { ...args, amount: args.lot ?? args.amount, lot: action }; action = args.amount ? 'build' : 'info'; }
    return ctx.db.tx(() => {
      const { lots, news } = catchUp(ctx, guildId);
      const at = (raw: unknown) => { const t = tileArg(ctx, raw); return { t, l: lotAt(lots, t) }; };
      const done = (title: string, lines: (string | null | false)[]): ReplyObject => ({ embeds: [embed('property', title, [...news, ...(news.length ? [''] : []), ...lines])] });

      if (!action || action === 'mine' || action === 'me') return summary(ctx, guildId, lots, news);
      if (action === 'map' || action === 'list' || action === 'all' || action === 'city') return mapView(ctx, guildId, lots, news);
      if (action === 'buildings' || action === 'types' || action === 'help' || action === 'catalog') return buildingsView(ctx);
      if (action === 'info' || action === 'look') return info(ctx, guildId, lots, tileArg(ctx, args.lot));

      if (action === 'build' || action === 'buy' || action === 'construct') {
        const { t, l } = at(args.lot);
        const k = findKind(String(args.amount ?? ''));
        if (!k) throw new GameError('estate.kind', `Build what? ${KIND_ORDER.map((x) => `\`${x}\``).join(', ')}. Like \`${P}property build ${tileName(t)} shack\`. See them all: \`${P}property buildings\`.`);
        if (l) throw new GameError('estate.taken', l.status === 'auction' ? `${tileName(t)} is a condemned ${KINDS[l.kind].name} at auction. Bid on it: \`${P}property bid ${tileName(t)} <amount>\`.`
          : l.owner_id === ctx.user.id ? `${tileName(t)} is already yours.` : `${tileName(t)} belongs to ${nameOf(ctx.db, guildId, l.owner_id)}. Make them an offer: \`${P}property bid ${tileName(t)} <amount>\` (at least ${format(minBid(l))}).`);
        if (k === 'lighthouse' && !isEdge(t)) throw new GameError('estate.edge', 'A Lighthouse has to go on the edge of the map (column A or H, or row 1 or 8).');
        if (k === 'barn' && ownedBy(lots, ctx.user.id).some((x) => x.kind === 'barn')) throw new GameError('estate.barn', 'You already have a Barn. One is all a farm needs.');
        const cost = KINDS[k].price + ESTATE.land;
        if (balance(ctx.db, wallet) < cost) throw new GameError('funds.short', `A ${KINDS[k].name} on ${tileName(t)} costs ${format(cost)} (${format(KINDS[k].price)} + ${format(ESTATE.land)} for the land). You have ${format(balance(ctx.db, wallet))}.`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: cost, reason: 'estate.build', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t, kind: k } });
        const nl = newLot(guildId, t, k, ctx.user.id, ctx.now, cost);
        saveLot(ctx.db, nl);
        // Not in My Backyard: a Factory next to someone else's place
        if (k === 'factory') for (const x of around(t).map((y) => lotAt(lots, y))) if (x?.status === 'owned' && x.owner_id && x.owner_id !== ctx.user.id) {
          award(ctx.db, guildId, x.owner_id, 'not_in_my_backyard', ctx.now);
          addInbox(ctx.db, x.owner_id, guildId, 'A new neighbor', `${kindE('factory')} **${ctx.user.name} is building a Factory on ${tileName(t)}**, right next to your ${KINDS[x.kind].name} on ${tileName(x.lot)}. ${KINDS[x.kind].industrial ? 'Industrial buildings don\'t mind the smoke.' : `Expect ${ESTATE.pollution * 100}% less rent and faster wear.`}`, ctx.now);
        }
        const n = ownedBy(lotsOf(ctx.db, guildId), ctx.user.id).length;
        checkOwnership(ctx.db, guildId, ctx.user.id, ctx.now);
        const fx = effects(lotsOf(ctx.db, guildId), nl, nl.build_until);
        return done(`${emojiOr('construction', '🚧')} Breaking ground on ${tileName(t)}`, [
          `${kindE(k)} You bought the land on ${where(nl)} and started building a **${KINDS[k].name}** for **${format(cost)}**. It's done ${discordTime(nl.build_until)} (${KINDS[k].buildHours}h).`,
          `${KINDS[k].rent ? `Rent up to **${format(KINDS[k].rent)}** a day` : k === 'factory' ? `**${ESTATE.goodsPerDay}** Goods a day` : 'No rent'}, **${format(KINDS[k].upkeep)}** a day to keep up. **${KINDS[k].perk}:** ${KINDS[k].perkText}.`,
          fx.notes.length ? `Neighbors: ${fx.notes.join(' · ')}` : null,
          taxRate(n) > taxRate(n - 1) ? `${emojiOr('tax', '🧾')} With ${n} buildings, your property tax is now **${taxRate(n) * 100}%** of their value a day.` : null
        ]);
      }

      if (action === 'upgrade' || action === 'level' || action === 'levelup') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t); finishedOnly(ctx, x);
        const cost = upgradeCost(x);
        if (cost === null) throw new GameError('estate.max', KINDS[x.kind].maxLevel === 1 ? `A ${KINDS[x.kind].name} doesn't have levels.` : `Your ${KINDS[x.kind].name} on ${tileName(t)} is already at the top level.`);
        if (x.squatters) throw new GameError('estate.squat', `There are squatters in ${tileName(t)}. Evict them first.`);
        if (balance(ctx.db, wallet) < cost) throw new GameError('funds.short', `Level ${x.level + 1} costs ${format(cost)}. You have ${format(balance(ctx.db, wallet))}.`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: cost, reason: 'estate.upgrade', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t, level: x.level + 1 } });
        const until = ctx.now + upgradeMs(x.kind);
        Object.assign(x, { level: x.level + 1, spent: x.spent + cost, condition: 100, built_at: ctx.now, build_until: until, settled_at: Math.max(x.settled_at, until) });
        saveLot(ctx.db, x);
        return done(`${emojiOr('construction', '🚧')} Upgrading ${tileName(t)}`, [
          `${kindE(x.kind)} The crews are back: your **${KINDS[x.kind].name}** goes to **level ${x.level}** for **${format(cost)}**, done ${discordTime(until)}. It's fixed up to 100% along the way.`,
          x.kind === 'factory' ? `It will make **${ESTATE.goodsPerDay * x.level}** Goods a day.` : KINDS[x.kind].rent ? `Rent goes up to **${format(rentAt(x.kind, x.level))}** a day (upkeep ${format(upkeepAt(x.kind, x.level))}).` : null,
          '-# No rent while the work is going on.'
        ]);
      }

      // Refined Everything!: tear down and build something else, keeping the land
      if (action === 'teardown' || action === 'demolish' || action === 'raze' || action === 'bulldoze' || action === 'rebuild') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        const k = findKind(String(args.amount ?? ''));
        const salvage = salvagePrice(x);
        if (!k) throw new GameError('estate.kind', `Tear down your ${KINDS[x.kind].name} and build what instead? Like \`${P}property teardown ${tileName(t)} shack\`. The crew pays **${format(salvage)}** in salvage and you keep the land. (Or sell it all to the bank for ${format(sellPrice(x))}: \`${P}property sell ${tileName(t)}\`.)`);
        if (k === x.kind) throw new GameError('estate.same', `It's already a ${KINDS[k].name}. Fix it up instead: \`${P}property repair ${tileName(t)}\`.`);
        if (k === 'lighthouse' && !isEdge(t)) throw new GameError('estate.edge', 'A Lighthouse has to go on the edge of the map (column A or H, or row 1 or 8).');
        if (k === 'barn' && ownedBy(lots, ctx.user.id).some((y) => y.kind === 'barn' && y.lot !== t)) throw new GameError('estate.barn', 'You already have a Barn. One is all a farm needs.');
        const cost = KINDS[k].price;
        if (balance(ctx.db, wallet) + salvage < cost) throw new GameError('funds.short', `A ${KINDS[k].name} costs ${format(cost)}. With ${format(salvage)} in salvage you'd still need ${format(cost - salvage - balance(ctx.db, wallet))} more.`);
        refundBid(ctx.db, x, ctx.now);
        const paid = salvage > 0 ? payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: salvage, reason: 'estate.teardown', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t, kind: x.kind } }) : 0;
        if (balance(ctx.db, wallet) < cost) throw new GameError('funds.short', `The Reserve is low, so the salvage came to ${format(paid)}: you need ${format(cost - balance(ctx.db, wallet))} more for a ${KINDS[k].name}.`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: cost, reason: 'estate.rebuild', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t, kind: k } });
        const nl = newLot(guildId, t, k, ctx.user.id, ctx.now, cost + ESTATE.land);
        saveLot(ctx.db, nl);
        if (k === 'factory') for (const y of around(t).map((z) => lotAt(lots, z))) if (y?.status === 'owned' && y.owner_id && y.owner_id !== ctx.user.id) {
          award(ctx.db, guildId, y.owner_id, 'not_in_my_backyard', ctx.now);
          addInbox(ctx.db, y.owner_id, guildId, 'A new neighbor', `${kindE('factory')} **${ctx.user.name} is building a Factory on ${tileName(t)}**, right next to your ${KINDS[y.kind].name} on ${tileName(y.lot)}. ${KINDS[y.kind].industrial ? 'Industrial buildings don\'t mind the smoke.' : `Expect ${ESTATE.pollution * 100}% less rent and faster wear.`}`, ctx.now);
        }
        checkOwnership(ctx.db, guildId, ctx.user.id, ctx.now);
        return done(`${emojiOr('construction', '🚧')} Rebuilding ${tileName(t)}`, [
          `${kindE(x.kind)} The **${KINDS[x.kind].name}** comes down (the crew pays **${format(paid)}** in salvage), and a **${KINDS[k].name}** goes up for **${format(cost)}**. ${kindE(k)} Done ${discordTime(nl.build_until)} (${KINDS[k].buildHours}h).`,
          `${KINDS[k].rent ? `Rent up to **${format(KINDS[k].rent)}** a day` : k === 'factory' ? `**${ESTATE.goodsPerDay}** Goods a day` : 'No rent'}, **${format(KINDS[k].upkeep)}** a day to keep up. **${KINDS[k].perk}:** ${KINDS[k].perkText}.`
        ]);
      }

      if (action === 'sell') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        const price = sellPrice(x);
        refundBid(ctx.db, x, ctx.now);
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: price, reason: 'estate.sell', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t } });
        clearLot(ctx.db, guildId, t);
        return done(`${emojiOr('sold', '🪧')} ${tileName(t)} sold`, [`The bank bought your **${KINDS[x.kind].name}** for **${format(paid)}**${paid < price ? ` (the Reserve is low, so it paid less than the ${format(price)} it's worth)` : ''} and tore it down. ${tileName(t)} is open land again.`]);
      }

      if (action === 'repair' || action === 'fix') {
        const all = /^all$/i.test(String(args.lot ?? '').trim());
        let targets: Lot[];
        if (all) targets = ownedBy(lots, ctx.user.id).filter((l) => l.condition < 100);
        else { const { t, l } = at(args.lot); targets = [mineOnly(ctx, l, t)]; }
        if (!targets.length) throw new GameError('estate.fine', 'Everything you own is already in perfect shape.');
        const lines: string[] = [];
        let spent = 0;
        for (const l of targets) {
          const before = l.condition;
          if (before >= 100) { lines.push(`${tileName(l.lot)} is already at 100%.`); continue; }
          const full = repairCost(l);
          const have = balance(ctx.db, wallet);
          if (have <= 0) { lines.push(`${tileName(l.lot)}: you're out of Polygons.`); break; }
          const cost = Math.min(full, have);
          const to = cost >= full ? 100 : before + Math.floor(cost / (value(l) * ESTATE.repairPerPoint));
          const pay = cost >= full ? full : Math.ceil((to - before) * value(l) * ESTATE.repairPerPoint);
          if (to <= before) { lines.push(`${tileName(l.lot)}: you can't afford any repairs.`); break; }
          transfer(ctx.db, { from: wallet, to: RESERVE, cents: pay, reason: 'estate.repair', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
          spent += pay;
          l.condition = to;
          let extra = '';
          if (l.squatters && to >= ESTATE.squatClearAt) { l.squatters = 0; extra = ' The squatters packed up when the hammering started.'; }
          if (before < 25 && to >= 100) awardHere('fixer_upper');
          saveLot(ctx.db, l);
          lines.push(`${kindE(l.kind)} ${tileName(l.lot)}: ${pct(before)} → **${pct(to)}** for ${format(pay)}.${extra}`);
        }
        return done(`${emojiOr('repair', '🔨')} Repairs`, [...lines, '', `Spent **${format(spent)}**.`]);
      }

      if (action === 'evict') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        if (!x.squatters) throw new GameError('estate.nosquat', `Nobody is squatting on ${tileName(t)}.`);
        const cost = Math.max(rentAt(x.kind, x.level), ESTATE.land / 10) * ESTATE.evictDays;
        if (balance(ctx.db, wallet) < cost) throw new GameError('funds.short', `Evicting them costs ${format(cost)} (${ESTATE.evictDays} days of rent).`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: cost, reason: 'estate.evict', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t } });
        x.squatters = 0; saveLot(ctx.db, x);
        return done(`${emojiOr('evict', '🚪')} Squatters evicted`, [`${tileName(t)} is clear, for **${format(cost)}**. ${x.condition < ESTATE.squatBelow ? `It's still at ${pct(x.condition)}, so they may come back. \`${P}property repair ${tileName(t)}\`` : 'Business as usual tomorrow.'}`]);
      }

      if (action === 'bid' || action === 'offer') {
        const { t, l } = at(args.lot);
        if (!l) throw new GameError('estate.open', `${tileName(t)} is open land. Just build on it: \`${P}property build ${tileName(t)} <building>\`.`);
        if (l.owner_id === ctx.user.id) throw new GameError('estate.own', `${tileName(t)} is already yours.`);
        if (l.bidder_id === ctx.user.id) throw new GameError('estate.already', `You already have the top bid on ${tileName(t)} (${format(l.bid_cents)}).`);
        const min = minBid(l);
        const cents = parseAmount(args.amount as string | undefined, { all: balance(ctx.db, wallet) });
        if (cents < min) throw new GameError('estate.low', `The bid has to be at least **${format(min)}**.`);
        if (balance(ctx.db, wallet) < cents) throw new GameError('funds.short', `You have ${format(balance(ctx.db, wallet))}.`);
        if (l.status === 'auction') {
          const prev = l.bidder_id;
          placeBid(ctx.db, l, ctx.user.id, cents, l.bid_until ?? l.auction_until!, ctx.now);
          saveLot(ctx.db, l);
          if (prev) addInbox(ctx.db, prev, guildId, 'Outbid', `${emojiOr('auction', '🔨')} You were outbid on ${tileName(t)} (${format(cents)}). Your bid is back in your wallet.`, ctx.now);
          return done(`${emojiOr('auction', '🔨')} Bid placed`, [`You're the top bidder on the condemned ${KINDS[l.kind].name} on ${tileName(t)} at **${format(cents)}**. The auction ends ${discordTime(l.auction_until!)}. Your Polygons are held until then (refunded if you're outbid).`]);
        }
        if (l.shield_until > ctx.now) throw new GameError('estate.shield', `${tileName(t)} is shielded from bids until ${discordTime(l.shield_until)}.`);
        const prev = l.bidder_id;
        placeBid(ctx.db, l, ctx.user.id, cents, ctx.now + ESTATE.bidHours * HOUR, ctx.now);
        saveLot(ctx.db, l);
        if (prev) addInbox(ctx.db, prev, guildId, 'Outbid', `${emojiOr('bid', '✉️')} Someone outbid you on ${tileName(t)} (${format(cents)}). Your bid is back in your wallet.`, ctx.now);
        addInbox(ctx.db, l.owner_id!, guildId, 'A buyout bid', `${emojiOr('bid', '✉️')} **${ctx.user.name} bid ${format(cents)} for ${tileName(t)}** (your ${KINDS[l.kind].name}). Accept: \`${P}property accept ${tileName(t)}\`. Refuse (costs ${format(Math.ceil(cents * ESTATE.refuseFee))}): \`${P}property refuse ${tileName(t)}\`. No answer by ${discordTime(l.bid_until!)} and it's sold.`, ctx.now);
        return done(`${emojiOr('bid', '✉️')} Bid sent`, [
          `You bid **${format(cents)}** for ${tileName(t)} (${nameOf(ctx.db, guildId, l.owner_id)}'s ${KINDS[l.kind].name}). Your Polygons are held until it's settled.`,
          `They have until ${discordTime(l.bid_until!)} to answer. If they refuse, they pay you **${format(Math.ceil(cents * ESTATE.refuseFee))}** and get a ${ESTATE.shieldDays}-day shield. If they don't answer, it's yours.`
        ]);
      }

      if (action === 'accept') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        if (!x.bidder_id) throw new GameError('estate.nobid', `There's no bid on ${tileName(t)}.`);
        const buyer = x.bidder_id, cents = x.bid_cents;
        buyout(ctx.db, x, ctx.now, []);
        saveLot(ctx.db, x);
        addInbox(ctx.db, buyer, guildId, 'Bid accepted', `${emojiOr('key', '🔑')} **Your bid for ${tileName(t)} was accepted.** It's yours, for ${format(cents)}.`, ctx.now);
        checkOwnership(ctx.db, guildId, buyer, ctx.now);
        return done(`${emojiOr('sold', '🪧')} Sold`, [`You sold ${tileName(t)} to **${nameOf(ctx.db, guildId, buyer)}** for **${format(cents)}**.`]);
      }

      if (action === 'refuse' || action === 'decline' || action === 'reject') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        if (!x.bidder_id) throw new GameError('estate.nobid', `There's no bid on ${tileName(t)}.`);
        const smoke = useCharge(ctx.db, guildId, ctx.user.id, 'smoke');   // No Questions Asked: a Smoke Bomb skips the fee
        const fee = smoke ? 0 : Math.ceil(x.bid_cents * ESTATE.refuseFee);
        if (balance(ctx.db, wallet) < fee) throw new GameError('funds.short', `Refusing costs ${format(fee)} (${ESTATE.refuseFee * 100}% of the bid). You have ${format(balance(ctx.db, wallet))}.`);
        const bidder = x.bidder_id;
        if (fee > 0) transfer(ctx.db, { from: wallet, to: walletOf(guildId, bidder), cents: fee, reason: 'estate.refuse', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: t } });
        refundBid(ctx.db, x, ctx.now);
        x.shield_until = ctx.now + ESTATE.shieldDays * DAY;
        saveLot(ctx.db, x);
        addInbox(ctx.db, bidder, guildId, 'Bid refused', smoke ? `${emojiOr('smoke_bomb', '💨')} Your bid for ${tileName(t)} was refused. There was a lot of smoke. You got your bid back.` : `${emojiOr('bid', '✉️')} Your bid for ${tileName(t)} was refused. You got it back, plus **${format(fee)}** for your trouble.`, ctx.now);
        return done(`🛡️ Bid refused`, [smoke ? `${emojiOr('smoke_bomb', '💨')} **Smoke Bomb!** By the time it clears, the bid's gone and you didn't pay a thing. ${tileName(t)} is shielded from bids until ${discordTime(x.shield_until)}.` : `You paid **${format(fee)}** to keep ${tileName(t)}. It's shielded from bids until ${discordTime(x.shield_until)}.`]);
      }

      if (action === 'storefront') {
        const { t, l } = at(args.lot); const x = mineOnly(ctx, l, t);
        if (x.kind !== 'shop') throw new GameError('estate.notshop', 'Only Corner Shops have a storefront.');
        const tk = String(args.amount ?? '').trim().toUpperCase();
        if (!tk || tk === 'NONE' || tk === 'OFF') { x.storefront = null; saveLot(ctx.db, x); return done('Storefront', [`${tileName(t)}'s storefront is empty again.`]); }
        const c = getCompany(ctx.db, tk);
        if (!alive(c)) throw new GameError('estate.company', `No player company called ${tk}. See them: \`${P}exchange\`.`);
        x.storefront = c.ticker; saveLot(ctx.db, x);
        return done('Storefront', [`${kindE('shop')} **${c.name} (${c.ticker})** now runs the storefront on ${tileName(t)}. It earns ${ESTATE.storefrontCut * 100}% of the shop's rent (paid by the Reserve, not you).`]);
      }

      if (action === 'party' || action === 'ballroom') {
        const mansion = ownedBy(lots, ctx.user.id).find((l) => l.kind === 'mansion' && l.build_until <= ctx.now && !l.squatters);
        if (!mansion) throw new GameError('estate.nomansion', ownedBy(lots, ctx.user.id).some((l) => l.kind === 'mansion') ? 'Your Mansion isn\'t ready for guests (still being built, or there are squatters in the ballroom).' : 'You need a Mansion to throw a party.');
        const until = partyUntil(ctx.db, guildId);
        if (until > ctx.now) throw new GameError('estate.party', `The party's already going until ${discordTime(until)}.`);
        const key = `estate.partyday:${guildId}:${ctx.user.id}`;
        if (ctx.db.meta(key) === dayKey(ctx.now)) throw new GameError('estate.partied', 'The Ballroom needs a day to recover. Throw another party tomorrow.');
        ctx.db.setMeta(key, dayKey(ctx.now));
        const end = startParty(ctx.db, guildId, ctx.now);
        addMoment('🎉 There\'s a party at a Mansion. Chat pay is doubled there', ctx.now);
        return done(`${kindE('mansion')} Party at the Mansion!`, [`**${ctx.user.name}** threw open the Ballroom on ${tileName(mansion.lot)}. **Chat pay is doubled for everyone here** until ${discordTime(end)}. 🎉`]);
      }

      if (action === 'freight' || action === 'ship' || action === 'train') {
        if (!perkLevel(ctx.db, guildId, ctx.user.id, 'station', ctx.now)) throw new GameError('estate.nostation', `You need a finished Station of your own to ship freight. \`${P}property build <tile> station\``);
        const last = lastShipment(ctx.db, guildId, ctx.user.id);
        if (last + ESTATE.freightGapMs > ctx.now) throw new GameError('estate.freightwait', `Your next train can leave ${discordTime(last + ESTATE.freightGapMs)}.`);
        const crops = basket(ctx, guildId);
        const goods = count(ctx.db, guildId, ctx.user.id, 'goods');
        const n = crops.reduce((s, r) => s + r.qty, 0);
        if (!n && !goods) throw new GameError('estate.nothing', `Nothing to ship. Freight takes your whole crop basket and your Goods (Factories make them).`);
        const days = coldDays(ctx, guildId);
        const cropCents = Math.round(crops.reduce((s, r) => s + rollSale(r.c, r.qty, ctx.now, ctx.rng, days).total, 0) * (1 + ESTATE.freightBonus));
        const goodsCents = goods * ESTATE.freightGoods;
        for (const r of crops) takeItem(ctx.db, guildId, ctx.user.id, r.item, r.qty);
        if (goods) takeItem(ctx.db, guildId, ctx.user.id, 'goods', goods);
        const f = ship(ctx.db, guildId, ctx.user.id, cropCents + goodsCents, n, goods, ctx.now);
        awardHere('special_delivery');
        addMoment(`🚂 A freight train just left a station with ${compact(f.cents)} on board`, ctx.now);
        return done(`${emojiOr('freight', '🚂')} All aboard!`, [
          `Your freight train pulls out with ${[n ? `**${n}** ${n === 1 ? 'crop' : 'crops'} (${format(cropCents)}, ${ESTATE.freightBonus * 100}% over market)` : null, goods ? `**${goods}** Goods (${format(goodsCents)})` : null].filter(Boolean).join(' and ')}.`,
          `It arrives ${discordTime(f.arrives_at)} and pays **${format(f.cents)}**. Until then it's on open track, and trains do get robbed.`,
          `-# One train every ${ESTATE.freightGapMs / HOUR} hours.`
        ]);
      }

      // Refined Everything follow-up (KorbedOut's idea): Wholesale seeds from your Warehouse
      if (action === 'wholesale' || action === 'seeds' || action === 'supplier') {
        const lv = perkLevel(ctx.db, guildId, ctx.user.id, 'warehouse', ctx.now);
        const words = [String(args.lot ?? ''), String(args.amount ?? '')].join(' ').trim();
        const m = /^(.*?)\s*(\d+)?$/.exec(words)!;
        const c = m[1] ? findCrop(m[1]) : null;
        if (!c) {
          return done(`${emojiOr('prop_warehouse', '📦')} Wholesale seeds`, [
            lv ? `Your level ${lv} Warehouse orders seeds straight from the supplier: your own daily allowance, no waiting on Marquez's shelf. ${WHOLESALE.markup * 100}% over his price.` : `Own a finished **Warehouse** and you can order seeds wholesale: your own daily allowance, no waiting on Marquez's shelf. \`${P}property build <tile> warehouse\`.`,
            '',
            ...Object.values(CROPS).map((x) => `${emojiOr(`seed_${x.id}`, x.emoji)} **${x.name}**: ${format(wholesalePrice(x))} each · ${lv ? `${allowance(x, lv) - boughtToday(ctx.db, guildId, ctx.user.id, x, ctx.now)} of ${allowance(x, lv)} left today` : `${WHOLESALE.perDay.map((_, i) => allowance(x, i + 1)).join(' / ')} a day by level`}`),
            '',
            `-# Order with \`${P}property wholesale <seed> <amount>\`, like \`${P}property wholesale polyfruit 3\`. Allowances reset at midnight Eastern.`
          ]);
        }
        if (!lv) throw new GameError('wholesale.none', `Wholesale needs a finished Warehouse. Build one with \`${P}property build <tile> warehouse\`.`);
        const want = m[2] ? Number(m[2]) : allowance(c, lv) - boughtToday(ctx.db, guildId, ctx.user.id, c, ctx.now);
        if (!(want > 0)) throw new GameError('wholesale.limit', `You've ordered your ${allowance(c, lv)} ${c.name} seeds for today. The supplier restocks you at midnight Eastern.`);
        const r = buyWholesale(ctx.db, guildId, ctx.user.id, c, want, lv, ctx.now);
        return done(`${emojiOr('prop_warehouse', '📦')} Wholesale order`, [
          `A truck backs up to your Warehouse: **${r.qty} ${c.name} Seeds** ${emojiOr(`seed_${c.id}`, c.emoji)} for **${format(r.cost)}**. They're in your inventory.`,
          `-# ${r.left} more ${c.name} seeds today. Plant them with \`${P}farm plant\`.`
        ]);
      }

      if (action === 'goods') {
        const have = count(ctx.db, guildId, ctx.user.id, 'goods');
        if (String(args.lot ?? '').toLowerCase() !== 'sell') return done(`${emojiOr('goods', '📦')} Goods`, [`You have **${have}** crates of Goods. Marquez pays ${format(ESTATE.goodsPrice)} a crate (\`${P}property goods sell\`); freight pays ${format(ESTATE.freightGoods)} (\`${P}property freight\`, needs a Station).`]);
        if (!have) throw new GameError('estate.nogoods', 'You have no Goods. Factories make them.');
        takeItem(ctx.db, guildId, ctx.user.id, 'goods', have);
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: have * ESTATE.goodsPrice, reason: 'estate.goods', guildId, actorId: ctx.user.id, now: ctx.now });
        return done(`${emojiOr('goods', '📦')} Goods sold`, [`Marquez takes **${have}** crates off your hands for **${format(paid)}**. *"Good, honest work, pal."*`]);
      }

      if (action === 'landmark' || action === 'landmarks' || action === 'donate') {
        const sub = action === 'donate' ? 'donate' : String(args.lot ?? '').trim().toLowerCase();
        const amount = action === 'donate' ? (args.lot ?? args.amount) : args.amount;
        if (sub !== 'donate' && sub !== 'give') return landmarkView(ctx, guildId, news);
        const c = current(ctx.db, guildId);
        if (!c) throw new GameError('estate.landmarks', 'Every landmark is already built here.');
        const cents = parseAmount(amount as string | undefined, { all: Math.min(balance(ctx.db, wallet), c.l.cost - c.funded), min: Math.min(MIN_DONATION, c.l.cost - c.funded) });
        if (balance(ctx.db, wallet) < cents) throw new GameError('funds.short', `You have ${format(balance(ctx.db, wallet))}.`);
        const d = donate(ctx.db, guildId, ctx.user.id, cents, ctx.now);
        const lines = [`${emojiOr('brick', '🧱')} You put **${format(d.cents)}** toward **${c.l.name}**.`];
        if (d.finished) lines.push('', `${emojiOr(`landmark_${d.finished.id}`, d.finished.emoji)} **${d.finished.name} is finished!** 🎉 Everyone here gets: ${d.finished.perk}.`);
        return landmarkView(ctx, guildId, [...news, ...lines]);
      }

      throw new GameError('estate.action', `Try: \`${P}property\`, \`map\`, \`buildings\`, \`build <tile> <building>\`, \`upgrade <tile>\`, \`sell <tile>\`, \`repair <tile|all>\`, \`evict <tile>\`, \`bid <tile> <amount>\`, \`accept <tile>\`, \`refuse <tile>\`, \`storefront <tile> <ticker>\`, \`party\`, \`freight\`, \`goods\`, \`landmark\`, \`info <tile>\`.`);
    });
  }
};

export const landmark: Command = {
  name: 'landmark', aliases: ['landmarks', 'monument'], system: 'property', guildOnly: true,
  description: 'Build It and They Will Come: the landmarks this server builds together',
  options: [{ name: 'action', type: 'string', description: 'Blank to look, or: donate <amount>' }],
  run(ctx, args) {
    const [verb = '', ...rest] = String(args.action ?? '').trim().split(/\s+/);
    return property.run(ctx, { action: 'landmark', lot: verb, amount: rest.join(' ') });
  }
};

/** For the background pass: settles a server and sends everything to inboxes. */
export function settleServer(db: Ctx['db'], guildId: string, now: number, prefix: string): void {
  db.tx(() => { tellAll(db, guildId, settle(db, guildId, now), prefix, null, now); });
}

export const propertyCommands = [property, landmark];
