// Main Street: Marquez's shop (shelves filled by the delivery truck, prices that move, the daily deal, Black
// Friday every Friday, his loyalty card and back room), Chuck Alfrey's Bait & Tackle, and player stores in Corner
// Shops. The hub, every view and the r!shop words live here; the engines are in src/shop/.
import { itemE } from '../discord/icons';
import { emojiOr } from '../discord/emoji';
import { nameOf, receipt } from '../social/receipts';
import { GameError } from '../core/errors';
import { format, parseAmount, parseCount, type Cents } from '../core/money';
import { DAY, discordTime } from '../core/time';
import * as sessions from '../core/sessions';
import { embed } from '../discord/style';
import { balance, wallet } from '../core/ledger';
import { count, items as invItems, takeItem } from '../shop/inventory';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ITEMS, ROTATION, SHELVES, anyItem, findItem, isCollectible, marquez, type Item, type Shelf } from '../shop/items';
import { isHoliday } from '../holidays/holidays';
import { SELL_BACK, SHOP_RULES, ShopError, backOf, buy, collectibleOfWeek, priceOf, quote, restock, sellBack, sellBackPrice, stockOf, type Bought, type Quote } from '../shop/shop';
import { LOYALTY, STREET, dailyDeal, featuredShelf, isFriday, levelIndex, levelOf, nextDelivery, nextLevel, onWishlist, regular, saleLabel, spentWith, unwish, wish, wishlist } from '../shop/street';
import { STORES, buyFrom, isOpen, listings, slotsOf, stock as stockShelf, storesOf, sweepStores, unstock as unstockShelf, type Listing } from '../shop/stores';
import { shopTax } from '../city/state';
import { CHUCK, CHUCK_LINES, CHUCK_RANKS, buyGear, chuckRank, pagesDone } from '../fishing/docks';
import { heatNow } from '../underground/underground';
import { dayKey as dayKeyOf, easternHour } from '../core/time';
import { parseTile, tileName } from '../estate/estate';
import { tonight } from '../underground/underground';
import { BULK_MAX, useItem, useMany } from '../shop/use';
import { bagCount, isCatch } from '../fishing/fishing';
import { bagMax } from '../fishing/docks';
import { isCropItem } from '../farming/farming';
import { itemName } from './connections';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

// ---------------------------------------------------------------- what's on which shelf

const shelfItems = (shelf: Shelf, now: number) =>
  shelf === 'rare' ? [COLLECTIBLES[collectibleOfWeek(now)]!]
    : shelf === 'holiday' ? (isHoliday(now) ? [...Object.values(HOLIDAY_COLLECTIBLES).filter((i) => i.stock > 0), ...Object.values(ITEMS).filter((i) => i.shelf === 'holiday')] : [])
    : Object.values(ITEMS).filter((i) => i.shelf === shelf && i.ready);
/** Marquez's shelves (the tackle moved to Chuck's on Main Street). */
const shelves = (now: number) => (Object.keys(SHELVES) as Shelf[]).filter((s) => s !== 'tackle' && shelfItems(s, now).length);
const TACKLE = () => Object.values(ITEMS).filter((i) => i.shelf === 'tackle' && i.ready);
const findShelf = (want: string, now: number): Shelf | undefined => {
  const w = want.toLowerCase();
  return w ? shelves(now).find((s) => s === w || SHELVES[s].label.toLowerCase().startsWith(w)) : undefined;
};

// ---------------------------------------------------------------- prices and lines

/** "⬡100" or "~~⬡100~~ **⬡70**", with a ▲/▼ when demand moved it. */
export function priceText(q: Quote): string {
  const trend = q.factor > 1.001 ? ` ${emojiOr('up', '▲')}` : q.factor < 0.999 ? ` ${emojiOr('down', '▼')}` : '';
  return q.each < q.base && q.each !== q.shelf ? `~~${format(q.shelf)}~~ **${format(q.each)}**${trend}` : q.each !== q.base ? `**${format(q.each)}**${trend}` : format(q.each);
}
function breakdown(q: Quote, now: number): string {
  const parts = [`list ${format(q.base)}`];
  if (q.factor !== 1) parts.push(`demand ×${q.factor.toFixed(2)}`);
  if (q.sale) parts.push(`${saleLabel(q.sale, now)} −${Math.round(q.sale.off * 100)}%`);
  if (q.loyalty) parts.push(`loyalty −${Math.round(q.loyalty * 100)}%`);
  return parts.join(' · ');
}
const avail = (ctx: Ctx, g: string, id: string): number =>
  stockOf(ctx.db, g, id) + (levelOf(ctx.db, g, ctx.user.id).id === 'family' ? backOf(ctx.db, g, id) : 0);

/** What Marquez says when you walk in: his loyalty greeting, the holidays, Fridays, or a price that moved. */
function greeting(ctx: Ctx, g: string, list: Item[] = []): string {
  const lvl = levelOf(ctx.db, g, ctx.user.id);
  if (isHoliday(ctx.now) && ctx.rng.chance(0.5)) return marquez('holiday', ctx.rng);
  if (isFriday(ctx.now) && ctx.rng.chance(0.4)) return marquez('friday', ctx.rng);
  const moved = list.filter((i) => regular(i)).map((i) => ({ i, f: quote(ctx.db, g, i.id, null, ctx.now).factor })).filter((x) => x.f >= 1.1 || x.f <= 0.9);
  if (moved.length && ctx.rng.chance(0.35)) { const x = ctx.rng.pick(moved); return marquez(x.f > 1 ? 'pricey' : 'cheap', ctx.rng, x.i.name); }
  return lvl.id === 'stranger' ? marquez('greet', ctx.rng) : marquez(lvl.id as 'familiar', ctx.rng);
}
function dealLines(ctx: Ctx, g: string): string[] {
  const deal = ITEMS[dailyDeal(ctx.now)]!;
  return [
    `${emojiOr('deal', '🏷️')} Daily deal: ${itemE(deal.id, deal.emoji)} **${deal.name}** ${Math.round(STREET.dailyDeal * 100)}% off (${priceText(quote(ctx.db, g, deal.id, ctx.user.id, ctx.now))})`,
    isFriday(ctx.now) ? `${emojiOr('black_friday', '🖤')} **Black Friday!** The ${SHELVES[featuredShelf(ctx.now)].emoji} ${SHELVES[featuredShelf(ctx.now)].label} shelf is ${Math.round(STREET.friday.featured * 100)}% off, everything else ${Math.round(STREET.friday.rest * 100)}%.` : null
  ].filter((x): x is string => !!x);
}

