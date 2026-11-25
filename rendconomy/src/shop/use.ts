// What each item does when used (/use). Passive items work on their own where their system checks them.
import type { Ctx } from '../commands/types';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, polygons } from '../core/money';
import { clearCooldown, discordTime, HOUR } from '../core/time';
import { addEffect, addItem, count, startTimed, takeItem } from './inventory';
import { ITEMS, anyItem, findItem, isCollectible } from './items';
import { restockOne } from './shop';
import { addMoment } from '../core/moments';
import { award } from '../achievements/achievements';
import { ownedBy } from '../companies/companies';
import { PAINTS, unlockKit, unlockPaint } from '../profile/styles';

/** The Rend Times: a vague tip about one company's hidden market state. */
function rendTimes(ctx: Ctx): string {
  let state: { co?: Record<string, { mood?: { trend?: number }; health?: number; secret?: { leakDir?: number }; lnFair?: number }> } | null = null;
  try { state = JSON.parse(ctx.db.meta('market.state') ?? 'null'); } catch { state = null; }
  const data = (() => { try { return JSON.parse(ctx.db.meta('market.data') ?? 'null') as { prices?: Record<string, number>; names?: Record<string, string> } | null; } catch { return null; } })();
  if (!state?.co) return 'The presses are down today. Nobody is printing anything.';
  const id = ctx.rng.pick(Object.keys(state.co));
  const s = state.co[id]!;
  const name = data?.names?.[id] ?? id;
  const hints: string[] = [];
  const trend = s.mood?.trend ?? 0;
  hints.push(trend > 0.05 ? `Insiders at **${name}** are quietly optimistic.` : trend < -0.05 ? `People leaving **${name}** headquarters look nervous.` : `It is a quiet week at **${name}**. Perhaps too quiet.`);
  if (typeof s.health === 'number') { if (s.health > 0.3) hints.push('Word is the books look healthy.'); else if (s.health < -0.3) hints.push('Someone saw an accountant crying in the parking lot.'); }
  if (s.secret) hints.push(s.secret.leakDir! > 0 ? 'Rumor has it something good is brewing behind closed doors.' : s.secret.leakDir! < 0 ? 'Rumor has it someone is about to get some bad news.' : 'Something is going on behind closed doors.');
  const price = Number(data?.prices?.[id]);
  if (Number.isFinite(price) && price > 0 && typeof s.lnFair === 'number') { const r = Math.exp(s.lnFair) / price; if (r > 1.2) hints.push('One analyst thinks the stock is a bargain.'); else if (r < 0.8) hints.push('One analyst thinks the stock is overpriced.'); }
  return `**The Rend Times.** ${hints.slice(0, 2 + (ctx.rng.chance(0.5) ? 1 : 0)).join(' ')}\n-# The Rend Times is not responsible for your trades.`;
}

/** Posts a Megaphone ad in the market news (set by the bot at startup). */
let postAd: (text: string) => void = () => {};
export const setAdPoster = (fn: (text: string) => void): void => { postAd = fn; };

const JOKE_TITLES = ['Certified Floppy User', 'Read-Only Member', 'Insert Disk 2', '1.44 MB of Talent', 'Corrupted File'];

type Use = (ctx: Ctx, guildId: string) => string;

