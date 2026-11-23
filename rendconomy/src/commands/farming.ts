// Farming commands: /farm, /plant, /water, /harvest, /sellcrops, /fertilize, /compost, /buyplot.
import { addRevenue, alive, getCompany } from '../companies/companies';
import { awardHere, bump, getProgress, sameDay, setProgress } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve, payoutFactor } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer, wallet as walletOf } from '../core/ledger';
import { format, polygons } from '../core/money';
import { DAY, discordTime } from '../core/time';
import { emoji, emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { isEvent } from '../events/world';
import {
  CROPS, CROP_ORDER, FARMING, GRADES, MARKET, MUTATIONS, isOctober, saleValue, cropItem, cropPrice, farmColumns, maxPlots, newPlot, nextPlotPrice, parseCropItem, plotCount, readyEstimate,
  remindOn, resolveFarm, rollGrade, rollMutation, rollSale, savePlot, clearPlot, seedItem, farmhandUntil, setPlotCount, setRemind, stageOf, type CropItem, type Env, type FarmEvent, type Mutation, type Plot
} from '../farming/farming';
import { ESTATE, hasBarn, perkLevel } from '../estate/estate';
import { addItem, count, items, takeItem } from '../shop/inventory';
import { marquez } from '../shop/items';
import { dismiss, farmEnv, fertOf, giveFert, giveSeeds, handSettings, hasHand as handOn, hire, quietLog, runShift, setHandDm, shedOf, shedTotal, takeFert, takeLog, takeSeeds } from '../farming/farmhand';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';
import { workBonus } from '../city/state';

const hasHand = (ctx: Ctx, guildId: string): boolean => handOn(ctx.db, guildId, ctx.user.id, ctx.now);
const env = (ctx: Ctx, guildId: string): Env => farmEnv(ctx.db, guildId, ctx.user.id, hasHand(ctx, guildId));

const cropE = (id: string): string => emojiOr(id, CROPS[id]!.emoji);
const tile = (p: Plot | undefined, locked: boolean): string => {
  if (locked) return emojiOr('plot_locked', '🔒');
  if (!p) return emojiOr('plot_empty', '🟫');
  const s = stageOf(p);
  if (s === 'wilted') return emojiOr('plot_wilted', '🥀');
  if (s === 'ready') return emojiOr(`plot_${p.crop}`, CROPS[p.crop]!.emoji);
  return emojiOr(`plot_${s}${p.watered ? '_wet' : ''}`, s === 'sprout' ? '🌱' : '🌿');
};

/** Words players type for a crop: "carrot", "carrots", "polygon fruit", "pumpkins"... */
export function findCrop(text: string): string | null {
  const t = String(text ?? '').trim().toLowerCase().replace(/\s*seeds?$/, '');
  if (!t) return null;
  if (CROPS[t]) return t;
  if (/^poly|fruit/.test(t)) return 'polyfruit';
  return CROP_ORDER.find((id) => [CROPS[id]!.name, CROPS[id]!.plural].some((n) => n.toLowerCase() === t)) ?? CROP_ORDER.find((id) => t.length >= 3 && id.startsWith(t)) ?? null;
}

/** Brings the farm up to now (the farmhand's shift first), awards what happened since, and says it. */
function catchUp(ctx: Ctx, guildId: string): { plots: Plot[]; news: string[]; env: Env } {
  runShift(ctx.db, guildId, ctx.user.id, ctx.now, ctx.rng);
  const e = env(ctx, guildId);
  const { plots, events } = resolveFarm(ctx.db, guildId, ctx.user.id, e, ctx.now);
  return { plots, news: [...handNews(ctx, guildId), ...news(ctx, events)], env: e };
}

/** Achievements and counters for crops that went into the basket. */
function creditHarvest(ctx: Ctx, item: string, qty: number): void {
  const c = parseCropItem(item);
  if (!c || qty <= 0) return;
  awardHere('green_thumb');
  if (bump(ctx.db, ctx.user.id, 'harvests', qty) >= 500) awardHere('bumper_crop');
  if (c.crop.id === 'carrot' && bump(ctx.db, ctx.user.id, 'carrots', qty) >= 100) awardHere('whats_up_doc');
  if (c.crop.id === 'pumpkin' && bump(ctx.db, ctx.user.id, 'pumpkins', qty) >= 25) awardHere('great_pumpkin');
  if (c.crop.id === 'polyfruit') awardHere('forbidden_fruit');
  if (c.mut === 'golden') awardHere('midas_touch');
  if (c.mut === 'square') awardHere('look_at_spookly');
  if (c.mut === 'rainbow') { setProgress(ctx.db, ctx.user.id, `rainbow_${c.crop.id}`, 1); if (CROP_ORDER.every((x) => getProgress(ctx.db, ctx.user.id, `rainbow_${x}`) > 0)) awardHere('taste_the_rainbow'); }
  gradeAwards(ctx, c, qty);
}

/** The quality achievements (and the run of Poor crops behind Rotten Luck). */
function gradeAwards(ctx: Ctx, c: CropItem, qty: number): void {
  if (c.grade === 'prime') { awardHere('quality_control'); if (c.mut === 'golden' || c.mut === 'rainbow') awardHere('cream_of_the_crop'); }
  if (c.grade === 'poor') { if (bump(ctx.db, ctx.user.id, 'poor_streak', qty) >= 10) awardHere('rotten_luck'); }
  else setProgress(ctx.db, ctx.user.id, 'poor_streak', 0);
}
/** A crop's name with its grade's badge. */
const cropLabel = (c: CropItem): string => `${emojiOr(c.emojiKey, c.emoji)} ${c.grade === 'prime' ? `${GRADES.prime.emoji} ` : ''}${c.name}`;

/** "While you were gone": what the farmhand did since you last looked. */
function handNews(ctx: Ctx, guildId: string): string[] {
  const log = takeLog(ctx.db, guildId, ctx.user.id);
  if (!log || quietLog(log)) return [];
  const P = ctx.config.prefix, H = emojiOr('farmhand', '🧑‍🌾');
  const out: string[] = [];
  const picked = Object.entries(log.harvested);
  const n = picked.reduce((s, [, q]) => s + q, 0);
  for (const [item, q] of picked) creditHarvest(ctx, item, q);
  if (n) { sameDay(ctx.db, ctx.user.id, 'harvest', ctx.now); if (bump(ctx.db, ctx.user.id, 'hand_harvests', n) >= 500) awardHere('farmhand_of_the_year'); }
  const primes = picked.filter(([item]) => parseCropItem(item)!.grade === 'prime').reduce((x, [, q]) => x + q, 0);
  const special = picked.map(([item, q]) => [parseCropItem(item)!, q] as const).filter(([c]) => c.mut).map(([c, q]) => `${emojiOr(c.emojiKey, c.emoji)} **${q > 1 ? `${q} × ` : ''}${c.name}**`);
  const did = [
    n ? `harvested ${n} ${n === 1 ? 'crop' : 'crops'} into your basket${special.length ? ` (${special.join(', ')})` : ''}` : null,
    log.replanted ? `replanted ${log.replanted} ${log.replanted === 1 ? 'time' : 'times'}` : null,
    log.fertilized ? `worked Fertilizer into ${log.fertilized} ${log.fertilized === 1 ? 'crop' : 'crops'}` : null
  ].filter(Boolean) as string[];
  if (did.length) out.push(`${H} **While you were gone**, your farmhand ${did.length > 1 ? `${did.slice(0, -1).join(', ')} and ${did[did.length - 1]}` : did[0]}.${primes ? ` ${GRADES.prime.emoji} ${primes} came out Prime.` : ''}`);
  const lost = [log.crows ? `crows got ${log.crows}` : null, log.storms ? `storms flattened ${log.storms}` : null].filter(Boolean);
  if (lost.length) out.push(`-# He did his best, but ${lost.join(' and ')}.`);
  const named = log.outOf.filter((c) => CROPS[c]).map((c) => CROPS[c]!.name);
  if (log.idle) out.push(`${H} He's out of seeds${named.length ? ` (${named.join(', ')})` : ''}: ${log.idle} ${log.idle === 1 ? 'plot sits' : 'plots sit'} empty. Hand him more: \`${P}farmhand give carrot 10\`.`);
  else if (named.length) out.push(`-# He ran out of ${named.join(' and ')} seeds and planted what he had instead.`);
  if (log.left) out.push(`${H} Your farmhand left: you couldn't pay their ${format(FARMING.farmhandWage)} wage. Whatever was in his seed shed is back in your inventory.`);
  return out;
}

/** Harvests these plots (ready or wilted) into the basket. auto: the farmhand did it (no Early Bird). */
function harvestPlots(ctx: Ctx, guildId: string, plots: Plot[], auto: boolean): { lines: string[]; count: number; muts: number } {
  const lines: string[] = [];
  let muts = 0, count = 0;
  for (const p of plots.filter((x) => stageOf(x) === 'wilted')) { clearPlot(ctx.db, guildId, ctx.user.id, p.slot); lines.push(`🥀 ${auto ? 'Cleared' : 'You clear'} the wilted ${CROPS[p.crop]!.name} from plot ${p.slot + 1}.`); }
  for (const p of plots.filter((x) => stageOf(x) === 'ready')) {
    const c = CROPS[p.crop]!;
    const mut: Mutation | null = rollMutation(p.crop, ctx.rng);
    const grade = rollGrade(ctx.rng, !!p.fert);
    addItem(ctx.db, guildId, ctx.user.id, cropItem(p.crop, mut, grade));
    count++;
    const parsed = parseCropItem(cropItem(p.crop, mut, grade))!;
    gradeAwards(ctx, parsed, 1);
    const badge = grade === 'prime' ? ` ${GRADES.prime.emoji} **Prime**` : grade === 'poor' ? ' · *Poor*' : '';
    lines.push(`${emojiOr(parsed.emojiKey, parsed.emoji)} ${mut ? `**${parsed.name}!** ${MUTATIONS[mut].emoji} Worth about ${format(parsed.value)}.` : `${c.name}${badge}`} · plot ${p.slot + 1}`);
    awardHere('green_thumb');
    if (bump(ctx.db, ctx.user.id, 'harvests') >= 500) awardHere('bumper_crop');
    if (p.crop === 'carrot' && bump(ctx.db, ctx.user.id, 'carrots') >= 100) awardHere('whats_up_doc');
    if (p.crop === 'pumpkin' && bump(ctx.db, ctx.user.id, 'pumpkins') >= 25) awardHere('great_pumpkin');
    if (p.crop === 'polyfruit') { awardHere('forbidden_fruit'); if (p.dry_ms === 0) awardHere('patience'); }
    if (p.crop === 'tomato' && p.harvests_left === 1 && c.harvests === 3) awardHere('ketchup');
    if (!auto && p.ready_at !== null && ctx.now - p.ready_at <= FARMING.earlyBirdMs) awardHere('early_bird');
    if (mut) {
      muts++;
      if (mut === 'golden') awardHere('midas_touch');
      if (mut === 'square') awardHere('look_at_spookly');
      if (mut === 'rainbow') { setProgress(ctx.db, ctx.user.id, `rainbow_${p.crop}`, 1); if (CROP_ORDER.every((x) => getProgress(ctx.db, ctx.user.id, `rainbow_${x}`) > 0)) awardHere('taste_the_rainbow'); }
    }
    // tomatoes grow back from the growing stage; everything else leaves the plot empty
    if (p.harvests_left > 1) savePlot(ctx.db, { ...p, harvests_left: p.harvests_left - 1, progress: c.growMs / 2, ready_at: null, watered: env(ctx, guildId).hand ? 1 : 0, stage_since: ctx.now, updated_at: ctx.now, crow_at: null, fert: 0, reminded: 0 });
    else clearPlot(ctx.db, guildId, ctx.user.id, p.slot);
  }
  if (muts >= 2) awardHere('lucky_harvest');
  if (count) sameDay(ctx.db, ctx.user.id, 'harvest', ctx.now);
  return { lines, count, muts };
}

function news(ctx: Ctx, events: FarmEvent[]): string[] {
  const out: string[] = [];
  const name = (ev: FarmEvent) => `${cropE(ev.crop)} ${CROPS[ev.crop]!.name} in plot ${ev.slot + 1}`;
  let storms = 0;
  for (const ev of events) {
    if (ev.kind === 'crow_ate') { out.push(`${emoji('crow')} Crows got your ${name(ev)}.`); awardHere('bird_brain'); }
    else if (ev.kind === 'crow_scared') {
      out.push(`${emoji('scarecrow')} Your Scarecrow chased crows away from your ${name(ev)}.`);
      if (bump(ctx.db, ctx.user.id, 'scarecrow_saves') >= 25) awardHere('scarecrow_season');
    } else if (ev.kind === 'storm') { out.push(`${emoji('storm')} The storm flattened your ${name(ev)}.`); storms++; }
    else if (ev.kind === 'wilted') { out.push(`🥀 Your ${name(ev)} wilted. \`${ctx.config.prefix}harvest\` clears it.`); awardHere('brown_thumb'); }
  }
  if (storms >= 3) awardHere('weathered');
  return out;
}

function plotLine(p: Plot | undefined, slot: number, now: number): string {
  const n = `**${slot + 1}.**`;
  if (!p) return `${n} Empty`;
  const c = CROPS[p.crop]!, s = stageOf(p);
  const extra = [p.fert ? '🧪' : null, c.harvests > 1 ? `${p.harvests_left} of ${c.harvests} harvests left` : null].filter(Boolean).join(' · ');
  const tail = extra ? ` · ${extra}` : '';
  if (s === 'wilted') return `${n} ${cropE(p.crop)} ${c.name}: 🥀 wilted`;
  if (s === 'ready') return `${n} ${cropE(p.crop)} ${c.name}: ${emoji('yes')} **ready to harvest**${tail}`;
  const est = readyEstimate(p, now);
  return `${n} ${cropE(p.crop)} ${c.name}: ${s === 'sprout' ? 'sprouting' : 'growing'} · ${p.watered ? `${emoji('wateringcan')} watered · ready ${discordTime(est!)}` : '**needs water**'}${tail}`;
}

/** A Warehouse's Cold Storage: sell at the best price of the last few days. */
export const coldDays = (ctx: Ctx, guildId: string): number => { const lv = perkLevel(ctx.db, guildId, ctx.user.id, 'warehouse', ctx.now); return lv ? ESTATE.warehouseDays[lv - 1]! : 1; };
export const basket = (ctx: Ctx, guildId: string) => items(ctx.db, guildId, ctx.user.id).map((r) => ({ ...r, c: parseCropItem(r.item) })).filter((r) => r.c) as { item: string; qty: number; c: NonNullable<ReturnType<typeof parseCropItem>> }[];

function farmView(ctx: Ctx, guildId: string, top: string[] = []): ReplyObject {
  const P = ctx.config.prefix;
  const { plots, news: n } = catchUp(ctx, guildId);
  const owned = plotCount(ctx.db, guildId, ctx.user.id);
  const barn = hasBarn(ctx.db, guildId, ctx.user.id, ctx.now);
  const at = (i: number) => plots.find((p) => p.slot === i);
  // never more than 3 rows: 3 columns, or 5 once a Barn makes room for 15
  const room = Math.max(owned, maxPlots(barn)), cols = farmColumns(room);
  const grid: string[] = [];
  for (let r = 0; r < FARMING.rows; r++) grid.push(Array.from({ length: cols }, (_, c) => r * cols + c).filter((i) => i < room).map((i) => tile(at(i), i >= owned)).join(''));
  const b = basket(ctx, guildId);
  const inBasket = b.reduce((s, r) => s + r.qty, 0);
  const days = coldDays(ctx, guildId);
  const worth = Math.floor(b.reduce((s, r) => s + saleValue(r.c, ctx.now, days) * r.qty, 0) * payoutFactor(ctx.db, economy.reserveStart));
  const price = nextPlotPrice(owned, barn);
  const raining = isEvent(ctx.db, 'rain', undefined, ctx.now), storming = isEvent(ctx.db, 'storm', undefined, ctx.now);
  const seeds = CROP_ORDER.map((id) => [id, count(ctx.db, guildId, ctx.user.id, seedItem(id))] as const).filter(([, q]) => q > 0);
  return {
    // the field on its own, as plain emoji-only text: Discord shows that at jumbo size (an embed never would)
    content: grid.join('\n'),
    embeds: [embed('farm', `🌾 ${ctx.user.name}'s farm`, [
      ...top, ...n, (top.length || n.length) ? '' : null,
      ...Array.from({ length: owned }, (_, i) => plotLine(at(i), i, ctx.now)),
      '',
      raining ? `${emoji('rain')} It's raining: every crop is watered for free.` : null,
      storming ? `${emoji('storm')} A storm is passing through.${count(ctx.db, guildId, ctx.user.id, 'greenhouse') ? ' Your Greenhouse keeps the crops safe.' : ''}` : null,
      seeds.length ? `Seeds: ${seeds.map(([id, q]) => `${emojiOr(`seed_${id}`, CROPS[id]!.emoji)} ${q}`).join(' · ')}` : `-# Seeds are on Marquez's Garden shelf: \`${P}shop garden\`.`,
      inBasket ? `${emoji('harvest')} Basket: ${inBasket} ${inBasket === 1 ? 'crop' : 'crops'}, worth **${format(worth)}** · \`${P}farm sell\`` : null,
      price !== null ? `-# ${emoji('newplot')} Plot ${owned + 1} costs ${format(price)}: \`${P}buyplot\`` : !barn ? `-# ${emojiOr('prop_barn', '🐄')} A Barn on the city map unlocks 6 more plots: \`${P}property build <tile> barn\`` : null,
      hasHand(ctx, guildId) && fertOf(ctx.db, guildId, ctx.user.id) ? `-# ${emoji('fertilizer')} ${fertOf(ctx.db, guildId, ctx.user.id)} Fertilizer in his shed.` : null,
      hasHand(ctx, guildId) ? `-# ${emojiOr('farmhand', '🧑‍🌾')} Your farmhand has ${shedTotal(shedOf(ctx.db, guildId, ctx.user.id))} seeds in his shed: \`${P}farmhand\`` : null
    ], { footer: { text: `${P}plant <crop> · ${P}water · ${P}harvest · ${P}farm remind ${remindOn(ctx.db, guildId, ctx.user.id) ? 'off' : 'on'}` } })]
  };
}

export const farm: Command = {
  name: 'farm', aliases: ['field', 'garden', 'plots', 'crops'], description: 'Your farm: what is growing, what is ready, and your basket', system: 'farm', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: 'Blank to look, or: plant <crop>, water, harvest, sell, buy, remind on|off' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const [word = '', ...rest] = String(args.action ?? '').trim().toLowerCase().split(/\s+/);
    if (word === 'sell') return sellcrops.run(ctx, { company: rest.join(' ') });
    if (word === 'water') return water.run(ctx, {});
    if (['harvest', 'reap', 'pick'].includes(word)) return harvest.run(ctx, {});
    if (['buy', 'expand', 'plot'].includes(word)) return buyplot.run(ctx, {});
    if (word === 'plant') return plant.run(ctx, { crop: rest.join(' ') });
    if (word === 'prices' || word === 'price' || word === 'market') {
      const days = coldDays(ctx, guildId);
      const pct = (x: number) => `${Math.round(x * 100)}%`;
      return { embeds: [embed('farm', '📈 Crop prices today', [
        'Every crop\'s price moves each day, the same for everyone. On top of that, each crop is graded at harvest:',
        `${GRADES.poor.emoji} **Poor** ${pct(GRADES.poor.band[0])}–${pct(GRADES.poor.band[1])} · **Fine** ${pct(GRADES.fine.band[0])}–${pct(GRADES.fine.band[1])} · ${GRADES.prime.emoji} **Prime** ${pct(GRADES.prime.band[0])}–${pct(GRADES.prime.band[1])} of its value. Fertilized crops come out Prime more often.`, '',
        ...CROP_ORDER.map((id) => { const today = cropPrice(id, ctx.now), yday = cropPrice(id, ctx.now - DAY); return `${cropE(id)} **${CROPS[id]!.name}**: ${pct(today)} of ${format(CROPS[id]!.value)} ${today >= yday ? emoji('up') : emoji('down')}`; }),
        '', days > 1 ? `${emojiOr('prop_warehouse', '📦')} Your Warehouse sells at the best price of the last ${days} days.` : `-# A Warehouse on the city map lets you sell at the best price of the last few days.`
      ])] };
    }
    if (word === 'remind') {
      const on = rest[0] ? ['on', 'yes', 'true'].includes(rest[0]) : !remindOn(ctx.db, guildId, ctx.user.id);
      setRemind(ctx.db, guildId, ctx.user.id, on);
      return { content: on ? `${emoji('yes')} You'll get a DM when your crops are ready. Turn it off with \`${ctx.config.prefix}farm remind off\`.` : `${emoji('no')} No more crop DMs.` };
    }
    return farmView(ctx, guildId);
  }
};

