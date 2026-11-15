// Farming commands: /farm, /plant, /water, /harvest, /sellcrops, /fertilize, /compost, /buyplot.
import { awardHere, bump, getProgress, sameDay, setProgress } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve, payoutFactor } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format, polygons } from '../core/money';
import { discordTime } from '../core/time';
import { emoji, emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { isEvent } from '../events/world';
import {
  CROPS, CROP_ORDER, FARMING, MUTATIONS, cropItem, newPlot, nextPlotPrice, parseCropItem, plotCount, readyEstimate, remindOn, resolveFarm, rollMutation,
  savePlot, clearPlot, seedItem, setPlotCount, setRemind, stageOf, weatherLog, type Env, type FarmEvent, type Mutation, type Plot
} from '../farming/farming';
import { addItem, count, items, takeItem } from '../shop/inventory';
import { marquez } from '../shop/items';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';

const env = (ctx: Ctx, guildId: string): Env => ({
  sprinkler: count(ctx.db, guildId, ctx.user.id, 'sprinkler') > 0,
  greenhouse: count(ctx.db, guildId, ctx.user.id, 'greenhouse') > 0,
  scarecrow: count(ctx.db, guildId, ctx.user.id, 'scarecrow') > 0,
  weather: weatherLog(ctx.db)
});

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

/** Brings the farm up to now, awards what happened since, and says it. */
function catchUp(ctx: Ctx, guildId: string): { plots: Plot[]; news: string[]; env: Env } {
  const e = env(ctx, guildId);
  const { plots, events } = resolveFarm(ctx.db, guildId, ctx.user.id, e, ctx.now);
  return { plots, news: news(ctx, events), env: e };
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

const basket = (ctx: Ctx, guildId: string) => items(ctx.db, guildId, ctx.user.id).map((r) => ({ ...r, c: parseCropItem(r.item) })).filter((r) => r.c) as { item: string; qty: number; c: NonNullable<ReturnType<typeof parseCropItem>> }[];

function farmView(ctx: Ctx, guildId: string, top: string[] = []): ReplyObject {
  const P = ctx.config.prefix;
  const { plots, news: n } = catchUp(ctx, guildId);
  const owned = plotCount(ctx.db, guildId, ctx.user.id);
  const at = (i: number) => plots.find((p) => p.slot === i);
  const grid: string[] = [];
  for (let r = 0; r < 3; r++) grid.push([0, 1, 2].map((c) => tile(at(r * 3 + c), r * 3 + c >= owned)).join(''));
  const b = basket(ctx, guildId);
  const inBasket = b.reduce((s, r) => s + r.qty, 0);
  const worth = Math.floor(b.reduce((s, r) => s + r.c.value * r.qty, 0) * payoutFactor(ctx.db, economy.reserveStart));
  const price = nextPlotPrice(owned);
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
      price !== null ? `-# ${emoji('newplot')} Plot ${owned + 1} costs ${format(price)}: \`${P}buyplot\`` : null
    ], { footer: { text: `${P}plant <crop> · ${P}water · ${P}harvest · ${P}farm remind ${remindOn(ctx.db, guildId, ctx.user.id) ? 'off' : 'on'}` } })]
  };
}

