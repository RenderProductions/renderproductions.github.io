import { unlocked } from '../achievements/achievements';
import { ACHIEVEMENTS } from '../achievements/list';
import { GameError } from '../core/errors';
import { balance, wallet } from '../core/ledger';
import { format } from '../core/money';
import { load as loadMarket } from '../market/market';
import { BANNERS, FRAMES, PAINTS, PRESETS, getStyle, setStyle, styleColor } from '../profile/styles';
import { COLLECTIBLES } from '../shop/items';
import { count } from '../shop/inventory';
import { netWorth } from '../social/worth';
import { COMPANIES, rankName } from '../work/jobs';
import { COLORS } from '../discord/style';
import { guildOf, me } from './shared';
import type { Command } from './types';

const SITE = 'https://renderproductions.github.io/profile/';

export const profile: Command = {
  name: 'profile', aliases: ['p', 'me', 'card'], description: 'Your profile (or another player\'s), and customizing it', system: 'social', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: '@player to view, or: color, theme, banner, frame, pin, reset, private on|off' }],
  run(ctx, args) {
    const raw = String(args.action ?? '').trim();
    const [verb, ...rest] = raw.split(/\s+/);
    const v = (verb ?? '').toLowerCase();
    if (['color', 'colour', 'theme', 'banner', 'frame', 'pin', 'reset'].includes(v)) {
      const { guildId } = me(ctx);
      const value = rest.join(' ');
      if (v === 'pin' && value && value !== 'none') {
        const id = Object.keys(COLLECTIBLES).find((c) => c === value || COLLECTIBLES[c]!.name.toLowerCase().includes(value.toLowerCase()));
        if (!id || !count(ctx.db, guildId, ctx.user.id, id)) throw new GameError('profile.pin', 'Pin a collectible you own in this server.');
        return { content: setStyle(ctx.db, ctx.user.id, 'pin', id, ctx.config.prefix), ephemeral: true };
      }
      try { return { content: setStyle(ctx.db, ctx.user.id, v === 'colour' ? 'color' : v, value, ctx.config.prefix), ephemeral: true }; }
      catch (e) { throw new GameError('profile.style', (e as Error).message); }
    }
    if (v === 'private') {
      const on = (rest[0] ?? 'on').toLowerCase() !== 'off';
      ctx.db.setMeta(`private:${ctx.user.id}`, on ? '1' : '0');
      return { content: on ? 'Your profile is now hidden from the site.' : 'Your profile is now shown on the site.', ephemeral: true };
    }
    if (v === 'looks' || v === 'styles') {
      return { content: [`**Themes:** ${Object.entries(PRESETS).map(([k, x]) => `${k} (${x.label})`).join(', ')}`, `**Paints:** ${Object.entries(PAINTS).map(([k, x]) => `${x.emoji} ${k}`).join(', ')}`,
        `**Banners:** ${Object.keys(BANNERS).join(', ')}`, `**Frames:** ${Object.keys(FRAMES).join(', ')}`].join('\n'), ephemeral: true };
    }
    const guildId = guildOf(ctx);
    const target = /^<@!?(\d+)>$/.exec(raw)?.[1] ?? (/^\d{5,22}$/.test(raw) ? raw : ctx.user.id);
    if (target === ctx.user.id) me(ctx);
    const p = ctx.db.get<{ name: string | null; title: string | null; job: string | null }>('SELECT name, title, job FROM players WHERE guild_id = ? AND user_id = ?', guildId, target);
    if (!p) throw new GameError('player.none', 'That player has no account in this server.');
    const m = loadMarket(ctx.db);
    const career = p.job ? ctx.db.get<{ rank: number }>('SELECT rank FROM careers WHERE guild_id = ? AND user_id = ? AND ticker = ?', guildId, target, p.job) : undefined;
    const shifts = ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(shifts), 0) AS s FROM careers WHERE guild_id = ? AND user_id = ?', guildId, target)!.s;
    const best = ctx.db.get<{ b: number }>('SELECT COALESCE(MAX(biggest), 0) AS b FROM gambling WHERE guild_id = ? AND user_id = ?', guildId, target)!.b;
    const ach = unlocked(ctx.db, target);
    const cols = Object.keys(COLLECTIBLES).filter((id) => count(ctx.db, guildId, target, id) > 0);
    const st = getStyle(ctx.db, target);
    const name = target === ctx.user.id ? ctx.user.name : p.name ?? 'Player';
    return { embeds: [{
      color: styleColor(ctx.db, target, COLORS.social),
      title: `${name}${p.title ? ` · *${p.title}*` : ''}`,
      url: `${SITE}?id=${target}`,
      description: [
        `**Net worth:** ${format(netWorth(ctx.db, m, guildId, target))} · cash ${format(balance(ctx.db, wallet(guildId, target)))}`,
        p.job ? `**Job:** ${rankName(p.job, career?.rank ?? 0)} at ${COMPANIES[p.job]?.name ?? p.job}` : '**Job:** none',
        `**Shifts worked:** ${shifts} · **Best Rend-Sino hit:** ${format(best)}`,
        `**Achievements:** ${ach.length} of ${ACHIEVEMENTS.length}`,
        cols.length ? `**Collectibles:** ${cols.map((c) => COLLECTIBLES[c]!.emoji).join(' ')}` : null,
        st.pin && COLLECTIBLES[st.pin] ? `**Pinned:** ${COLLECTIBLES[st.pin]!.emoji} ${COLLECTIBLES[st.pin]!.name}` : null
      ].filter(Boolean).join('\n'),
      footer: { text: target === ctx.user.id ? `Customize: ${ctx.config.prefix}profile color|theme|banner|frame|pin|reset · ${ctx.config.prefix}profile looks` : 'View the full profile on the site' }
    }] };
  }
};