export const plant: Command = {
  name: 'plant', aliases: ['sow'], description: 'Plant seeds in your empty plots (or one plot)', system: 'farm', guildOnly: true,
  options: [{ name: 'crop', type: 'string', description: 'carrot, corn, tomato, pumpkin or polygon fruit', required: true }, { name: 'plot', type: 'string', description: 'A plot number (default: every empty plot)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    let cropText = String(args.crop ?? ''), plotText = String(args.plot ?? '').trim().toLowerCase();
    if (plotText && !/^(\d+|all)$/.test(plotText)) { cropText += ' ' + plotText; plotText = ''; }   // "polygon fruit"
    const id = findCrop(cropText);
    if (!id) throw new GameError('farm.crop', `Plant what? ${CROP_ORDER.map((c) => `\`${c}\``).join(', ')}.`);
    const c = CROPS[id]!;
    return ctx.db.tx(() => {
      const { plots, news: n, env: e } = catchUp(ctx, guildId);
      const owned = plotCount(ctx.db, guildId, ctx.user.id);
      const taken = new Set(plots.map((p) => p.slot));
      let targets = Array.from({ length: owned }, (_, i) => i).filter((i) => !taken.has(i));
      if (/^\d+$/.test(plotText)) {
        const slot = Number(plotText) - 1;
        if (slot < 0 || slot >= owned) throw new GameError('farm.plot', `You have plots 1 to ${owned}.`);
        if (taken.has(slot)) throw new GameError('farm.taken', `Plot ${slot + 1} already has something in it. \`${P}harvest\` clears ready and wilted crops.`);
        targets = [slot];
      }
      if (!targets.length) throw new GameError('farm.full', `Every plot is in use. Harvest first, or buy another plot: \`${P}buyplot\`.`);
      const seeds = count(ctx.db, guildId, ctx.user.id, seedItem(id));
      if (!seeds) throw new GameError('farm.seeds', `You have no ${c.name} Seeds. Marquez has them on the Garden shelf: \`${P}shop garden\`.`);
      const go = targets.slice(0, seeds);
      takeItem(ctx.db, guildId, ctx.user.id, seedItem(id), go.length);
      const wet = e.hand || isEvent(ctx.db, 'rain', undefined, ctx.now);
      for (const slot of go) savePlot(ctx.db, newPlot(guildId, ctx.user.id, slot, id, ctx.now, ctx.rng, wet));
      const growing = new Set([...plots.filter((p) => !p.wilted).map((p) => p.crop), id]);
      if (CROP_ORDER.every((x) => growing.has(x))) awardHere('something_for_everyone');
      const left = seeds - go.length;
      return farmView(ctx, guildId, [...n,
        `${cropE(id)} You plant ${go.length === 1 ? `a ${c.name}` : `${go.length} ${c.plural}`} in plot${go.length === 1 ? '' : 's'} ${go.map((s) => s + 1).join(', ')}.` +
        (wet ? ` ${e.hand ? 'Your farmhand waters' : 'The rain waters'} ${go.length === 1 ? 'it' : 'them'} right away.` : ` Don't forget to \`${P}water\`.`),
        targets.length > seeds ? `-# That was your last ${c.name} seed.` : left ? `-# ${left} ${c.name} ${left === 1 ? 'seed' : 'seeds'} left.` : null
      ].filter((x): x is string => x !== null));
    });
  }
};

