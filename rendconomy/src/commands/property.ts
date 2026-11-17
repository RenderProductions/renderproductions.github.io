// Room to Grow: r!property (your places), map, buy, sell, repair, evict, bid, accept, refuse, storefront, party, info.
import { addMoment, compact } from '../core/moments';
import { awardHere, award } from '../achievements/achievements';
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
  ESTATE, KINDS, LOTS, buyout, dayRent, fullSet, lotsOf, lotsOfKind, minBid, ownedBy, partyUntil, placeBid, refundBid, repairCost, saveLot,
  sellPrice, setsOf, settle, startParty, taxRate, value, type EstateNews, type Kind, type Lot
} from '../estate/estate';
import { addInbox } from '../social/inbox';
import { useCharge } from '../underground/underground';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';

export const kindE = (k: Kind): string => emojiOr(`prop_${k}`, KINDS[k].emoji);
const pct = (c: number): string => `${Math.round(Math.max(0, c))}%`;
const nameOf = (ctx: Ctx, guildId: string, id: string | null): string => {
  if (!id) return 'the bank';
  if (id === ctx.user.id) return 'you';
  return ctx.db.get<{ name: string }>('SELECT name FROM players WHERE guild_id = ? AND user_id = ?', guildId, id)?.name ?? 'someone';
};
/** A lot's tile on the map. */
export function tile(l: Lot): string {
  if (l.status === 'auction') return emojiOr('lot_condemned', '🏚️');
  if (l.squatters) return emojiOr('squatter', '🛌');
  return kindE(l.kind);
}

/** Settles the server, tells the other people involved (inbox), and returns the lines for this player. */
function catchUp(ctx: Ctx, guildId: string): { lots: Lot[]; news: string[] } {
  const events = settle(ctx.db, guildId, ctx.now);
  const news = tellAll(ctx.db, guildId, events, ctx.config.prefix, ctx.user.id);
  return { lots: lotsOf(ctx.db, guildId, ctx.now), news };
}

/**
 * What settling turned up, in words. Anything about someone other than `me` goes to their inbox; the lines
 * about `me` are returned for the reply. Also used by the background pass (me = null: everything to inboxes).
 */
export function tellAll(db: Ctx['db'], guildId: string, events: EstateNews[], P: string, me: string | null): string[] {
  const mine: string[] = [];
  const paid = new Map<string, { rent: Cents; charges: Cents; days: number; short: boolean }>();
  const say = (userId: string, title: string, line: string) => { if (userId === me) mine.push(line); else addInbox(db, userId, guildId, title, line); };
  for (const e of events) {
    if (e.kind === 'paid') {
      const p = paid.get(e.userId) ?? { rent: 0, charges: 0, days: 0, short: false };
      p.rent += e.rent; p.charges += e.charges; p.days = Math.max(p.days, e.days); p.short ||= e.short;
      paid.set(e.userId, p);
    } else if (e.kind === 'squatters') {
      say(e.userId, 'Squatters!', `${emojiOr('squatter', '🛌')} **Squatters moved into lot ${e.lot}.** No rent until they're gone: \`${P}property evict ${e.lot}\`, or repair it to ${ESTATE.squatClearAt}%.`);
    } else if (e.kind === 'condemned') {
      say(e.userId, 'Condemned', `${emojiOr('lot_condemned', '🏚️')} **Lot ${e.lot} was condemned.** It fell apart, so the bank took it (and paid you ${format(e.payout)}). It's up for auction for ${ESTATE.auctionHours} hours.`);
      award(db, guildId, e.userId, 'condemned');
      addMoment(`🏚️ A ${KINDS[lotsOf(db, guildId)[e.lot - 1]!.kind].name} was just condemned`);
    } else if (e.kind === 'auction_won') {
      say(e.userId, 'Auction won', `${emojiOr('sold', '🪧')} **You won the auction for lot ${e.lot}** for ${format(e.cents)}. It needs work: it's at ${ESTATE.auctionCondition}%.`);
      checkOwnership(db, guildId, e.userId);
    } else if (e.kind === 'bought_out') {
      say(e.userId, 'Bought out', `${emojiOr('sold', '🪧')} **Lot ${e.lot} was bought out** for ${format(e.cents)}. Nobody answered the bid in time, so it went through.`);
      say(e.buyerId, 'Your bid went through', `${emojiOr('key', '🔑')} **Your bid for lot ${e.lot} went through.** It's yours, for ${format(e.cents)}.`);
      checkOwnership(db, guildId, e.buyerId);
    }
  }
  for (const [userId, p] of paid) {
    if (!p.rent && !p.charges) continue;
    const line = `${emojiOr('receipt', '🧾')} Since you last looked: **+${format(p.rent)}** rent, **−${format(p.charges)}** upkeep and tax${p.short ? ' (you couldn\'t cover it all, so your places wore down faster)' : ''}.`;
    if (userId === me) mine.push(line);
    else if (p.short) addInbox(db, userId, guildId, 'Upkeep unpaid', `${emojiOr('tax', '🧾')} You couldn't cover your property upkeep and tax, so your places are wearing down faster. \`${P}property\``);
  }
  return mine;
}

