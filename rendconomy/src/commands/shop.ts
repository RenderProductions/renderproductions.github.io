import { itemE } from '../discord/icons';
import { emojiOr } from '../discord/emoji';
import { nameOf, receipt } from '../social/receipts';
import { GameError } from '../core/errors';
import { format, parseCount } from '../core/money';
import * as sessions from '../core/sessions';
import { embed } from '../discord/style';
import { count, items as invItems, takeItem } from '../shop/inventory';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ITEMS, SHELVES, anyItem, findItem, marquez, type Shelf } from '../shop/items';
import { isHoliday } from '../holidays/holidays';
import { SELL_BACK, SHOP_RULES, ShopError, buy, collectibleOfWeek, priceOf, restock, sellBack, sellBackPrice, stockOf } from '../shop/shop';
import { BULK_MAX, useItem, useMany } from '../shop/use';
import { FISHING, isCatch } from '../fishing/fishing';
import { isCropItem } from '../farming/farming';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

const shelfItems = (shelf: Shelf, now: number) =>
  shelf === 'rare' ? [COLLECTIBLES[collectibleOfWeek(now)]!]
    : shelf === 'holiday' ? (isHoliday(now) ? [...Object.values(HOLIDAY_COLLECTIBLES).filter((i) => i.stock > 0), ...Object.values(ITEMS).filter((i) => i.shelf === 'holiday')] : [])
    : Object.values(ITEMS).filter((i) => i.shelf === shelf && i.ready);
const shelves = (now: number) => (Object.keys(SHELVES) as Shelf[]).filter((s) => shelfItems(s, now).length);

function shopView(ctx: Ctx, shelf: Shelf, sessionId: string, line: string): ReplyObject {
  const restocked = restock(ctx.db, ctx.rng, ctx.now);
  const list = shelfItems(shelf, ctx.now);
  const lines = list.map((i) => {
    const left = stockOf(ctx.db, i.id);
    return `${itemE(i.id, i.emoji)} **${i.name}** · ${format(priceOf(ctx.db, i.id))} · ${left ? `${left} in stock` : 'sold out'}\n-# ${i.desc}`;
  });
  const tabs: Button[] = shelves(ctx.now).map((s) => ({ label: SHELVES[s].label, emoji: SHELVES[s].emoji, id: sessions.buttonId(sessionId, `shelf:${s}`), style: s === shelf ? 'primary' : 'secondary' }));
  const buys: Button[] = list.map((i) => ({ label: `Buy ${i.name}`.slice(0, 80), emoji: itemE(i.id, i.emoji), id: sessions.buttonId(sessionId, `buy:${i.id}`), style: 'success', disabled: stockOf(ctx.db, i.id) === 0 }));
  const rows: Button[][] = [];
  const pushRows = (bs: Button[]) => bs.forEach((b, i) => { if (i % 5 === 0) rows.push([]); rows[rows.length - 1]!.push(b); });
  pushRows(tabs); pushRows(buys);
  return {
    embeds: [embed('wallet', `Marquez's Shop · ${SHELVES[shelf].emoji} ${SHELVES[shelf].label}`, [
      `*${line}*`, '', ...lines
    ], { footer: { text: `Stock is shared by every server and restocks hourly. Next restock: ${new Date(restocked + SHOP_RULES.restockMs).toUTCString().slice(17, 22)} UTC` } })],
    buttons: rows.slice(0, 5), session: sessionId
  };
}

export const shop: Command = {
  name: 'shop',
  aliases: ['store', 'marquez'],
  description: "Marquez's shop: items, shelves and this week's collectible",
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'shelf', type: 'string', description: 'work, market, casino, fun, rare...' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const want = String(args.shelf ?? '').trim().toLowerCase();
    const shelf = (shelves(ctx.now).find((s) => s === want || SHELVES[s].label.toLowerCase().startsWith(want)) ?? 'work') as Shelf;
    const s = sessions.create(ctx.db, { kind: 'shop', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { shelf }, ttlMs: 10 * 60_000, now: ctx.now });
    return shopView(ctx, shelf, s.id, marquez(isHoliday(ctx.now) ? 'holiday' : 'greet', ctx.rng));
  }
};