export const water: Command = {
  name: 'water', aliases: ['wet', 'sprinkle'], description: 'Water every crop that needs it', system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const { plots, news: n } = catchUp(ctx, guildId);
      const dry = plots.filter((p) => (stageOf(p) === 'sprout' || stageOf(p) === 'growing') && !p.watered);
      if (!dry.length) {
        const growing = plots.some((p) => stageOf(p) === 'sprout' || stageOf(p) === 'growing');
        throw new GameError('farm.wet', growing ? 'Everything is already watered. Crops need water again when they move to the next stage.' : `Nothing is growing. Plant something: \`${ctx.config.prefix}plant carrot\`.`);
      }
      for (const p of dry) savePlot(ctx.db, { ...p, watered: 1 });
      return farmView(ctx, guildId, [...n, `${emoji('wateringcan')} You water ${dry.length === 1 ? `your ${CROPS[dry[0]!.crop]!.name}` : `${dry.length} crops`}.`]);
    });
  }
};

export const harvest: Command = {
  name: 'harvest', aliases: ['reap', 'pick'], description: 'Harvest every ready crop (and clear wilted ones)', system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    return ctx.db.tx(() => {
      const { plots, news: n } = catchUp(ctx, guildId);
      const ready = plots.filter((p) => stageOf(p) === 'ready'), wilted = plots.filter((p) => stageOf(p) === 'wilted');
      if (!ready.length && !wilted.length) {
        const soon = plots.map((p) => (p.watered ? readyEstimate(p, ctx.now) : null)).filter((x): x is number => x !== null).sort((a, b) => a - b)[0];
        throw new GameError('farm.notready', plots.length ? `Nothing is ready yet.${soon ? ` The next crop is ready ${discordTime(soon)}.` : ' Some crops need water first.'}` : `Nothing is planted. \`${P}plant carrot\` to start.`);
      }
      const { lines } = harvestPlots(ctx, guildId, [...wilted, ...ready], false);
      return farmView(ctx, guildId, [...n, ready.length ? `${emoji('harvest')} **Harvest time!**` : null, ...lines].filter((x): x is string => x !== null));
    });
  }
};

