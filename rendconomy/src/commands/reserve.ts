import { economy } from '../config';
import { awardHere, bump } from '../achievements/achievements';
import { GameError } from '../core/errors';
import { RESERVE, balance, transfer } from '../core/ledger';
import { format, parseAmount, polygons } from '../core/money';
import { embed } from '../discord/style';
import { activeLoans, overdue, toddDebt } from '../loans/loans';
import { me } from './shared';
import type { Command, Ctx } from './types';

export const DONATE = { min: polygons(10), patron: 1_000, pillar: 25_000 };

/** The biggest givers to the Reserve, across every server. */
function patrons(ctx: Ctx, n = 5): { user: string; cents: number }[] {
  return ctx.db.all<{ user: string; cents: number }>(
    "SELECT actor_id AS user, SUM(cents) AS cents FROM ledger WHERE reason = 'reserve.donate' AND to_id = ? GROUP BY actor_id ORDER BY cents DESC LIMIT ?", RESERVE, n);
}

function thanks(ctx: Ctx, cents: number): string {
  const p = cents / 100;
  if (p >= 10_000) return ctx.rng.pick(['TODD stares at the number for a long time. "...Okay. Okay. Respect."', 'Somewhere, TODD stands up and slow-claps. Alone. In the dark.']);
  if (p >= 1_000) return ctx.rng.pick(['TODD: "Huh. You\'re not as bad as I thought."', 'Marquez takes off his hat for a moment. "That\'s good of you, friend."']);
  return ctx.rng.pick(['Marquez nods. "Every little bit, friend."', 'Marquez drops it in the jar by the register. "Much obliged, friend."', '"Thank you kindly," Marquez says.']);
}

function donate(ctx: Ctx, amount: string) {
  const { wallet, guildId } = me(ctx);
  const P = ctx.config.prefix;
  if (toddDebt(ctx.db, guildId, ctx.user.id) > 0) throw new GameError('donate.todd', `TODD: "Donating MY Polygons back to the house? Pay ME first." (\`${P}repay\`)`);
  if (activeLoans(ctx.db, guildId, { borrower: ctx.user.id }, ctx.now).some((l) => overdue(l, ctx.now))) throw new GameError('donate.overdue', 'You have an overdue loan. Repay it before donating.');
  const have = balance(ctx.db, wallet);
  const cents = parseAmount(amount, { all: have, min: DONATE.min });
  if (cents > have) throw new GameError('donate.funds', `You have ${format(have)}.`);
  transfer(ctx.db, { from: wallet, to: RESERVE, cents, reason: 'reserve.donate', guildId, actorId: ctx.user.id, now: ctx.now });
  const total = bump(ctx.db, ctx.user.id, 'reserve_donated', Math.floor(cents / 100));
  if (total >= DONATE.patron) awardHere('patron');
  if (total >= DONATE.pillar) awardHere('pillar_of_the_economy');
  const left = balance(ctx.db, RESERVE);
  return {
    embeds: [embed('reserve', 'Donation received', [
      `You gave **${format(cents)}** to the Polygon Reserve.`,
      `*${thanks(ctx, cents)}*`,
      '',
      `The Reserve now holds **${format(left)}** (${((left / economy.reserveStart) * 100).toFixed(1)}%).`,
      `-# You've given ${format(polygons(total))} in all · Your balance: ${format(balance(ctx.db, wallet))}`
    ])]
  };
}

export const reserve: Command = {
  name: 'reserve', aliases: ['vault'],
  description: 'The Polygon Reserve: what the house has left to pay out. "donate <amount>" to give to it',
  system: 'reserve',
  options: [{ name: 'action', type: 'string', description: '"donate <amount>" to give Polygons to the Reserve' }],
  run(ctx, args) {
    const action = String(args.action ?? '').trim();
    const m = /^(?:donate|give|fund|tip)\s+(.+)$/i.exec(action);
    if (m) return donate(ctx, m[1]!);
    if (/^(donate|give|fund|tip)$/i.test(action)) throw new GameError('donate.amount', `How much? \`${ctx.config.prefix}reserve donate 500\``);
    const left = balance(ctx.db, RESERVE);
    const pct = (left / economy.reserveStart) * 100;
    const top = patrons(ctx);
    return {
      embeds: [embed('reserve', 'The Polygon Reserve', [
        `**${format(left)}** of ${format(economy.reserveStart)}`,
        `Level: ${pct.toFixed(pct < 10 ? 2 : 1)}%`,
        'Every payout is drawn from the Reserve. Every purchase is returned to it.',
        top.length ? '' : null,
        top.length ? '**Patrons of the Reserve**' : null,
        ...top.map((t, i) => `${['🥇', '🥈', '🥉'][i] ?? '▫️'} <@${t.user}> · ${format(t.cents)}`),
        '',
        `-# Help keep payouts full: \`${ctx.config.prefix}reserve donate <amount>\``
      ])]
    };
  }
};