function marquezFor(e: unknown, ctx: Ctx): string {
  if (e instanceof ShopError && ['soldOut', 'broke', 'once', 'notThisWeek'].includes(e.why)) return `${marquez(e.why as 'soldOut', ctx.rng)}\n${e.message}`;
  throw e;
}

export function onShopButton(ctx: Ctx, s: sessions.Session<{ shelf: Shelf }>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}shop\` to open your own.` };
  const [kind, id] = value.split(':') as [string, string];
  if (kind === 'shelf' && id in SHELVES) {
    sessions.save(ctx.db, s.id, { shelf: id as Shelf });
    const { session: _x, ...v } = shopView(ctx, id as Shelf, s.id, marquez(isHoliday(ctx.now) ? 'holiday' : 'greet', ctx.rng));
    return { update: v };
  }
  if (kind === 'buy') {
    let line: string;
    try {
      const r = buy(ctx.db, ctx.rng, s.guild_id!, ctx.user.id, id, 1, ctx.now);
      line = `${marquez('thanks', ctx.rng)}\nPurchased: ${itemE(r.item.id, r.item.emoji)} ${r.item.name} for ${format(r.cost)}. Balance: ${format(r.cash)}.`;
    } catch (e) { line = marquezFor(e, ctx); }
    const { session: _x, ...v } = shopView(ctx, s.state.shelf, s.id, line);
    return { update: v };
  }
  return {};
}

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
    const qty = parseCount(amount || '1', { max: 10 });
    try {
      const r = buy(ctx.db, ctx.rng, guildId, ctx.user.id, id, qty, ctx.now);
      receipt(ctx.db, guildId, ctx.user.id, `Bought ${r.qty > 1 ? `${r.qty} × ` : 'a '}${r.item.name}`, [['Item', `${itemE(r.item.id, r.item.emoji)} ${r.item.name}`], ['Quantity', String(r.qty)], ['Price', format(r.cost), '-'], ['Balance', format(r.cash)]]);
      return { embeds: [embed('wallet', `🛍️ ${r.item.emoji} ${r.item.name}${r.qty > 1 ? ` × ${r.qty}` : ''}`, [`*${marquez('thanks', ctx.rng)}*`, `${r.qty} × ${itemE(r.item.id, r.item.emoji)} ${r.item.name}: ${format(r.cost)}`, `Balance: ${format(r.cash)}`,
        r.item.passive ? '-# This item works on its own while it is in your inventory.' : `-# Use it with \`${ctx.config.prefix}use ${r.item.name.toLowerCase()}\`.`])] };
    } catch (e) {
      throw new GameError('shop.refused', marquezFor(e, ctx));
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
    const fish = all.filter((r) => isCatch(r.item)).reduce((s, r) => s + r.qty, 0);
    const lines = list.map(({ item, qty }) => {
      const it = anyItem(item);
      return it ? `${itemE(it.id, it.emoji)} **${it.name}** × ${qty}${it.passive ? ' · works on its own' : ''}` : `${item} × ${qty}`;
    });
    if (crops) lines.push(`${emojiOr('harvest', '🧺')} **Harvest basket** (${crops}) · \`${ctx.config.prefix}farm\``);
    if (fish || list.some((r) => r.item === 'rod')) lines.push(`${emojiOr('fishing', '🎣')} **Fishing bag** (${fish}/${FISHING.bagMax}) · \`${ctx.config.prefix}fish bag\``);
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
    const back = ITEMS[id] && ITEMS[id]!.ready !== false ? sellBackPrice(ctx.db, id) * qty : 0;
    return { embeds: [embed('wallet', `🗑️ ${it.emoji} ${it.name}${qty > 1 ? ` × ${qty}` : ''}`, [
      `Gone. ${qty > 1 ? 'They\'re' : 'It\'s'} in the bin behind Marquez's shop.`,
      back ? `-# Next time, Marquez would have paid ${format(back)} for ${qty > 1 ? 'them' : 'it'}: \`${ctx.config.prefix}sellitem\`.` : null
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
      if (!takeItem(ctx.db, guildId, ctx.user.id, 'title')) throw new GameError('title.none', `A Title item is required. Marquez sells them (${format(priceOf(ctx.db, 'title'))}).`);
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