const USES: Record<string, Use> = {
  kit: (ctx) => { unlockKit(ctx.db, ctx.user.id); return `Profile customizing is unlocked for good. Try \`${ctx.config.prefix}profile looks\`.`; },
  ...Object.fromEntries(Object.keys(PAINTS).map((id) => [`paint_${id}`, ((ctx: Ctx) => { unlockPaint(ctx.db, ctx.user.id, id); return `${PAINTS[id]!.label} is yours for good: \`${ctx.config.prefix}profile theme ${id}\`.`; }) as Use])),
  times: (ctx) => rendTimes(ctx),
  megaphone: (ctx) => {
    const c = ownedBy(ctx.db, ctx.user.id);
    if (!c || (c.status !== 'private' && c.status !== 'public')) throw new GameError('use.megaphone', 'A Megaphone advertises your player company. Found one first.');
    postAd(`**${c.name} (${c.ticker})** is open for business${c.status === 'public' ? ` at ${format(Math.round(c.price * 100))} a share` : ''}. Now hiring: \`/apply ${c.ticker}\`.`);
    return `The ad for ${c.name} is in the market news.`;
  },
  coffee: (ctx, g) => { clearCooldown(ctx.db, 'work', `${g}:${ctx.user.id}`); return 'Coffee consumed. Your work cooldown has been reset.'; },
  overtime: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'overtime', 1); return 'Overtime approved. Your next shift pays double.'; },
  stopwatch: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'stopwatch', 3); return 'Stopwatch set. Your next 3 shifts have 10 extra seconds.'; },
  booster: (ctx, g) => `Dividend Booster active until ${discordTime(startTimed(ctx.db, g, ctx.user.id, 'divBoost', 24 * HOUR, ctx.now))}. Dividends collected meanwhile pay 50% more.`,
  chip: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'chip', 5); return 'Platinum Chip loaded. Your next 5 Rend-Sino games pay 4% more.'; },
  fuel: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'fuel', 1); return 'Rocket Fuel loaded. Your next Rocket flies 20% higher before it crashes.'; },
  lure: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'lure', 25); return 'Lure attached. No bait is needed for the next 25 casts, and bigger fish bite more often.'; },
  wrap: (ctx, g) => { addEffect(ctx.db, g, ctx.user.id, 'wrap', 1); return 'Gift Wrap ready. Your next gift has no fee.'; },
  mystery: (ctx, g) => {
    const w = wallet(g, ctx.user.id);
    const roll = ctx.rng.next();
    if (roll < MYSTERY.jackpotChance) return `**Jackpot.** The box held ${format(payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: MYSTERY.jackpot, reason: 'shop.mystery', guildId: g, actorId: ctx.user.id, now: ctx.now }))}.`;
    if (roll < MYSTERY.jackpotChance + MYSTERY.overtimeChance) { addItem(ctx.db, g, ctx.user.id, 'overtime', 1); return `The box held an **Overtime** pass. It is in your inventory: \`${ctx.config.prefix}use overtime\`.`; }
    return `The box held ${format(payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: polygons(ctx.rng.int(MYSTERY.cash[0], MYSTERY.cash[1])), reason: 'shop.mystery', guildId: g, actorId: ctx.user.id, now: ctx.now }))}.`;
  },
  floppy: (ctx, g) => {
    const u = ctx.user.id, w = wallet(g, u);
    const r = ctx.rng.next();
    if (r < 0.2) return '*whirr... click... click...* **FILE CORRUPTED.** Nothing happens. TODD shrugs.';
    if (r < 0.35) { clearCooldown(ctx.db, 'work', `${g}:${u}`); return 'The disk installs **TURBO_WORK.EXE**. Your work cooldown has been reset.'; }
    if (r < 0.5) { addEffect(ctx.db, g, u, 'dailyDouble', 1); return 'The disk installs **DAILY_X2.BAT**. Your next daily pays double.'; }
    if (r < 0.65) {
      const take = Math.min(polygons(500), Math.floor(balance(ctx.db, w) * 0.1));
      if (take > 0) transfer(ctx.db, { from: w, to: RESERVE, cents: take, reason: 'shop.floppy', guildId: g, actorId: u, now: ctx.now });
      return `The disk installs **TODD_LOAN.SYS**. TODD "borrows" ${format(take)}. "I'll give it back," he says. He won't.`;
    }
    if (r < 0.75) return `The disk was taped to an envelope. Inside: ${format(payFromReserve(ctx.db, economy.reserveStart, { to: w, cents: polygons(ctx.rng.int(50, 250)), reason: 'shop.floppy', guildId: g, actorId: u, now: ctx.now }))}.`;
    if (r < 0.85) {
      const t = ctx.rng.pick(JOKE_TITLES);
      const cur = ctx.db.get<{ title: string | null }>('SELECT title FROM players WHERE guild_id = ? AND user_id = ?', g, u)?.title;
      if (cur) return `The disk tries to rename you to *${t}*, but your title holds. Nothing happens.`;
      ctx.db.run('UPDATE players SET title = ? WHERE guild_id = ? AND user_id = ?', t, g, u);
      return `The disk installs **NAME.TXT**. Your title is now *${t}*.`;
    }
    if (r < 0.95) { addEffect(ctx.db, g, u, 'chip', 1); return 'A **Platinum Chip** was taped to the back of the disk. Your next Rend-Sino game pays 4% more.'; }
    return 'The disk plays a tinny little song. TODD is quietly moved. Nothing else happens.';
  }
};

