import { awardHere } from '../achievements/achievements';
import { GameError } from '../core/errors';
import { balance } from '../core/ledger';
import { format, parseAmount } from '../core/money';
import * as sessions from '../core/sessions';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { LOANS, activeLoans, bailout as toddBailout, between, createLoan, forgive as forgiveLoan, overdue, payLoan, repayTodd, toddDebt } from '../loans/loans';
import { load as loadMarket } from '../market/market';
import { netWorth } from '../social/worth';
import { player as ensurePlayer } from '../core/economy';
import { economy } from '../config';
import { me } from './shared';
import type { Command, Ctx, SessionReply } from './types';

const userArg = (v: unknown, what = 'a player'): string => {
  const id = String(v ?? '');
  if (!/^\d{5,22}$/.test(id)) throw new GameError('loan.target', `Name ${what}, for example @someone.`);
  return id;
};

export const bailout: Command = {
  name: 'bailout', description: "Borrow ⬡500 from TODD when you're broke (you owe ⬡600)", system: 'social', guildOnly: true,
  run(ctx) {
    const { guildId, wallet } = me(ctx);
    const paid = toddBailout(ctx.db, guildId, ctx.user.id, netWorth(ctx.db, loadMarket(ctx.db), guildId, ctx.user.id), ctx.now);
    return { embeds: [embed('social', 'TODD Loans', [
      `TODD: "OH?! BROKE?? DON'T worry, TODD's GOT you!!!"`,
      `**+${format(paid)}**. You now owe TODD **${format(toddDebt(ctx.db, guildId, ctx.user.id))}**.`,
      `Repay with \`${ctx.config.prefix}repay <amount>\`. No gambling or gifts until TODD is repaid.`,
      `Balance: ${format(balance(ctx.db, wallet))}`
    ])] };
  }
};

export const repay: Command = {
  name: 'repay', description: 'Pay TODD back', system: 'social', guildOnly: true,
  options: [{ name: 'amount', type: 'string', description: 'How much, or "all"', required: true }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const debt = toddDebt(ctx.db, guildId, ctx.user.id);
    const cents = parseAmount(args.amount, { all: Math.min(debt, balance(ctx.db, wallet)) });
    const r = repayTodd(ctx.db, guildId, ctx.user.id, cents, ctx.now);
    if (r.left === 0) awardHere('debt_free');
    return { embeds: [embed('social', 'TODD Loans', [
      `Repaid ${format(r.paid)}.`,
      r.left ? `Still owed to TODD: **${format(r.left)}**.` : 'TODD: "PAID IN FULL?! ...I\'ll allow it." You owe TODD nothing.',
      `Balance: ${format(balance(ctx.db, wallet))}`
    ])] };
  }
};

interface LoanRequest { borrowerId: string; borrowerName: string; lenderId: string; cents: number; rate: number }

export const loan: Command = {
  name: 'loan', description: 'Ask another player for a loan (they accept or decline)', system: 'social', guildOnly: true,
  options: [
    { name: 'lender', type: 'user', description: 'Who you are asking', required: true },
    { name: 'amount', type: 'string', description: 'How much', required: true },
    { name: 'rate', type: 'string', description: `Interest per day, 0 to ${LOANS.maxRate}% (default 5)` }
  ],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const lender = userArg(args.lender, 'a lender');
    if (lender === ctx.user.id) throw new GameError('loan.self', 'You cannot borrow from yourself.');
    const cents = parseAmount(args.amount);
    const rate = args.rate === undefined || args.rate === '' ? 5 : Number(String(args.rate).replace('%', ''));
    if (!Number.isFinite(rate) || rate < 0 || rate > LOANS.maxRate) throw new GameError('loan.rate', `The rate must be between 0 and ${LOANS.maxRate}% a day.`);
    if (between(ctx.db, guildId, lender, ctx.user.id, ctx.now)) throw new GameError('loan.exists', 'There is already an active loan between you two.');
    const s = sessions.create<LoanRequest>(ctx.db, { kind: 'loan', guildId, channelId: ctx.channelId, userId: lender,
      state: { borrowerId: ctx.user.id, borrowerName: ctx.user.name, lenderId: lender, cents, rate }, ttlMs: LOANS.requestMs, now: ctx.now });
    const due = ctx.now + LOANS.termMs;
    const owedAtDue = Math.round(cents * Math.pow(1 + rate / 100, 7));
    return {
      content: `<@${lender}>`,
      embeds: [embed('social', 'Loan request', [
        `<@${ctx.user.id}> asks to borrow **${format(cents)}** at **${rate}%** a day.`,
        `If it runs the full week, ${format(owedAtDue)} is owed, due ${discordTime(due)}.`,
        `After that, half of the borrower's earnings go to the lender until it is repaid.`
      ], { footer: { text: 'The request expires in 10 minutes.' } })],
      buttons: [[{ label: 'Accept', id: sessions.buttonId(s.id, 'yes'), style: 'success' }, { label: 'Decline', id: sessions.buttonId(s.id, 'no'), style: 'danger' }]],
      session: s.id
    };
  }
};