export const farm: Command = {
  name: 'farm', aliases: ['field', 'garden', 'plots', 'crops'], description: 'Your farm: what is growing, what is ready, and your basket', system: 'farm', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: 'Blank to look, or: plant <crop>, water, harvest, sell, buy, remind on|off' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const [word = '', ...rest] = String(args.action ?? '').trim().toLowerCase().split(/\s+/);
    if (word === 'sell') return sellcrops.run(ctx, {});
    if (word === 'water') return water.run(ctx, {});
    if (['harvest', 'reap', 'pick'].includes(word)) return harvest.run(ctx, {});
    if (['buy', 'expand', 'plot'].includes(word)) return buyplot.run(ctx, {});
    if (word === 'plant') return plant.run(ctx, { crop: rest.join(' ') });
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
      const wet = e.sprinkler || isEvent(ctx.db, 'rain', undefined, ctx.now);
      for (const slot of go) savePlot(ctx.db, newPlot(guildId, ctx.user.id, slot, id, ctx.now, ctx.rng, wet));
      const growing = new Set([...plots.filter((p) => !p.wilted).map((p) => p.crop), id]);
      if (CROP_ORDER.every((x) => growing.has(x))) awardHere('something_for_everyone');
      const left = seeds - go.length;
      return farmView(ctx, guildId, [...n,
        `${cropE(id)} You plant ${go.length === 1 ? `a ${c.name}` : `${go.length} ${c.plural}`} in plot${go.length === 1 ? '' : 's'} ${go.map((s) => s + 1).join(', ')}.` +
        (wet ? ` ${e.sprinkler ? 'The Sprinkler waters' : 'The rain waters'} ${go.length === 1 ? 'it' : 'them'} right away.` : ` Don't forget to \`${P}water\`.`),
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
      const lines: string[] = [];
      let muts = 0;
      for (const p of wilted) { clearPlot(ctx.db, guildId, ctx.user.id, p.slot); lines.push(`🥀 You clear the wilted ${CROPS[p.crop]!.name} from plot ${p.slot + 1}.`); }
      for (const p of ready) {
        const c = CROPS[p.crop]!;
        const mut: Mutation | null = rollMutation(p.crop, ctx.rng);
        addItem(ctx.db, guildId, ctx.user.id, cropItem(p.crop, mut));
        const parsed = parseCropItem(cropItem(p.crop, mut))!;
        lines.push(`${emojiOr(parsed.emojiKey, parsed.emoji)} ${mut ? `**${parsed.name}!** ${MUTATIONS[mut].emoji} Worth ${format(parsed.value)}.` : `${c.name}`} · plot ${p.slot + 1}`);
        // achievements
        awardHere('green_thumb');
        if (bump(ctx.db, ctx.user.id, 'harvests') >= 500) awardHere('bumper_crop');
        if (p.crop === 'carrot' && bump(ctx.db, ctx.user.id, 'carrots') >= 100) awardHere('whats_up_doc');
        if (p.crop === 'pumpkin' && bump(ctx.db, ctx.user.id, 'pumpkins') >= 25) awardHere('great_pumpkin');
        if (p.crop === 'polyfruit') { awardHere('forbidden_fruit'); if (p.dry_ms === 0) awardHere('patience'); }
        if (p.crop === 'tomato' && p.harvests_left === 1 && c.harvests === 3) awardHere('ketchup');
        if (p.ready_at !== null && ctx.now - p.ready_at <= FARMING.earlyBirdMs) awardHere('early_bird');
        if (mut) {
          muts++;
          if (mut === 'golden') awardHere('midas_touch');
          if (mut === 'square') awardHere('look_at_spookly');
          if (mut === 'rainbow') { setProgress(ctx.db, ctx.user.id, `rainbow_${p.crop}`, 1); if (CROP_ORDER.every((x) => getProgress(ctx.db, ctx.user.id, `rainbow_${x}`) > 0)) awardHere('taste_the_rainbow'); }
        }
        // tomatoes grow back from the growing stage; everything else leaves the plot empty
        if (p.harvests_left > 1) savePlot(ctx.db, { ...p, harvests_left: p.harvests_left - 1, progress: c.growMs / 2, ready_at: null, watered: env(ctx, guildId).sprinkler ? 1 : 0, stage_since: ctx.now, updated_at: ctx.now, crow_at: null, fert: 0, reminded: 0 });
        else clearPlot(ctx.db, guildId, ctx.user.id, p.slot);
      }
      if (muts >= 2) awardHere('lucky_harvest');
      if (ready.length) sameDay(ctx.db, ctx.user.id, 'harvest', ctx.now);
      return farmView(ctx, guildId, [...n, ready.length ? `${emoji('harvest')} **Harvest time!**` : null, ...lines].filter((x): x is string => x !== null));
    });
  }
};