/** Items where using more than one at once does nothing more (or would just spam). */
export const ONE_AT_A_TIME = new Set(['kit', 'coffee', 'megaphone', 'rushorder', ...Object.keys(PAINTS).map((id) => `paint_${id}`)]);
/** The Mystery box (Refined Everything! balance pass: it used to pay out more than it cost). */
export const MYSTERY = { jackpotChance: 0.05, jackpot: polygons(500), overtimeChance: 0.25, cash: [20, 100] as [number, number] };
export const BULK_MAX = 25;

/**
 * Uses several of an item in one go (Refined Everything!, Kine's idea): `/use mystery 10`. Returns one line per
 * different outcome, with how many times it happened, and how many were used.
 */
export function useMany(ctx: Ctx, guildId: string, id: string, want: number | 'all'): { lines: string[]; used: number } {
  const it = anyItem(id);
  const have = count(ctx.db, guildId, ctx.user.id, id);
  const n = Math.min(BULK_MAX, want === 'all' ? have : want);
  if (n > 1 && ONE_AT_A_TIME.has(id)) throw new GameError('use.one', `${it?.name ?? 'That'} is used one at a time.`);
  if (have > 0 && n > have) throw new GameError('use.short', `You have ${have} ${it?.name ?? id}.`);
  if (n <= 1) return { lines: [useItem(ctx, guildId, id)], used: 1 };
  return ctx.db.tx(() => {
    const seen = new Map<string, number>();
    let used = 0;
    for (let i = 0; i < n; i++) {
      // a different-looking message for the same result (amounts) still counts separately; that's fine
      const line = useItem(ctx, guildId, id);
      seen.set(line, (seen.get(line) ?? 0) + 1);
      used++;
    }
    const lines = [...seen].map(([l, k]) => (k > 1 ? `**×${k}** ${l}` : l));
    // keep the reply under Discord's embed limit
    let total = 0, keep = 0;
    while (keep < lines.length && total + lines[keep]!.length < 3300) total += lines[keep++]!.length + 1;
    return { lines: keep < lines.length ? [...lines.slice(0, keep), `-# …and ${lines.length - keep} more.`] : lines, used };
  });
}

/** Uses one of an item. Returns what happened. */
export function useItem(ctx: Ctx, guildId: string, id: string, target?: string): string {
  const it = anyItem(id);
  if (!it) throw new GameError('use.unknown', 'That item does not exist.');
  if (id === 'fertilizer') throw new GameError('use.fertilizer', `Fertilizer goes on a growing crop: \`${ctx.config.prefix}fertilize\`.`);
  if (id.startsWith('seed_')) throw new GameError('use.seed', `Plant seeds with \`${ctx.config.prefix}plant ${id.slice(5)}\`.`);
  if (it.passive) throw new GameError('use.passive', `${it.name} works on its own while it is in your inventory.`);
  if (id === 'rushorder') return rushOrder(ctx, guildId, target);
  const fn = USES[id];
  if (!fn) throw new GameError('use.none', `${it.name} has no use yet.`);
  return ctx.db.tx(() => {
    if (!takeItem(ctx.db, guildId, ctx.user.id, id)) throw new GameError('use.none', `You do not have a ${it.name}. Marquez sells them: \`${ctx.config.prefix}shop\`.`);
    return fn(ctx, guildId);
  });
}

/** A Rush Order: Marquez restocks one item in this server. */
function rushOrder(ctx: Ctx, guildId: string, target?: string): string {
  const P = ctx.config.prefix;
  const id = findItem(String(target ?? ''));
  if (!id) throw new GameError('use.rush', `Which item should Marquez restock? \`${P}use rush order <item>\`, like \`${P}use rush order coffee\`.`);
  const it = anyItem(id)!;
  if (isCollectible(id) || !ITEMS[id] || it.ready === false || id === 'rushorder') throw new GameError('use.rush', `Marquez can't rush ${it.name}. Rush Orders are for his regular shelves, not collectibles.`);
  return ctx.db.tx(() => {
    const added = restockOne(ctx.db, guildId, id);
    if (!added) throw new GameError('use.rush', `${it.name} is already fully stocked. Your Rush Order is still in your inventory.`);
    if (!takeItem(ctx.db, guildId, ctx.user.id, 'rushorder')) throw new GameError('use.none', `You do not have a Rush Order. Marquez sells them: \`${P}shop\`.`);
    award(ctx.db, guildId, ctx.user.id, 'rush_order', ctx.now);
    addMoment(`📦 Someone placed a Rush Order: Marquez just restocked ${it.name}`, ctx.now);
    return `Marquez makes a phone call. Ten minutes later a truck pulls up: **${added} ${it.name}** back on the shelf, for everyone here. *"Appreciate it, friend."*`;
  });
}
