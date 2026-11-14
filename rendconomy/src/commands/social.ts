import { economy } from '../config';
import { player as ensurePlayer } from '../core/economy';
import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { RESERVE, balance, transfer, wallet } from '../core/ledger';
import { format, parseAmount, polygons } from '../core/money';
import * as sessions from '../core/sessions';
import { dayKey, discordTime, nextReset } from '../core/time';
import { embed } from '../discord/style';
import { load as loadMarket } from '../market/market';
import { SAVINGS, close, collect, deposit, interestOf, list } from '../social/savings';
import { netWorth } from '../social/worth';
import { awardHere } from '../achievements/achievements';
import { charges, useEffect } from '../shop/inventory';
import { activeLoans, overdue, toddDebt } from '../loans/loans';
import { guildOf, me } from './shared';
import type { Button, Command, Ctx, ReplyObject, SessionReply } from './types';

// ---------------------------------------------------------------- gift

export const GIFT = { fee: 0.05, min: polygons(1), perDay: polygons(5000) };

/** Polygons this player has gifted since 12 AM Eastern. */
function giftedToday(ctx: Ctx, guildId: string): number {
  const since = nextReset(ctx.now) - 24 * 3600_000 - 2 * 3600_000; // generous lower bound; filtered by day below
  const rows = ctx.db.all<{ cents: number; at: number }>("SELECT cents, at FROM ledger WHERE from_id = ? AND reason = 'gift' AND at >= ?", wallet(guildId, ctx.user.id), since);
  const today = dayKey(ctx.now);
  return rows.filter((r) => dayKey(r.at) === today).reduce((s, r) => s + r.cents, 0);
}

export const gift: Command = {
  name: 'gift',
  aliases: ['send', 'tip'],
  description: 'Send Polygons to another player (5% fee, up to ⬡5,000 a day)',
  system: 'social',
  guildOnly: true,
  options: [
    { name: 'player', type: 'user', description: 'Who receives it', required: true },
    { name: 'amount', type: 'string', description: 'How much they receive', required: true },
    { name: 'note', type: 'string', description: 'A message to go with it' }
  ],
  run(ctx, args) {
    const { wallet: from, guildId } = me(ctx);
    const to = String(args.player ?? '');
    if (!/^\d{5,22}$/.test(to)) throw new GameError('gift.target', `Name a player, for example \`${ctx.config.prefix}gift @someone 100\`.`);
    if (to === ctx.user.id) throw new GameError('gift.self', 'You cannot send a gift to yourself.');
    if (ctx.botId && to === ctx.botId) { awardHere('tip_the_house'); throw new GameError('gift.house', 'The house does not accept gifts. It appreciates the thought.'); }
    if (toddDebt(ctx.db, guildId, ctx.user.id) > 0) throw new GameError('gift.todd', `TODD: "Giving away MY Polygons? Pay me back first." (\`${ctx.config.prefix}repay\`)`);
    if (activeLoans(ctx.db, guildId, { borrower: ctx.user.id }, ctx.now).some((l) => overdue(l, ctx.now))) throw new GameError('gift.overdue', 'You have an overdue loan. Repay it before sending gifts.');
    const cents = parseAmount(args.amount, { min: GIFT.min });
    const sent = giftedToday(ctx, guildId);
    if (sent + cents > GIFT.perDay) throw new GameError('gift.limit', `The daily gift limit is ${format(GIFT.perDay)}. Remaining today: ${format(Math.max(0, GIFT.perDay - sent))}.`);
    const wrapped = charges(ctx.db, guildId, ctx.user.id, 'wrap') > 0;
    const fee = wrapped ? 0 : Math.max(1, Math.round(cents * GIFT.fee));
    if (balance(ctx.db, from) < cents + fee) throw new GameError('funds.short', `A gift of ${format(cents)} costs ${format(cents + fee)} including the ${GIFT.fee * 100}% fee. The balance is ${format(balance(ctx.db, from))}.`);
    const note = String(args.note ?? '').trim().slice(0, 200);
    ctx.db.tx(() => {
      ensurePlayer(ctx.db, guildId, to, economy.startingCash, ctx.now);
      transfer(ctx.db, { from, to: wallet(guildId, to), cents, reason: 'gift', guildId, actorId: ctx.user.id, now: ctx.now, note: note ? { note } : undefined });
      if (fee > 0) transfer(ctx.db, { from, to: RESERVE, cents: fee, reason: 'gift.fee', guildId, actorId: ctx.user.id, now: ctx.now });
      if (wrapped) useEffect(ctx.db, guildId, ctx.user.id, 'wrap');
    });
    emit('gift.sent', { guildId, fromId: ctx.user.id, toId: to, cents });
    return { embeds: [embed('social', 'Gift sent', [
      `<@${to}> received **${format(cents)}**.`,
      wrapped ? 'Gift Wrap: no fee.' : `Fee: ${format(fee)}`,
      note && `Note: ${note}`,
      `Balance: ${format(balance(ctx.db, from))}`
    ])] };
  }
};

