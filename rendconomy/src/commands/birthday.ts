// Happy Birthday To Me!: r!birthday (the party, the cake, the time capsule) and r!yearbook (your RendConomy so far).
import { unlocked } from '../achievements/achievements';
import { getProgress } from '../achievements/achievements';
import { BIRTHDAY, YEARS, cakeOf, capsuleOf, isBotBirthday, myPieces, nextParty, onPartyShelf, openedCapsules, partyOf, sealCapsule } from '../birthday/birthday';
import { GameError } from '../core/errors';
import { format } from '../core/money';
import { emojiOr } from '../discord/emoji';
import { embed } from '../discord/style';
import { SPECIES, fmtLb } from '../fishing/fishing';
import { PARTY_ITEMS } from '../shop/items';
import { me } from './shared';
import type { Command, Ctx } from './types';

const bar = (have: number, target: number, width = 12): string => {
  const n = Math.max(0, Math.min(width, Math.round((have / Math.max(1, target)) * width)));
  return '🟪'.repeat(n) + '⬛'.repeat(width - n);
};
const dateText = (at: number): string => `<t:${Math.floor(at / 1000)}:D>`;

function noParty(ctx: Ctx): GameError {
  const n = nextParty(ctx.now);
  return new GameError('birthday.off', `No birthday party right now. The next one is **${n.kind === 'bot' ? BIRTHDAY.bot.name : BIRTHDAY.dev.name}**, starting **${n.at}**. 🎂`);
}