/** Buying from Marquez, wrapped up: the receipt, and the line to show. */
function bought(ctx: Ctx, g: string, r: Bought): string {
  const P = ctx.config.prefix;
  receipt(ctx.db, g, ctx.user.id, `Bought ${r.qty > 1 ? `${r.qty} × ` : 'a '}${r.item.name}`, [
    ['Item', `${itemE(r.item.id, r.item.emoji)} ${r.item.name}`], ['Quantity', String(r.qty)],
    r.quote.each !== r.quote.base ? ['Each', `${format(r.quote.each)} (${breakdown(r.quote, ctx.now)})`] : null,
    r.tax ? ['Sales tax', format(r.tax), '-'] : null,
    ['Price', format(r.cost), '-'], ['Balance', format(r.cash)]
  ]);
  return [
    `${emojiOr('marquez', '🏪')} *${marquez('thanks', ctx.rng)}*`,
    `${r.qty} × ${itemE(r.item.id, r.item.emoji)} ${r.item.name}: ${format(r.cost)}${r.tax ? ` (with ${format(r.tax)} tax)` : ''}${r.quote.sale ? ` · ${saleLabel(r.quote.sale, ctx.now)}` : ''}${r.fromBack ? ` · ${r.fromBack} from the back room` : ''}`,
    r.level ? `${r.level.emoji} Marquez punches your card: you're **${r.level.name}** now (${Math.round(r.level.off * 100)}% off${r.level.perk && r.level.off ? `, and ${r.level.perk}` : ''}).` : null,
    r.wished ? '-# It was on your wishlist, so it\'s off it now.' : null,
    `Balance: ${format(r.cash)}`,
    r.item.passive ? '-# This item works on its own while it is in your inventory.' : ITEMS[r.item.id] ? `-# Use it with \`${P}use ${r.item.name.toLowerCase()}\`.` : null
  ].filter(Boolean).join('\n');
}
function refusal(e: unknown, ctx: Ctx): string {
  if (e instanceof ShopError && ['soldOut', 'broke', 'once', 'notThisWeek'].includes(e.why)) return `*${marquez(e.why as 'soldOut', ctx.rng)}*\n${e.message}`;
  if (e instanceof GameError) return e.message;
  throw e;
}

// ---------------------------------------------------------------- the views

type View = { v: 'hub' } | { v: 'shelf'; shelf: Shelf } | { v: 'item'; shelf: Shelf; item: string } | { v: 'stores' } | { v: 'store'; owner: string } | { v: 'chuck' } | { v: 'card' };
const navRow = (sid: string, here: View['v']): Button[] => [
  { label: 'Main Street', emoji: emojiOr('main_street', '🏙️'), id: sessions.buttonId(sid, 'go:hub'), style: 'secondary', disabled: here === 'hub' },
  { label: "Marquez's", emoji: emojiOr('marquez', '🏪'), id: sessions.buttonId(sid, 'go:shelf'), style: 'secondary', disabled: here === 'shelf' },
  { label: "Chuck's", emoji: '⚓', id: sessions.buttonId(sid, 'go:chuck'), style: 'secondary', disabled: here === 'chuck' },
  { label: 'Player stores', emoji: emojiOr('stall', '🛒'), id: sessions.buttonId(sid, 'go:stores'), style: 'secondary', disabled: here === 'stores' },
  { label: 'My card', emoji: emojiOr('loyalty_card', '🪪'), id: sessions.buttonId(sid, 'go:card'), style: 'secondary', disabled: here === 'card' }
];
const chunk = (bs: Button[], rows: Button[][], max = 5) => bs.forEach((b, i) => { if (i % max === 0) rows.push([]); rows[rows.length - 1]!.push(b); });

function render(ctx: Ctx, g: string, sid: string, view: View, line?: string): ReplyObject {
  sweepStores(ctx.db, g, ctx.now, itemName);
  const r = view.v === 'hub' ? hubView(ctx, g, sid, line) : view.v === 'shelf' ? shelfView(ctx, g, sid, view.shelf, line) : view.v === 'item' ? itemView(ctx, g, sid, view.shelf, view.item, line)
    : view.v === 'stores' ? storesView(ctx, g, sid, line) : view.v === 'store' ? storeView(ctx, g, sid, view.owner, line) : view.v === 'chuck' ? chuckView(ctx, g, sid, line) : cardView(ctx, g, sid, line);
  return { ...r, session: sid };
}

function hubView(ctx: Ctx, g: string, sid: string, line?: string): ReplyObject {
  const P = ctx.config.prefix;
  const lvl = levelOf(ctx.db, g, ctx.user.id);
  const all = listings(ctx.db, g);
  const owners = [...new Set(all.map((l) => l.owner_id))];
  const night = tonight(ctx.db, g, ctx.now);
  return {
    embeds: [embed('wallet', '🏙️ Main Street', [
      line ? `${line}\n` : `*${ctx.rng.pick(['Marquez sweeps his front step. Down by the water, Chuck Alfrey is untangling line.', 'A delivery truck rattles past. Shop bells jingle up and down the street.', 'The street smells like coffee and lake water. Somebody\'s haggling at a Corner Shop.', 'Hand-lettered signs in every window. Main Street is open for business.'])}*\n`,
      `${emojiOr('marquez', '🏪')} **Marquez's Shop** · ${emojiOr('truck', '🚚')} next delivery ${discordTime(nextDelivery(ctx.now))}`,
      ...dealLines(ctx, g).map((l) => `-# ${l}`),
      `⚓ **${CHUCK.name}'s Bait & Tackle** · rods, lures, a cooler, a boat`,
      `${emojiOr('stall', '🛒')} **Player stores** · ${owners.length ? `${owners.length} on the street` : `none yet: any Corner Shop owner can open one with \`${P}shop stock\``}`,
      ...owners.slice(0, 5).map((o) => `-# ${nameOf(ctx.db, o)}: ${all.filter((l) => l.owner_id === o).length} item${all.filter((l) => l.owner_id === o).length === 1 ? '' : 's'}`),
      `${emojiOr('connector', '👁️')} **The alley** · ${night ? `Mr. Glaz is down there, muttering. \`${P}underground\`` : 'empty. Come back after dark.'}`,
      '',
      `${emojiOr('loyalty_card', '🪪')} Your card at Marquez's: **${lvl.name}**${lvl.off ? ` · ${Math.round(lvl.off * 100)}% off` : ''}`
    ], { footer: { text: `${P}shop <shelf> · ${P}shop buy <item> · ${P}shop sell <item> · ${P}shop want <item> · ${P}shop @player` } })],
    buttons: [navRow(sid, 'hub')]
  };
}