// ---------------------------------------------------------------- leaderboard

type Board = 'worth' | 'cash' | 'shifts';
const BOARDS: Record<Board, { label: string; show: (v: number) => string }> = {
  worth: { label: 'Net worth', show: format },
  cash: { label: 'Polygons', show: format },
  shifts: { label: 'Shifts worked', show: (v) => `${v.toLocaleString('en-US')} ${v === 1 ? 'shift' : 'shifts'}` }
};
const ALIAS: Record<string, Board> = { networth: 'worth', net: 'worth', nw: 'worth', polygons: 'cash', money: 'cash', balance: 'cash', work: 'shifts', jobs: 'shifts' };

function scores(ctx: Ctx, guildId: string, board: Board): { id: string; name: string; v: number }[] {
  const players = ctx.db.all<{ user_id: string; name: string | null }>('SELECT user_id, name FROM players WHERE guild_id = ?', guildId);
  if (board === 'cash') return players.map((p) => ({ id: p.user_id, name: p.name ?? 'Unknown', v: balance(ctx.db, wallet(guildId, p.user_id)) }));
  if (board === 'shifts') {
    const s = new Map(ctx.db.all<{ user_id: string; n: number }>('SELECT user_id, SUM(shifts) AS n FROM careers WHERE guild_id = ? GROUP BY user_id', guildId).map((r) => [r.user_id, r.n]));
    return players.map((p) => ({ id: p.user_id, name: p.name ?? 'Unknown', v: s.get(p.user_id) ?? 0 }));
  }
  const m = loadMarket(ctx.db);
  return players.map((p) => ({ id: p.user_id, name: p.name ?? 'Unknown', v: netWorth(ctx.db, m, guildId, p.user_id) }));
}

function boardView(ctx: Ctx, guildId: string, board: Board, sessionId: string): ReplyObject {
  const b = BOARDS[board];
  const ranked = scores(ctx, guildId, board).sort((x, y) => y.v - x.v);
  const lines = ranked.slice(0, 10).map((r, i) => `\`${String(i + 1).padStart(2, ' ')}.\` ${r.id === ctx.user.id ? `**${r.name} (you)**` : r.name} · ${b.show(r.v)}`);
  const mine = ranked.findIndex((r) => r.id === ctx.user.id);
  const buttons: Button[][] = [(Object.keys(BOARDS) as Board[]).map((k) => ({ label: BOARDS[k].label, id: sessions.buttonId(sessionId, k), style: k === board ? 'primary' : 'secondary' }))];
  return {
    embeds: [embed('social', `Leaderboard: ${b.label}`, [
      ...(lines.length ? lines : ['No players yet.']),
      mine >= 10 ? `\nYour position: #${mine + 1} of ${ranked.length} · ${b.show(ranked[mine]!.v)}` : null
    ])],
    buttons, session: sessionId
  };
}