export const birthday: Command = {
  name: 'birthday', aliases: ['bday', 'party', 'cake'], description: 'The birthday party: your server\'s cake, the Party shelf, and the time capsule', system: 'social', guildOnly: true,
  options: [
    { name: 'action', type: 'string', description: 'Blank for the party, or: capsule' },
    { name: 'text', type: 'string', description: 'For capsule: your line for next year (140 characters)' }
  ],
  run(ctx, args) {
    const p = partyOf(ctx.now);
    if (!p) throw noParty(ctx);
    const { guildId } = me(ctx);
    const P = ctx.config.prefix;
    const word = String(args.action ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
    const rest = [String(args.action ?? '').trim().split(/\s+/).slice(1).join(' '), String(args.text ?? '')].join(' ').trim();

    if (word === 'capsule' || word === 'timecapsule') {
      if (p.kind !== 'bot') throw new GameError('birthday.capsule', 'The time capsule opens on RendConomy\'s own birthday, November 9 to 15.');
      const lastYear = openedCapsules(ctx.db, guildId, p.year - 1);
      if (rest) {
        const text = rest.replace(/[`*_~|<>@]/g, '').replace(/\s+/g, ' ').trim().slice(0, BIRTHDAY.capsuleMax);
        if (!text) throw new GameError('birthday.capsule', 'Write something to seal in it.');
        ctx.db.tx(() => sealCapsule(ctx.db, guildId, ctx.user.id, text, ctx.now));
        return { embeds: [embed('social', '🕰️ Time capsule', [`Sealed: *"${text}"*`, '', `It opens at RendConomy's next birthday, with your name on it. You can rewrite it until November ${p.to}.`])] };
      }
      const mine = capsuleOf(ctx.db, guildId, ctx.user.id, p.year);
      return { embeds: [embed('social', '🕰️ Time capsule', [
        lastYear.length ? `**Opened today, from last year (${lastYear.length}):**` : 'Nothing was sealed here last year. This year\'s will be the first.',
        ...lastYear.slice(0, 15).map((c) => `> *"${c.text}"* · <@${c.user_id}>`),
        lastYear.length > 15 ? `-# …and ${lastYear.length - 15} more.` : null,
        '', mine ? `Yours for next year: *"${mine.text}"*` : `Seal a line for next year (up to ${BIRTHDAY.capsuleMax} characters): \`${P}birthday capsule <your line>\``
      ])] };
    }

    const cake = cakeOf(ctx.db, guildId, p, ctx.now);
    const mine = myPieces(ctx.db, guildId, ctx.user.id, p);
    const shelf = Object.values(PARTY_ITEMS).filter((i) => onPartyShelf(i.id, ctx.now)).map((i) => `${emojiOr(i.id, i.emoji)} ${i.name}`).join(' · ');
    const end = `${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][p.month]} ${p.to}`;
    return { embeds: [embed('social', `${p.emoji} ${p.name}`, [
      p.kind === 'bot' ? `RendConomy is **${p.age}**! Birthday Week runs until **${end}**.` : `It's the developer's birthday, and everyone's invited. The party runs until **${end}**.`,
      p.bash ? `🎉 **Birthday Bash today:** chat pay x${BIRTHDAY.bashChat}, and a **${format(BIRTHDAY.bashDaily)}** bonus on every daily.` : null,
      '',
      `**🎂 This server's cake:** ${cake.done ? 'done! The candles are out.' : `${cake.have} / ${cake.target} pieces`}`,
      bar(cake.have, cake.target),
      cake.done ? `${cake.helpers} people helped, and every one of them got ${format(BIRTHDAY.cakeReward[p.kind])}.`
        : `Every shift, gig, catch and harvest adds a piece. When it's full, everyone who helped gets **${format(BIRTHDAY.cakeReward[p.kind])}**. You've added **${mine}**.`,
      '',
      `**🎉 At the party:** Marquez's Party shelf (${shelf}), 🎂 on the Slots reels (and ${format(BIRTHDAY.jackpotTopUp[p.kind])} more in the jackpot), Chuck's 🎉 Party Fish in any water, and TODD with birthday questions.`,
      p.kind === 'bot' ? `\n🕰️ The time capsule is open: \`${P}birthday capsule\` · 📖 Your year: \`${P}yearbook\`` : null,
      `-# Party Animal: eat a Cake Slice, win a TODD drop-in and land a Party Fish before the party ends.`
    ])] };
  }
};

export const yearbook: Command = {
  name: 'yearbook', aliases: ['wrapped', 'myyear'], description: 'Your RendConomy so far (RendConomy\'s birthday week)', system: 'social', guildOnly: true,
  run(ctx) {
    if (!isBotBirthday(ctx.now)) {
      const n = nextParty(ctx.now);
      throw new GameError('birthday.yearbook', `The yearbook comes out on RendConomy's birthday, November 9 to 15.${n.kind === 'bot' ? ` See you on ${n.at}!` : ''}`);
    }
    me(ctx);
    const u = ctx.user.id, p = partyOf(ctx.now)!;
    const first = ctx.db.get<{ at: number | null }>('SELECT MIN(joined_at) AS at FROM players WHERE user_id = ?', u)!.at;
    const days = ctx.db.get<{ n: number }>('SELECT COUNT(DISTINCT day) AS n FROM activity WHERE user_id = ?', u)!.n;
    const all = unlocked(ctx.db, u), year = all.filter((a) => a.unlocked_at > ctx.now - 365 * 86_400_000).length;
    const win = ctx.db.get<{ c: number | null }>("SELECT MAX(cents) AS c FROM ledger WHERE to_id LIKE ? AND reason IN ('casino.win', 'casino.jackpot')", `wallet:%:${u}`)!.c ?? 0;
    const payday = ctx.db.get<{ c: number | null }>("SELECT MAX(cents) AS c FROM ledger WHERE to_id LIKE ? AND reason LIKE 'work.%'", `wallet:%:${u}`)!.c ?? 0;
    const dex = ctx.db.all<{ species: string; best_lb: number; caught: number }>('SELECT species, MAX(best_lb) AS best_lb, SUM(caught) AS caught FROM fishdex WHERE user_id = ? GROUP BY species', u);
    const best = dex.filter((d) => SPECIES[d.species]).sort((a, b) => (SPECIES[b.species]!.size - SPECIES[a.species]!.size) || (SPECIES[b.species]!.value - SPECIES[a.species]!.value))[0];
    const fish = getProgress(ctx.db, u, 'fish_caught'), harvests = getProgress(ctx.db, u, 'harvests'), drops = getProgress(ctx.db, u, 'dropins_won');
    const years = Array.from({ length: YEARS }, (_, i) => i + 1).filter((n) => all.some((a) => a.id === `year_${n}`)).length;
    return { embeds: [embed('social', `📖 ${ctx.user.name}'s RendConomy yearbook · Year ${p.age}`, [
      first ? `🗓️ **First day:** ${dateText(first)}` : null,
      `📅 **Days played:** ${days}`,
      `🏆 **Achievements:** ${all.length}${year ? ` (${year} in the last year)` : ''}`,
      win ? `🎰 **Biggest Rend-Sino win:** ${format(win)}` : '🎰 **Biggest Rend-Sino win:** still waiting on that one',
      payday ? `💼 **Best payday:** ${format(payday)}` : null,
      best ? `🎣 **Best catch:** ${SPECIES[best.species]!.emoji} ${SPECIES[best.species]!.name} (${fmtLb(best.best_lb)}) · ${fish} fish caught` : fish ? `🎣 **Fish caught:** ${fish}` : null,
      harvests ? `🌾 **Crops harvested:** ${harvests}` : null,
      drops ? `📟 **TODD drop-ins won:** ${drops}` : null,
      years > 1 ? `🎂 **Birthdays:** ${years}` : null,
      '', `-# Happy birthday, RendConomy. Here's to year ${p.age + 1}.`
    ])] };
  }
};

export const birthdayCommands = [birthday, yearbook];
