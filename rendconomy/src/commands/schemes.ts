import { GameError } from '../core/errors';
import { balance } from '../core/ledger';
import { format, parseAmount, parseCount } from '../core/money';
import { seededRng } from '../core/rng';
import * as sessions from '../core/sessions';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { KEY, current, quote, tick } from '../market/market';
import { BROKERS, ORDERS, TRAITS, brokerOf, brokerRow, cancelOrder, candidates, coverShort, describeOrder, dismissBroker, hireBroker, listOrders, listShorts, openShort, placeOrder, setBrokerRule, settlePrice, shortPnl, signOnBonus, SHORTS, type Rule, type Trait } from '../market/schemes';
import { tradableQuote } from '../market/trading';
import { me } from './shared';
import type { Command, Ctx, SessionReply } from './types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const controls: { crashSettings: (cur: unknown, input: Record<string, unknown>, now?: number) => { settings?: unknown; error?: string }; boostSettings: (cur: unknown, input: Record<string, unknown>, now?: number) => { settings?: unknown; error?: string } } = require('../market/engine/controls.js');

const words = (v: unknown) => String(v ?? '').trim().split(/\s+/).filter(Boolean);
const tickerOf = (m: ReturnType<typeof current>, t: string) => {
  const q = quote(m, t);
  if (!q) throw new GameError('stock.unknown', `There is no company with the ticker ${t.toUpperCase()}. Tickers: ${m.companies.map((c) => c.id).join(', ')}.`);
  return q;
};

// ---------------------------------------------------------------- orders

export const order: Command = {
  name: 'order', aliases: ['orders', 'limit'], description: 'Limit and stop orders that fill on their own', system: 'market', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: '"buy RRM 10 at 150", "sell BNW all at 90", "sell BLU all below 30", "cancel <#>"' }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const w = words(args.action).map((x) => x.toLowerCase());
    const P = ctx.config.prefix;
    if (w[0] === 'cancel') {
      const o = listOrders(ctx.db, guildId, ctx.user.id).find((x) => x.id === Number(String(w[1] ?? '').replace('#', '')));
      if (!o) throw new GameError('order.none', 'No order has that number.');
      cancelOrder(ctx.db, o, ctx.now);
      return { embeds: [embed('market', 'Order cancelled', [describeOrder(o), o.reserved ? `${format(o.reserved)} returned to your wallet.` : null])] };
    }
    if (w[0] === 'buy' || w[0] === 'sell') {
      const m = current(ctx.db);
      const q = tickerOf(m, w[1] ?? '');
      const kindWord = w[3];
      if (kindWord !== 'at' && kindWord !== 'below') throw new GameError('order.format', `Write it like \`${P}order buy RRM 10 at 150\`, \`${P}order sell BNW all at 90\` or \`${P}order sell BLU all below 30\`.`);
      const kind = kindWord === 'below' ? 'stop' : 'limit';
      if (w[0] === 'buy' && kind === 'stop') throw new GameError('order.buy', 'Buy orders use "at": they fill at that price or lower.');
      const qty = w[2] === 'all' && w[0] === 'sell' ? null : parseCount(w[2]);
      const price = parseAmount(w[4]);
      const o = placeOrder(ctx.db, guildId, ctx.user.id, { side: w[0], kind, ticker: q.id, qty, price }, ctx.now);
      return { embeds: [embed('market', `Order #${o.id} placed`, [describeOrder(o), o.reserved ? `${format(o.reserved)} is set aside until it fills or is cancelled.` : null,
        `It is checked every 5 minutes while the market is open, and expires ${discordTime(o.created_at + ORDERS.expireMs)}.`, `Balance: ${format(balance(ctx.db, wallet))}`])] };
    }
    const list = listOrders(ctx.db, guildId, ctx.user.id);
    return { embeds: [embed('market', 'Orders', [...(list.length ? list.map((o) => `**#${o.id}** · ${describeOrder(o)}`) : ['No open orders.']), '',
      `\`${P}order buy RRM 10 at 150\` · \`${P}order sell BNW all at 90\` · \`${P}order sell BLU all below 30\` · \`${P}order cancel <#>\``])] };
  }
};

// ---------------------------------------------------------------- brokers