export const sellcrops: Command = {
  name: 'sellcrops', aliases: ['sellharvest', 'sellcrop', 'sellbasket'], description: 'Sell your whole harvest to Marquez, or to a player company at the farmers\' market', system: 'farm', guildOnly: true,
  options: [{ name: 'company', type: 'string', description: 'A player company\'s ticker: it pays 10% more and earns from the sale' }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix;
    const b = basket(ctx, guildId);
    if (!b.length) throw new GameError('farm.empty', `Your basket is empty. Harvest something first: \`${P}harvest\`.`);
    const ticker = String(args.company ?? '').trim().toUpperCase();
    const co = ticker ? getCompany(ctx.db, ticker) : null;
    if (ticker && !alive(co)) throw new GameError('farm.market', `There's no player company called ${ticker}. \`${P}companies\` lists them.`);
    if (co && co.owner_id === ctx.user.id) throw new GameError('farm.own', 'Selling to your own company? Marquez raises an eyebrow. Pick someone else\'s.');
    return ctx.db.tx(() => {
      const days = coldDays(ctx, guildId);
      // every crop's price is rolled within its grade's range, at today's (or Cold Storage's best) price
      const sold = new Map(b.map((r) => [r.item, rollSale(r.c, r.qty, ctx.now, ctx.rng, days)] as const));
      const value = (r: (typeof b)[number]) => sold.get(r.item)!.total;
      const base = b.reduce((s, r) => s + value(r), 0);
      const civic = workBonus(ctx.db, guildId, 'crops', ctx.now);   // Under New Management: a public work
      const total = Math.round((co ? base * MARKET.farmersMarket : base) * (1 + civic));
      if (days > 1 && b.some((r) => sold.get(r.item)!.best >= 1.5)) awardHere('buy_low_sell_high');
      for (const r of b) takeItem(ctx.db, guildId, ctx.user.id, r.item, r.qty);
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: total, reason: 'farm.sell', guildId, actorId: ctx.user.id, now: ctx.now, note: co ? { company: co.ticker } : undefined });
      if (co) addRevenue(ctx.db, co.ticker, Math.round(paid * MARKET.companyCut), ctx.now);
      if (bump(ctx.db, ctx.user.id, 'farm_earned', paid) >= polygons(100_000)) awardHere('cash_crop');
      const n = b.reduce((x, r) => x + r.qty, 0);
      const say = b.some((r) => r.c.mut === 'square') ? 'square' : b.some((r) => r.c.mut) ? 'golden' : 'crops';
      const october = isOctober(ctx.now) && b.some((r) => r.c.crop.id === 'pumpkin');
      return { embeds: [embed('farm', co ? `🧺 Sold at the farmers' market` : '🧺 Harvest sold', [
        co ? `${emoji('company')} **${co.name}** (${co.ticker}) buys your whole basket for its kitchens.` : `*${marquez(say, ctx.rng)}*`, '',
        ...b.sort((x, y) => value(y) - value(x)).map((r) => `${cropLabel(r.c)} × ${r.qty}: ${format(value(r))}`), '',
        days > 1 ? `${emojiOr('prop_warehouse', '📦')} Cold Storage: your Warehouse sold at the best price of the last ${days} days.` : null,
        october ? `🎃 Pumpkin season: pumpkins sell for ${Math.round((MARKET.octoberPumpkins - 1) * 100)}% more all October.` : null,
        co ? `They pay **${format(paid)}** for ${n} ${n === 1 ? 'crop' : 'crops'}, ${Math.round((MARKET.farmersMarket - 1) * 100)}% more than Marquez, and ${co.ticker} earns ${format(Math.round(paid * MARKET.companyCut))} from it.`
          : `He pays **${format(paid)}** for ${n} ${n === 1 ? 'crop' : 'crops'}.`,
        `-# Balance: ${format(balance(ctx.db, wallet))}${co ? '' : ` · Player companies pay 10% more: \`${P}farm sell <ticker>\``}`])] };
    });
  }
};

export const fertilize: Command = {
  name: 'fertilize', aliases: ['fertilise', 'fert'], description: 'Put Fertilizer on every growing crop (or one plot): they grow 50% faster and come out Prime more often', system: 'farm', guildOnly: true,
  options: [{ name: 'plot', type: 'string', description: 'A plot number (default: every growing crop, as far as your Fertilizer goes)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    const have = count(ctx.db, guildId, ctx.user.id, 'fertilizer');
    if (!have) throw new GameError('farm.nofert', `You have no Fertilizer. Marquez sells it (\`${P}shop garden\`), or make some with \`${P}compost\`.`);
    return ctx.db.tx(() => {
      const { plots, news: n } = catchUp(ctx, guildId);
      const ok = (p: Plot) => (stageOf(p) === 'sprout' || stageOf(p) === 'growing') && !p.fert;
      const want = String(args.plot ?? '').trim();
      let targets: Plot[];
      if (want && want !== 'all') {
        const p = plots.find((x) => x.slot === Number(want) - 1);
        if (!p || !ok(p)) throw new GameError('farm.fert', `Plot ${want} has no growing crop that can use Fertilizer.`);
        targets = [p];
      } else targets = plots.filter(ok).sort((a, b) => a.slot - b.slot);
      if (!targets.length) throw new GameError('farm.fert', 'Nothing growing can use Fertilizer right now.');
      const go = targets.slice(0, have);
      takeItem(ctx.db, guildId, ctx.user.id, 'fertilizer', go.length);
      for (const p of go) savePlot(ctx.db, { ...p, fert: 1 });
      const left = have - go.length;
      return farmView(ctx, guildId, [...n,
        go.length === 1 ? `${emoji('fertilizer')} You work Fertilizer into plot ${go[0]!.slot + 1}. Your ${CROPS[go[0]!.crop]!.name} perks right up.`
          : `${emoji('fertilizer')} You work Fertilizer into ${go.length} plots (${go.map((p) => p.slot + 1).join(', ')}). Everything perks right up.`,
        targets.length > go.length ? `-# You ran out: ${targets.length - go.length} more could use some.` : `-# ${left} Fertilizer left.`]);
    });
  }
};

const JUNK = ['boot', 'can', 'tire', 'controller'];
export const compost: Command = {
  name: 'compost', description: 'Turn fishing junk into Fertilizer (a Soggy Boot makes 1; other junk, 2 for 1)', system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    return ctx.db.tx(() => {
      const have = Object.fromEntries(JUNK.map((j) => [j, count(ctx.db, guildId, ctx.user.id, `fish_${j}`)]));
      const boots = have.boot!, other = JUNK.slice(1).reduce((s, j) => s + have[j]!, 0);
      const made = boots + Math.floor(other / 2);
      if (!made) throw new GameError('farm.nojunk', 'You have no junk to compost. Fishing turns up plenty of it.');
      if (boots) takeItem(ctx.db, guildId, ctx.user.id, 'fish_boot', boots);
      let use = Math.floor(other / 2) * 2;
      for (const j of JUNK.slice(1)) { const t = Math.min(use, have[j]!); if (t) takeItem(ctx.db, guildId, ctx.user.id, `fish_${j}`, t); use -= t; }
      addItem(ctx.db, guildId, ctx.user.id, 'fertilizer', made);
      if (boots) awardHere('one_mans_trash');
      return { embeds: [embed('farm', '♻️ Compost', [`${emoji('compost')} Into the bin it goes. A few days of rot later (or right now, this is a game)...`, '',
        `You get **${made} Fertilizer**.`, other % 2 ? '-# One piece of junk was left over: it takes 2 to make one.' : null])] };
    });
  }
};

export const buyplot: Command = {
  name: 'buyplot', aliases: ['newplot', 'moreland'], description: `Buy another plot of land (up to ${FARMING.maxPlots}, or ${FARMING.maxPlots + FARMING.barnPlots} with a Barn)`, system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    return ctx.db.tx(() => {
      const owned = plotCount(ctx.db, guildId, ctx.user.id);
      const barn = hasBarn(ctx.db, guildId, ctx.user.id, ctx.now);
      const price = nextPlotPrice(owned, barn);
      if (price === null) throw new GameError('farm.max', barn ? `You own all ${maxPlots(true)} plots. That's the whole field, Barn and all.`
        : `You own all ${FARMING.maxPlots} plots. A Barn on the city map unlocks ${FARMING.barnPlots} more: \`${ctx.config.prefix}property build <tile> barn\`.`);
      if (balance(ctx.db, wallet) < price) throw new GameError('funds.short', `Plot ${owned + 1} costs ${format(price)}. The balance is ${format(balance(ctx.db, wallet))}.`);
      transfer(ctx.db, { from: wallet, to: RESERVE, cents: price, reason: 'farm.plot', guildId, actorId: ctx.user.id, now: ctx.now });
      setPlotCount(ctx.db, guildId, ctx.user.id, owned + 1);
      if (owned + 1 >= FARMING.maxPlots) awardHere('full_acreage');
      if (owned + 1 >= maxPlots(true)) awardHere('fifteen_acres');
      return farmView(ctx, guildId, [`${emoji('newplot')} You buy plot ${owned + 1} for **${format(price)}**. Fresh soil, ready to go.`]);
    });
  }
};

const SHED_HELP = (P: string) => `\`${P}farmhand give <crop|fertilizer> [amount|all]\` · \`${P}farmhand take <crop|fertilizer> [amount|all]\` · \`${P}farmhand dms on|off\` · \`${P}farmhand fire\``;
/** "carrot 10", "polygon fruit all", "corn": the crop and how many (default all). */
function cropAndAmount(words: string[]): { crop: string | null; n: number | 'all' } {
  const lastWord = words[words.length - 1] ?? '';
  const n: number | 'all' = /^\d+$/.test(lastWord) ? Number(lastWord) : 'all';
  const cropWords = /^(\d+|all)$/.test(lastWord) ? words.slice(0, -1) : words;
  return { crop: findCrop(cropWords.join(' ')), n };
}

export const farmhand: Command = {
  name: 'farmhand', aliases: ['hand', 'farmhelp'], description: `Hire a Farmhand (${format(FARMING.farmhandWage)} a day): he waters, harvests and replants from a seed shed you stock`, system: 'farm', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: 'Blank to see, or: hire, fire, give <crop> [amount], take <crop> [amount], dms on|off' }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const P = ctx.config.prefix, H = emojiOr('farmhand', '🧑‍🌾');
    const [v = '', ...rest] = String(args.action ?? '').trim().toLowerCase().split(/\s+/);
    const onOff = (w: string | undefined, cur: boolean) => (w ? ['on', 'yes', 'true'].includes(w) : !cur);
    return ctx.db.tx(() => {
      const top = catchUp(ctx, guildId).news;
      const until = farmhandUntil(ctx.db, guildId, ctx.user.id);
      const employed = !!until && until > ctx.now;
      const need = () => { if (!employed) throw new GameError('hand.none', `You have no farmhand. Hire one: \`${P}farmhand hire\`.`); };
      if (v === 'hire') {
        if (employed) throw new GameError('hand.have', 'You already have a farmhand.');
        if (balance(ctx.db, wallet) < FARMING.farmhandWage) throw new GameError('funds.short', `A farmhand costs ${format(FARMING.farmhandWage)} a day, paid up front. The balance is ${format(balance(ctx.db, wallet))}.`);
        transfer(ctx.db, { from: wallet, to: RESERVE, cents: FARMING.farmhandWage, reason: 'farm.hand', guildId, actorId: ctx.user.id, now: ctx.now });
        hire(ctx.db, guildId, ctx.user.id, ctx.now);
        awardHere('gentleman_farmer');
        // first job: water everything that's thirsty
        for (const p of resolveFarm(ctx.db, guildId, ctx.user.id, env(ctx, guildId), ctx.now).plots) if ((stageOf(p) === 'sprout' || stageOf(p) === 'growing') && !p.watered) savePlot(ctx.db, { ...p, watered: 1 });
        return farmView(ctx, guildId, [...top, `${H} You hire a farmhand for **${format(FARMING.farmhandWage)} a day**. He keeps everything watered, harvests what's ready into your basket and replants from his seed shed.`,
          `Stock his shed so he can replant: \`${P}farmhand give carrot 10\`. He'll DM you when he runs out.`, `-# His wage comes out each day. Let him go with \`${P}farmhand fire\`.`]);
      }
      if (v === 'fire' || v === 'dismiss') {
        need();
        const back = dismiss(ctx.db, guildId, ctx.user.id);
        return farmView(ctx, guildId, [...top, `${H} You let your farmhand go. He tips his hat on the way out${back ? ` and hands back ${back} ${back === 1 ? 'seed' : 'seeds'} from his shed` : ''}.`]);
      }
      if ((v === 'give' || v === 'stock' || v === 'take') && /^fert/.test(rest[0] ?? '')) {
        need();
        const last = rest[rest.length - 1] ?? '';
        const n: number | 'all' = /^\d+$/.test(last) ? Number(last) : 'all';
        const moved = v === 'take' ? takeFert(ctx.db, guildId, ctx.user.id, n) : giveFert(ctx.db, guildId, ctx.user.id, n);
        if (!moved) throw new GameError('farm.nofert', v === 'take' ? 'He has no Fertilizer.' : `You have no Fertilizer. Marquez sells it (\`${P}shop garden\`), or make some with \`${P}compost\`.`);
        const after = v === 'take' ? [] : catchUp(ctx, guildId).news;
        return farmView(ctx, guildId, [...top, ...after, v === 'take' ? `You take back ${moved} Fertilizer.` : `${H} You hand your farmhand ${moved} Fertilizer. He'll work one into every crop he plants. He has ${fertOf(ctx.db, guildId, ctx.user.id)} now.`]);
      }
      if (v === 'give' || v === 'stock') {
        need();
        const { crop, n } = cropAndAmount(rest);
        if (!crop) throw new GameError('farm.crop', `Give him which seeds? ${CROP_ORDER.map((c) => `\`${c}\``).join(', ')}. Like \`${P}farmhand give carrot 10\`.`);
        const moved = giveSeeds(ctx.db, guildId, ctx.user.id, crop, n);
        if (!moved) throw new GameError('farm.seeds', `You have no ${CROPS[crop]!.name} Seeds. Marquez has them on the Garden shelf: \`${P}shop garden\`.`);
        const after = catchUp(ctx, guildId).news;   // he gets straight to work on empty plots
        return farmView(ctx, guildId, [...top, ...after, `${H} You hand your farmhand ${moved} ${CROPS[crop]!.name} ${moved === 1 ? 'seed' : 'seeds'}. He has ${shedOf(ctx.db, guildId, ctx.user.id)[crop] ?? 0} now.`]);
      }
      if (v === 'take') {
        need();
        const { crop, n } = cropAndAmount(rest);
        if (!crop) throw new GameError('farm.crop', `Take back which seeds? Like \`${P}farmhand take carrot 5\`.`);
        const got = takeSeeds(ctx.db, guildId, ctx.user.id, crop, n);
        if (!got) throw new GameError('farm.seeds', `He has no ${CROPS[crop]!.name} Seeds.`);
        return { embeds: [embed('farm', '🧑‍🌾 Farmhand', [...top, `You take back ${got} ${CROPS[crop]!.name} ${got === 1 ? 'seed' : 'seeds'}.`])] };
      }
      if (v === 'dms' || v === 'dm') {
        const on = onOff(rest[0], handSettings(ctx.db, guildId, ctx.user.id).dm);
        setHandDm(ctx.db, guildId, ctx.user.id, on);
        return { embeds: [embed('farm', '🧑‍🌾 Farmhand', [...top, on ? `${emoji('yes')} Your farmhand will DM you when he runs out of seeds or quits.` : `${emoji('no')} No more DMs from your farmhand. He'll still tell you everything when you look at your farm.`])] };
      }
      const shed = shedOf(ctx.db, guildId, ctx.user.id);
      const st = handSettings(ctx.db, guildId, ctx.user.id);
      const stocked = CROP_ORDER.filter((c) => shed[c]).map((c) => `${emojiOr(`seed_${c}`, CROPS[c]!.emoji)} ${CROPS[c]!.name} × ${shed[c]}`);
      return { embeds: [embed('farm', '🧑‍🌾 Farmhand', employed ? [...top,
        `Your farmhand is on the job. Next wage (${format(FARMING.farmhandWage)}) is due ${discordTime(until!)}.`, '',
        `**Seed shed**: ${stocked.length ? stocked.join(' · ') : 'empty. He can\'t replant anything.'}`,
        `**Fertilizer**: ${fertOf(ctx.db, guildId, ctx.user.id) || 'none'}. He works one into every crop he plants: \`${P}farmhand give fertilizer 10\``,
        `He replants each plot with the same crop, or whatever he has most of. Out of seeds, the plot waits for you.`, '',
        `DMs: **${st.dm ? 'on' : 'off'}**`,
        `-# ${SHED_HELP(P)}`
      ] : [...top, `No farmhand. Hire one for **${format(FARMING.farmhandWage)} a day**: he waters everything, harvests what's ready and replants from a seed shed you stock, even while you're away.`, `-# \`${P}farmhand hire\``])] };
    });
  }
};

export const farmCommands = [farm, plant, water, harvest, sellcrops, fertilize, compost, buyplot, farmhand];
