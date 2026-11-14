import { RARITY, ACHIEVEMENTS, CATEGORIES, type Category } from '../achievements/list';
import { rarityStats, unlocked } from '../achievements/achievements';
import { importFromOldBot, oldDbFile } from '../achievements/import';
import { GameError } from '../core/errors';
import * as sessions from '../core/sessions';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { guildOf } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

interface AchState { targetId: string; targetName: string }

function view(ctx: Ctx, st: AchState, cat: Category | 'all', sessionId: string): ReplyObject {
  const have = new Map(unlocked(ctx.db, st.targetId).map((r) => [r.id, r]));
  const stats = rarityStats(ctx.db);
  const list = ACHIEVEMENTS.filter((a) => cat === 'all' || a.cat === cat);
  const shown = list.slice().sort((x, y) => Number(have.has(y.id)) - Number(have.has(x.id)) || RARITY[x.rarity].order - RARITY[y.rarity].order);
  const lines = (cat === 'all'
    ? shown.filter((a) => have.has(a.id))
    : shown
  ).slice(0, 25).map((a) => {
    const got = have.get(a.id);
    if (got) return `${RARITY[a.rarity].emoji} **${a.name}**: ${a.desc} · ${discordTime(got.unlocked_at, 'f')}`;
    return a.secret ? `🔒 **???**: Secret achievement` : `🔒 ${a.name}: ${a.desc} · ${stats.pct(a.id)}% of players`;
  });
  const total = ACHIEVEMENTS.length;
  const cats = Object.keys(CATEGORIES) as Category[];
  const btns: Button[] = [{ label: 'Unlocked', id: sessions.buttonId(sessionId, 'all'), style: cat === 'all' ? 'primary' : 'secondary' },
    ...cats.map((c) => ({ label: CATEGORIES[c].label, emoji: CATEGORIES[c].emoji, id: sessions.buttonId(sessionId, c), style: (c === cat ? 'primary' : 'secondary') as Button['style'] }))];
  const rows: Button[][] = [];
  btns.forEach((b, i) => { if (i % 4 === 0) rows.push([]); rows[rows.length - 1]!.push(b); });
  return {
    embeds: [embed('social', `Achievements: ${st.targetName}`, [
      `${have.size} of ${total} unlocked.`,
      cat === 'all' ? '' : `**${CATEGORIES[cat].emoji} ${CATEGORIES[cat].label}**`,
      ...(lines.length ? lines : ['None yet.'])
    ], { footer: { text: Object.values(RARITY).map((r) => `${r.emoji} ${r.label}`).join(' · ') } })],
    buttons: rows, session: sessionId
  };
}

export const achievements: Command = {
  name: 'achievements',
  aliases: ['ach', 'badges'],
  description: 'Your achievements (they follow you across servers)',
  system: 'social',
  options: [{ name: 'player', type: 'user', description: 'Whose achievements to show (default: yours)' }],
  run(ctx, args) {
    const targetId = typeof args.player === 'string' && /^\d{5,22}$/.test(args.player) ? args.player : ctx.user.id;
    const name = targetId === ctx.user.id ? ctx.user.name
      : ctx.db.get<{ name: string | null }>('SELECT name FROM players WHERE user_id = ? AND name IS NOT NULL LIMIT 1', targetId)?.name ?? 'Player';
    const st: AchState = { targetId, targetName: name };
    const s = sessions.create(ctx.db, { kind: 'achievements', guildId: ctx.guildId, channelId: ctx.channelId, userId: ctx.user.id, state: st, ttlMs: 10 * 60_000, now: ctx.now });
    return view(ctx, st, 'all', s.id);
  }
};

export function onAchievementsButton(ctx: Ctx, s: sessions.Session<AchState>, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}achievements\` to open your own.` };
  if (value !== 'all' && !(value in CATEGORIES)) return {};
  const { session: _s, ...v } = view(ctx, s.state, value as Category | 'all', s.id);
  return { update: v };
}

export const importAchievements: Command = {
  name: 'importachievements',
  description: "Bot owner: copy achievements from the old bot's database (for the reset)",
  system: 'admin',
  options: [{ name: 'file', type: 'string', description: "Path to the old database (default: OLD_DB_FILE or engine/data/rend-conomy.db)" }],
  run(ctx, args) {
    guildOf(ctx);
    if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
    const file = String(args.file ?? '').trim() || oldDbFile();
    let r;
    try { r = importFromOldBot(ctx.db, file); } catch (e) { throw new GameError('import.failed', (e as Error).message); }
    return { embeds: [embed('admin', 'Achievements imported', [
      `${r.achievements} achievements for ${r.players} players were copied.`,
      `${r.progress} progress counters were copied.`,
      r.skipped ? `${r.skipped} unknown achievement ids were skipped.` : null,
      'Each player receives their achievement payouts again when their account opens in each server.'
    ])] };
  }
};