/** The ownership achievements, for whoever just gained a lot. */
function checkOwnership(db: Ctx['db'], guildId: string, userId: string): string[] {
  const lots = lotsOf(db, guildId);
  const mine = ownedBy(lots, userId);
  const notes: string[] = [];
  const give = (id: string) => { const s = award(db, guildId, userId, id); if (s) notes.push(s); };
  if (mine.length >= 1) give('first_home');
  if (mine.length >= 3) give('landlord');
  if (mine.some((l) => l.kind === 'mansion')) give('lord_of_the_manor');
  if (setsOf(lots, userId).length) give('full_house');
  if (mine.length === LOTS) give('monopoly');
  if (notes.some((n) => n.includes('Monopoly, Baby!'))) addMoment('🏙️ Someone owns a whole map. Monopoly, baby!');
  else if (notes.some((n) => n.includes('Full House'))) addMoment(`👑 Someone just bought up a full set of ${KINDS[setsOf(lots, userId)[0]!].plural}`);
  return notes;
}

const lotArg = (ctx: Ctx, raw: unknown): number => {
  const n = Number(String(raw ?? '').replace(/^#|^lot\s*/i, '').trim());
  if (!Number.isInteger(n) || n < 1 || n > LOTS) throw new GameError('estate.lot', `Pick a lot from 1 to ${LOTS}. See them all: \`${ctx.config.prefix}property map\`.`);
  return n;
};
const mineOnly = (ctx: Ctx, l: Lot): void => {
  if (l.status !== 'owned' || l.owner_id !== ctx.user.id) throw new GameError('estate.notyours', `Lot ${l.lot} isn't yours.`);
};

function summary(ctx: Ctx, guildId: string, lots: Lot[], news: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const mine = ownedBy(lots, ctx.user.id);
  if (!mine.length) {
    const free = lots.filter((l) => l.status === 'bank');
    return { embeds: [embed('property', `${emojiOr('property', '🏠')} Your property`, [
      ...news,
      'You don\'t own any property yet.',
      '',
      free.length ? `${free.length} of ${LOTS} lots are for sale, from ${format(Math.min(...free.map((l) => value(l.kind))))}. See the map: \`${P}property map\`, then \`${P}property buy <lot>\`.` : `Every lot is taken. Make an owner an offer: \`${P}property bid <lot> <amount>\`.`
    ])] };
  }
  const sets = new Set(setsOf(lots, ctx.user.id));
  const rate = taxRate(mine.length);
  let rent = 0, upkeep = 0, tax = 0;
  const rows = mine.map((l) => {
    const r = dayRent(l, sets.has(l.kind));
    rent += r; upkeep += KINDS[l.kind].upkeep; tax += Math.floor(value(l.kind) * rate);
    const tags = [
      l.squatters ? `${emojiOr('squatter', '🛌')} squatters` : null,
      l.bidder_id ? `${emojiOr('bid', '✉️')} bid ${format(l.bid_cents)} (answer by ${discordTime(l.bid_until!)})` : null,
      l.shield_until > ctx.now ? `🛡️ shielded until ${discordTime(l.shield_until, 'f')}` : null,
      l.kind === 'shop' && l.storefront ? `storefront: ${l.storefront}` : null
    ].filter(Boolean);
    return `${kindE(l.kind)} **Lot ${l.lot} · ${KINDS[l.kind].name}** · ${pct(l.condition)} · ${format(r)}/day${tags.length ? ` · ${tags.join(' · ')}` : ''}`;
  });
  return { embeds: [embed('property', `${emojiOr('property', '🏠')} Your property`, [
    ...news,
    ...(news.length ? [''] : []),
    ...rows,
    '',
    `Rent **${format(rent)}**/day · upkeep **${format(upkeep)}** · tax **${format(tax)}** (${(rate * 100).toFixed(1).replace(/\.0$/, '')}% for ${mine.length} ${mine.length === 1 ? 'lot' : 'lots'})`,
    `Net: **${rent - upkeep - tax >= 0 ? '+' : '−'}${format(Math.abs(rent - upkeep - tax))}** a day, before repairs.`,
    sets.size ? `${emojiOr('fullset', '👑')} Full ${sets.size === 1 ? 'set' : 'sets'}: ${[...sets].map((k) => KINDS[k].plural).join(', ')} (+${ESTATE.setBonus * 100}% rent)` : null,
    `-# \`${P}property map\` · \`${P}property repair all\` · \`${P}property sell <lot>\` · \`${P}property info <lot>\``
  ])] };
}

function mapView(ctx: Ctx, guildId: string, lots: Lot[], news: string[]): ReplyObject {
  const P = ctx.config.prefix;
  const grid = [0, 5, 10].map((i) => lots.slice(i, i + 5).map(tile).join(' ')).join('\n');
  const rows = lots.map((l) => {
    const k = KINDS[l.kind];
    let state: string;
    if (l.status === 'bank') state = `for sale, **${format(value(l.kind))}**`;
    else if (l.status === 'auction') state = `${emojiOr('auction', '🔨')} condemned, at auction: ${l.bidder_id ? `top bid ${format(l.bid_cents)} by ${nameOf(ctx, guildId, l.bidder_id)}` : `from ${format(minBid(l))}`}, ends ${discordTime(l.auction_until!)}`;
    else state = `**${nameOf(ctx, guildId, l.owner_id)}** · ${pct(l.condition)}${l.squatters ? ' · squatters' : ''}${l.bidder_id ? ' · bid open' : ''}`;
    return `\`${String(l.lot).padStart(2)}\` ${kindE(l.kind)} ${k.name}: ${state}`;
  });
  return { embeds: [embed('property', `${emojiOr('property', '🏠')} The map`, [
    ...news, ...(news.length ? [''] : []),
    grid, '', ...rows, '',
    `-# \`${P}property buy <lot>\` · \`${P}property bid <lot> <amount>\` · \`${P}property info <lot>\``
  ])] };
}

function info(ctx: Ctx, guildId: string, l: Lot): ReplyObject {
  const k = KINDS[l.kind];
  const lots = lotsOf(ctx.db, guildId, ctx.now);
  const owner = l.owner_id ? nameOf(ctx, guildId, l.owner_id) : null;
  return { embeds: [embed('property', `Lot ${l.lot}: ${k.name}`, [
    `${kindE(l.kind)} Value **${format(value(l.kind))}** · rent up to **${format(k.rent)}**/day · upkeep **${format(k.upkeep)}**/day`,
    `**${k.perk}:** ${k.perkText}.`,
    '',
    l.status === 'bank' ? `For sale by the bank. \`${ctx.config.prefix}property buy ${l.lot}\``
      : l.status === 'auction' ? `Condemned and at auction until ${discordTime(l.auction_until!)}. ${l.bidder_id ? `Top bid ${format(l.bid_cents)}.` : 'No bids yet.'} Next bid at least **${format(minBid(l))}**: \`${ctx.config.prefix}property bid ${l.lot} <amount>\``
        : `Owned by **${owner}** · condition ${pct(l.condition)}${l.squatters ? ' · squatters' : ''}${fullSet(lots, l.owner_id!, l.kind) ? ' · part of a full set' : ''}.`,
    l.status === 'owned' && l.owner_id !== ctx.user.id
      ? (l.shield_until > ctx.now ? `🛡️ Shielded from bids until ${discordTime(l.shield_until)}.` : `A buyout bid has to be at least **${format(minBid(l))}**${l.bidder_id ? ` (there's one open at ${format(l.bid_cents)})` : ''}.`)
      : null
  ])] };
}

export const property: Command = {
  name: 'property', aliases: ['estate', 'realestate', 'prop', 'properties', 'lots'], system: 'property', guildOnly: true,
  description: 'Room to Grow: your property, the server map, buying, repairs, buyout bids and auctions',
  options: [
    { name: 'action', type: 'string', description: 'Blank for yours, or: map, buy, sell, repair, evict, bid, accept, refuse, storefront, party, info' },
    { name: 'lot', type: 'string', description: 'A lot number from 1 to 15 (or "all" for repair)' },
    { name: 'amount', type: 'string', description: 'For bid: Polygons. For storefront: a company ticker' }
  ],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix;
    const action = String(args.action ?? '').trim().toLowerCase();
    return ctx.db.tx(() => {
      const { lots, news } = catchUp(ctx, guildId);
      const get = (raw: unknown): Lot => lots[lotArg(ctx, raw) - 1]!;
      const done = (title: string, lines: (string | null | false)[]): ReplyObject => ({ embeds: [embed('property', title, [...news, ...(news.length ? [''] : []), ...lines])] });

      if (!action || action === 'mine' || action === 'me') return summary(ctx, guildId, lots, news);
      if (action === 'map' || action === 'list' || action === 'all') return mapView(ctx, guildId, lots, news);
      if (/^\d+$/.test(action)) return info(ctx, guildId, get(action));

      if (action === 'info' || action === 'look') return info(ctx, guildId, get(args.lot));

      if (action === 'buy') {
        const l = get(args.lot);
        if (l.status === 'auction') throw new GameError('estate.auction', `Lot ${l.lot} is at auction. Bid on it: \`${P}property bid ${l.lot} <amount>\` (at least ${format(minBid(l))}).`);
        if (l.status === 'owned') throw new GameError('estate.taken', l.owner_id === ctx.user.id ? `Lot ${l.lot} is already yours.` : `Lot ${l.lot} belongs to ${nameOf(ctx, guildId, l.owner_id)}. Make them an offer: \`${P}property bid ${l.lot} <amount>\` (at least ${format(minBid(l))}).`);
        const price = value(l.kind);
        if (balance(ctx.db, wallet) < price) throw new GameError('funds.short', `Lot ${l.lot} (${KINDS[l.kind].name}) costs ${format(price)}. You have ${format(balance(ctx.db, wallet))}.`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: price, reason: 'estate.buy', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
        Object.assign(l, { owner_id: ctx.user.id, status: 'owned', condition: 100, settled_at: ctx.now, bought_at: ctx.now, squatters: 0, shield_until: 0, storefront: null });
        saveLot(ctx.db, l);
        const after = lotsOf(ctx.db, guildId, ctx.now);
        const set = fullSet(after, ctx.user.id, l.kind) && lotsOfKind(l.kind) > 1;
        const n = ownedBy(after, ctx.user.id).length;
        checkOwnership(ctx.db, guildId, ctx.user.id);   // unlocks add their own lines to the reply
        return done(`${emojiOr('key', '🔑')} Lot ${l.lot} is yours`, [
          `${kindE(l.kind)} You bought the **${KINDS[l.kind].name}** on lot ${l.lot} for **${format(price)}**.`,
          `It pays up to **${format(KINDS[l.kind].rent)}** a day in rent and costs **${format(KINDS[l.kind].upkeep)}** a day to keep up. **${KINDS[l.kind].perk}:** ${KINDS[l.kind].perkText}.`,
          taxRate(n) > taxRate(n - 1) ? `${emojiOr('tax', '🧾')} With ${n} lots, your property tax is now **${taxRate(n) * 100}%** of their value a day.` : null,
          set ? `\n${emojiOr('fullset', '👑')} **${ctx.user.name} owns every ${KINDS[l.kind].name} on the map!** That's +${ESTATE.setBonus * 100}% rent on all of them, and a target on their back.` : null
        ]);
      }

      if (action === 'sell') {
        const l = get(args.lot); mineOnly(ctx, l);
        const price = sellPrice(l);
        refundBid(ctx.db, l, ctx.now);
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: price, reason: 'estate.sell', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
        Object.assign(l, { owner_id: null, status: 'bank', condition: 100, squatters: 0, storefront: null, shield_until: 0, bought_at: null, settled_at: ctx.now });
        saveLot(ctx.db, l);
        return done(`${emojiOr('sold', '🪧')} Lot ${l.lot} sold`, [`The bank bought your **${KINDS[l.kind].name}** for **${format(paid)}**${paid < price ? ` (the Reserve is low, so it paid less than the ${format(price)} it's worth)` : ''}. It's back on the market.`]);
      }

      if (action === 'repair' || action === 'fix') {
        const all = /^all$/i.test(String(args.lot ?? '').trim());
        const targets = all ? ownedBy(lots, ctx.user.id).filter((l) => l.condition < 100) : [get(args.lot)];
        if (!all) mineOnly(ctx, targets[0]!);
        if (!targets.length) throw new GameError('estate.fine', 'Everything you own is already in perfect shape.');
        const lines: string[] = [];
        let spent = 0;
        for (const l of targets) {
          const before = l.condition;
          if (before >= 100) { lines.push(`Lot ${l.lot} is already at 100%.`); continue; }
          const full = repairCost(l);
          const have = balance(ctx.db, wallet);
          if (have <= 0) { lines.push(`Lot ${l.lot}: you're out of Polygons.`); break; }
          const cost = Math.min(full, have);
          const to = cost >= full ? 100 : before + Math.floor(cost / (value(l.kind) * ESTATE.repairPerPoint));
          const pay = cost >= full ? full : Math.ceil((to - before) * value(l.kind) * ESTATE.repairPerPoint);
          if (to <= before) { lines.push(`Lot ${l.lot}: you can't afford any repairs.`); break; }
          transfer(ctx.db, { from: wallet, to: RESERVE, cents: pay, reason: 'estate.repair', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
          spent += pay;
          l.condition = to;
          let extra = '';
          if (l.squatters && to >= ESTATE.squatClearAt) { l.squatters = 0; extra = ' The squatters packed up when the hammering started.'; }
          if (before < 25 && to >= 100) awardHere('fixer_upper');
          saveLot(ctx.db, l);
          lines.push(`${kindE(l.kind)} Lot ${l.lot}: ${pct(before)} → **${pct(to)}** for ${format(pay)}.${extra}`);
        }
        return done(`${emojiOr('repair', '🔨')} Repairs`, [...lines, '', `Spent **${format(spent)}**.`]);
      }

      if (action === 'evict') {
        const l = get(args.lot); mineOnly(ctx, l);
        if (!l.squatters) throw new GameError('estate.nosquat', `Nobody is squatting on lot ${l.lot}.`);
        const cost = KINDS[l.kind].rent * ESTATE.evictDays;
        if (balance(ctx.db, wallet) < cost) throw new GameError('funds.short', `Evicting them costs ${format(cost)} (${ESTATE.evictDays} days of rent).`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: cost, reason: 'estate.evict', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
        l.squatters = 0; saveLot(ctx.db, l);
        return done(`${emojiOr('evict', '🚪')} Squatters evicted`, [`Lot ${l.lot} is clear, for **${format(cost)}**. ${l.condition < ESTATE.squatBelow ? `It's still at ${pct(l.condition)}, so they may come back. \`${P}property repair ${l.lot}\`` : 'Rent starts again tomorrow.'}`]);
      }

      if (action === 'bid' || action === 'offer') {
        const l = get(args.lot);
        if (l.status === 'bank') throw new GameError('estate.forsale', `Lot ${l.lot} is for sale by the bank. Just buy it: \`${P}property buy ${l.lot}\`.`);
        if (l.owner_id === ctx.user.id) throw new GameError('estate.own', `Lot ${l.lot} is already yours.`);
        if (l.bidder_id === ctx.user.id) throw new GameError('estate.already', `You already have the top bid on lot ${l.lot} (${format(l.bid_cents)}).`);
        const min = minBid(l);
        const cents = parseAmount(args.amount as string | undefined, { all: balance(ctx.db, wallet) });
        if (cents < min) throw new GameError('estate.low', `The bid has to be at least **${format(min)}**.`);
        if (balance(ctx.db, wallet) < cents) throw new GameError('funds.short', `You have ${format(balance(ctx.db, wallet))}.`);
        if (l.status === 'auction') {
          const prev = l.bidder_id;
          placeBid(ctx.db, l, ctx.user.id, cents, l.bid_until ?? l.auction_until!, ctx.now);
          saveLot(ctx.db, l);
          if (prev) addInbox(ctx.db, prev, guildId, 'Outbid', `${emojiOr('auction', '🔨')} You were outbid on lot ${l.lot} (${format(cents)}). Your bid is back in your wallet.`, ctx.now);
          return done(`${emojiOr('auction', '🔨')} Bid placed`, [`You're the top bidder on condemned lot ${l.lot} (${KINDS[l.kind].name}) at **${format(cents)}**. The auction ends ${discordTime(l.auction_until!)}. Your Polygons are held until then (refunded if you're outbid).`]);
        }
        if (l.shield_until > ctx.now) throw new GameError('estate.shield', `Lot ${l.lot} is shielded from bids until ${discordTime(l.shield_until)}.`);
        const prev = l.bidder_id;
        placeBid(ctx.db, l, ctx.user.id, cents, ctx.now + ESTATE.bidHours * HOUR, ctx.now);
        saveLot(ctx.db, l);
        if (prev) addInbox(ctx.db, prev, guildId, 'Outbid', `${emojiOr('bid', '✉️')} Someone outbid you on lot ${l.lot} (${format(cents)}). Your bid is back in your wallet.`, ctx.now);
        addInbox(ctx.db, l.owner_id!, guildId, 'A buyout bid', `${emojiOr('bid', '✉️')} **${ctx.user.name} bid ${format(cents)} for lot ${l.lot}** (your ${KINDS[l.kind].name}). Accept: \`${P}property accept ${l.lot}\`. Refuse (costs ${format(Math.ceil(cents * ESTATE.refuseFee))}): \`${P}property refuse ${l.lot}\`. No answer by ${discordTime(l.bid_until!)} and it's sold.`, ctx.now);
        return done(`${emojiOr('bid', '✉️')} Bid sent`, [
          `You bid **${format(cents)}** for lot ${l.lot} (${nameOf(ctx, guildId, l.owner_id)}'s ${KINDS[l.kind].name}). Your Polygons are held until it's settled.`,
          `They have until ${discordTime(l.bid_until!)} to answer. If they refuse, they pay you **${format(Math.ceil(cents * ESTATE.refuseFee))}** and get a ${ESTATE.shieldDays}-day shield. If they don't answer, it's yours.`
        ]);
      }

      if (action === 'accept') {
        const l = get(args.lot); mineOnly(ctx, l);
        if (!l.bidder_id) throw new GameError('estate.nobid', `There's no bid on lot ${l.lot}.`);
        const buyer = l.bidder_id, cents = l.bid_cents;
        const ev: EstateNews[] = [];
        buyout(ctx.db, l, ctx.now, ev);
        saveLot(ctx.db, l);
        addInbox(ctx.db, buyer, guildId, 'Bid accepted', `${emojiOr('key', '🔑')} **Your bid for lot ${l.lot} was accepted.** It's yours, for ${format(cents)}.`, ctx.now);
        checkOwnership(ctx.db, guildId, buyer);
        return done(`${emojiOr('sold', '🪧')} Sold`, [`You sold lot ${l.lot} to **${nameOf(ctx, guildId, buyer)}** for **${format(cents)}**.`]);
      }

      if (action === 'refuse' || action === 'decline' || action === 'reject') {
        const l = get(args.lot); mineOnly(ctx, l);
        if (!l.bidder_id) throw new GameError('estate.nobid', `There's no bid on lot ${l.lot}.`);
        const smoke = useCharge(ctx.db, guildId, ctx.user.id, 'smoke');   // No Questions Asked: a Smoke Bomb skips the fee
        const fee = smoke ? 0 : Math.ceil(l.bid_cents * ESTATE.refuseFee);
        if (balance(ctx.db, wallet) < fee) throw new GameError('funds.short', `Refusing costs ${format(fee)} (${ESTATE.refuseFee * 100}% of the bid). You have ${format(balance(ctx.db, wallet))}.`);
        const bidder = l.bidder_id;
        if (fee > 0) transfer(ctx.db, { from: wallet, to: walletOf(guildId, bidder), cents: fee, reason: 'estate.refuse', guildId, actorId: ctx.user.id, now: ctx.now, note: { lot: l.lot } });
        refundBid(ctx.db, l, ctx.now);
        l.shield_until = ctx.now + ESTATE.shieldDays * DAY;
        saveLot(ctx.db, l);
        addInbox(ctx.db, bidder, guildId, 'Bid refused', smoke ? `${emojiOr('smoke_bomb', '💨')} Your bid for lot ${l.lot} was refused. There was a lot of smoke. You got your bid back.` : `${emojiOr('bid', '✉️')} Your bid for lot ${l.lot} was refused. You got it back, plus **${format(fee)}** for your trouble.`, ctx.now);
        return done(`🛡️ Bid refused`, [smoke ? `${emojiOr('smoke_bomb', '💨')} **Smoke Bomb!** By the time it clears, the bid's gone and you didn't pay a thing. Lot ${l.lot} is shielded from bids until ${discordTime(l.shield_until)}.` : `You paid **${format(fee)}** to keep lot ${l.lot}. It's shielded from bids until ${discordTime(l.shield_until)}.`]);
      }

      if (action === 'storefront') {
        const l = get(args.lot); mineOnly(ctx, l);
        if (l.kind !== 'shop') throw new GameError('estate.notshop', 'Only Corner Shops have a storefront.');
        const t = String(args.amount ?? '').trim().toUpperCase();
        if (!t || t === 'NONE' || t === 'OFF') { l.storefront = null; saveLot(ctx.db, l); return done('Storefront', [`Lot ${l.lot}'s storefront is empty again.`]); }
        const c = getCompany(ctx.db, t);
        if (!alive(c)) throw new GameError('estate.company', `No player company called ${t}. See them: \`${P}exchange\`.`);
        l.storefront = c.ticker; saveLot(ctx.db, l);
        return done('Storefront', [`${kindE('shop')} **${c.name} (${c.ticker})** now runs the storefront on lot ${l.lot}. It earns ${ESTATE.storefrontCut * 100}% of the shop's rent (paid by the Reserve, not you).`]);
      }

      if (action === 'party' || action === 'ballroom') {
        const mansion = ownedBy(lots, ctx.user.id).find((l) => l.kind === 'mansion');
        if (!mansion) throw new GameError('estate.nomansion', 'You need the Mansion to throw a party.');
        if (mansion.squatters) throw new GameError('estate.squat', 'There are squatters in the ballroom. Evict them first.');
        const until = partyUntil(ctx.db, guildId);
        if (until > ctx.now) throw new GameError('estate.party', `The party's already going until ${discordTime(until)}.`);
        const last = ctx.db.meta(`estate.partyday:${guildId}`);
        if (last === dayKey(ctx.now)) throw new GameError('estate.partied', 'The Ballroom needs a day to recover. Throw another party tomorrow.');
        ctx.db.setMeta(`estate.partyday:${guildId}`, dayKey(ctx.now));
        const end = startParty(ctx.db, guildId, ctx.now);
        addMoment('🎉 There\'s a party at a Mansion. Chat pay is doubled there', ctx.now);
        return done(`${kindE('mansion')} Party at the Mansion!`, [`**${ctx.user.name}** threw open the Ballroom. **Chat pay is doubled for everyone here** until ${discordTime(end)}. 🎉`]);
      }

      throw new GameError('estate.action', `Try: \`${P}property\`, \`map\`, \`buy <lot>\`, \`sell <lot>\`, \`repair <lot|all>\`, \`evict <lot>\`, \`bid <lot> <amount>\`, \`accept <lot>\`, \`refuse <lot>\`, \`storefront <lot> <ticker>\`, \`party\`, \`info <lot>\`.`);
    });
  }
};

/** For the background pass: settles a server and sends everything to inboxes. */
export function settleServer(db: Ctx['db'], guildId: string, now: number, prefix: string): void {
  db.tx(() => { tellAll(db, guildId, settle(db, guildId, now), prefix, null); });
}

export const propertyCommands = [property];

