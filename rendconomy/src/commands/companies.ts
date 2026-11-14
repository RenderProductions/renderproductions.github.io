import { GameError } from '../core/errors';
import { emit } from '../core/events';
import { balance } from '../core/ledger';
import { format, parseAmount } from '../core/money';
import { discordTime } from '../core/time';
import { embed } from '../discord/style';
import { TICKERS } from '../market/market';
import { CO, LEVELS, TAKEOVER, alive, approve as approveCo, bidOn, change, cleanName, employees, found as foundCo, getCompany, invest as investCo, ipo as ipoCo, levelOf, listCompanies, merge as mergeCo, mergerFor, ownedBy, poisonPill, proposeMerger, reject as rejectCo, salary as salaryCo, sharesHeld, spark, startBid, treasury, upgrade as upgradeCo, worthOf, completeBid } from '../companies/companies';
import { me } from './shared';
import type { Command, Ctx } from './types';

const canApprove = (ctx: Ctx) => ctx.isOwner || (!!ctx.config.homeGuildId && ctx.guildId === ctx.config.homeGuildId && ctx.isMod);
function mine(ctx: Ctx) {
  const c = ownedBy(ctx.db, ctx.user.id);
  if (!c) throw new GameError('co.none', `You do not run a company. Found one with \`${ctx.config.prefix}found <TICKER> <name>\` (${format(LEVELS[0]!.cost)}).`);
  return c;
}
const card = (ctx: Ctx, t: string) => {
  const c = getCompany(ctx.db, t);
  if (!c || c.status === 'rejected') throw new GameError('co.unknown', `There is no player company ${t.toUpperCase()}.`);
  const lv = levelOf(c), next = LEVELS[c.level];
  const bid = bidOn(ctx.db, c.ticker);
  return embed('market', `${c.name} (${c.ticker})`, [
    `Owner: <@${c.owner_id}> · **${lv.name}** (level ${c.level}) · ${c.status}`,
    c.status === 'public' ? `Price: **${format(Math.round(c.price * 100))}** ${change(c) >= 0 ? '▲' : '▼'}${Math.abs(change(c)).toFixed(1)}% ${spark(c.history)} · ${CO.float - sharesHeld(ctx.db, c.ticker)} public shares available` : null,
    `Treasury: ${format(treasury(ctx.db, c))} · worth ${format(worthOf(ctx.db, c))} · upkeep ${format(lv.upkeep)}/day${c.strikes ? ` · **${c.strikes} missed upkeep${c.strikes > 1 ? 's' : ''}**` : ''}`,
    `Employees: ${employees(ctx.db, c.ticker)} (pay ${lv.payMult}x)`,
    next ? `Next level: ${next.name}, ${format(next.cost)} from the treasury` : 'Top level reached.',
    c.status === 'private' && c.level >= CO.ipoLevel ? `Ready to go public: \`${ctx.config.prefix}ipo\` (${format(CO.listingFee)})` : null,
    bid ? `**Takeover bid** by <@${bid.bidder_id}>: completes ${discordTime(bid.ends_at)} unless defended.` : null,
    c.status === 'dead' ? `Closed ${c.died_at ? discordTime(c.died_at) : ''}: ${c.note ?? ''}` : null
  ]);
};