function shelfView(ctx: Ctx, g: string, sid: string, shelf: Shelf, line?: string): ReplyObject {
  const list = shelfItems(shelf, ctx.now);
  const family = levelOf(ctx.db, g, ctx.user.id).id === 'family';
  const lines = list.map((i) => {
    const left = stockOf(ctx.db, g, i.id), back = family ? backOf(ctx.db, g, i.id) : 0;
    const q = quote(ctx.db, g, i.id, ctx.user.id, ctx.now);
    return `${itemE(i.id, i.emoji)} **${i.name}** · ${priceText(q)} · ${left ? `${left} in stock` : 'sold out'}${back ? ` · ${emojiOr('back_room', '🚪')} ${back} in the back` : ''}${onWishlist(ctx.db, g, ctx.user.id, i.id) ? ' · ⭐' : ''}\n-# ${i.desc}`;
  });
  // Regulars see next week's collectible a day early
  const weekEnds = (Math.floor(ctx.now / SHOP_RULES.weekMs) + 1) * SHOP_RULES.weekMs;
  const peek = shelf === 'rare' && levelIndex(levelOf(ctx.db, g, ctx.user.id)) >= 2 && weekEnds - ctx.now < DAY ? COLLECTIBLES[collectibleOfWeek(weekEnds)] : undefined;
  const rows: Button[][] = [
    [{ label: 'Shelf', id: sessions.buttonId(sid, 'shelf'), placeholder: 'Pick a shelf', options: shelves(ctx.now).map((s) => ({ label: SHELVES[s].label, value: s, emoji: SHELVES[s].emoji, default: s === shelf, ...(isFriday(ctx.now) && s === featuredShelf(ctx.now) ? { description: `Black Friday: ${Math.round(STREET.friday.featured * 100)}% off` } : {}) })) }],
    [{ label: 'Look closer', id: sessions.buttonId(sid, 'look'), placeholder: 'Look closer at an item…', options: list.map((i) => ({ label: i.name, value: i.id, emoji: itemE(i.id, i.emoji), description: `${format(quote(ctx.db, g, i.id, ctx.user.id, ctx.now).each)} · ${stockOf(ctx.db, g, i.id) || 'sold out'}${stockOf(ctx.db, g, i.id) ? ' in stock' : ''}` })) }]
  ];
  chunk(list.slice(0, 10).map((i) => ({ label: `Buy ${i.name}`.slice(0, 80), emoji: itemE(i.id, i.emoji), id: sessions.buttonId(sid, `buy:${i.id}:1`), style: 'success' as const, disabled: avail(ctx, g, i.id) === 0 })), rows);
  rows.push(navRow(sid, 'shelf'));
  return {
    embeds: [embed('wallet', `Marquez's Shop · ${SHELVES[shelf].emoji} ${SHELVES[shelf].label}`, [
      line ?? `${emojiOr('marquez', '🏪')} *${greeting(ctx, g, list)}*`, ...dealLines(ctx, g).map((l) => `-# ${l}`), '', ...lines,
      peek ? `\n🔮 Next week's collectible, a day early (you're a regular): ${itemE(peek.id, peek.emoji)} **${peek.name}**` : null
    ], { footer: { text: `Stock is this server's own. The delivery truck comes at 8 AM, 2 PM and 8 PM Eastern.` } })],
    buttons: rows.slice(0, 5).length < rows.length ? [...rows.slice(0, 4), rows[rows.length - 1]!] : rows
  };
}

function itemView(ctx: Ctx, g: string, sid: string, shelf: Shelf, id: string, line?: string): ReplyObject {
  const it = anyItem(id);
  if (!it) return shelfView(ctx, g, sid, shelf, line);
  const q = quote(ctx.db, g, id, ctx.user.id, ctx.now);
  const left = stockOf(ctx.db, g, id), family = levelOf(ctx.db, g, ctx.user.id).id === 'family', back = family ? backOf(ctx.db, g, id) : 0;
  const tax = shopTax(ctx.db, g, ctx.now);
  const one = isCollectible(id) || !!HOLIDAY_COLLECTIBLES[id] || !!it.unlock;
  const afford = Math.floor(balance(ctx.db, wallet(g, ctx.user.id)) / Math.max(1, Math.ceil(q.each * (1 + tax))));
  const max = Math.max(0, Math.min(left + back, afford, one ? 1 : 10));
  const wished = onWishlist(ctx.db, g, ctx.user.id, id);
  const back40 = ITEMS[id] && it.ready !== false ? sellBackPrice(ctx.db, g, id) : 0;
  const buttons: Button[][] = [[
    { label: 'Buy 1', emoji: itemE(id, it.emoji), id: sessions.buttonId(sid, `buy:${id}:1`), style: 'success', disabled: left + back === 0 },
    ...(one ? [] : [{ label: 'Buy 5', id: sessions.buttonId(sid, `buy:${id}:5`), style: 'success' as const, disabled: left + back < 5 },
      { label: `Buy max${max > 1 ? ` (${max})` : ''}`, id: sessions.buttonId(sid, `buy:${id}:${Math.max(1, max)}:max`), style: 'success' as const, disabled: max < 2 }]),
    ...(regular(ITEMS[id]) ? [{ label: wished ? 'On your wishlist' : 'Add to wishlist', emoji: emojiOr('wishlist', '⭐'), id: sessions.buttonId(sid, `wish:${id}`), style: (wished ? 'primary' : 'secondary') as 'primary' | 'secondary' }] : []),
    { label: 'Back to the shelf', emoji: '↩️', id: sessions.buttonId(sid, `shelf:${shelf}`), style: 'secondary' }
  ]];
  return {
    embeds: [embed('wallet', `${itemE(id, it.emoji)} ${it.name}`, [
      line ?? `${emojiOr('marquez', '🏪')} *${greeting(ctx, g)}*`, '',
      it.desc, '',
      `**Price:** ${priceText(q)}${tax ? ` + ${Math.round(tax * 100)}% city sales tax` : ''}`,
      q.each !== q.base ? `-# ${breakdown(q, ctx.now)}` : null,
      `**Stock:** ${left ? `${left} on the shelf` : 'sold out'}${back ? ` · ${back} in the back room for you` : ''}${!left && !back ? ` · the truck comes ${discordTime(nextDelivery(ctx.now))}` : ''}`,
      back40 ? `-# Marquez buys it back for ${format(back40)} (\`${ctx.config.prefix}shop sell\`).` : null,
      wished ? '-# ⭐ On your wishlist: you\'ll get a DM when a delivery brings it.' : null
    ])],
    buttons
  };
}

