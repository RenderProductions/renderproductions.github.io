// r!shop [shelf]: Marquez's shop. One shelf at a time (Work, Market, Rend-Sino, Odds & Ends, and this
// week's collectible), with buttons to switch shelves and to buy.
const config = require('../config');
const shop = require('../shop');
const { have, amt, relTime } = require('../format');
const { button, rows } = require('../buttons');
const { ComponentType } = require('discord.js');

const ORDER = ['work', 'market', 'casino', 'fun', 'style', 'rare'];
const ALIAS = { profile: 'style', paint: 'style', customize: 'style', jobs: 'work', stocks: 'market', casino: 'casino', gambling: 'casino', rendsino: 'casino', odds: 'fun', other: 'fun', collectible: 'rare', collectibles: 'rare' };

function view(ctx, shelf) {
  const p = ctx.db.player(ctx.guildId, ctx.user);
  const since = shop.restock(ctx.db, Date.now(), ctx.random);
  const random = ctx.random || Math.random;
  const greet = shop.MARQUEZ[Math.floor(random() * shop.MARQUEZ.length)];
  let ids, body;
  if (shelf === 'rare') {
    const id = shop.collectibleOfWeek();
    const c = shop.COLLECTIBLES[id];
    ids = [id];
    const left = ctx.db.stock(id);
    body = `**This week's collectible**\n\n${c.emoji} **${c.name}**: ${amt(c.price)} | ${left > 0 ? `**${left}** left for everyone` : '**Sold out**'}\n${c.desc}\n\n` +
      `-# Collectibles do nothing. They just sit on your profile and look good. A new one comes ${relTime((Math.floor(Date.now() / shop.WEEK_MS) + 1) * shop.WEEK_MS)}.`;
  } else {
    ids = Object.keys(shop.ITEMS).filter((id) => shop.ITEMS[id].cat === shelf);
    body = ids.map((id) => {
      const it = shop.ITEMS[id];
      const n = ctx.db.stock(id);
      return `${it.emoji} **${it.name}**: ${amt(shop.price(ctx.db, id))} | ${n > 0 ? `Stock: ${n}` : '**Sold out**'}${it.passive ? ' · *passive*' : ''}\n${it.desc}`;
    }).join('\n\n') + `\n\n-# Restocks ${relTime(since + shop.RESTOCK_MS)}. One of each item per player per restock.`;
  }
  const tabs = ORDER.map((k) => button(shop.SHELVES[k].label, `shop:shelf:${k}`, k === shelf ? 'blue' : 'grey', k === shelf, shop.SHELVES[k].emoji));
  const buys = ids.map((id) => { const it = shop.any(id); return button(`Buy ${it.name}`, `shop:buy:${id}`, 'green', ctx.db.stock(id) <= 0, it.emoji); });
  return {
    embeds: [{
      author: { name: "Marquez's Shop" },
      title: `${shop.SHELVES[shelf].emoji} ${shop.SHELVES[shelf].label}`,
      description: `*${greet}*\n\nYou have **${have(p.cash)}**.\n\n${body}`,
      footer: { text: `Buy with the buttons or ${config.prefix}purchase <item> · Use items with ${config.prefix}use <item>` },
      color: 0xf0b232
    }],
    components: [...rows(tabs, 3), ...rows(buys)].slice(0, 5)
  };
}

module.exports = {
  name: 'shop',
  aliases: ['marquez', 'store'],
  description: "Marquez's shop: items, stock, and this week's collectible",
  usage: '[shelf]',
  options: [{ name: 'shelf', type: 'string', description: 'work, market, casino, fun, profile, or collectible' }],

  async run(ctx, args = {}) {
    const t = String(args.shelf || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return view(ctx, ORDER.includes(t) ? t : ALIAS[t] || 'work');
  },

  // Shelf tabs flip the shop's page (it's a public counter, anyone can browse). Buy buttons buy
  // for whoever pressed them, and only they see the receipt.
  buttonPrefix: 'shop',
  async onButton(ctx, [action, arg]) {
    if (action === 'shelf' && ORDER.includes(arg)) return { update: view(ctx, arg) };
    if (action !== 'buy') return null;
    const out = await require('./purchase').run(ctx, { item: arg });
    return { reply: out };
  },
  view
};
