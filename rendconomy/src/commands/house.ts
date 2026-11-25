// Easter egg (from the original bot, lost in the rewrite and brought back): look up the bot itself with
// r!balance or r!profile and you get the house's books. Infinite everything. (The Reserve would disagree.)
import { itemE } from '../discord/icons';
import { emojiOr } from '../discord/emoji';
import { embed, COLORS } from '../discord/style';
import { load } from '../market/market';
import { ACHIEVEMENTS } from '../achievements/list';
import { COLLECTIBLES } from '../shop/items';
import type { Ctx, ReplyObject } from './types';

const INF = '∞';
const P = (s: string) => `⬡${s}`;

/** Is this id the bot itself? */
export const isHouse = (ctx: Ctx, id: unknown): boolean => !!ctx.botId && String(id ?? '').replace(/[<@!>]/g, '') === ctx.botId;

export function houseBalance(ctx: Ctx): ReplyObject {
  const m = load(ctx.db);
  return { embeds: [embed('wallet', `${ctx.config.name}'s balance`, [
    '🏷️ *The House*', '',
    `${emojiOr('polygon', '⬡')} **Cash:** ${P(INF)}`,
    `${emojiOr('savings', '🏦')} **Savings:** ${P(INF)}`,
    `${emojiOr('stonks', '📈')} **Shares:** ${P(INF)}`,
    ...(m?.companies ?? []).map((c) => `-# ${c.name} (${c.id}): ${INF} shares, worth ${P(INF)}`),
    '', `**Net worth:** ${P(INF)}`,
    '', '*The house always wins.*'
  ])] };
}

export function houseProfile(ctx: Ctx): ReplyObject {
  const cols = Object.values(COLLECTIBLES);
  return { embeds: [{
    color: COLORS.social,
    title: `${ctx.config.name} · *The House*`,
    description: [
      `**Net worth:** ${P(INF)} · cash ${P(INF)}`,
      '**Job:** owns the place',
      `**Shifts worked:** ${INF} · **Best Rend-Sino hit:** all of them`,
      `**Achievements:** ${INF} of ${ACHIEVEMENTS.length}`,
      `**Collectibles:** ${cols.map((c) => `${itemE(c.id, c.emoji)}×${INF}`).join(' ')}`,
      `**On the wall:** ${itemE('fish_whale', '🐋')} the White Whale, ${INF} lb`,
      '', '*It never runs out. It never needs to.*'
    ].join('\n'),
    footer: { text: 'The house always wins.' }
  }] };
}