/** What Chuck says when you come by: the tournament on Saturdays, the alley on you, the night, or a story. */
function chuckSays(ctx: Ctx, g: string): string {
  const L = CHUCK_LINES, h = easternHour(ctx.now);
  if (new Date(`${dayKeyOf(ctx.now)}T12:00:00Z`).getUTCDay() === 6 && ctx.rng.chance(0.5)) return ctx.rng.pick(L.saturday);
  if (heatNow(ctx.db, g, ctx.user.id, ctx.now) >= 40 && ctx.rng.chance(0.5)) return ctx.rng.pick(L.heat);
  if ((h >= 21 || h < 5) && ctx.rng.chance(0.4)) return ctx.rng.pick(L.night);
  if (ctx.rng.chance(0.4)) return ctx.rng.pick(L.rank[chuckRank(ctx.db, g, ctx.user.id).id]!);
  return ctx.rng.pick(L.greet);
}
function chuckView(ctx: Ctx, g: string, sid: string, line?: string): ReplyObject {
  const P = ctx.config.prefix;
  const tackle = TACKLE();
  const rows: Button[][] = [];
  chunk([
    ...tackle.map((i) => ({ label: `Buy ${i.name}`, emoji: itemE(i.id, i.emoji), id: sessions.buttonId(sid, `buy:${i.id}:1`), style: 'success' as const, disabled: stockOf(ctx.db, g, i.id) === 0 })),
    ...CHUCK.gear.map((id) => ({ label: `Buy ${ITEMS[id]!.name}`, emoji: itemE(id, ITEMS[id]!.emoji), id: sessions.buttonId(sid, `gear:${id}`), style: 'success' as const, disabled: count(ctx.db, g, ctx.user.id, id) > 0 }))
  ], rows);
  rows.push(navRow(sid, 'chuck'));
  return {
    embeds: [embed('wallet', `⚓ ${CHUCK.name}'s Bait & Tackle`, [
      line ?? `*An old man in a yellow raincoat looks up from a tangle of line.* "${chuckSays(ctx, g)}"`,
      '**Bait and starter rods** (restocked by the truck)',
      ...tackle.map((i) => `${itemE(i.id, i.emoji)} **${i.name}** · ${priceText(quote(ctx.db, g, i.id, ctx.user.id, ctx.now))} · ${stockOf(ctx.db, g, i.id) ? `${stockOf(ctx.db, g, i.id)} in stock` : 'sold out'}\n-# ${i.desc}`),
      '', '**Gear** (one each, yours for good)',
      ...CHUCK.gear.map((id) => `${itemE(id, ITEMS[id]!.emoji)} **${ITEMS[id]!.name}** · ${format(ITEMS[id]!.price!)} · ${ITEMS[id]!.desc}${count(ctx.db, g, ctx.user.id, id) ? ' ✅' : ''}`),
      '', (() => { const r = chuckRank(ctx.db, g, ctx.user.id), d = pagesDone(ctx.db, g, ctx.user.id), next = CHUCK_RANKS[CHUCK_RANKS.indexOf(r) + 1];
        return `⚓ Chuck calls you **${r.name}** (${d.done} of ${d.of} Fishdex pages done${next ? `; ${next.pages === Infinity ? 'all of them' : next.pages} for ${next.name}` : ''}).`; })(),
      `-# Or \`${P}fish buy <gear>\`. Worms come from composting junk: \`${P}farm compost\`.`
    ])],
    buttons: rows.slice(-5)
  };
}

function cardView(ctx: Ctx, g: string, sid: string, line?: string): ReplyObject {
  const spent = spentWith(ctx.db, g, ctx.user.id);
  const lvl = levelOf(ctx.db, g, ctx.user.id), next = nextLevel(lvl);
  const wl = wishlist(ctx.db, g, ctx.user.id);
  return {
    embeds: [embed('wallet', `🪪 Marquez's loyalty card · ${ctx.user.name}`, [
      line ?? null,
      `**${lvl.emoji} ${lvl.name}**${lvl.off ? ` · ${Math.round(lvl.off * 100)}% off everything` : ''}`,
      `Spent here: ${format(spent)}${next ? ` · ${format(next.spent - spent)} to **${next.name}**` : ' · as far as it goes'}`, '',
      ...LOYALTY.map((l) => `${spent >= l.spent ? '✅' : '▫️'} ${l.emoji} **${l.name}** (${format(l.spent)})${l.perk ? `: ${l.perk}` : ''}`), '',
      `${emojiOr('wishlist', '⭐')} **Wishlist** (${wl.length}/${STREET.wishMax}): ${wl.length ? wl.map((id) => `${itemE(id, anyItem(id)?.emoji ?? '📦')} ${anyItem(id)?.name ?? id}`).join(', ') : `empty. Add with \`${ctx.config.prefix}shop want <item>\`.`}`,
      '-# Only what you spend at Marquez\'s counts. Collectibles, the Mystery box and the Title are never discounted.'
    ])],
    buttons: [navRow(sid, 'card')]
  };
}

function storesView(ctx: Ctx, g: string, sid: string, line?: string): ReplyObject {
  const P = ctx.config.prefix;
  const all = listings(ctx.db, g);
  const owners = [...new Set(all.map((l) => l.owner_id))];
  const rows: Button[][] = [];
  chunk(owners.slice(0, 15).map((o) => ({ label: nameOf(ctx.db, o).slice(0, 60), emoji: emojiOr('stall', '🛒'), id: sessions.buttonId(sid, `store:${o}`), style: 'primary' as const })), rows);
  rows.push(navRow(sid, 'stores'));
  return {
    embeds: [embed('wallet', '🛒 Player stores', [
      line ?? '*Hand-lettered signs, mismatched shelves, prices that make no sense. Or perfect sense, if you look closely.*', '',
      ...(owners.length ? owners.map((o) => {
        const mine = all.filter((l) => l.owner_id === o);
        const closed = storesOf(ctx.db, g, o, ctx.now).every((l) => !isOpen(l));
        return `**${nameOf(ctx.db, o)}** · ${mine.length} item${mine.length === 1 ? '' : 's'}${closed ? ' · 🔒 closed' : ''}\n-# ${mine.slice(0, 4).map((l) => `${itemE(l.item, anyItem(l.item)?.emoji ?? '📦')} ${itemName(l.item)} ${format(l.price)}`).join(' · ')}${mine.length > 4 ? ' …' : ''}`;
      }) : ['Nobody has opened a store yet.']),
      '', `-# Own a finished Corner Shop? Stock it: \`${P}shop stock <item> [n] at <price>\`. Buyers pay your price plus the city's sales tax; you keep the price.`
    ])],
    buttons: rows.slice(-5)
  };
}

