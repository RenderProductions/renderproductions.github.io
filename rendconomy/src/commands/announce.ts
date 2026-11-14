import { GameError } from '../core/errors';
import { postUpdate, readNewestUpdate, updateEmbed } from '../site/updates';
import type { Command } from './types';

export const announce: Command = {
  name: 'announce', description: 'Bot owner: preview the newest patch notes post, or post it again', system: 'admin',
  options: [{ name: 'action', type: 'string', description: '"preview" (default) or "post"' }],
  async run(ctx, args) {
    if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
    const u = readNewestUpdate();
    if (!u) throw new GameError('announce.none', 'The patch notes page could not be read.');
    if (String(args.action ?? '').trim().toLowerCase() === 'post') {
      const ok = await postUpdate(u);
      if (!ok) throw new GameError('announce.off', 'Update posts are off for this bot (set UPDATES_CHANNEL_ID).');
      ctx.db.setMeta('updates.last', u.id);
      return { content: `Posted **${u.title}** in the updates channel.`, ephemeral: true };
    }
    return { content: `Preview of the newest entry (\`${u.id}\`). \`${ctx.config.prefix}announce post\` posts it.`, embeds: [updateEmbed(u)], ephemeral: true };
  }
};
