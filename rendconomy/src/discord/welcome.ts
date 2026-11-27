// The hello a new server gets when RendConomy joins: what it is, how to start, and where to find more.
// Sent once per server (meta welcome:<guild>), to the server's system channel or the first channel it can talk in.
import { ButtonStyle, ChannelType, ComponentType, PermissionFlagsBits, type Guild, type GuildTextBasedChannel } from 'discord.js';
import type { Db } from '../core/db';

export const SITE = 'https://renderproductions.github.io';
export const SUPPORT_INVITE = 'https://discord.gg/D2v4EsuZBU';

/** The welcome message (kept separate so it can be tested and previewed). */
export function welcomeMessage(prefix: string) {
  return {
    embeds: [{
      color: 0xf0d43c,
      title: '👋 RendConomy has arrived',
      description: [
        'Thanks for adding me! I\'m a whole economy for your server: jobs, a stock market, a casino, fishing, farming, a city to build, and a shopkeeper named Marquez. Everyone starts with a few Polygons (⬡), and every server has its own economy.',
        '',
        '**Start here**',
        `\`${prefix}daily\` · your daily Polygons`,
        `\`${prefix}work\` · pick up a shift (\`${prefix}apply\` for a better job)`,
        `\`${prefix}shop\` · Marquez's store on Main Street`,
        `\`${prefix}fish\` · \`${prefix}farm\` · \`${prefix}slots\` · something to do while you wait`,
        `\`${prefix}help\` · everything, by section (slash commands work too: \`/help\`)`,
        '',
        '**Good to know**',
        `• The [wiki](${SITE}/wiki/) explains every system, and the [Play hub](${SITE}/play/) lets you play from the browser.`,
        `• Follow the **#updates** and **#market-news** channels in [The Render Room](${SUPPORT_INVITE}) to get patch notes and market news in your server.`,
        '• Moderators: `/mod` holds the tools (give or take Polygons, wipe a player, and TODD\'s drop-ins with `/mod dropin`).',
        '',
        `-# By using RendConomy you agree to the [Terms](${SITE}/bot/terms/) and [Privacy Policy](${SITE}/bot/privacy/). It's free, and always will be.`
      ].join('\n')
    }],
    components: [{
      type: ComponentType.ActionRow,
      components: [
        { type: ComponentType.Button, style: ButtonStyle.Link, label: 'The wiki', url: `${SITE}/wiki/`, emoji: { name: '📖' } },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: 'Support server', url: SUPPORT_INVITE, emoji: { name: '💬' } },
        { type: ComponentType.Button, style: ButtonStyle.Link, label: 'Add to another server', url: `${SITE}/bot/`, emoji: { name: '➕' } }
      ]
    }],
    allowedMentions: { parse: [] as never[] }
  };
}

/** The best channel to say hello in: the server's system channel, else the first text channel it can post in. */
function pickChannel(guild: Guild): GuildTextBasedChannel | null {
  const me = guild.members.me;
  if (!me) return null;
  const can = (ch: GuildTextBasedChannel) => {
    const p = ch.permissionsFor(me);
    return !!p && p.has(PermissionFlagsBits.ViewChannel) && p.has(PermissionFlagsBits.SendMessages) && p.has(PermissionFlagsBits.EmbedLinks);
  };
  if (guild.systemChannel && can(guild.systemChannel)) return guild.systemChannel;
  const text = [...guild.channels.cache.values()]
    .filter((c): c is GuildTextBasedChannel => c.type === ChannelType.GuildText)
    .sort((a, b) => ('position' in a && 'position' in b ? (a.position as number) - (b.position as number) : 0));
  return text.find(can) ?? null;
}

export async function welcome(db: Db, guild: Guild, prefix: string): Promise<void> {
  const key = `welcome:${guild.id}`;
  if (db.meta(key)) return;            // only the first time it joins
  db.setMeta(key, String(Date.now()));
  const ch = pickChannel(guild);
  if (!ch) return;
  await ch.send(welcomeMessage(prefix)).catch((e: unknown) => console.error('[welcome]', e instanceof Error ? e.message : e));
}
