import { GameError } from '../core/errors';
import { findUpdate, postUpdate, readAllUpdates, updateEmbed } from '../site/updates';
import type { Command } from './types';

// /announce                      preview the newest patch notes entry
// /announce animation            preview an entry, found by its id or part of its title
// /announce post [animation]     post it in the updates channel (the newest if no name is given)
export const announce: Command = {
  name: 'announce', description: 'Bot owner: preview or post a patch notes entry ("post", then a name for an older one)', system: 'admin',
  options: [{ name: 'action', type: 'string', description: '"post" to post, then optionally an entry name, e.g. "post animation"; leave out to preview' }],
  async run(ctx, args) {
    if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
    const all = readAllUpdates();
    if (!all.length) throw new GameError('announce.none', 'The patch notes page could not be read.');
    const words = String(args.action ?? '').trim().split(/\s+/).filter(Boolean);
    const post = words[0]?.toLowerCase() === 'post';
    const query = (post ? words.slice(1) : words[0]?.toLowerCase() === 'preview' ? words.slice(1) : words).join(' ');
    const u = findUpdate(all, query);
    if (!u) throw new GameError('announce.unknown', `No entry matches "${query}". Recent entries: ${all.slice(0, 5).map((e) => `\`${e.id}\``).join(', ')}.`);
    if (post) {
      const ok = await postUpdate(u);
      if (!ok) throw new GameError('announce.off', 'Update posts are off for this bot (set UPDATES_CHANNEL_ID).');
      if (u.id === all[0]!.id) ctx.db.setMeta('updates.last', u.id);
      return { content: `Posted **${u.title}** in the updates channel.`, ephemeral: true };
    }
    return { content: `Preview of \`${u.id}\`. \`${ctx.config.prefix}announce post ${u.id}\` posts it.`, embeds: [updateEmbed(u)], ephemeral: true };
  }
};
