// Under New Management: r!mayor, r!vote, r!impeach and r!city. See src/city/city.ts for the rules.
import { award } from '../achievements/achievements';
import {
  CITY, appoint, block, bailout, build, candidatesOf, cannotRun, cityBalance, countElections, decree, ensureCity, fine, freeze, impeach,
  impeachState, investigate, mayor, recentLog, run as runFor, setCollect, setTax, vote as castVote, withdraw, workCost
} from '../city/city';
import { closesAt, phaseOf, policyOf, votingOpensAt, worksNow, type Decree, type WorkEffect } from '../city/state';
import { GameError } from '../core/errors';
import { format, parseAmount } from '../core/money';
import { discordTime } from '../core/time';
import { emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { me } from './shared';
import type { Command, Ctx, ReplyObject } from './types';

const pct = (r: number) => `${+(r * 100).toFixed(2)}%`;
const mention = (s: string | undefined): string | null => /^<@!?(\d+)>$/.exec(s ?? '')?.[1] ?? (/^\d{15,22}$/.test(s ?? '') ? s! : null);
const hall = (ctx: Ctx, title: string, lines: (string | null | false | undefined)[]): ReplyObject => ({ embeds: [embed('property', `${emojiOr('city_hall', '🏛️')} ${title}`, lines.filter((l) => l !== null && l !== false && l !== undefined) as string[])] });

/** City Hall at a glance: the mayor, the treasury, taxes, works, the race, the record. */
function overview(ctx: Ctx, g: string): ReplyObject {
  const P = ctx.config.prefix;
  const t = mayor(ctx.db, g, ctx.now);
  const p = policyOf(ctx.db, g, ctx.now);
  const { week, phase } = phaseOf(ctx.now);
  const race = candidatesOf(ctx.db, g, week);
  const works = worksNow(ctx.db, g, ctx.now);
  const imp = impeachState(ctx.db, g, ctx.now);
  return hall(ctx, 'City Hall', [
    t ? `**Mayor:** <@${t.user_id}> (${t.votes} of ${t.total} votes), until ${discordTime(t.ends_at)}.` : '**Mayor:** nobody this week. The seat is empty until the next election.',
    t && (p.treasurer || p.chief) ? `**Appointed:** ${[p.treasurer ? `Treasurer <@${p.treasurer}>` : null, p.chief ? `Police Chief <@${p.chief}>` : null].filter(Boolean).join(' · ')}` : null,
    `**City treasury:** ${format(cityBalance(ctx.db, g))}`,
    `**Taxes:** shop ${pct(p.shop)} · property ${pct(p.property)} · casino winnings ${pct(p.casino)}${p.pending.length ? ` (from midnight: ${p.pending.map((c) => `${c.key} ${pct(c.rate)}`).join(', ')})` : ''}`,
    `**Collections:** ${pct(p.collectFee)} fee, ${p.graceDays} days' grace.`,
    works.length ? `**Public works:** ${works.map((w) => `"${w.name}" (${w.effect === 'happyhour' ? 'Happy Hour' : `+${Math.round(w.size * 100)}% ${CITY.works[w.effect].label}`}, until ${discordTime(w.ends_at, 'R')})`).join(' · ')}` : null,
    imp?.open ? `⚠️ **Impeachment vote open:** ${imp.yes} of ${imp.need} needed, until ${discordTime(imp.until, 'R')}. \`${P}impeach\` to add yours.` : null,
    '',
    phase === 'voting'
      ? `${emojiOr('ballot', '🗳️')} **Voting is open** until ${discordTime(closesAt(week))}: ${race.length ? race.map((c) => `<@${c.user_id}> (${c.votes})`).join(', ') : 'nobody is running'}. \`${P}vote @player\``
      : `📝 **Nominations are open** until ${discordTime(votingOpensAt(week))}${race.length ? `: ${race.map((c) => `<@${c.user_id}>`).join(', ')}` : ''}. Active players can run: \`${P}mayor run [slogan]\``,
    '',
    ...recentLog(ctx.db, g, 5).map((r) => `-# ${discordTime(r.at, 'R')} · ${r.detail}`),
    `-# \`${P}mayor help\` lists the mayor's powers · \`${P}mayor log\` is the full public record`
  ]);
}

const HELP = (P: string): string[] => [
  '**Business** (no conflicts of interest):',
  `\`${P}mayor block <TICKER> <reason>\`: call off a takeover bid (refunded) or merger`,
  `\`${P}mayor freeze <TICKER> <reason>\`: no trading in its shares for 24h (${CITY.freeze.perTerm} a term)`,
  `\`${P}mayor investigate @player <reason>\`: their player-company trades go on the public record for 7 days`,
  `\`${P}mayor fine <TICKER|@player> <amount> <reason>\`: up to ${CITY.fine.share * 100}% of the treasury or wallet, at most ${format(CITY.fine.max)} (${CITY.fine.perTerm} a term)`,
  `\`${P}mayor bailout <TICKER> <amount> <reason>\`: a grant from the city treasury`,
  '**Money:**',
  `\`${P}mayor tax <shop|property|casino> <percent>\`: shop 0–${CITY.taxMax.shop * 100}%, property 0–${CITY.taxMax.property * 100}%, casino winnings 0–${CITY.taxMax.casino * 100}% (from midnight)`,
  `\`${P}mayor collect fee <percent>\` or \`grace <days>\`: Collect Call, ${CITY.collect.fee[0] * 100}–${CITY.collect.fee[1] * 100}% and ${CITY.collect.graceDays[0]}–${CITY.collect.graceDays[1]} days`,
  `\`${P}mayor build <effect> <size> <days> <name>\`: a public work from the city treasury. Effects: rent 5–20, chat 25–100, shifts 5–15, crops 5–20 (%), or \`happyhour <hours> <name>\` (1–6). \`${P}mayor quote <effect> <size> <days>\` prices it.`,
  '**Everything else:**',
  `\`${P}mayor decree [${Object.keys(CITY.decrees).join('|')}] <text>\`: a decree for the record; with an effect, one a day`,
  `\`${P}mayor appoint <treasurer|chief> @player\` (or \`none\`): the Treasurer funds works and bailouts; the Police Chief investigates and freezes`,
  '',
  '-# The mayor can never pay themselves from the city treasury. Everything goes on the public record, and players can impeach.'
];

export const mayorCmd: Command = {
  name: 'mayor', aliases: ['cityhall', 'townhall'], description: 'City Hall: the mayor, the election, and the mayor\'s powers', system: 'property', guildOnly: true,
  options: [
    { name: 'action', type: 'string', description: 'Blank for City Hall, or: vote, impeach, race, run, help, log, block, freeze, fine, tax, build, decree…' },
    { name: 'details', type: 'string', description: 'The rest: a ticker or @player, an amount, a reason, a name' }
  ],
  run(ctx, args) {
    const { guildId: g } = me(ctx);
    const P = ctx.config.prefix;
    ensureCity(ctx.db, g, ctx.now);
    countElections(ctx.db, g, ctx.now);
    const action = String(args.action ?? '').trim().toLowerCase();
    const rest = String(args.details ?? '').trim();
    const words = rest.split(/\s+/).filter(Boolean);
    const after = (n: number) => words.slice(n).join(' ');
    return ctx.db.tx(() => {
      switch (action) {
        case '': case 'status': case 'hall': return overview(ctx, g);
        case 'help': case 'powers': return hall(ctx, 'The mayor\'s powers', HELP(P));
        case 'log': case 'record': return hall(ctx, 'The public record', recentLog(ctx.db, g, 20).map((r) => `${discordTime(r.at, 'R')} · ${r.detail}${r.cents ? ` (${format(r.cents)})` : ''}`).concat(recentLog(ctx.db, g, 1).length ? [] : ['Nothing yet.']));
        case 'race': case 'ballot': case 'candidates': {
          const { week, phase } = phaseOf(ctx.now);
          const cs = candidatesOf(ctx.db, g, week);
          return hall(ctx, 'The race', [
            phase === 'voting' ? `Voting closes ${discordTime(closesAt(week))}. \`${P}vote @player\`` : `Nominations close ${discordTime(votingOpensAt(week))}; voting runs until ${discordTime(closesAt(week))}.`,
            '',
            ...(cs.length ? cs.map((c, i) => `${i + 1}. <@${c.user_id}>${phase === 'voting' ? ` · **${c.votes}** vote${c.votes === 1 ? '' : 's'}` : ''}${c.slogan ? ` · *"${c.slogan}"*` : ''}`) : ['Nobody is running yet.']),
            '', `-# Candidates need ${CITY.run.activeDays} active days in the last 7 and an account ${CITY.run.accountAgeMs / 86_400_000}+ days old. Two terms in a row, then sit one out.`
          ]);
        }
        case 'run': case 'campaign': {
          const r = runFor(ctx.db, g, ctx.user.id, rest || null, ctx.now);
          return hall(ctx, 'You\'re on the ballot', [`<@${ctx.user.id}> is running for mayor${rest ? `: *"${rest.slice(0, CITY.run.sloganMax)}"*` : ''}.`, `Voting opens ${discordTime(votingOpensAt(r.week))} and closes ${discordTime(closesAt(r.week))}. Tell people to \`${P}vote @${ctx.user.name}\`.`]);
        }
        case 'eligible': case 'canirun': {
          const why = cannotRun(ctx.db, g, ctx.user.id, ctx.now);
          return hall(ctx, 'Can you run?', [why ?? `Yes. \`${P}mayor run [slogan]\` while nominations are open.`]);
        }
        case 'withdraw': case 'dropout': withdraw(ctx.db, g, ctx.user.id, ctx.now); return hall(ctx, 'Out of the race', ['You withdrew. Any votes for you are gone.']);
        case 'block': return done(ctx, `Blocked: ${block(ctx.db, g, ctx.user.id, words[0] ?? '', after(1), ctx.now) === 'takeover' ? 'the takeover bid is off and refunded' : 'the merger is off'}.`);
        case 'freeze': return done(ctx, `${(words[0] ?? '').toUpperCase()} can't be traded until ${discordTime(freeze(ctx.db, g, ctx.user.id, words[0] ?? '', after(1), ctx.now))}.`);
        case 'investigate': {
          const who = mention(words[0]);
          if (!who) throw new GameError('city.who', `Who? \`${P}mayor investigate @player <reason>\``);
          return done(ctx, `<@${who}>'s trades in player companies go on the public record until ${discordTime(investigate(ctx.db, g, ctx.user.id, who, after(1), ctx.now))}.`);
        }
        case 'fine': {
          const who = mention(words[0]);
          const cents = parseAmount(words[1]);
          const r = fine(ctx.db, g, ctx.user.id, who ? { userId: who } : { ticker: words[0] ?? '' }, cents, after(2), ctx.now);
          return done(ctx, `Fined ${r.who} **${format(r.cents)}**, into the city treasury.`);
        }
        case 'bailout': case 'grant': {
          const cents = parseAmount(words[1]);
          const c = bailout(ctx.db, g, ctx.user.id, words[0] ?? '', cents, after(2), ctx.now);
          return done(ctx, `**${format(cents)}** from the city treasury into ${c.name}'s.`);
        }
        case 'tax': {
          const key = (words[0] ?? '').toLowerCase().replace(/winnings$/, '') as 'shop' | 'property' | 'casino';
          if (!['shop', 'property', 'casino'].includes(key)) throw new GameError('city.tax', `\`${P}mayor tax <shop|property|casino> <percent>\``);
          const rate = Number(String(words[1] ?? '').replace('%', '')) / 100;
          if (!Number.isFinite(rate)) throw new GameError('city.tax', 'Give the rate as a percent, like 5.');
          const r = setTax(ctx.db, g, ctx.user.id, key, rate, ctx.now);
          return done(ctx, `The ${key} tax will be **${pct(r.rate)}** from ${discordTime(r.from)}.`);
        }
        case 'collect': case 'collections': {
          const k = (words[0] ?? '').toLowerCase(), v = Number(String(words[1] ?? '').replace('%', ''));
          if (k !== 'fee' && k !== 'grace') throw new GameError('city.collect', `\`${P}mayor collect fee <percent>\` or \`${P}mayor collect grace <days>\``);
          const p = setCollect(ctx.db, g, ctx.user.id, k === 'fee' ? v / 100 : null, k === 'grace' ? v : null, ctx.now);
          return done(ctx, `Collections now: a **${pct(p.collectFee)}** fee and **${p.graceDays} days'** grace.`);
        }
        case 'quote': case 'build': case 'fund': {
          const effect = (words[0] ?? '').toLowerCase().replace(/^happy$/, 'happyhour') as WorkEffect;
          const w = CITY.works[effect];
          if (!w) throw new GameError('city.work', `Effects: ${Object.keys(CITY.works).join(', ')}. \`${P}mayor build rent 10 3 Main Street Repaving\``);
          const size = w.unit === 'h' ? Number(words[1]) : Number(words[1]) / 100;
          const days = w.unit === 'h' ? 0 : Number(words[2]);
          const name = after(w.unit === 'h' ? 2 : 3);
          if (action === 'quote') return hall(ctx, 'A quote from the contractor', [`${w.unit === 'h' ? `${size}h of Happy Hour` : `+${Math.round(size * 100)}% ${w.label} for ${days} days`}: **${format(workCost(ctx.db, g, effect, size, days, ctx.now))}**. The city treasury has ${format(cityBalance(ctx.db, g))}.`]);
          const r = build(ctx.db, g, ctx.user.id, effect, size, days, name, ctx.now);
          return done(ctx, `🏗️ **"${name.trim()}"** is funded for **${format(r.cost)}**: ${w.unit === 'h' ? `Happy Hour for ${size}h` : `+${Math.round(size * 100)}% ${w.label}`} until ${discordTime(r.ends)}.`);
        }
        case 'decree': case 'declare': {
          const maybe = (words[0] ?? '').toLowerCase() as Decree;
          const effect = CITY.decrees[maybe] ? maybe : null;
          const text = effect ? after(1) : rest;
          const r = decree(ctx.db, g, ctx.user.id, effect, text, ctx.now);
          return hall(ctx, '📜 By order of the mayor', [effect ? `**${CITY.decrees[effect].label}**${r.until ? `, until ${discordTime(r.until)}` : ''}.` : null, text ? `*"${text.slice(0, 300)}"*` : null, `-# <@${ctx.user.id}>`]);
        }
        case 'appoint': case 'fire': {
          const role = (words[0] ?? '').toLowerCase().replace(/^police$/, 'chief') as 'treasurer' | 'chief';
          if (role !== 'treasurer' && role !== 'chief') throw new GameError('city.appoint', `\`${P}mayor appoint <treasurer|chief> @player\` (or \`none\`)`);
          const who = (words[1] ?? '').toLowerCase() === 'none' || action === 'fire' ? null : mention(words[1]);
          if (who === null && action !== 'fire' && (words[1] ?? '').toLowerCase() !== 'none') throw new GameError('city.who', 'Who? Mention them.');
          appoint(ctx.db, g, ctx.user.id, role, who, ctx.now);
          return done(ctx, who ? `<@${who}> is the new ${role === 'treasurer' ? 'Treasurer' : 'Police Chief'}.` : `The ${role === 'treasurer' ? 'Treasurer' : 'Police Chief'} post is empty.`);
        }
        default: throw new GameError('city.action', `Try \`${P}mayor\`, \`${P}mayor race\`, \`${P}mayor run\`, or \`${P}mayor help\` for the mayor's powers.`);
      }
    });
  }
};
const done = (ctx: Ctx, text: string): ReplyObject => hall(ctx, 'City Hall', [text, '-# On the public record: `mayor log`.']);

export const vote: Command = {
  name: 'vote', aliases: ['ballot'], description: 'Vote for mayor (Friday to Sunday 9 PM Eastern)', system: 'property', guildOnly: true,
  options: [{ name: 'candidate', type: 'user', description: 'Who you\'re voting for', required: true }],
  run(ctx, args) {
    const { guildId: g } = me(ctx);
    const who = String(args.candidate ?? '');
    const r = castVote(ctx.db, g, ctx.user.id, who, ctx.now);
    award(ctx.db, g, ctx.user.id, 'i_voted', ctx.now);
    return { embeds: [embed('property', `${emojiOr('ballot', '🗳️')} Vote cast`, [`${r.changed ? 'You changed your vote to' : 'You voted for'} <@${who}>. You can change it until ${discordTime(closesAt(r.week))}.`])], ephemeral: true };
  }
};

export const impeachCmd: Command = {
  name: 'impeach', description: 'Call or join a 24-hour vote to remove the mayor', system: 'property', guildOnly: true,
  run(ctx) {
    const { guildId: g } = me(ctx);
    const r = impeach(ctx.db, g, ctx.user.id, ctx.now);
    if (r.removed) return { embeds: [embed('property', '🏛️ Impeached!', [`That makes ${r.yes}. The mayor is out. Their taxes and decrees end now, and the seat is empty until the next election.`])] };
    return { embeds: [embed('property', '🏛️ Impeachment', [`${r.opened ? 'You called a vote to impeach the mayor.' : 'You voted to impeach.'} **${r.yes}** of **${r.need}** votes needed in 24 hours. \`${ctx.config.prefix}impeach\` to join.`])] };
  }
};

