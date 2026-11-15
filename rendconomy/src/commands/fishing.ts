import { awardHere, bump } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve, payoutFactor } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format } from '../core/money';
import { cooldown, discordTime, takeCooldown } from '../core/time';
import { embed } from '../discord/style';
import { CATCH, FISHING, SIZE_NAMES, cast, isCatch, itemId } from '../fishing/fishing';
import { addItem, charges, count, items, takeItem, useEffect } from '../shop/inventory';
import { marquez } from '../shop/items';
import { LINES, line, teaser } from '../discord/flavor';
import { me } from './shared';
import { isEvent } from '../events/world';
import type { Command, Ctx } from './types';

const bag = (ctx: Ctx, guildId: string) => items(ctx.db, guildId, ctx.user.id).filter((r) => isCatch(r.item)).map((r) => ({ ...r, id: r.item.slice(5), ...CATCH[r.item.slice(5)]! }));

export const fish: Command = {
  name: 'fish', aliases: ['cast', 'fishing'], description: 'Cast a line (needs a Fishing Rod; optionally use a fish as bait)', system: 'wallet', guildOnly: true,
  options: [{ name: 'bait', type: 'string', description: 'A fish to use as bait (e.g. minnow), "bag" to see your catch, or "sell"' }],
  run(ctx, args) {
    const word = String(args.bait ?? '').trim().toLowerCase();
    if (word === 'sell') return sellfish.run(ctx, {});                                   // the old r!fish sell
    const { guildId, wallet } = me(ctx);
    if (['bag', 'catch', 'inv', 'inventory'].includes(word)) return bagView(ctx, guildId); // and r!fish bag
    if (!count(ctx.db, guildId, ctx.user.id, 'rod')) throw new GameError('fish.rod', `A Fishing Rod is required. Marquez sells them: \`${ctx.config.prefix}shop tackle\`.`);
    const stash = bag(ctx, guildId);
    if (stash.reduce((s, r) => s + r.qty, 0) >= FISHING.bagMax) throw new GameError('fish.full', `Your bag is full (${FISHING.bagMax}). Sell your catch with \`${ctx.config.prefix}sellfish\`.`);
    const baitName = String(args.bait ?? '').trim().toLowerCase();
    let using = 'bait';
    if (baitName) {
      const b = stash.find((r) => r.id === baitName || r.name.toLowerCase() === baitName || r.name.toLowerCase().includes(baitName));
      if (!b || b.size === 0 || b.size === 4) throw new GameError('fish.bait', 'Choose a small, medium or large fish from your bag as bait.');
      using = b.id;
    } else if (charges(ctx.db, guildId, ctx.user.id, 'lure') > 0) using = 'lure';
    const frenzy = isEvent(ctx.db, 'fish_frenzy', undefined, ctx.now);
    if (using === 'bait' && balance(ctx.db, wallet) < FISHING.bait) throw new GameError('funds.short', `Bait costs ${format(FISHING.bait)}.`);
    if (!takeCooldown(ctx.db, 'fish', `${guildId}:${ctx.user.id}`, frenzy ? 90_000 : FISHING.cooldownMs, ctx.now)) {
      throw new GameError('fish.cooldown', `The fish need a moment. Cast again ${discordTime(cooldown(ctx.db, 'fish', `${guildId}:${ctx.user.id}`, ctx.now).until)}.`);
    }
    return ctx.db.tx(() => {
      const P = ctx.config.prefix;
      let spent: string;
      if (using === 'bait') { transfer(ctx.db, { from: wallet, to: RESERVE, cents: FISHING.bait, reason: 'fish.bait', guildId, actorId: ctx.user.id, now: ctx.now }); spent = `🪱 Bait: −${format(FISHING.bait)}`; }
      else if (using === 'lure') { useEffect(ctx.db, guildId, ctx.user.id, 'lure'); const left = charges(ctx.db, guildId, ctx.user.id, 'lure'); spent = `🪝 Lure: ${left} ${left === 1 ? 'cast' : 'casts'} left`; }
      else { takeItem(ctx.db, guildId, ctx.user.id, itemId(using)); spent = `${CATCH[using]!.emoji} You used a ${CATCH[using]!.name} as bait.`; }
      const r = cast(frenzy && using === 'bait' ? 'lure' : using, ctx.rng);
      let text: string, color = 0x3ba7f2;
      if (r.kind === 'nothing') text = `🌊 ${line(ctx.rng, 'fishNothing')}`;
      else if (r.kind === 'snag') { text = '🪢 **Your line snagged on something!** You yank it free, but the bait is gone.'; color = 0xed4245; }
      else if (r.kind === 'wallet') {
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: r.cents, reason: 'fish.wallet', guildId, actorId: ctx.user.id, now: ctx.now });
        text = `👛 **You reeled in a soggy wallet!** There's **${format(paid)}** inside. Finders keepers.`;
        color = 0xf0b232;
      } else {
        const f = CATCH[r.id]!;
        addItem(ctx.db, guildId, ctx.user.id, itemId(r.id));
        if (r.kind === 'junk') text = `${f.emoji} You pulled up a **${f.name}**. Marquez might give you ${format(f.value)} for it.`;
        else {
          text = `${f.emoji} **You caught a ${f.name}!** ${SIZE_NAMES[f.size]}, worth ${format(f.value)}.${LINES.fishBig[f.size]}`;
          color = f.size >= 3 ? 0xf0b232 : 0x57f287;
          if (f.size === 4) text += `\n-# Word travels fast. *${marquez(r.id === 'whale' ? 'whale' : 'koi', ctx.rng)}*`;
          awardHere('first_catch');
          if (bump(ctx.db, ctx.user.id, 'fish_caught') >= 200) awardHere('fish_in_the_sea');
          if (r.id === 'whale') awardHere('moby_dick');
          if (CATCH[using] && f.size > CATCH[using]!.size) awardHere('bigger_fish');
        }
      }
      const inBag = bag(ctx, guildId).reduce((s, x) => s + x.qty, 0);
      return {
        embeds: [{ title: '🎣 Fishing', color, description: [text, '', spent, `-# Bag: ${inBag} / ${FISHING.bagMax} · \`${P}fish bag\` · \`${P}fish sell\``, frenzy ? '-# 🐟 Fish Frenzy: the fish are biting like a lure is on.' : null].filter((x) => x !== null).join('\n') }],
        teaser: teaser('🎣 Fishing', CATCH[using] ? `You hook the ${CATCH[using]!.name} and cast it out... 🌊` : 'You cast your line... 🌊', 0x99aab5, 2200)
      };
    });
  }
};