function storeView(ctx: Ctx, g: string, sid: string, owner: string, line?: string): ReplyObject {
  const P = ctx.config.prefix;
  const mine = listings(ctx.db, g, owner);
  const shops = storesOf(ctx.db, g, owner, ctx.now);
  const self = owner === ctx.user.id;
  const open = (l: Listing) => { const s = shops.find((x) => x.lot === l.lot); return !!s && isOpen(s); };
  const rows: Button[][] = [];
  if (!self) chunk(mine.slice(0, 15).map((l) => ({ label: `Buy ${itemName(l.item)}`.slice(0, 80), emoji: itemE(l.item, anyItem(l.item)?.emoji ?? '📦'), id: sessions.buttonId(sid, `sbuy:${l.id}`), style: 'success' as const, disabled: !open(l) })), rows);
  rows.push(navRow(sid, 'stores').map((b) => (b.id.endsWith('go:stores') ? { ...b, disabled: false } : b)));
  const tax = shopTax(ctx.db, g, ctx.now);
  return {
    embeds: [embed('wallet', `🛒 ${self ? 'Your store' : `${nameOf(ctx.db, owner)}'s store`}`, [
      line ?? null,
      ...(shops.length ? shops.map((s) => `🏪 Corner Shop on **${tileName(s.lot)}** · ${listings(ctx.db, g, owner).filter((l) => l.lot === s.lot).length}/${slotsOf(s)} slots${isOpen(s) ? '' : ` · 🔒 closed (${s.squatters ? 'squatters' : `condition ${s.condition}%`})`}`) : ['No Corner Shop.']), '',
      ...(mine.length ? mine.map((l) => `${itemE(l.item, anyItem(l.item)?.emoji ?? '📦')} **${itemName(l.item)}** × ${l.qty} · ${format(l.price)} each${!open(l) ? ' · 🔒' : ''}`) : ['The shelves are empty.']),
      tax && !self ? `-# Plus ${Math.round(tax * 100)}% city sales tax.` : null,
      self ? `\n-# \`${P}shop stock <item> [n] at <price>\` · \`${P}shop unstock <item> [n|all]\` · a Corner Shop under ${STORES.minCondition}% (or with squatters) closes until repaired.` : null
    ])],
    buttons: rows.slice(-5)
  };
}

// ---------------------------------------------------------------- buttons and dropdowns

export function onShopButton(ctx: Ctx, s: sessions.Session<{ view: View }>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}shop\` to open your own.` };
  const g = s.guild_id!;
  const [kind, a, b] = value.split(':') as [string, string | undefined, string | undefined];
  const view = s.state.view ?? { v: 'hub' };
  const go = (v: View, line?: string): SessionReply => {
    sessions.save(ctx.db, s.id, { view: v });
    const { session: _x, ...r } = render(ctx, g, s.id, v, line);
    return { update: r };
  };
  const lastShelf = (): Shelf => ('shelf' in view ? view.shelf : 'work');
  switch (kind) {
    case 'go':
      if (a === 'shelf') return go({ v: 'shelf', shelf: lastShelf() });
      if (a === 'hub' || a === 'stores' || a === 'chuck' || a === 'card') return go({ v: a });
      return {};
    case 'shelf': return a && a in SHELVES ? go({ v: 'shelf', shelf: a as Shelf }) : {};
    case 'look': return a && anyItem(a) ? go({ v: 'item', shelf: lastShelf(), item: a }) : {};
    case 'store': return a ? go({ v: 'store', owner: a }) : {};
    case 'wish': {
      if (!a) return {};
      if (onWishlist(ctx.db, g, ctx.user.id, a)) { unwish(ctx.db, g, ctx.user.id, a); return go(view, `⭐ Off your wishlist: ${anyItem(a)?.name}.`); }
      return go(view, wish(ctx.db, g, ctx.user.id, a, ctx.now) ? `⭐ On your wishlist: ${anyItem(a)?.name}. You'll get a DM when a delivery brings it.` : `Your wishlist is full (${STREET.wishMax}). Take something off first.`);
    }
    case 'buy': {
      if (!a) return {};
      let line: string;
      try { line = bought(ctx, g, buy(ctx.db, ctx.rng, g, ctx.user.id, a, Math.max(1, Math.min(10, Number(b) || 1)), ctx.now)); } catch (e) { line = refusal(e, ctx); }
      return go(view, line);
    }
    case 'gear': {
      if (!a) return {};
      let line: string;
      try { const r = ctx.db.tx(() => buyGear(ctx.db, g, ctx.user.id, a, ctx.now)); line = `${CHUCK.name} hands it over. "${ctx.rng.pick(a === 'boat' ? CHUCK_LINES.boat : CHUCK_LINES.handover)}"\n-# −${format(r.price)}.`; } catch (e) { line = refusal(e, ctx); }
      return go(view, line);
    }
    case 'sbuy': {
      let line: string;
      try { line = storeBought(ctx, g, buyFrom(ctx.db, g, ctx.user.id, Number(a), 1, ctx.now)); } catch (e) { line = refusal(e, ctx); }
      return go(view, line);
    }
  }
  return {};
}

function storeBought(ctx: Ctx, g: string, r: ReturnType<typeof buyFrom>): string {
  const what = `${r.qty > 1 ? `${r.qty} × ` : ''}${itemName(r.listing.item)}`;
  receipt(ctx.db, g, ctx.user.id, `Bought ${what} from ${nameOf(ctx.db, r.listing.owner_id)}'s store`, [['Item', `${itemE(r.listing.item, anyItem(r.listing.item)?.emoji ?? '📦')} ${itemName(r.listing.item)}`], ['Quantity', String(r.qty)], r.tax ? ['Sales tax', format(r.tax), '-'] : null, ['Price', format(r.cost + r.tax), '-'], ['Balance', format(r.cash)]]);
  receipt(ctx.db, g, r.listing.owner_id, `Your store sold ${what}`, [['Buyer', nameOf(ctx.db, ctx.user.id)], ['Item', itemName(r.listing.item)], ['Quantity', String(r.qty)], ['Paid to you', format(r.cost), '+'], r.emptied ? ['Shelf', 'sold out'] : null]);
  return `🛒 Bought ${what} from ${nameOf(ctx.db, r.listing.owner_id)}'s store for ${format(r.cost + r.tax)}${r.tax ? ` (with ${format(r.tax)} tax)` : ''}. Balance: ${format(r.cash)}.`;
}

// ---------------------------------------------------------------- the truck

