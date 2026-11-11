// r!order: limit and stop orders that fill on their own.
//   r!order buy RRM 10 at 2.00        buy when RRM is at or under ⬡ 2.00 (the Polygons are set aside now)
//   r!order sell BNW all at 15        sell when BNW is at or over ⬡ 15
//   r!order sell BLU all below 5      a stop-loss: sell if BLU falls to ⬡ 5
//   r!order cancel 3                  cancel order #3 (anything set aside comes back)
//   r!orders                          your open orders
const config = require('../config');
const trading = require('../trading');
const { amt, parsePolygons, relTime } = require('../format');

function listView(ctx) {
  const P = config.prefix;
  const os = trading.list(ctx.db, ctx.guildId, ctx.user.id);
  return { embeds: [{
    title: '📋 Your orders',
    description: os.length
      ? os.map((o) => `**#${o.id}** · ${trading.describe(o)}${o.reserved ? ` · ${amt(o.reserved)} set aside` : ''}\n-# Expires ${relTime(o.created_at + trading.ORDERS.expireMs)}`).join('\n')
      : `No open orders. Try \`${P}order buy RRM 10 at 2.00\`.`,
    footer: { text: `Orders fill on their own when the price gets there (checked every 5 minutes while the market is open) · Up to ${trading.ORDERS.max} at once` },
    color: 0x3ba7f2
  }] };
}

module.exports = {
  name: 'order',
  aliases: ['orders', 'limit'],
  description: 'Limit and stop orders that fill on their own',
  usage: 'buy <ticker> <amount> at <price> | sell <ticker> <amount|all> at|below <price> | cancel <#>',
  options: [{ name: 'order', type: 'string', description: 'Like "buy RRM 10 at 2.00", "sell BNW all at 15", "sell BLU all below 5", "cancel 3"' }],

  async run(ctx, args) {
    const P = config.prefix;
    const help = `📋 Try \`${P}order buy RRM 10 at 2.00\`, \`${P}order sell BNW all at 15\`, \`${P}order sell BLU all below 5\` (a stop-loss), or \`${P}order cancel <#>\`.`;
    const words = String(args.order || '').trim().split(/\s+/).filter(Boolean);
    const action = (words[0] || '').toLowerCase();
    if (!action || action === 'list') return listView(ctx);

    if (action === 'cancel') {
      const id = Number(String(words[1] || '').replace('#', ''));
      const o = trading.list(ctx.db, ctx.guildId, ctx.user.id).find((x) => x.id === id);
      if (!o) return `📋 You don't have an order #${words[1] || '?'}. See \`${P}orders\`.`;
      trading.cancel(ctx.db, o);
      return `📋 Cancelled **#${o.id}**: ${trading.describe(o)}.${o.reserved ? ` ${amt(o.reserved)} is back in your Polygons.` : ''}`;
    }
    if (action !== 'buy' && action !== 'sell') return help;
    const m = await ctx.market.get();
    const t = String(words[1] || '').toUpperCase();
    if (!m || !ctx.market.ids(m).includes(t)) return `📋 Orders work on the five main companies: ${ctx.market.tickerList(m)}.`;
    const qtyRaw = String(words[2] || '').toLowerCase();
    const how = String(words[3] || '').toLowerCase();
    const price = parsePolygons(words[4]);
    if (!['at', 'below'].includes(how) || price === null || price <= 0) return help;
    let qty = qtyRaw === 'all' ? null : Number(qtyRaw);
    if (qty !== null && (!Number.isInteger(qty) || qty <= 0)) return '📋 The amount must be a whole number of shares (or `all` for a sell).';
    if (action === 'buy' && qty === null) return '📋 A buy order needs a number of shares, like `10`.';
    if (action === 'buy' && how === 'below') return help;

    const kind = how === 'below' ? 'stop' : 'limit';
    const r = trading.place(ctx, m, { side: action, kind, ticker: t, qty, price });
    if (r.error) return r.error;
    const now = trading.priceOf(m, t);
    return `📋 Order **#${r.id}** placed: ${trading.describe({ side: action, kind, ticker: t, qty, price })}.` +
      (r.reserved ? ` ${amt(r.reserved)} is set aside until it fills.` : '') +
      `\n-# ${t} is at ${amt(now)} now. You'll get a DM when it fills.`;
  }
};