export const found: Command = {
  name: 'found', aliases: ['startup'], description: `Found a player company (${'⬡2,500'}; approved by moderators)`, system: 'market', guildOnly: true,
  options: [{ name: 'ticker', type: 'string', description: '2 to 5 letters, e.g. MEOW', required: true }, { name: 'name', type: 'string', description: 'The company name', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const c = foundCo(ctx.db, guildId, ctx.user.id, ctx.user.name, String(args.ticker ?? '').trim().toUpperCase(), cleanName(String(args.name ?? '')), TICKERS, ctx.now);
    emit('mod.action', { guildId, modId: ctx.user.id, action: `company founded: ${c.ticker} (${c.name}), awaiting approval` });
    return { embeds: [embed('market', `Founded: ${c.name} (${c.ticker})`, [`${format(LEVELS[0]!.cost)} is in the treasury. The company is awaiting approval; if the name is rejected, it is refunded in full.`])] };
  }
};

export const company: Command = {
  name: 'company', aliases: ['co'], description: 'A player company (yours if you leave it out)', system: 'market',
  options: [{ name: 'ticker', type: 'string', description: 'Ticker' }],
  run(ctx, args) {
    const t = String(args.ticker ?? '').trim().toUpperCase() || mine(ctx).ticker;
    return { embeds: [card(ctx, t)] };
  }
};

export const exchange: Command = {
  name: 'exchange', aliases: ['companies', 'ex'], description: 'Every player company', system: 'market',
  run(ctx) {
    const list = listCompanies(ctx.db, ['public', 'private']);
    return { embeds: [embed('market', 'The player exchange', list.length ? list.map((c) => `**${c.ticker}** · ${c.name} · ${levelOf(c).name} · ${c.status === 'public' ? `${format(Math.round(c.price * 100))} ${change(c) >= 0 ? '▲' : '▼'}${Math.abs(change(c)).toFixed(1)}%` : 'private'}`) : ['No player companies yet.'],
      { footer: { text: `Buy public shares with ${ctx.config.prefix}buy <TICKER> <amount>.` } })] };
  }
};

export const invest: Command = {
  name: 'invest', aliases: ['fund'], description: 'Put your own Polygons into your company\'s treasury', system: 'market', guildOnly: true,
  options: [{ name: 'amount', type: 'string', description: 'How much', required: true }],
  run(ctx, args) {
    const { guildId, wallet } = me(ctx);
    const c = mine(ctx);
    if (c.status !== 'pending' && c.status !== 'private' && c.status !== 'public') throw new GameError('co.dead', 'That company is closed.');
    const cents = parseAmount(args.amount, { all: balance(ctx.db, wallet) });
    investCo(ctx.db, c, guildId, ctx.user.id, cents, ctx.now);
    return { embeds: [embed('market', 'Invested', [`${format(cents)} into ${c.name}. Treasury: ${format(treasury(ctx.db, c))}.`])] };
  }
};

export const upgrade: Command = {
  name: 'upgrade', aliases: ['expand'], description: 'Level your company up (paid from its treasury)', system: 'market', guildOnly: true,
  run(ctx) {
    const c = mine(ctx);
    if (!alive(c)) throw new GameError('co.pending', 'The company must be approved first.');
    const u = upgradeCo(ctx.db, c, ctx.now);
    return { embeds: [embed('market', `${u.name} is now a ${levelOf(u).name}`, [`Upkeep: ${format(levelOf(u).upkeep)}/day · employee pay ${levelOf(u).payMult}x`])] };
  }
};

export const ipo: Command = {
  name: 'ipo', description: 'Take your company public', system: 'market', guildOnly: true,
  run(ctx) {
    const c = mine(ctx);
    const price = ipoCo(ctx.db, c, ctx.now);
    return { embeds: [embed('market', `${c.name} is public`, [`Opening price: **${format(Math.round(price * 100))}**. ${CO.float} shares are offered; their sale funds the treasury.`])] };
  }
};

export const salary: Command = {
  name: 'salary', aliases: ['wage'], description: 'Pay yourself from your company (up to 10% of the treasury a day)', system: 'market', guildOnly: true,
  options: [{ name: 'amount', type: 'string', description: 'How much, or "max"', required: true }],
  run(ctx, args) {
    const c = mine(ctx);
    if (!alive(c)) throw new GameError('co.pending', 'The company must be approved first.');
    const cents = parseAmount(args.amount, { all: Math.floor(treasury(ctx.db, c) * CO.salaryMaxPct) });
    salaryCo(ctx.db, c, cents, ctx.now);
    return { embeds: [embed('market', 'Salary paid', [`${format(cents)} from ${c.name}. Treasury: ${format(treasury(ctx.db, c))}.`])] };
  }
};

export const review: Command = {
  name: 'review', description: 'Approvers: companies awaiting approval', system: 'admin',
  run(ctx) {
    if (!canApprove(ctx)) throw new GameError('co.approver', 'Company approvals are restricted to the bot owner and the home server\'s moderators.');
    const list = listCompanies(ctx.db, ['pending']);
    return { embeds: [embed('admin', 'Companies awaiting approval', list.length ? list.map((c) => `**${c.ticker}** · ${c.name} · <@${c.owner_id}> · ${discordTime(c.created_at)}`) : ['None.'],
      { footer: { text: `${ctx.config.prefix}approve <TICKER> · ${ctx.config.prefix}reject <TICKER> <reason>` } })] };
  }
};

export const approve: Command = {
  name: 'approve', description: 'Approvers: approve a company', system: 'admin',
  options: [{ name: 'ticker', type: 'string', description: 'Ticker', required: true }],
  run(ctx, args) {
    if (!canApprove(ctx)) throw new GameError('co.approver', 'Company approvals are restricted to the bot owner and the home server\'s moderators.');
    const c = getCompany(ctx.db, String(args.ticker ?? ''));
    if (!c || c.status !== 'pending') throw new GameError('co.pending', 'No company with that ticker is awaiting approval.');
    approveCo(ctx.db, c.ticker, ctx.now);
    return { embeds: [embed('admin', 'Company approved', [`${c.name} (${c.ticker}) is open for business.`])] };
  }
};

export const reject: Command = {
  name: 'reject', description: 'Approvers: reject a company (refunded in full)', system: 'admin',
  options: [{ name: 'ticker', type: 'string', description: 'Ticker', required: true }, { name: 'reason', type: 'string', description: 'Why', required: true }],
  run(ctx, args) {
    if (!canApprove(ctx)) throw new GameError('co.approver', 'Company approvals are restricted to the bot owner and the home server\'s moderators.');
    const c = getCompany(ctx.db, String(args.ticker ?? ''));
    if (!c || c.status !== 'pending') throw new GameError('co.pending', 'No company with that ticker is awaiting approval.');
    rejectCo(ctx.db, c, String(args.reason ?? ''), ctx.now);
    return { embeds: [embed('admin', 'Company rejected', [`${c.name} (${c.ticker}). The founding cost was refunded.`])] };
  }
};

export const takeover: Command = {
  name: 'takeover', aliases: ['hostiletakeover', 'raid'], description: 'Hostile takeovers: bid, defend (poison pill), or accept a bid on your company', system: 'market', guildOnly: true,
  options: [{ name: 'action', type: 'string', description: '"bid <TICKER>", "defend", or "accept"', required: true }],
  run(ctx, args) {
    const { guildId } = me(ctx);
    const [verb, t] = String(args.action ?? '').trim().split(/\s+/);
    const v = (verb ?? '').toLowerCase();
    if (v === 'bid') {
      const c = getCompany(ctx.db, t ?? '');
      if (!c) throw new GameError('co.unknown', 'No such company.');
      const b = startBid(ctx.db, guildId, ctx.user.id, c, ctx.now);
      return { content: `<@${c.owner_id}>`, embeds: [embed('market', `Takeover bid: ${c.name}`, [`<@${ctx.user.id}> holds a controlling stake and bids a premium of **${format(b.premium)}** (set aside).`,
        `The owner may accept (\`${ctx.config.prefix}takeover accept\`) or defend with a poison pill costing ${format(Math.round(worthOf(ctx.db, c) * TAKEOVER.poisonPill))} (\`${ctx.config.prefix}takeover defend\`).`, `Otherwise it completes ${discordTime(b.ends_at)}.`])] };
    }
    const c = mine(ctx);
    const b = bidOn(ctx.db, c.ticker);
    if (!b) throw new GameError('to.none', 'There is no takeover bid on your company.');
    if (v === 'defend') return { embeds: [embed('market', 'Takeover defeated', [`A poison pill cost you ${format(poisonPill(ctx.db, c, ctx.now))}. The bidder was refunded.`])] };
    if (v === 'accept') { completeBid(ctx.db, b, ctx.now); return { embeds: [embed('market', 'Takeover accepted', [`${c.name} now belongs to <@${b.bidder_id}>. You received ${format(b.premium)}.`])] }; }
    throw new GameError('to.action', 'Use bid <TICKER>, defend, or accept.');
  }
};

export const merge: Command = {
  name: 'merge', aliases: ['merger'], description: 'Propose or accept a merger with another company', system: 'market', guildOnly: true,
  options: [{ name: 'ticker', type: 'string', description: 'The other company', required: true }],
  run(ctx, args) {
    me(ctx);
    const mineCo = mine(ctx);
    const other = getCompany(ctx.db, String(args.ticker ?? ''));
    if (!alive(mineCo) || !alive(other) || other.ticker === mineCo.ticker) throw new GameError('merge.invalid', 'Both companies must be open, and different.');
    if (mergerFor(ctx.db, mineCo.ticker, ctx.now) === other.ticker) {
      const big = mergeCo(ctx.db, mineCo, other, ctx.now);
      return { embeds: [embed('market', 'Merger complete', [`The companies are now **${big.name} (${big.ticker})**, a ${levelOf(big).name}. Treasury: ${format(treasury(ctx.db, big))}.`])] };
    }
    proposeMerger(ctx.db, mineCo, other, ctx.now);
    return { content: `<@${other.owner_id}>`, embeds: [embed('market', 'Merger proposed', [`${mineCo.name} proposes to merge with ${other.name}. Its owner accepts with \`${ctx.config.prefix}merge ${mineCo.ticker}\` within 24 hours.`])] };
  }
};