/** Posted in a busy channel when a delivery is announced (see index.ts). */
export function truckEmbed(db: Ctx['db'], g: string, now: number, prefix: string): ReturnType<typeof embed> {
  const deal = ITEMS[dailyDeal(now)]!;
  const movers = Object.values(ITEMS).filter((i) => regular(i)).map((i) => ({ i, q: quote(db, g, i.id, null, now) })).filter((x) => Math.abs(x.q.factor - 1) >= 0.1);
  const up = movers.filter((x) => x.q.factor > 1).sort((a, b) => b.q.factor - a.q.factor)[0], down = movers.filter((x) => x.q.factor < 1).sort((a, b) => a.q.factor - b.q.factor)[0];
  return embed('wallet', '🚚 Marquez\'s delivery truck just pulled up', [
    `*${['Marquez props the door open with a crate. Boxes everywhere.', 'The truck backs up to the curb, beeping. Marquez signs for it without looking.', 'Fresh stock, still smelling of cardboard. Marquez starts stacking shelves.'][Math.floor(now / 60_000) % 3]}*`, '',
    'Every shelf is full again.',
    `${emojiOr('deal', '🏷️')} Today's deal: ${itemE(deal.id, deal.emoji)} **${deal.name}** ${Math.round(STREET.dailyDeal * 100)}% off`,
    isFriday(now) ? `${emojiOr('black_friday', '🖤')} **Black Friday:** ${SHELVES[featuredShelf(now)].emoji} ${SHELVES[featuredShelf(now)].label} ${Math.round(STREET.friday.featured * 100)}% off, everything else ${Math.round(STREET.friday.rest * 100)}%` : null,
    up ? `${emojiOr('up', '▲')} ${up.i.name} is in demand (×${up.q.factor.toFixed(2)})` : null,
    down ? `${emojiOr('down', '▼')} ${down.i.name} is going cheap (×${down.q.factor.toFixed(2)})` : null,
    '', `-# \`${prefix}shop\` · next delivery ${discordTime(nextDelivery(now))}`
  ]);
}

// ---------------------------------------------------------------- r!shop and its words

function open(ctx: Ctx, g: string, view: View, line?: string): ReplyObject {
  const s = sessions.create(ctx.db, { kind: 'shop', guildId: g, channelId: ctx.channelId, userId: ctx.user.id, state: { view }, ttlMs: 10 * 60_000, now: ctx.now });
  return render(ctx, g, s.id, view, line);
}
/** Chuck Alfrey's, opened from r!fish shop too. */
export const chuck = (ctx: Ctx, g: string): ReplyObject => { restock(ctx.db, ctx.rng, g, ctx.now); return open(ctx, g, { v: 'chuck' }); };

/** An item in your inventory by name ("golden nacho", "prime corn"). */
function invItem(ctx: Ctx, g: string, name: string): string | null {
  const n = name.toLowerCase().trim();
  const inv = invItems(ctx.db, g, ctx.user.id);
  return (inv.find((r) => r.item === n || itemName(r.item).toLowerCase() === n) ?? inv.find((r) => n.length >= 3 && itemName(r.item).toLowerCase().startsWith(n)))?.item ?? null;
}

function stockCmd(ctx: Ctx, g: string, text: string): ReplyObject {
  const P = ctx.config.prefix;
  const m = /^(.*?)(?:\s+(\d+|all))?\s+(?:at|for|@)\s+⬡?([\d.,]+[kmb]?)(?:\s+(?:on|in)\s+(\S+))?$/i.exec(text.trim());
  if (!m) throw new GameError('store.usage', `Stock your store with \`${P}shop stock <item> [how many|all] at <price>\`, like \`${P}shop stock coffee 3 at 150\`. Add \`on C4\` to pick a Corner Shop.`);
  const id = invItem(ctx, g, m[1]!);
  if (!id) throw new GameError('store.item', `You don't have any "${m[1]}". Check \`${P}inventory\`.`);
  const have = count(ctx.db, g, ctx.user.id, id);
  const qty = !m[2] ? 1 : /^all$/i.test(m[2]) ? have : Number(m[2]);
  const price = parseAmount(m[3]!);
  let lot: number | undefined;
  if (m[4]) { const t = parseTile(m[4]); if (t === null) throw new GameError('store.tile', `"${m[4]}" isn't a tile. Tiles look like C4.`); lot = t; }
  const l = stockShelf(ctx.db, g, ctx.user.id, id, qty, price, ctx.now, lot);
  const it = anyItem(id);
  const vsMarquez = ITEMS[id] && regular(ITEMS[id]) ? quote(ctx.db, g, id, null, ctx.now).each : 0;
  return open(ctx, g, { v: 'store', owner: ctx.user.id }, [
    `🏪 On the shelf at **${tileName(l.lot)}**: ${qty} × ${itemE(id, it?.emoji ?? '📦')} ${itemName(id)} at **${format(price)}** each (${l.qty} there now).`,
    vsMarquez ? `-# Marquez sells it for ${format(vsMarquez)} right now${price > vsMarquez ? ', so you\'ll want a reason for people to pick yours.' : '.'}` : null
  ].filter(Boolean).join('\n'));
}
function unstockCmd(ctx: Ctx, g: string, text: string): ReplyObject {
  const m = /^(.*?)(?:\s+(\d+|all))?$/i.exec(text.trim());
  const want = (m?.[1] ?? '').toLowerCase();
  const l = listings(ctx.db, g, ctx.user.id).find((x) => x.item === want || itemName(x.item).toLowerCase() === want || (want.length >= 3 && itemName(x.item).toLowerCase().startsWith(want)));
  if (!want || !l) throw new GameError('store.unlisted', `Take what down? \`${ctx.config.prefix}shop store\` shows your shelves.`);
  const r = unstockShelf(ctx.db, g, ctx.user.id, l.item, !m?.[2] || /^all$/i.test(m[2]) ? 'all' : Number(m[2]));
  return open(ctx, g, { v: 'store', owner: ctx.user.id }, `↩️ ${r.qty} × ${itemName(r.item)} back in your inventory.`);
}
function wantCmd(ctx: Ctx, g: string, text: string): ReplyObject {
  const P = ctx.config.prefix;
  const t = text.trim();
  if (!t) return open(ctx, g, { v: 'card' });
  if (/^clear$/i.test(t)) { ctx.db.run('DELETE FROM shop_wish WHERE guild_id = ? AND user_id = ?', g, ctx.user.id); return open(ctx, g, { v: 'card' }, '⭐ Wishlist cleared.'); }
  const id = findItem(t);
  if (!id || !regular(ITEMS[id])) throw new GameError('wish.item', `Marquez doesn't stock "${t}" on his regular shelves. \`${P}shop\` shows what he has.`);
  if (onWishlist(ctx.db, g, ctx.user.id, id)) { unwish(ctx.db, g, ctx.user.id, id); return open(ctx, g, { v: 'card' }, `⭐ Off your wishlist: ${ITEMS[id]!.name}.`); }
  if (!wish(ctx.db, g, ctx.user.id, id, ctx.now)) throw new GameError('wish.full', `Your wishlist is full (${STREET.wishMax}). Take something off with \`${P}shop want <item>\` again.`);
  return open(ctx, g, { v: 'card' }, `⭐ On your wishlist: ${itemE(id, ITEMS[id]!.emoji)} ${ITEMS[id]!.name}. You'll get a DM when a delivery brings it.`);
}

