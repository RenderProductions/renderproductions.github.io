import { GameError } from '../core/errors';
import { format, parseCount } from '../core/money';
import * as sessions from '../core/sessions';
import { embed } from '../discord/style';
import { items as invItems, takeItem } from '../shop/inventory';
import { COLLECTIBLES, ITEMS, SHELVES, anyItem, findItem, marquez, type Shelf } from '../shop/items';
import { SHOP_RULES, ShopError, buy, collectibleOfWeek, priceOf, restock, stockOf } from '../shop/shop';
import { useItem } from '../shop/use';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

const shelfItems = (shelf: Shelf, now: number) =>
  shelf === 'rare' ? [COLLECTIBLES[collectibleOfWeek(now)]!] : Object.values(ITEMS).filter((i) => i.shelf === shelf && i.ready);
const shelves = (now: number) => (Object.keys(SHELVES) as Shelf[]).filter((s) => shelfItems(s, now).length);

function shopView(ctx: Ctx, shelf: Shelf, sessionId: string, line: string): ReplyObject {
  const restocked = restock(ctx.db, ctx.rng, ctx.now);
  const list = shelfItems(shelf, ctx.now);
  const lines = list.map((i) => {
    const left = stockOf(ctx.db, i.id);
    return `${i.emoji} **${i.name}** · ${format(priceOf(ctx.db, i.id))} · ${left ? `${left} in stock` : 'sold out'}\n-# ${i.desc}`;
  });
  const tabs: Button[] = shelves(ctx.now).map((s) => ({ label: SHELVES[s].label, emoji: SHELVES[s].emoji, id: sessions.buttonId(sessionId, `shelf:${s}`), style: s === shelf ? 'primary' : 'secondary' }));
  const buys: Button[] = list.map((i) => ({ label: `Buy ${i.name}`.slice(0, 80), emoji: i.emoji, id: sessions.buttonId(sessionId, `buy:${i.id}`), style: 'success', disabled: stockOf(ctx.db, i.id) === 0 }));
  const rows: Button[][] = [];
  const pushRows = (bs: Button[]) => bs.forEach((b, i) => { if (i % 4 === 0) rows.push([]); rows[rows.length - 1]!.push(b); });
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
    return shopView(ctx, shelf, s.id, marquez('greet', ctx.rng));
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
    const { session: _x, ...v } = shopView(ctx, id as Shelf, s.id, marquez('greet', ctx.rng));
    return { update: v };
  }
  if (kind === 'buy') {
    let line: string;
    try {
      const r = buy(ctx.db, ctx.rng, s.guild_id!, ctx.user.id, id, 1, ctx.now);
      line = `${marquez('thanks', ctx.rng)}\nPurchased: ${r.item.emoji} ${r.item.name} for ${format(r.cost)}. Balance: ${format(r.cash)}.`;
    } catch (e) { line = marquezFor(e, ctx); }
    const { session: _x, ...v } = shopView(ctx, s.state.shelf, s.id, line);
    return { update: v };
  }
  return {};
}

export const purchase: Command = {
  name: 'purchase',
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
      return { embeds: [embed('wallet', 'Purchase complete', [`*${marquez('thanks', ctx.rng)}*`, `${r.qty} × ${r.item.emoji} ${r.item.name}: ${format(r.cost)}`, `Balance: ${format(r.cash)}`,
        r.item.passive ? '-# This item works on its own while it is in your inventory.' : `-# Use it with \`${ctx.config.prefix}use ${r.item.name.toLowerCase()}\`.`])] };
    } catch (e) {
      throw new GameError('shop.refused', marquezFor(e, ctx));
    }
  }
};

export const inventory: Command = {
  name: 'inventory',
  aliases: ['inv', 'items'],
  description: 'The items you own in this server',
  system: 'wallet',
  guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const list = invItems(ctx.db, guildId, ctx.user.id);
    const lines = list.map(({ item, qty }) => {
      const it = anyItem(item);
      return it ? `${it.emoji} **${it.name}** × ${qty}${it.passive ? ' · works on its own' : ''}` : `${item} × ${qty}`;
    });
    return { embeds: [embed('wallet', `Inventory: ${ctx.user.name}`, lines.length ? lines : ['Your inventory is empty. Marquez is open: `/shop`.'],
      { footer: { text: `${ctx.config.prefix}use <item> to use one` } })] };
  }
};

export const use: Command = {
  name: 'use',
  description: 'Use an item from your inventory',
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'item', type: 'string', description: 'Item name, e.g. coffee', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const id = findItem(String(args.item ?? ''));
    if (!id) throw new GameError('use.unknown', 'That item does not exist.');
    const it = anyItem(id)!;
    return { embeds: [embed('wallet', `${it.emoji} ${it.name}`, [useItem(ctx, guildId, id)])] };
  }
};

export const settitle: Command = {
  name: 'settitle',
  description: 'Set your profile title (uses a Title item)',
  system: 'wallet',
  guildOnly: true,
  options: [{ name: 'title', type: 'string', description: 'Up to 32 characters', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
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

