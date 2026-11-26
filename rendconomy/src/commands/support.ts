// r!support: where to chip in for the bot's running costs. Donations buy nothing in the game.
import { embed } from '../discord/style';
import type { Command } from './types';

export const KOFI = 'https://ko-fi.com/lowrendergaming';
export const SUPPORT_PAGE = 'https://renderproductions.github.io/bot/support/';

export const support: Command = {
  name: 'support', aliases: ['donate', 'kofi', 'tipjar'],
  description: 'Help keep the bot running (a tip jar; it buys nothing in the game)',
  system: 'general',
  run() {
    return { embeds: [embed('general', '☕ Support RendConomy', [
      'RendConomy is free, and it stays that way. Running it costs real money every month (hosting the bot and the servers behind the site), so if you\'d like to help there\'s a tip jar, or a $5/month membership, on Ko-fi.',
      '',
      `**[Support on Ko-fi](${KOFI})** · [what it pays for](${SUPPORT_PAGE})`,
      '',
      '-# Tips and memberships don\'t buy anything in the bot: no Polygons, items, perks or advantages. Everyone plays the same game.'
    ])] };
  }
};