export const shop: Command = {
  name: 'shop',
  aliases: ['store', 'marquez', 'mainstreet', 'street'],
  description: 'Main Street: Marquez\'s shop, Chuck\'s tackle and player stores; buy, sell, wishlist, stock your store',
  system: 'wallet',
  guildOnly: true,
  options: [
    { name: 'shelf', type: 'string', description: 'Blank for Main Street, a shelf, @player, or: buy, sell, want, stores, store, stock, unstock, card' },
    { name: 'details', type: 'string', description: 'The rest: "coffee 3" to buy or sell, "coffee 3 at 150" to stock your store' }
  ],
  run(ctx, args) {
    const { guildId: g } = me(ctx);
    restock(ctx.db, ctx.rng, g, ctx.now);
    const word = String(args.shelf ?? '').trim();
    const rest = String(args.details ?? '').trim();
    const w = word.toLowerCase();
    const mention = /^<@!?(\d{5,22})>$/.exec(word) ?? /^(\d{15,22})$/.exec(word);
    if (mention) {
      const owner = mention[1]!;
      if (!rest) return open(ctx, g, { v: 'store', owner });
      // r!shop @player coffee 2
      const m = /^(.*?)(?:\s+(\d+))?$/.exec(rest)!;
      const want = m[1]!.toLowerCase();
      const l = listings(ctx.db, g, owner).find((x) => itemName(x.item).toLowerCase() === want || x.item === want || (want.length >= 3 && itemName(x.item).toLowerCase().startsWith(want)));
      if (!l) throw new GameError('store.unlisted', `That store doesn't have "${m[1]}".`);
      return open(ctx, g, { v: 'store', owner }, storeBought(ctx, g, buyFrom(ctx.db, g, ctx.user.id, l.id, Number(m[2] ?? 1), ctx.now)));
    }
    switch (w) {
      case '': case 'street': case 'main': case 'hub': case 'deals': case 'deal': case 'sale': case 'friday': return open(ctx, g, { v: 'hub' });
      case 'marquez': return open(ctx, g, { v: 'shelf', shelf: findShelf(rest, ctx.now) ?? 'work' });
      case 'chuck': case 'docks': case 'tackle': case 'bait': return open(ctx, g, { v: 'chuck' });
      case 'card': case 'loyalty': case 'wishlist': return open(ctx, g, { v: 'card' });
      case 'want': case 'wish': return wantCmd(ctx, g, rest);
      case 'stores': return open(ctx, g, { v: 'stores' });
      case 'store': case 'mystore': return open(ctx, g, { v: 'store', owner: ctx.user.id });
      case 'stock': case 'list': return stockCmd(ctx, g, rest);
      case 'unstock': case 'unlist': case 'takedown': return unstockCmd(ctx, g, rest);
    }
    const shelf = findShelf(w, ctx.now);
    if (shelf) return open(ctx, g, { v: 'shelf', shelf });
    return open(ctx, g, { v: 'hub' }, `There's no shelf called "${word}". Here's the street.`);
  }
};

export const purchase: Command = {
  name: 'purchase', aliases: ['buyitem'],
  description: 'Buy an item from Marquez by name',
  system: 'wallet',
  guildOnly: true,
  options: [
    { name: 'item', type: 'string', description: 'Item name, e.g. coffee or "rocket fuel"', required: true },
    { name: 'amount', type: 'string', description: 'How many (default 1)' }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    // "r!purchase rocket fuel 2": the last word may be the amount
    let name = String(args.item ?? '').trim(), amount = String(args.amount ?? '').trim();
    const m = /^(.*\S)\s+(\d+)$/.exec(name);
    if (!amount && m) { name = m[1]!; amount = m[2]!; }
    const id = findItem(name);
    if (!id) throw new GameError('shop.unknown', `Marquez does not stock "${name}". See \`${ctx.config.prefix}shop\`.`);
    if (CHUCK.gear.includes(id)) throw new GameError('shop.chuck', `That's ${CHUCK.name}'s. \`${ctx.config.prefix}fish buy ${ITEMS[id]!.name.toLowerCase()}\`.`);
    const qty = parseCount(amount || '1', { max: 10 });
    try {
      const r = buy(ctx.db, ctx.rng, guildId, ctx.user.id, id, qty, ctx.now);
      return { embeds: [embed('wallet', `🛍️ ${r.item.emoji} ${r.item.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`, [bought(ctx, guildId, r)])] };
    } catch (e) {
      throw new GameError('shop.refused', refusal(e, ctx));
    }
  }
};

export const inventory: Command = {
  name: 'inventory',
  aliases: ['inv', 'items', 'bag'],
  description: 'The items you own in this server',
  system: 'wallet',
  guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const all = invItems(ctx.db, guildId, ctx.user.id);
    const list = all.filter((r) => !isCatch(r.item) && !isCropItem(r.item));   // fish live in the bag, crops in the basket
    const crops = all.filter((r) => isCropItem(r.item)).reduce((s, r) => s + r.qty, 0);
    const fish = all.filter((r) => isCatch(r.item)).reduce((s, r) => s + r.qty, 0) + bagCount(ctx.db, guildId, ctx.user.id);
    const lines = list.map(({ item, qty }) => {
      const it = anyItem(item);
      return it ? `${itemE(it.id, it.emoji)} **${it.name}** × ${qty}${it.passive ? ' · works on its own' : ''}` : `${item} × ${qty}`;
    });
    if (crops) lines.push(`${emojiOr('harvest', '🧺')} **Harvest basket** (${crops}) · \`${ctx.config.prefix}farm\``);
    if (fish || list.some((r) => r.item === 'rod')) lines.push(`${emojiOr('fishing', '🎣')} **Fishing bag** (${fish}/${bagMax(ctx.db, guildId, ctx.user.id)}) · \`${ctx.config.prefix}fish bag\``);
    return { embeds: [embed('wallet', `Inventory: ${ctx.user.name}`, lines.length ? lines : ['Your inventory is empty. Marquez is open: `/shop`.'],
      { footer: { text: `${ctx.config.prefix}use <item> to use one` } })] };
  }
};

