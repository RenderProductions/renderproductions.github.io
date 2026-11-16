// Connections pt. 2: the inbox (the site's bell), the achievement showcase, trade offers between players,
// and odd jobs (quick tasks for a little pay, a few a day). All of these work in chat and from the site.
import { ACHIEVEMENTS } from '../achievements/list';
import { awardHere, bump, getProgress, has, setProgress } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { balance, ensureEscrow, escrow, transfer, wallet as walletOf } from '../core/ledger';
import { format, parseAmount, polygons, type Cents } from '../core/money';
import * as sessions from '../core/sessions';
import { dayKey, discordTime, HOUR } from '../core/time';
import { rarityE, itemE } from '../discord/icons';
import { emoji } from '../discord/emoji';
import { embed } from '../discord/style';
import { CATCH } from '../fishing/fishing';
import { parseCropItem } from '../farming/farming';
import { addInbox, inboxOf, markRead, unread } from '../social/inbox';
import { nameOf, receipt } from '../social/receipts';
import { addItem, count, items, takeItem } from '../shop/inventory';
import { anyItem } from '../shop/items';
import { me } from './shared';
import type { Command, Ctx } from './types';

// ---------------------------------------------------------------- inbox
export const inbox: Command = {
  name: 'inbox', aliases: ['notifications', 'notifs', 'bell'], description: 'Your latest notifications: receipts, market reports, bids, crops and trade offers', system: 'general',
  options: [{ name: 'action', type: 'string', description: 'Blank to read them, or "count"' }],
  run(ctx, args) {
    if (String(args.action ?? '').trim().toLowerCase() === 'count') { const n = unread(ctx.db, ctx.user.id); return { content: `${n} unread` }; }
    const rows = inboxOf(ctx.db, ctx.user.id, 10);
    markRead(ctx.db, ctx.user.id);
    return { embeds: [embed('general', '🔔 Inbox', rows.length ? rows.map((r) => `${r.read ? '' : '🟡 '}**${r.title}** · <t:${Math.floor(r.created / 1000)}:R>\n${r.body.split('\n').map((l) => `-# ${l}`).join('\n')}`) : ['Nothing yet. Receipts, market reports, takeover bids, ready crops and trade offers land here.'])] };
  }
};

// ---------------------------------------------------------------- showcase
export const SHOWCASE_MAX = 3;
export const showcaseOf = (db: Ctx['db'], userId: string): string[] => { try { return (JSON.parse(db.meta(`showcase:${userId}`) ?? '[]') as string[]).filter((id) => ACHIEVEMENTS.some((a) => a.id === id)); } catch { return []; } };
const findAchievement = (text: string) => {
  const t = text.trim().toLowerCase().replace(/[^a-z0-9 ]/g, '');
  return ACHIEVEMENTS.find((a) => a.id === t.replace(/ /g, '_') || a.name.toLowerCase().replace(/[^a-z0-9 ]/g, '') === t) ?? ACHIEVEMENTS.find((a) => t.length >= 3 && a.name.toLowerCase().replace(/[^a-z0-9 ]/g, '').startsWith(t));
};
export const showcase: Command = {
  name: 'showcase', aliases: ['pinach', 'feature'], description: `Pin up to ${SHOWCASE_MAX} of your achievements to your profile`, system: 'social',
  options: [{ name: 'action', type: 'string', description: '"add <achievement>", "remove <achievement>", "clear", or blank to see it' }],
  run(ctx, args) {
    const [verb = '', ...rest] = String(args.action ?? '').trim().split(/\s+/);
    const v = verb.toLowerCase();
    let list = showcaseOf(ctx.db, ctx.user.id);
    const save = () => ctx.db.setMeta(`showcase:${ctx.user.id}`, JSON.stringify(list));
    if (v === 'clear') { list = []; save(); }
    else if (v === 'add' || v === 'pin' || v === 'remove' || v === 'unpin') {
      const a = findAchievement(rest.join(' '));
      if (!a) throw new GameError('showcase.none', 'No achievement by that name. `/achievements` lists yours.');
      if (v === 'add' || v === 'pin') {
        if (!has(ctx.db, ctx.user.id, a.id)) throw new GameError('showcase.locked', `You haven't unlocked **${a.name}** yet.`);
        if (!list.includes(a.id)) { if (list.length >= SHOWCASE_MAX) throw new GameError('showcase.full', `Your showcase holds ${SHOWCASE_MAX}. Remove one first: \`${ctx.config.prefix}showcase remove <name>\`.`); list.push(a.id); }
      } else list = list.filter((x) => x !== a.id);
      save();
    }
    const shown = list.map((id) => ACHIEVEMENTS.find((a) => a.id === id)!);
    return { embeds: [embed('social', '🏆 Showcase', [
      shown.length ? shown.map((a) => `${rarityE(a.rarity)} **${a.name}**: ${a.desc}`).join('\n') : 'Nothing pinned yet.',
      '', `-# ${shown.length}/${SHOWCASE_MAX} · It shows on your profile on the site. \`${ctx.config.prefix}showcase add <achievement>\``
    ])] };
  }
};

// ---------------------------------------------------------------- trade offers
export const TRADES = { ttlMs: 24 * HOUR, maxOpen: 3 };
interface Side { cents: Cents; item: string | null; qty: number }
interface TradeRow { id: number; guild_id: string; from_id: string; to_id: string; give_cents: number; give_item: string | null; give_qty: number; want_cents: number; want_item: string | null; want_qty: number; status: string; created: number; expires: number }
/** A display name for anything that can sit in an inventory. */
export function itemName(id: string): string {
  const it = anyItem(id); if (it) return it.name;
  const crop = parseCropItem(id); if (crop) return crop.name;
  if (id.startsWith('fish_')) { const f = CATCH[id.slice(5)]; if (f) return f.name; }
  return id;
}
const itemIcon = (id: string): string => itemE(id, anyItem(id)?.emoji ?? parseCropItem(id)?.emoji ?? (id.startsWith('fish_') ? CATCH[id.slice(5)]?.emoji ?? '📦' : '📦'));
const sideText = (s: Side): string => [s.cents ? `**${format(s.cents)}**` : null, s.item ? `${s.qty > 1 ? `${s.qty} × ` : ''}${itemIcon(s.item)} ${itemName(s.item)}` : null].filter(Boolean).join(' and ') || 'nothing';
/** "500", "⬡500", "2 coffee", "snow globe", "500 and coffee", "nothing". Items are matched against the owner's inventory. */
function parseSide(db: Ctx['db'], guildId: string, ownerId: string, text: string, who: string): Side {
  const out: Side = { cents: 0, item: null, qty: 0 };
  for (const raw of text.split(/\s+(?:and|\+|&)\s+/i).map((x) => x.trim()).filter(Boolean)) {
    if (/^(nothing|none)$/i.test(raw)) continue;
    const money = raw.replace(/^⬡/, '');
    if (/^[\d.,]+[kmb]?$/i.test(money)) { out.cents += parseAmount(money); continue; }
    const m = raw.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
    const qty = m ? Number(m[1]) : 1, name = (m ? m[2]! : raw).toLowerCase();
    const inv = items(db, guildId, ownerId);
    const hit = inv.find((r) => r.item === name || itemName(r.item).toLowerCase() === name) ?? inv.find((r) => name.length >= 3 && itemName(r.item).toLowerCase().startsWith(name));
    if (!hit) throw new GameError('trade.item', `${who} ${who === 'You' ? "don't" : "doesn't"} have any "${raw}".`);
    if (out.item) throw new GameError('trade.items', 'One kind of item per side (plus Polygons if you like).');
    out.item = hit.item; out.qty = qty;
  }
  return out;
}
const userArg = (v: unknown, what: string): string => {
  const id = String(v ?? '').replace(/[<@!>]/g, '').trim();
  if (!/^\d{5,22}$/.test(id)) throw new GameError('arg.user', `Mention ${what}.`);
  return id;
};
const tradesFor = (db: Ctx['db'], guildId: string, userId: string): TradeRow[] => db.all<TradeRow>("SELECT * FROM trades WHERE guild_id = ? AND status = 'open' AND (from_id = ? OR to_id = ?) ORDER BY id DESC", guildId, userId, userId);
/** Expired offers go back to whoever made them. */
export function expireTrades(db: Ctx['db'], now: number): void {
  for (const t of db.all<TradeRow>("SELECT * FROM trades WHERE status = 'open' AND expires <= ?", now)) closeTrade(db, t, 'expired', now);
}
function closeTrade(db: Ctx['db'], t: TradeRow, status: 'expired' | 'declined' | 'cancelled', now: number): void {
  db.tx(() => {
    if (t.give_cents) transfer(db, { from: escrow(t.guild_id, t.from_id), to: walletOf(t.guild_id, t.from_id), cents: t.give_cents, reason: 'trade.refund', guildId: t.guild_id, now });
    if (t.give_item) addItem(db, t.guild_id, t.from_id, t.give_item, t.give_qty);
    db.run('UPDATE trades SET status = ? WHERE id = ?', status, t.id);
    if (status !== 'cancelled') addInbox(db, t.from_id, t.guild_id, `Trade #${t.id} ${status}`, `Your offer to ${nameOf(db, t.to_id)} was ${status}. What you offered is back with you.`, now);
  });
}
export const trade: Command = {
  name: 'trade', aliases: ['offer', 'swap'], description: 'Offer another player a trade (Polygons and/or an item for theirs), or answer one', system: 'social', guildOnly: true,
  options: [
    { name: 'action', type: 'string', description: '"@player <you give> for <you want>", "accept <#>", "decline <#>", "cancel <#>", or blank to list', required: false }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    expireTrades(ctx.db, ctx.now);
    const line = String(args.action ?? '').trim();
    const ans = line.match(/^(accept|decline|cancel)\s+#?(\d+)$/i);
    if (ans) {
      const t = ctx.db.get<TradeRow>("SELECT * FROM trades WHERE id = ? AND guild_id = ? AND status = 'open'", Number(ans[2]), guildId);
      if (!t) throw new GameError('trade.none', `There's no open trade #${ans[2]} here.`);
      const v = ans[1]!.toLowerCase();
      if (v === 'cancel') { if (t.from_id !== ctx.user.id) throw new GameError('trade.notyours', 'Only whoever made the offer can cancel it.'); closeTrade(ctx.db, t, 'cancelled', ctx.now); return { content: `${emoji('no')} Trade #${t.id} cancelled. What you offered is back with you.` }; }
      if (t.to_id !== ctx.user.id) throw new GameError('trade.notyours', 'That offer is for someone else.');
      if (v === 'decline') { closeTrade(ctx.db, t, 'declined', ctx.now); return { content: `${emoji('no')} You declined trade #${t.id}.` }; }
      return ctx.db.tx(() => {
        if (t.want_cents && balance(ctx.db, walletOf(guildId, ctx.user.id)) < t.want_cents) throw new GameError('funds.short', `You need ${format(t.want_cents)} for this trade.`);
        if (t.want_item && count(ctx.db, guildId, ctx.user.id, t.want_item) < t.want_qty) throw new GameError('trade.item', `You need ${t.want_qty} × ${itemName(t.want_item)} for this trade.`);
        if (t.give_cents) transfer(ctx.db, { from: escrow(guildId, t.from_id), to: walletOf(guildId, ctx.user.id), cents: t.give_cents, reason: 'trade', guildId, actorId: t.from_id, now: ctx.now });
        if (t.give_item) addItem(ctx.db, guildId, ctx.user.id, t.give_item, t.give_qty);
        if (t.want_cents) transfer(ctx.db, { from: walletOf(guildId, ctx.user.id), to: walletOf(guildId, t.from_id), cents: t.want_cents, reason: 'trade', guildId, actorId: ctx.user.id, now: ctx.now });
        if (t.want_item) { takeItem(ctx.db, guildId, ctx.user.id, t.want_item, t.want_qty); addItem(ctx.db, guildId, t.from_id, t.want_item, t.want_qty); }
        ctx.db.run("UPDATE trades SET status = 'done' WHERE id = ?", t.id);
        const give = sideText({ cents: t.give_cents, item: t.give_item, qty: t.give_qty }), want = sideText({ cents: t.want_cents, item: t.want_item, qty: t.want_qty });
        receipt(ctx.db, guildId, t.from_id, `Trade #${t.id} accepted by ${ctx.user.name}`, [['You gave', give.replace(/\*\*/g, '')], ['You got', want.replace(/\*\*/g, '')]]);
        receipt(ctx.db, guildId, ctx.user.id, `Trade #${t.id} with ${nameOf(ctx.db, t.from_id)}`, [['You gave', want.replace(/\*\*/g, '')], ['You got', give.replace(/\*\*/g, '')]]);
        if (bump(ctx.db, ctx.user.id, 'trades') >= 1) awardHere('dealmaker');
        awardHere('dealmaker', t.from_id);
        return { embeds: [embed('social', `🤝 Trade #${t.id} done`, [`You get ${give} from <@${t.from_id}>.`, `They get ${want}.`])] };
      });
    }
    const offer = line.match(/^<@!?(\d+)>\s+(.+?)\s+for\s+(.+)$/i) ?? line.match(/^(\d{15,22})\s+(.+?)\s+for\s+(.+)$/i);
    if (!offer) {
      const open = tradesFor(ctx.db, guildId, ctx.user.id);
      return { embeds: [embed('social', '🤝 Trade offers', [
        open.length ? open.map((t) => t.to_id === ctx.user.id
          ? `**#${t.id}** from <@${t.from_id}>: ${sideText({ cents: t.give_cents, item: t.give_item, qty: t.give_qty })} for your ${sideText({ cents: t.want_cents, item: t.want_item, qty: t.want_qty })} · expires ${discordTime(t.expires)}\n-# \`${P}trade accept ${t.id}\` · \`${P}trade decline ${t.id}\``
          : `**#${t.id}** to <@${t.to_id}>: your ${sideText({ cents: t.give_cents, item: t.give_item, qty: t.give_qty })} for ${sideText({ cents: t.want_cents, item: t.want_item, qty: t.want_qty })} · expires ${discordTime(t.expires)}\n-# \`${P}trade cancel ${t.id}\``).join('\n') : 'No open offers.',
        '', `-# Make one: \`${P}trade @player 500 and coffee for snow globe\`. What you offer is held until they answer (24 hours).`
      ])] };
    }
    const to = userArg(offer[1], 'a player');
    if (to === ctx.user.id) throw new GameError('trade.self', 'You cannot trade with yourself.');
    if (ctx.botId && to === ctx.botId) throw new GameError('trade.house', "The house doesn't trade. Marquez might: `/shop`.");
    if (!ctx.db.get('SELECT 1 FROM players WHERE guild_id = ? AND user_id = ?', guildId, to)) throw new GameError('player.none', 'That player has no account in this server yet.');
    const open = ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM trades WHERE guild_id = ? AND from_id = ? AND status = 'open'", guildId, ctx.user.id)!.n;
    if (open >= TRADES.maxOpen) throw new GameError('trade.many', `You have ${open} open offers. Cancel one first: \`${P}trade\`.`);
    const give = parseSide(ctx.db, guildId, ctx.user.id, offer[2]!, 'You');
    const want = parseSide(ctx.db, guildId, to, offer[3]!, 'They');
    if (!give.cents && !give.item) throw new GameError('trade.empty', 'Offer something: Polygons, an item, or both.');
    if (!want.cents && !want.item) throw new GameError('trade.empty', 'Ask for something in return (or use `/gift`).');
    if (give.item && count(ctx.db, guildId, ctx.user.id, give.item) < give.qty) throw new GameError('trade.item', `You only have ${count(ctx.db, guildId, ctx.user.id, give.item)} × ${itemName(give.item)}.`);
    if (give.cents && balance(ctx.db, walletOf(guildId, ctx.user.id)) < give.cents) throw new GameError('funds.short', `The balance is ${format(balance(ctx.db, walletOf(guildId, ctx.user.id)))}.`);
    return ctx.db.tx(() => {
      if (give.cents) transfer(ctx.db, { from: walletOf(guildId, ctx.user.id), to: ensureEscrow(ctx.db, guildId, ctx.user.id, ctx.now), cents: give.cents, reason: 'trade.held', guildId, actorId: ctx.user.id, now: ctx.now });
      if (give.item) takeItem(ctx.db, guildId, ctx.user.id, give.item, give.qty);
      const r = ctx.db.run('INSERT INTO trades (guild_id, from_id, to_id, give_cents, give_item, give_qty, want_cents, want_item, want_qty, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        guildId, ctx.user.id, to, give.cents, give.item, give.qty, want.cents, want.item, want.qty, ctx.now, ctx.now + TRADES.ttlMs);
      const id = Number(r.lastInsertRowid);
      receipt(ctx.db, guildId, to, `Trade offer #${id} from ${ctx.user.name}`, [['They give', sideText(give).replace(/\*\*/g, '')], ['For your', sideText(want).replace(/\*\*/g, '')], ['Answer', `${P}trade accept ${id} or ${P}trade decline ${id}`]]);
      return { content: `<@${to}>`, embeds: [embed('social', `🤝 Trade offer #${id}`, [`<@${ctx.user.id}> offers ${sideText(give)} for your ${sideText(want)}.`,
        `Accept with \`${P}trade accept ${id}\`, or decline with \`${P}trade decline ${id}\`. It's held for 24 hours.`])] };
    });
  }
};

// ---------------------------------------------------------------- odd jobs
export const ODDJOBS = { perDay: 10, minPay: 25, maxPay: 60, ttlMs: 90_000 };
interface Job { prompt: string; answer: string; pay: Cents }
const WORDS = ['POLYGON', 'MARQUEZ', 'RESERVE', 'PUMPKIN', 'CARROT', 'TICKER', 'DIVIDEND', 'CASINO', 'HARVEST', 'TERMINAL', 'NACHO', 'ROCKET', 'BROKER', 'SAVINGS'];
export function makeJob(rng: Ctx['rng']): Omit<Job, 'pay'> {
  const kind = rng.int(0, 3);
  if (kind === 0) {
    const a = rng.int(3, 19), b = rng.int(3, 19), op = rng.pick(['+', '−', '×']);
    return { prompt: `**Bookkeeping:** what's ${a} ${op} ${b}?`, answer: String(op === '+' ? a + b : op === '−' ? a - b : a * b) };
  }
  if (kind === 1) {
    const w = rng.pick(WORDS); let s = w;
    for (let i = 0; i < 6 && s === w; i++) s = rng.shuffle(w.split('')).join('');
    return { prompt: `**Filing:** a label got scrambled. Unscramble **${s}**.`, answer: w.toLowerCase() };
  }
  if (kind === 2) {
    const syms = ['🍒', '🍋', '🔔', '💎']; const t = rng.pick(syms);
    const row = Array.from({ length: rng.int(8, 13) }, () => rng.pick(syms));
    return { prompt: `**Stocktake:** how many ${t} are on the shelf?\n${row.join('')}`, answer: String(row.filter((x) => x === t).length) };
  }
  const w = rng.pick(WORDS).toLowerCase();
  return { prompt: `**Mailroom:** a letter came in backwards. Type **${w.split('').reverse().join('')}** the right way round.`, answer: w };
}
export const oddjob: Command = {
  name: 'oddjob', aliases: ['odd', 'chore'], description: `A quick odd job for a little pay (up to ${ODDJOBS.perDay} a day)`, system: 'work', guildOnly: true,
  options: [{ name: 'answer', type: 'string', description: 'Your answer to the current job (blank for a new one)' }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix;
    const today = Number(dayKey(ctx.now).replace(/-/g, ''));
    const done = getProgress(ctx.db, ctx.user.id, 'oddjobs_day') === today ? getProgress(ctx.db, ctx.user.id, 'oddjobs_today') : 0;
    const cur = sessions.active<Job>(ctx.db, 'oddjob', guildId, ctx.user.id, ctx.now);
    const answer = String(args.answer ?? '').trim().toLowerCase();
    if (cur && answer) {
      sessions.end(ctx.db, cur.id);
      if (answer.replace(/\s+/g, '') !== cur.state.answer) return { embeds: [embed('work', '🧰 Odd job', [`${emoji('no')} Not quite: it was **${cur.state.answer}**. No pay this time.`, `-# Another? \`${P}oddjob\``])] };
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: cur.state.pay, reason: 'oddjob', guildId, actorId: ctx.user.id, now: ctx.now });
      setProgress(ctx.db, ctx.user.id, 'oddjobs_day', today); setProgress(ctx.db, ctx.user.id, 'oddjobs_today', done + 1);
      if (bump(ctx.db, ctx.user.id, 'oddjobs') >= 50) awardHere('odd_one_out');
      return { embeds: [embed('work', '🧰 Odd job done', [`${emoji('yes')} Right! You earn **${format(paid)}**.`, `-# ${done + 1}/${ODDJOBS.perDay} today · Balance ${format(balance(ctx.db, wallet))} · Another? \`${P}oddjob\``])] };
    }
    if (cur) return { embeds: [embed('work', '🧰 Odd job', [cur.state.prompt, '', `Answer with \`${P}oddjob <answer>\` before ${discordTime(cur.expires_at)}.`])] };
    if (answer) throw new GameError('oddjob.none', `No job in progress. Get one with \`${P}oddjob\`.`);
    if (done >= ODDJOBS.perDay) throw new GameError('oddjob.cap', `That's all ${ODDJOBS.perDay} odd jobs for today. Come back tomorrow.`);
    const job = { ...makeJob(ctx.rng), pay: polygons(ctx.rng.int(ODDJOBS.minPay, ODDJOBS.maxPay)) };
    const s = sessions.create<Job>(ctx.db, { kind: 'oddjob', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: job, ttlMs: ODDJOBS.ttlMs, now: ctx.now });
    return { embeds: [embed('work', '🧰 Odd job', [job.prompt, '', `Pays **${format(job.pay)}**. Answer with \`${P}oddjob <answer>\` before ${discordTime(s.expires_at)}.`, `-# ${done}/${ODDJOBS.perDay} done today`])] };
  }
};

export const connectionCommands = [inbox, showcase, trade, oddjob];