export const sellcrops: Command = {
  name: 'sellcrops', aliases: ['sellharvest', 'sellcrop', 'sellbasket'], description: 'Sell your whole harvest to Marquez', system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    const b = basket(ctx, guildId);
    if (!b.length) throw new GameError('farm.empty', `Your basket is empty. Harvest something first: \`${ctx.config.prefix}harvest\`.`);
    return ctx.db.tx(() => {
      const total = b.reduce((s, r) => s + r.c.value * r.qty, 0);
      for (const r of b) takeItem(ctx.db, guildId, ctx.user.id, r.item, r.qty);
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: total, reason: 'farm.sell', guildId, actorId: ctx.user.id, now: ctx.now });
      if (bump(ctx.db, ctx.user.id, 'farm_earned', paid) >= polygons(100_000)) awardHere('cash_crop');
      const n = b.reduce((x, r) => x + r.qty, 0);
      const say = b.some((r) => r.c.mut === 'square') ? 'square' : b.some((r) => r.c.mut) ? 'golden' : 'crops';
      return { embeds: [embed('farm', '🧺 Harvest sold', [`*${marquez(say, ctx.rng)}*`, '',
        ...b.sort((x, y) => y.c.value - x.c.value).map((r) => `${emojiOr(r.c.emojiKey, r.c.emoji)} ${r.c.name} × ${r.qty}: ${format(r.c.value * r.qty)}`), '',
        `He pays **${format(paid)}** for ${n} ${n === 1 ? 'crop' : 'crops'}.`, `-# Balance: ${format(balance(ctx.db, wallet))}`])] };
    });
  }
};

export const fertilize: Command = {
  name: 'fertilize', aliases: ['fertilise', 'fert'], description: 'Put Fertilizer on a growing crop: it grows 50% faster', system: 'farm', guildOnly: true,
  options: [{ name: 'plot', type: 'string', description: 'A plot number (default: the first one that can use it)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    if (!count(ctx.db, guildId, ctx.user.id, 'fertilizer')) throw new GameError('farm.nofert', `You have no Fertilizer. Marquez sells it (\`${P}shop garden\`), or make some with \`${P}compost\`.`);
    return ctx.db.tx(() => {
      const { plots, news: n } = catchUp(ctx, guildId);
      const ok = (p: Plot) => (stageOf(p) === 'sprout' || stageOf(p) === 'growing') && !p.fert;
      const want = String(args.plot ?? '').trim();
      const p = want ? plots.find((x) => x.slot === Number(want) - 1) : plots.find(ok);
      if (!p || !ok(p)) throw new GameError('farm.fert', want ? `Plot ${want} has no growing crop that can use Fertilizer.` : 'Nothing growing can use Fertilizer right now.');
      takeItem(ctx.db, guildId, ctx.user.id, 'fertilizer');
      savePlot(ctx.db, { ...p, fert: 1 });
      return farmView(ctx, guildId, [...n, `${emoji('fertilizer')} You work Fertilizer into plot ${p.slot + 1}. Your ${CROPS[p.crop]!.name} perks right up.`]);
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
  name: 'buyplot', aliases: ['newplot', 'moreland'], description: `Buy another plot of land (up to ${FARMING.maxPlots})`, system: 'farm', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    return ctx.db.tx(() => {
      const owned = plotCount(ctx.db, guildId, ctx.user.id);
      const price = nextPlotPrice(owned);
      if (price === null) throw new GameError('farm.max', `You own all ${FARMING.maxPlots} plots. That's the whole field.`);
      if (balance(ctx.db, wallet) < price) throw new GameError('funds.short', `Plot ${owned + 1} costs ${format(price)}. The balance is ${format(balance(ctx.db, wallet))}.`);
      transfer(ctx.db, { from: wallet, to: RESERVE, cents: price, reason: 'farm.plot', guildId, actorId: ctx.user.id, now: ctx.now });
      setPlotCount(ctx.db, guildId, ctx.user.id, owned + 1);
      if (owned + 1 >= FARMING.maxPlots) awardHere('full_acreage');
      return farmView(ctx, guildId, [`${emoji('newplot')} You buy plot ${owned + 1} for **${format(price)}**. Fresh soil, ready to go.`]);
    });
  }
};

export const farmCommands = [farm, plant, water, harvest, sellcrops, fertilize, compost, buyplot];