export const use: Command = {
  name: 'use', aliases: ['open'],
  description: 'Use an item from your inventory',
  system: 'wallet',
  guildOnly: true,
  options: [
    { name: 'item', type: 'string', description: 'Item name, e.g. coffee', required: true },
    { name: 'amount', type: 'string', description: 'How many (up to 25, or "all"), or for a Rush Order: the item to restock' }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    // "/use mystery 10", "/use mystery all", "/use rush order coffee"
    let text = String(args.item ?? '').trim(), extra = String(args.amount ?? '').trim();
    let id = findItem(text);
    if (!id) {
      const words = text.split(/\s+/);
      for (let k = words.length - 1; k > 0 && !id; k--) { id = findItem(words.slice(0, k).join(' ')); if (id) extra = `${words.slice(k).join(' ')} ${extra}`.trim(); }
    }
    if (!id) throw new GameError('use.unknown', 'That item does not exist.');
    const it = anyItem(id)!;
    const head = `${itemE(it.id, it.emoji)} `;
    if (id === 'rushorder') return { embeds: [embed('wallet', `${it.emoji} ${it.name}`, [head + useItem(ctx, guildId, id, extra)])] };
    const n: number | 'all' = /^all$/i.test(extra) ? 'all' : /^\d+$/.test(extra) ? Math.max(1, Number(extra)) : 1;
    const r = useMany(ctx, guildId, id, n);
    const left = count(ctx.db, guildId, ctx.user.id, id);
    return { embeds: [embed('wallet', r.used > 1 ? `${it.emoji} ${it.name} × ${r.used}` : `${it.emoji} ${it.name}`, [
      ...r.lines.map((l) => head + l),
      r.used > 1 || left ? `-# ${left ? `${left} left` : 'That was your last one'}.${n === 'all' && left ? ` (At most ${BULK_MAX} at a time.)` : ''}` : null
    ])] };
  }
};

/** "coffee 3", "rocket fuel all", "mystery": the item, and how many (default 1). */
function itemAndCount(ctx: Ctx, guildId: string, itemArg: unknown, amountArg: unknown, what: string): { id: string; qty: number } {
  let name = String(itemArg ?? '').trim(), amount = String(amountArg ?? '').trim();
  const m = /^(.*\S)\s+(\d+|all)$/i.exec(name);
  if (!amount && m) { name = m[1]!; amount = m[2]!; }
  const id = findItem(name);
  if (!id) throw new GameError('item.unknown', `There's no item called "${name}". Check \`${ctx.config.prefix}inventory\`.`);
  const have = count(ctx.db, guildId, ctx.user.id, id);
  if (!have) throw new GameError('item.none', `You don't have any ${anyItem(id)!.name} to ${what}.`);
  const qty = /^all$/i.test(amount) ? have : parseCount(amount || '1', { max: 1000 });
  if (qty > have) throw new GameError('item.short', `You have ${have} × ${anyItem(id)!.name}.`);
  return { id, qty };
}

export const sellitem: Command = {
  name: 'sellitem', aliases: ['sellback', 'pawn'],
  description: `Sell items back to Marquez for ${SELL_BACK * 100}% of his price`,
  system: 'wallet',
  guildOnly: true,
  options: [
    { name: 'item', type: 'string', description: 'Item name, e.g. coffee', required: true },
    { name: 'amount', type: 'string', description: 'How many (default 1), or "all"' }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const { id, qty } = itemAndCount(ctx, guildId, args.item, args.amount, 'sell');
    const r = sellBack(ctx.db, guildId, ctx.user.id, id, qty, ctx.now);
    receipt(ctx.db, guildId, ctx.user.id, `Sold ${r.qty > 1 ? `${r.qty} × ` : 'a '}${r.item.name} back`, [['Paid to you', format(r.paid), '+'], ['Balance', format(r.cash)]]);
    const left = count(ctx.db, guildId, ctx.user.id, id);
    return { embeds: [embed('wallet', `🛍️ Sold: ${r.item.emoji} ${r.item.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`, [
      `Marquez looks it over and gives you **${format(r.paid)}**${r.qty > 1 ? ` (${format(r.paid / r.qty)} each)` : ''}. It's back on his shelf.`,
      `-# ${left ? `${left} left. ` : ''}Balance: ${format(r.cash)}.`
    ])] };
  }
};

export const discard: Command = {
  name: 'discard', aliases: ['toss', 'trash', 'throwaway'],
  description: 'Throw items away (for nothing)',
  system: 'wallet',
  guildOnly: true,
  options: [
    { name: 'item', type: 'string', description: 'Item name, e.g. floppy', required: true },
    { name: 'amount', type: 'string', description: 'How many (default 1), or "all"' }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const { id, qty } = itemAndCount(ctx, guildId, args.item, args.amount, 'throw away');
    const it = anyItem(id)!;
    takeItem(ctx.db, guildId, ctx.user.id, id, qty);
    const back = ITEMS[id] && ITEMS[id]!.ready !== false ? sellBackPrice(ctx.db, guildId, id) * qty : 0;
    return { embeds: [embed('wallet', `🗑️ ${it.emoji} ${it.name}${qty > 1 ? ` × ${qty}` : ''}`, [
      `Gone. ${qty > 1 ? 'They\'re' : 'It\'s'} in the bin behind Marquez's shop.`,
      back ? `-# Next time, Marquez would have paid ${format(back)} for ${qty > 1 ? 'them' : 'it'}: \`${ctx.config.prefix}shop sell\`.` : null
    ])] };
  }
};

export const settitle: Command = {
  name: 'settitle', aliases: ['title'],
  description: 'Set your profile title (uses a Title item), or "clear" to remove it',
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'title', type: 'string', description: 'Up to 32 characters, or "clear" to remove yours', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    if (/^(clear|remove|none|off)$/i.test(String(args.title ?? '').trim())) {
      ctx.db.run('UPDATE players SET title = NULL WHERE guild_id = ? AND user_id = ?', guildId, ctx.user.id);
      return { embeds: [embed('wallet', 'Title cleared', ['Your profile has no title now. A new one takes another Title item.'])] };
    }
    const t = String(args.title ?? '').replace(/[\n\r`*_~|<>@#]/g, '').trim().slice(0, 32);
    if (!t) throw new GameError('title.empty', 'Enter a title of up to 32 characters.');
    return ctx.db.tx(() => {
      if (!takeItem(ctx.db, guildId, ctx.user.id, 'title')) throw new GameError('title.none', `A Title item is required. Marquez sells them (${format(priceOf(ctx.db, guildId, 'title'))}).`);
      ctx.db.run('UPDATE players SET title = ? WHERE guild_id = ? AND user_id = ?', t, guildId, ctx.user.id);
      return { embeds: [embed('wallet', 'Title set', [`Your title is now *${t}*.`])] };
    });
  }
};

export const cleartitle: Command = {
  name: 'cleartitle',
  description: "Moderators: remove a player's title",
  system: 'admin',
  guildOnly: true,
  options: [{ name: 'player', type: 'user', description: 'Whose title', required: true }],
  run(ctx, args) {
    if (!ctx.isMod) throw new GameError('mod.only', 'This command is restricted to moderators (Manage Server).');
    ctx.db.run('UPDATE players SET title = NULL WHERE guild_id = ? AND user_id = ?', ctx.guildId, String(args.player ?? ''));
    return { embeds: [embed('admin', 'Title cleared', [`<@${args.player}>`])] };
  }
};