/** r!fish bag: what you've caught, what it's worth, and how full the bag is. */
export function bagView(ctx: Ctx, guildId: string) {
  const P = ctx.config.prefix;
  const stash = bag(ctx, guildId).sort((a, b) => b.size - a.size || b.value - a.value);
  const n = stash.reduce((s, r) => s + r.qty, 0);
  const worth = Math.floor(stash.reduce((s, r) => s + r.value * r.qty, 0) * payoutFactor(ctx.db, economy.reserveStart));
  const lure = charges(ctx.db, guildId, ctx.user.id, 'lure');
  return {
    embeds: [{
      title: '🎣 Your catch', color: 0x3ba7f2,
      description: [
        ...(stash.length ? stash.map((r) => `${r.emoji} **${r.name}** × ${r.qty} · ${SIZE_NAMES[r.size]} · ${format(r.value)} each`) : ['Nothing yet. Go cast a line!']),
        '',
        stash.length ? `Marquez would pay **${format(worth)}** for all of it.` : null,
        `${n} / ${FISHING.bagMax} in your bag${lure ? ` · 🪝 Lure: ${lure} ${lure === 1 ? 'cast' : 'casts'} left` : ''}`
      ].filter((x) => x !== null).join('\n'),
      footer: { text: `${P}fish sell · ${P}fish <small fish> uses it as bait` }
    }]
  };
}

export const sellfish: Command = {
  name: 'sellfish', aliases: ['sellcatch'], description: 'Sell your whole catch to Marquez', system: 'wallet', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    const stash = bag(ctx, guildId);
    if (!stash.length) throw new GameError('fish.empty', 'Your bag is empty.');
    return ctx.db.tx(() => {
      const total = stash.reduce((s, r) => s + r.value * r.qty, 0);
      for (const r of stash) takeItem(ctx.db, guildId, ctx.user.id, r.item, r.qty);
      const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: total, reason: 'fish.sell', guildId, actorId: ctx.user.id, now: ctx.now });
      const n = stash.reduce((x, r) => x + r.qty, 0);
      return { embeds: [embed('wallet', '🧺 Catch sold', [`*${marquez('catch', ctx.rng)}*`, '', ...stash.map((r) => `${r.emoji} ${r.name} × ${r.qty}: ${format(r.value * r.qty)}`), '',
        `He pays **${format(paid)}** for ${n} ${n === 1 ? 'thing' : 'things'}.`, `-# Balance: ${format(balance(ctx.db, wallet))}`])] };
    });
  }
};
