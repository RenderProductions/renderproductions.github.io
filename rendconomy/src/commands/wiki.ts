// r!wiki: the wiki's Featured page this week, and a vote for next week's.
import { GameError } from '../core/errors';
import { DAY, discordTime, easternAt } from '../core/time';
import { embed } from '../discord/style';
import { weekOf } from '../city/state';
import { featured, findPage, myVote, tally, vote, wikiPages } from '../site/wikivote';
import type { Command } from './types';

const WIKI = 'https://renderproductions.github.io/wiki/';

export const wiki: Command = {
  name: 'wiki', aliases: ['featured'],
  description: 'The wiki: this week\'s Featured page, and vote for next week\'s',
  system: 'general',
  options: [
    { name: 'action', type: 'string', description: 'Blank to look, or: vote <page>, pages' },
    { name: 'page', type: 'string', description: 'For vote: the page, e.g. fishing or "main street"' }
  ],
  run(ctx, args) {
    const P = ctx.config.prefix;
    const pages = wikiPages();
    if (!pages.length) throw new GameError('wiki.none', `The wiki's page list isn't available right now. It's at ${WIKI}.`);
    const raw = `${String(args.action ?? '')} ${String(args.page ?? '')}`.trim();
    const [verb, ...rest] = raw.split(/\s+/);
    const v = (verb ?? '').toLowerCase();
    const nextWeek = easternAt(weekOf(ctx.now + 7 * DAY), 0);
    if (v === 'pages' || v === 'list') {
      const by = new Map<string, string[]>();
      for (const p of pages) by.set(p.section, [...(by.get(p.section) ?? []), `\`${p.slug}\``]);
      return { embeds: [embed('general', '📖 Every wiki page', [...[...by].map(([s, l]) => `**${s}:** ${l.join(' ')}`), '', `-# Vote with \`${P}wiki vote <page>\`.`])] };
    }
    if (v === 'vote') {
      const want = rest.join(' ');
      const page = findPage(want, pages);
      if (!want || !page) throw new GameError('wiki.page', `${want ? `There's no wiki page called "${want}". ` : ''}Pick one from \`${P}wiki pages\`.`);
      const r = ctx.db.tx(() => vote(ctx.db, ctx.user.id, page, ctx.now));
      return { embeds: [embed('general', '📖 Vote counted', [
        `${r.changed ? 'You changed your vote to' : 'You voted for'} **[${page.title}](${page.url})** for next week's Featured page.`,
        `-# Voting closes ${discordTime(nextWeek)}. One vote a week, across every server; vote again to change it.`
      ])] };
    }
    const f = featured(ctx.db, ctx.now, pages);
    const race = tally(ctx.db, weekOf(ctx.now)).slice(0, 5);
    const mine = myVote(ctx.db, ctx.user.id, ctx.now);
    const titleOf = (slug: string) => pages.find((p) => p.slug === slug)?.title ?? slug;
    return { embeds: [embed('general', '📖 The wiki', [
      f ? `⭐ **Featured this week: [${f.page.title}](${f.page.url})**\n-# ${f.page.summary}\n-# ${f.by === 'vote' ? `Picked by ${f.votes} vote${f.votes === 1 ? '' : 's'}.` : 'Nobody voted last week, so it stays up.'}` : null,
      '', `**Next week's race** (closes ${discordTime(nextWeek)})`,
      race.length ? race.map((r, i) => `${i + 1}. ${titleOf(r.page)} · ${r.votes} vote${r.votes === 1 ? '' : 's'}`).join('\n') : 'No votes yet.',
      mine ? `-# You voted for ${titleOf(mine)}.` : `-# Vote with \`${P}wiki vote <page>\` (\`${P}wiki pages\` lists them).`,
      '', `${WIKI}`
    ])] };
  }
};
