import { awardHere, bump } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format } from '../core/money';
import { cooldown, discordTime, takeCooldown } from '../core/time';
import { embed } from '../discord/style';
import { CATCH, FISHING, SIZE_NAMES, cast, isCatch, itemId } from '../fishing/fishing';
import { addItem, charges, count, items, takeItem, useEffect } from '../shop/inventory';
import { marquez } from '../shop/items';
import { me } from './shared';
import { isEvent } from '../events/world';
import type { Command, Ctx } from './types';

const bag = (ctx: Ctx, guildId: string) => items(ctx.db, guildId, ctx.user.id).filter((r) => isCatch(r.item)).map((r) => ({ ...r, id: r.item.slice(5), ...CATCH[r.item.slice(5)]! }));

export const fish: Command = {
  name: 'fish', aliases: ['cast'], description: 'Cast a line (needs a Fishing Rod; optionally use a fish as bait)', system: 'wallet', guildOnly: true,
  options: [{ name: 'bait', type: 'string', description: 'A fish from your bag to use as bait, e.g. minnow' }],
  run(ctx, args) {
    if (String(args.bait ?? '').trim().toLowerCase() === 'sell') return sellfish.run(ctx, {}); // the old r!fish sell
    const { guildId, wallet } = me(ctx);
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
      const head: string[] = [];
      if (using === 'bait') transfer(ctx.db, { from: wallet, to: RESERVE, cents: FISHING.bait, reason: 'fish.bait', guildId, actorId: ctx.user.id, now: ctx.now });
      else if (using === 'lure') { useEffect(ctx.db, guildId, ctx.user.id, 'lure'); head.push(`Lure: ${charges(ctx.db, guildId, ctx.user.id, 'lure')} casts left.`); }
      else { takeItem(ctx.db, guildId, ctx.user.id, itemId(using)); head.push(`Bait: one ${CATCH[using]!.name}.`); }
      const r = cast(frenzy && using === 'bait' ? 'lure' : using, ctx.rng);
      let line: string;
      if (r.kind === 'nothing' || r.kind === 'snag') line = r.kind === 'nothing' ? 'Nothing bites.' : 'The line snags on a log. Nothing caught.';
      else if (r.kind === 'wallet') {
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: r.cents, reason: 'fish.wallet', guildId, actorId: ctx.user.id, now: ctx.now });
        line = `A lost wallet. Inside: ${format(paid)}.`;
      } else {
        const f = CATCH[r.id]!;
        addItem(ctx.db, guildId, ctx.user.id, itemId(r.id));
        line = `Caught: ${f.emoji} **${f.name}** (${SIZE_NAMES[f.size]}, worth ${format(f.value)}).`;
        if (r.kind === 'fish') {
          awardHere('first_catch');
          if (bump(ctx.db, ctx.user.id, 'fish_caught') >= 200) awardHere('fish_in_the_sea');
          if (r.id === 'whale') awardHere('moby_dick');
          if (CATCH[using] && f.size > CATCH[using]!.size) awardHere('bigger_fish');
        }
      }
      return { embeds: [embed('wallet', 'Fishing', [...head, line, '', `Bag: ${bag(ctx, guildId).reduce((s, x) => s + x.qty, 0)} of ${FISHING.bagMax}`])] };
    });
  }
};

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
      return { embeds: [embed('wallet', 'Catch sold', [`*${marquez('thanks', ctx.rng)}*`, ...stash.map((r) => `${r.emoji} ${r.name} × ${r.qty}: ${format(r.value * r.qty)}`), `**Paid: ${format(paid)}**`, `Balance: ${format(balance(ctx.db, wallet))}`])] };
    });
  }
};