export const leaderboard: Command = {
  name: 'leaderboard',
  aliases: ['lb', 'top', 'rich'],
  description: 'The top 10 in this server: net worth, Polygons or shifts',
  system: 'social',
  guildOnly: true,
  options: [{ name: 'board', type: 'string', description: 'worth, cash or shifts' }],
  run(ctx, args) {
    const guildId = guildOf(ctx);
    me(ctx);
    const raw = String(args.board ?? 'worth').trim().toLowerCase();
    const board = (ALIAS[raw] ?? raw) as Board;
    if (!BOARDS[board]) throw new GameError('lb.board', 'Choose a board: worth, cash or shifts.');
    const s = sessions.create(ctx.db, { kind: 'leaderboard', guildId, channelId: ctx.channelId, userId: ctx.user.id, state: {}, ttlMs: 10 * 60_000, now: ctx.now });
    return boardView(ctx, guildId, board, s.id);
  }
};

export function onLeaderboardButton(ctx: Ctx, s: sessions.Session, value: string): SessionReply {
  if (ctx.user.id !== s.user_id) return { notice: `Use \`${ctx.config.prefix}leaderboard\` to open your own.` };
  if (!(value in BOARDS)) return {};
  const { session: _s, ...view } = boardView(ctx, s.guild_id!, value as Board, s.id);
  return { update: view };
}

// ---------------------------------------------------------------- savings

export const savings: Command = {
  name: 'savings',
  aliases: ['save', 'bank', 'piggybank'],
  description: 'Lock Polygons away for 3, 7 or 14 days and get them back with interest',
  system: 'social',
  guildOnly: true,
  options: [{ name: 'action', type: 'string', description: '"deposit <amount> <3|7|14>" or "withdraw <#>"' }],
  run(ctx, args) {
    const { wallet: w, guildId } = me(ctx);
    const paid = collect(ctx.db, guildId, ctx.user.id, ctx.now);
    const [verb, a, b] = String(args.action ?? '').trim().toLowerCase().split(/\s+/);
    const head: string[] = paid.map((r) => `A ${r.account.days}-day account has matured: ${format(r.account.amount)} returned with ${format(r.interest)} interest.`);

    if (verb === 'deposit' || verb === 'd') {
      const cents = parseAmount(a, { all: balance(ctx.db, w), min: SAVINGS.min });
      const days = Number(b);
      const acct = deposit(ctx.db, guildId, ctx.user.id, cents, days, ctx.now);
      head.push(`Deposited **${format(cents)}** for ${days} days at ${acct.rate_bp / 100}%. It returns **${format(cents + interestOf(acct))}** ${discordTime(acct.ends_at)}.`);
    } else if (verb === 'withdraw' || verb === 'w') {
      const acct = list(ctx.db, guildId, ctx.user.id).find((x) => x.id === Number(String(a ?? '').replace('#', '')));
      if (!acct) throw new GameError('savings.none', 'No savings account has that number. Use the numbers shown in the list.');
      const r = close(ctx.db, acct, ctx.now);
      head.push(r.early ? `Account #${acct.id} closed early. ${format(acct.amount)} returned, without interest.` : `Account #${acct.id} matured: ${format(acct.amount)} returned with ${format(r.interest)} interest.`);
    } else if (verb) {
      throw new GameError('savings.action', `Use \`${ctx.config.prefix}savings deposit <amount> <3|7|14>\` or \`${ctx.config.prefix}savings withdraw <#>\`.`);
    }

    const accts = list(ctx.db, guildId, ctx.user.id);
    const plans = Object.entries(SAVINGS.plans).map(([d, bp]) => `${d} days: ${bp / 100}%`).join(' · ');
    return { embeds: [embed('social', 'Savings', [
      ...head, head.length ? '' : null,
      ...(accts.length ? accts.map((x) => `**#${x.id}** · ${format(x.amount)} for ${x.days} days at ${x.rate_bp / 100}% · returns ${format(x.amount + interestOf(x))} ${discordTime(x.ends_at)}`) : ['No savings accounts open.']),
      '',
      `Plans: ${plans}`,
      `Cash: ${format(balance(ctx.db, w))}`
    ], { footer: { text: `${ctx.config.prefix}savings deposit <amount> <days> · ${ctx.config.prefix}savings withdraw <#> closes early, without interest` } })] };
  }
};
