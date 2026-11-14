import { economy } from '../config';
import { player } from '../core/economy';
import { GameError } from '../core/errors';
import { RESERVE, balance } from '../core/ledger';
import { format } from '../core/money';
import * as sessions from '../core/sessions';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { EVENTS, activeEvent, describeEvent, endEvent, startEvent } from '../events/world';
import { HEIST, ROLES, TARGETS, heistOdds, playerCooldown, recentHeists, runHeist, serverReady, type Member, type Role, type Target } from '../heists/heists';
import { heistBonus } from '../events/world';
import { me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

interface Lobby { target: Target; members: Member[] }

function lobbyView(ctx: Ctx, s: sessions.Session<Lobby>, line = '', done = false): ReplyObject {
  const st = s.state, T = TARGETS[st.target];
  const crew = st.members.map((m) => `${ROLES[m.role].emoji} **${m.name}** (${ROLES[m.role].label})${m.id === s.user_id ? ' · leader' : ''}`);
  const buttons: Button[][] = done ? [] : [
    (Object.keys(ROLES) as Role[]).map((r) => ({ label: `Join as ${ROLES[r].label}`, emoji: ROLES[r].emoji, id: sessions.buttonId(s.id, `join:${r}`), style: 'primary' as const })),
    [{ label: 'Leave', id: sessions.buttonId(s.id, 'leave') }, { label: 'Start the heist', id: sessions.buttonId(s.id, 'start'), style: 'success', disabled: st.members.length < HEIST.minCrew }, { label: 'Call it off', id: sessions.buttonId(s.id, 'cancel'), style: 'danger' }]
  ];
  return { embeds: [embed('casino', `${T.emoji} Heist: ${T.label}`, [
    `Stake: ${format(T.stake)} each · haul ${format(T.haul[0])} to ${format(T.haul[1])}${T.needs ? ' · needs a Hacker' : ''}`,
    `Crew ${st.members.length}/${HEIST.maxCrew} (at least ${HEIST.minCrew}) · odds now ${Math.round(heistOdds(st.target, st.members, heistBonus(ctx.db, ctx.now)) * 100)}%`,
    '', ...(crew.length ? crew : ['No one yet.']), line && `\n${line}`
  ])], buttons };
}

export const heist: Command = {
  name: 'heist', aliases: ['heists', 'rob'], description: 'Plan a heist: vault, stash, or the Reserve (crew of 3 to 5)', system: 'casino', guildOnly: true,
  options: [{ name: 'target', type: 'string', description: 'vault, stash, or reserve (leave out for recent heists)' }, { name: 'role', type: 'string', description: 'Your role: hacker, driver, lookout, muscle (default hacker)' }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const t = String(args.target ?? '').trim().toLowerCase() as Target;
    if (!t) {
      const r = recentHeists(ctx.db, guildId);
      return { embeds: [embed('casino', 'Recent heists', r.length ? r.map((h) => `${TARGETS[h.target as Target]?.emoji ?? ''} ${TARGETS[h.target as Target]?.label ?? h.target} · ${h.outcome}${h.haul ? ` · ${format(h.haul)}` : ''} · ${discordTime(h.at)}`) : ['None yet.'],
        { footer: { text: `${ctx.config.prefix}heist vault|stash|reserve [role]` } })] };
    }
    if (!TARGETS[t]) throw new GameError('heist.target', 'Choose a target: vault, stash, or reserve.');
    let role = (String(args.role ?? 'hacker').trim().toLowerCase() || 'hacker') as Role;
    if (!ROLES[role] && /^[a-z]{2,5}$/.test(role) && !['hack', 'look', 'drive'].includes(role)) role = 'hacker'; // the old "r!heist vault <ticker>"
    if (!ROLES[role]) throw new GameError('heist.role', 'Roles: hacker, driver, lookout, muscle.');
    const wait = serverReady(ctx.db, guildId, ctx.now);
    if (wait) throw new GameError('heist.server', `The server is still hot from the last heist. Next one ${discordTime(wait)}.`);
    const cd = playerCooldown(ctx.db, guildId, ctx.user.id, ctx.now);
    if (cd) throw new GameError('heist.cooldown', `You are laying low until ${discordTime(cd)}.`);
    if (t === 'reserve' && balance(ctx.db, RESERVE) < economy.reserveStart * TARGETS.reserve.minLevel) throw new GameError('heist.reserve', 'The Reserve is too low to be worth robbing.');
    if (ctx.db.get("SELECT 1 FROM sessions WHERE kind = 'heist' AND channel_id = ? AND expires_at > ?", ctx.channelId, ctx.now)) throw new GameError('heist.live', 'A heist is already being planned here.');
    const s = sessions.create<Lobby>(ctx.db, { kind: 'heist', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: { target: t, members: [{ id: ctx.user.id, name: ctx.user.name, role }] }, ttlMs: HEIST.lobbyMs, now: ctx.now });
    return { ...lobbyView(ctx, s), session: s.id };
  }
};

export function onHeistButton(ctx: Ctx, s: sessions.Session<Lobby>, value: string): SessionReply {
  const st = s.state, g = s.guild_id!;
  const [kind, arg] = value.split(':');
  const isLeader = ctx.user.id === s.user_id;
  if (kind === 'join') {
    if (!ROLES[arg as Role]) return {};
    if (st.members.length >= HEIST.maxCrew && !st.members.some((m) => m.id === ctx.user.id)) return { notice: 'The crew is full.' };
    const cd = playerCooldown(ctx.db, g, ctx.user.id, ctx.now);
    if (cd) return { notice: `You are laying low until ${discordTime(cd)}.` };
    player(ctx.db, g, ctx.user.id, economy.startingCash, ctx.now);
    st.members = st.members.filter((m) => m.id !== ctx.user.id).concat({ id: ctx.user.id, name: ctx.user.name, role: arg as Role });
    sessions.save(ctx.db, s.id, st);
    return { update: lobbyView(ctx, s) };
  }
  if (kind === 'leave') {
    if (isLeader) return { notice: 'The leader cannot leave. Call it off instead.' };
    st.members = st.members.filter((m) => m.id !== ctx.user.id);
    sessions.save(ctx.db, s.id, st);
    return { update: lobbyView(ctx, s) };
  }
  if (!isLeader) return { notice: 'Only the leader can do that.' };
  if (kind === 'cancel') { if (!sessions.end(ctx.db, s.id)) return {}; return { update: lobbyView(ctx, s, 'Called off.', true) }; }
  if (kind === 'start') {
    if (st.members.length < HEIST.minCrew) return { notice: `A crew needs at least ${HEIST.minCrew}.` };
    if (!sessions.end(ctx.db, s.id)) return {};
    const r = runHeist(ctx.db, g, st.target, st.members, ctx.rng, ctx.now);
    const line = r.outcome === 'short' ? `Not enough of the crew could pay the stake. Left behind: ${r.dropped.map((m) => m.name).join(', ')}.`
      : r.outcome === 'clean' ? `**Clean getaway.** The haul: ${format(r.haul)}, ${format(r.each)} each.`
      : r.outcome === 'escaped' ? '**It went wrong**, but the driver got everyone out. Stakes are lost; no fines.'
      : `**TODD caught the crew.** Stakes are lost, and each member was fined up to ${format(TARGETS[st.target].stake * HEIST.fine)}.`;
    return { update: lobbyView(ctx, s, `${line}${r.odds ? `\n-# The odds were ${Math.round(r.odds * 100)}%.` : ''}`, true) };
  }
  return {};
}

export const event: Command = {
  name: 'event', aliases: ['events', 'worldevent'], description: 'The world event running now (bot owner: start or end one)', system: 'market',
  options: [{ name: 'action', type: 'string', description: 'Bot owner: "start <id> [ticker]" or "end"' }],
  run(ctx, args) {
    const [verb, id, tk] = String(args.action ?? '').trim().split(/\s+/);
    if (verb) {
      if (!ctx.isOwner) throw new GameError('owner.only', 'This command is restricted to the bot owner.');
      if (verb === 'end') { endEvent(ctx.db); return { content: 'The world event has ended.', ephemeral: true }; }
      if (verb === 'start' && id && EVENTS[id]) { const e = startEvent(ctx.db, id, tk?.toUpperCase(), ctx.now); return { embeds: [embed('market', 'World event started', [describeEvent(e)])] }; }
      throw new GameError('event.action', `Events: ${Object.keys(EVENTS).join(', ')}.`);
    }
    const e = activeEvent(ctx.db, ctx.now);
    return { embeds: [embed('market', 'World event', [e ? `${describeEvent(e)}\nEnds ${discordTime(e.until!)}.` : 'Nothing special is happening right now.'])] };
  }
};