export const broker: Command = {
  name: 'broker', aliases: ['brokers'], description: 'Hire a broker to trade for you by your rules', system: 'market', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: '"hire", "buy RRM until 150", "sell RRM at 200", "stop RRM at 120", "clear RRM", "fire"' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const w = words(args.action).map((x) => x.toLowerCase());
    const P = ctx.config.prefix;
    const b = brokerOf(ctx.db, guildId, ctx.user.id);
    if (w[0] === 'hire') {
      if (b) throw new GameError('broker.have', `${b.name} already works for you.`);
      const cands = candidates(ctx.user.id, ctx.now, seededRng);
      const bonus = signOnBonus(brokerRow(ctx.db, guildId, ctx.user.id)?.hires ?? 0);
      const s = sessions.create(ctx.db, { kind: 'broker', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { cands }, ttlMs: 5 * 60_000, now: ctx.now });
      return { embeds: [embed('market', 'Brokers available today', [
        `Sign-on bonus: **${format(bonus)}** (grows 1.25x with each hire).`, '',
        ...cands.map((c) => { const t = TRAITS[c.trait]; return `${t.emoji} **${c.name}** · ${t.label} · salary ${format(t.salary)}/day · ${Math.round(t.cut * 100)}% of profits\n-# ${t.desc}`; })
      ])], buttons: [cands.map((c, i) => ({ label: `Hire ${c.name}`.slice(0, 80), emoji: TRAITS[c.trait].emoji, id: sessions.buttonId(s.id, String(i)), style: 'success' as const }))], session: s.id };
    }
    if (!b) throw new GameError('broker.none', `You do not have a broker. See today's candidates with \`${P}broker hire\`.`);
    if (w[0] === 'fire') { dismissBroker(ctx.db, b, 'Dismissed.'); return { embeds: [embed('market', 'Broker dismissed', [`${b.name} has left. The shares they bought stay in your portfolio.`])] }; }
    const field: Record<string, keyof Rule> = { buy: 'buyUntil', sell: 'sellAt', stop: 'stopAt' };
    if (w[0] === 'clear') {
      const m = current(ctx.db); const q = tickerOf(m, w[1] ?? '');
      for (const f of Object.values(field)) setBrokerRule(ctx.db, b, q.id, f, null);
      return { embeds: [embed('market', 'Broker rules cleared', [`${b.name} will no longer trade ${q.id}.`])] };
    }
    if (field[w[0] ?? '']) {
      const m = current(ctx.db); const q = tickerOf(m, w[1] ?? '');
      const price = parseAmount(w[3]);
      setBrokerRule(ctx.db, b, q.id, field[w[0]!]!, price);
      return { embeds: [embed('market', 'Broker rule set', [`${b.name}: ${w[0] === 'buy' ? `buy ${q.id} while it is ${format(price)} or less (up to ${BROKERS.cap} shares)` : w[0] === 'sell' ? `sell ${q.id} once it reaches ${format(price)}` : `sell ${q.id} if it falls to ${format(price)}`}.`])] };
    }
    const t = TRAITS[b.trait];
    const rules = Object.entries(b.rules).map(([tk, r]) => `**${tk}** · ${[r.buyUntil !== undefined && `buy until ${format(r.buyUntil)}`, r.sellAt !== undefined && `sell at ${format(r.sellAt)}`, r.stopAt !== undefined && `stop at ${format(r.stopAt)}`].filter(Boolean).join(' · ')}`);
    const held = Object.entries(b.holdings).filter(([, h]) => h.shares > 0).map(([tk, h]) => `${tk} × ${h.shares}`);
    return { embeds: [embed('market', `${t.emoji} ${b.name} (${t.label})`, [
      `Salary ${format(t.salary)}/day, next due ${discordTime(b.paid_at + 86_400_000)} · ${Math.round(t.cut * 100)}% of profits · profit so far ${format(b.profit)}`,
      '', '**Rules**', ...(rules.length ? rules : ['None yet.']),
      held.length ? `Managing: ${held.join(', ')}` : null,
      '', '**Recent**', ...(b.log.length ? b.log.slice(0, 5) : ['Nothing yet.']),
      '', `\`${P}broker buy RRM until 150\` · \`sell RRM at 200\` · \`stop RRM at 120\` · \`clear RRM\` · \`fire\``
    ])] };
  }
};

export function onBrokerButton(ctx: Ctx, s: sessions.Session<{ cands: { name: string; trait: Trait }[] }>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}broker hire\` to see your own candidates.` };
  const c = s.state.cands[Number(value)];
  if (!c || !sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  const b = hireBroker(ctx.db, s.guild_id!, ctx.user.id, c, ctx.now);
  return { update: { embeds: [embed('market', `Hired: ${b.name}`, [`${TRAITS[b.trait].emoji} ${TRAITS[b.trait].label}. Give them rules with \`${ctx.config.prefix}broker buy RRM until 150\`.`])], buttons: [] } };
}

// ---------------------------------------------------------------- shorts

export const short: Command = {
  name: 'short', aliases: ['shortsell'], description: 'Short a stock: profit if it falls', system: 'market', guildOnly: true,
  options: [{ name: 'ticker', type: 'string', description: 'Company ticker', required: true }, { name: 'amount', type: 'string', description: 'Shares to short', required: true }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const m = current(ctx.db);
    const q = tradableQuote(m, String(args.ticker ?? ''));
    const qty = parseCount(args.amount, { max: SHORTS.maxShares });
    const r = openShort(ctx.db, m, guildId, ctx.user.id, q, qty, ctx.now);
    return { embeds: [embed('market', `Short opened: ${qty} ${q.id}`, [
      `Sold ${qty} borrowed shares at ${format(q.priceCents)}.`, `Margin set aside: ${format(r.margin)}${r.fee ? ` · fee ${format(r.fee)}` : ''}`,
      `Position: ${r.short.shares} shares at an average of ${format(r.short.entry)}.`,
      `If the loss reaches ${Math.round(SHORTS.call * 100)}% of the margin, the short is covered automatically.`, `Balance: ${format(balance(ctx.db, wallet))}`
    ])] };
  }
};

