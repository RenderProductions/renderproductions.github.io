// Refined Everything! (NachoBellGrande1065's idea): r!beg. Every so often, ask around for spare change: a few
// Polygons, a trinket off Marquez's cheap shelf, or nothing at all. The richer you are, the likelier someone
// notices you've got a fortune in the bank: TODD fines you, or Marquez gives you a talking-to.
import { award, bump } from '../achievements/achievements';
import { economy } from '../config';
import { payFromReserve } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format, polygons } from '../core/money';
import { HOUR, cooldown, discordTime, takeCooldown } from '../core/time';
import { emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { load as loadMarket } from '../market/market';
import { addItem } from '../shop/inventory';
import { ITEMS } from '../shop/items';
import { netWorth } from '../social/worth';
import { me } from './shared';
import type { Command } from './types';

export const BEG = {
  cooldownMs: HOUR,
  coins: [5, 40] as [number, number],   // Polygons, when someone gives
  chances: { coins: 0.55, trinket: 0.2 },  // the rest: nobody gives
  /** Net worth from which you might be caught, and the chance at each step. */
  caught: [{ above: polygons(25_000), chance: 0.25 }, { above: polygons(100_000), chance: 0.5 }, { above: polygons(1_000_000), chance: 0.8 }],
  fineShare: 0.05, fineMax: polygons(1_000),
  /** Trinkets: cheap, everyday items from Marquez's shelves. */
  trinkets: ['coffee', 'times', 'seed_carrot', 'seed_corn', 'wrap', 'stopwatch', 'mystery']
};

const GIVERS = [
  'A kind stranger', 'Someone hurrying past', 'A kid with a lemonade stand', 'A guy from the nacho line', 'A moderator on their lunch break',
  'Someone who just won at the Rend-Sino', 'A tourist', 'An off-duty Builder', 'A very polite pigeon (somehow)'
];
const NOBODY = [
  'Everyone pretends to be on their phone.', 'A pigeon looks at you. The pigeon has nothing.', 'Someone hands you a pamphlet about index funds.',
  'You hold out your hand. It starts raining. Only on you.', 'A passerby gives you a thumbs up. Not money. A thumbs up.', 'Nobody stops. It is a busy day.'
];

export const beg: Command = {
  name: 'beg', aliases: ['panhandle', 'sparechange'], description: 'Ask around for spare change (once an hour). Being rich and caught begging is embarrassing', system: 'work', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    const subject = `${guildId}:${ctx.user.id}`;
    return ctx.db.tx(() => {
      if (!takeCooldown(ctx.db, 'beg', subject, BEG.cooldownMs, ctx.now)) {
        throw new GameError('beg.cooldown', `People are starting to recognize you. Try again ${discordTime(cooldown(ctx.db, 'beg', subject, ctx.now).until)}.`);
      }
      award(ctx.db, guildId, ctx.user.id, 'spare_change', ctx.now);
      const worth = netWorth(ctx.db, loadMarket(ctx.db), guildId, ctx.user.id);
      const risk = [...BEG.caught].reverse().find((c) => worth >= c.above)?.chance ?? 0;
      if (risk && ctx.rng.chance(risk)) {
        if (bump(ctx.db, ctx.user.id, 'beg_caught') >= 5) award(ctx.db, guildId, ctx.user.id, 'shameless', ctx.now);
        if (ctx.rng.chance(0.5)) {
          const fine = Math.min(BEG.fineMax, Math.floor(balance(ctx.db, wallet) * BEG.fineShare));
          if (fine > 0) transfer(ctx.db, { from: wallet, to: RESERVE, cents: fine, reason: 'beg.fine', guildId, actorId: ctx.user.id, now: ctx.now });
          return { embeds: [embed('work', '🚔 Caught!', [
            `${emojiOr('todd', '🖥️')} TODD rolls up. *"You have ${format(worth)} to your name and you're out here with a cup?"*`,
            fine > 0 ? `He fines you **${format(fine)}** for wasting everyone's time.` : 'He would fine you, but your wallet is empty. Somehow that makes it worse.'
          ])] };
        }
        return { embeds: [embed('work', '😬 Caught!', [
          `${emojiOr('marquez', '🏪')} Marquez spots you from across the street. He walks over slowly.`,
          `*"Kiddo. I've seen your net worth. Put the cup away."* He doesn't say anything else. He doesn't have to.`,
          '-# Nobody gave you anything.'
        ])] };
      }
      const r = ctx.rng.next(), who = ctx.rng.pick(GIVERS);
      if (r < BEG.chances.coins) {
        const paid = payFromReserve(ctx.db, economy.reserveStart, { to: wallet, cents: polygons(ctx.rng.int(BEG.coins[0], BEG.coins[1])), reason: 'beg', guildId, actorId: ctx.user.id, now: ctx.now });
        return { embeds: [embed('work', '🥺 Spare change?', [`${who} drops **${format(paid)}** in your cup.`, `-# Again ${discordTime(ctx.now + BEG.cooldownMs)}.`])] };
      }
      if (r < BEG.chances.coins + BEG.chances.trinket) {
        const id = ctx.rng.pick(BEG.trinkets.filter((t) => ITEMS[t]));
        const it = ITEMS[id]!;
        addItem(ctx.db, guildId, ctx.user.id, id);
        return { embeds: [embed('work', '🥺 Spare change?', [`${who} doesn't have cash, but hands you a **${it.emoji} ${it.name}**. It's in your inventory.`, `-# Again ${discordTime(ctx.now + BEG.cooldownMs)}.`])] };
      }
      return { embeds: [embed('work', '🥺 Spare change?', [ctx.rng.pick(NOBODY), `-# Again ${discordTime(ctx.now + BEG.cooldownMs)}.`])] };
    });
  }
};