export function onLoanButton(ctx: Ctx, s: sessions.Session<LoanRequest>, value: string): SessionReply {
  const st = s.state;
  if (ctx.user.id !== st.lenderId) return { notice: 'Only the player asked can answer this request.' };
  if (!sessions.end(ctx.db, s.id)) return { update: { buttons: [] } };
  if (value !== 'yes') return { update: { embeds: [embed('social', 'Loan declined', [`<@${st.lenderId}> declined the request from <@${st.borrowerId}>.`])], buttons: [], content: '' } };
  const g = s.guild_id!;
  ensurePlayer(ctx.db, g, st.lenderId, economy.startingCash, ctx.now);
  const l = createLoan(ctx.db, g, st.lenderId, st.borrowerId, st.cents, st.rate, ctx.now);
  if (st.rate >= LOANS.maxRate) awardHere('loan_shark', st.lenderId);
  return { update: { content: '', embeds: [embed('social', 'Loan issued', [
    `<@${st.lenderId}> lent <@${st.borrowerId}> **${format(st.cents)}** at ${st.rate}% a day.`,
    `Due ${discordTime(l.due_at)}. Repay with \`${ctx.config.prefix}payback @lender <amount>\`.`
  ])], buttons: [] } };
}

export const loans: Command = {
  name: 'loans', description: 'Your loans: what you owe and what you are owed', system: 'social', guildOnly: true,
  run(ctx) {
    const { guildId } = me(ctx);
    const owe = activeLoans(ctx.db, guildId, { borrower: ctx.user.id }, ctx.now);
    const lent = activeLoans(ctx.db, guildId, { lender: ctx.user.id }, ctx.now);
    const todd = toddDebt(ctx.db, guildId, ctx.user.id);
    const line = (l: typeof owe[number], who: string) => `${who} · **${format(l.owed)}** at ${l.rate}% · ${overdue(l, ctx.now) ? '**overdue**' : `due ${discordTime(l.due_at)}`}`;
    return { embeds: [embed('social', 'Loans', [
      todd ? `Owed to TODD: **${format(todd)}**` : null,
      '**You owe**', ...(owe.length ? owe.map((l) => line(l, `<@${l.lender_id}>`)) : ['Nothing.']),
      '', '**You are owed**', ...(lent.length ? lent.map((l) => line(l, `<@${l.borrower_id}>`)) : ['Nothing.'])
    ])] };
  }
};

export const payback: Command = {
  name: 'payback', description: 'Repay a loan from another player', system: 'social', guildOnly: true,
  options: [{ name: 'lender', type: 'user', description: 'Who you owe', required: true }, { name: 'amount', type: 'string', description: 'How much, or "all"', required: true }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const lender = userArg(args.lender, 'the lender');
    const l = activeLoans(ctx.db, guildId, { borrower: ctx.user.id, lender }, ctx.now)[0];
    if (!l) throw new GameError('loan.none', 'You have no active loan from that player.');
    const cents = parseAmount(args.amount, { all: Math.min(l.owed, balance(ctx.db, wallet)) });
    const paid = payLoan(ctx.db, l, cents, ctx.now);
    const left = l.owed - paid;
    return { embeds: [embed('social', 'Loan repayment', [`Paid <@${lender}> ${format(paid)}.`, left > 0 ? `Still owed: **${format(left)}**.` : 'The loan is repaid in full.', `Balance: ${format(balance(ctx.db, wallet))}`])] };
  }
};

export const forgive: Command = {
  name: 'forgive', description: 'Cancel what a borrower owes you', system: 'social', guildOnly: true,
  options: [{ name: 'borrower', type: 'user', description: 'Who owes you', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const borrower = userArg(args.borrower, 'the borrower');
    const l = activeLoans(ctx.db, guildId, { borrower, lender: ctx.user.id }, ctx.now)[0];
    if (!l) throw new GameError('loan.none', 'That player has no active loan from you.');
    forgiveLoan(ctx.db, l, ctx.now);
    awardHere('merciful');
    return { embeds: [embed('social', 'Loan forgiven', [`<@${borrower}> no longer owes you ${format(l.owed)}.`])] };
  }
};