export const cover: Command = {
  name: 'cover', aliases: ['shorts', 'closeshort'], description: 'Close a short (or list your shorts)', system: 'market', guildOnly: true,
  options: [{ name: 'ticker', type: 'string', description: 'Which short to close (leave out to list them)' }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const m = current(ctx.db);
    const list = listShorts(ctx.db, guildId, ctx.user.id);
    const t = String(args.ticker ?? '').trim().toUpperCase();
    if (!t) return { embeds: [embed('market', 'Shorts', list.length ? list.map((s) => { const p = settlePrice(s, quote(m, s.ticker)); const pnl = shortPnl(s, p); return `**${s.ticker}** · ${s.shares} at ${format(s.entry)} · now ${format(p)} · ${pnl >= 0 ? '+' : '−'}${format(Math.abs(pnl))}`; }) : ['No open shorts.'])] };
    const s = list.find((x) => x.ticker === t);
    if (!s) throw new GameError('short.none', `You have no short on ${t}.`);
    const q = quote(m, t);
    const price = settlePrice(s, q);
    if (price > 0) tradableQuote(m, t);
    const r = coverShort(ctx.db, s, price, ctx.now);
    return { embeds: [embed('market', `Short covered: ${s.shares} ${t}`, [`Bought back at ${format(price)} (sold at ${format(s.entry)}).`, `${r.pnl >= 0 ? 'Profit' : 'Loss'}: ${format(Math.abs(r.pnl))}`, `Returned to your wallet: ${format(r.back)}`, `Balance: ${format(balance(ctx.db, wallet))}`])] };
  }
};

// ---------------------------------------------------------------- compare

export const compare: Command = {
  name: 'compare', aliases: ['vs'], description: 'Compare companies side by side', system: 'market',
  run(ctx) {
    const m = current(ctx.db);
    const rows = m.companies.map((c) => {
      const q = quote(m, c.id)!;
      const h = c.history ?? [];
      const hi = Math.max(...h), lo = Math.min(...h);
      const div = (m.divText as Record<string, string> | undefined)?.[c.id] ?? '';
      return `**${c.id}** ${format(q.priceCents)} ${q.change >= 0 ? '▲' : '▼'}${Math.abs(q.change).toFixed(1)}% · 24h range ${format(Math.round(lo * 100))}–${format(Math.round(hi * 100))}${div ? ` · ${div.replace(/\*\*/g, '')}` : ''}`;
    });
    return { embeds: [embed('market', 'Compare', rows)] };
  }
};

// ---------------------------------------------------------------- owner controls

function control(kind: 'crash' | 'boost'): Command {
  return {
    name: kind,
    description: kind === 'crash' ? 'Bot owner: start, end or cancel a market crash' : 'Bot owner: start or stop a market boom',
    system: 'admin',
    options: [{ name: 'action', type: 'string', description: kind === 'crash' ? 'start [mild|normal|brutal] [warning] [crash] [recovery] | end | cancel' : 'start [small|normal|big] [hours] [tickers] | stop' }],
    run(ctx, args) {
      if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
      const w = words(args.action).map((x) => x.toLowerCase());
      const action = w.shift();
      const m = current(ctx.db);
      if (!action) return { embeds: [embed('admin', kind === 'crash' ? 'Market crash' : 'Market boom', [String((kind === 'crash' ? m.crashText : m.boostText) || 'Nothing is running.').replace(/\*\*/g, '')])] };
      const curRaw = ctx.db.meta(kind === 'crash' ? KEY.crash : KEY.boost);
      const cur = curRaw ? JSON.parse(curRaw) : {};
      const nums = w.filter((x) => /^\d+(\.\d+)?$/.test(x));
      const r = kind === 'crash'
        ? controls.crashSettings(cur, { action, severity: w.find((x) => ['mild', 'normal', 'brutal'].includes(x)), warning: nums[0], crash: nums[1], recovery: nums[2] }, ctx.now)
        : controls.boostSettings(cur, { action, strength: w.find((x) => ['small', 'normal', 'big'].includes(x)), hours: nums[0], tickers: w.filter((x) => /^[a-z]{2,5}$/.test(x) && !['start', 'stop', 'small', 'normal', 'big'].includes(x)).join(' ') }, ctx.now);
      if (r.error) throw new GameError(`${kind}.input`, r.error);
      ctx.db.setMeta(kind === 'crash' ? KEY.crash : KEY.boost, JSON.stringify(r.settings));
      tick(ctx.db, ctx.rng, ctx.now);
      const after = current(ctx.db);
      return { embeds: [embed('admin', kind === 'crash' ? 'Market crash' : 'Market boom', [`Done: ${action}.`, String((kind === 'crash' ? after.crashText : after.boostText) || '').replace(/\*\*/g, '')])] };
    }
  };
}
export const crash = control('crash');
export const boost = control('boost');

