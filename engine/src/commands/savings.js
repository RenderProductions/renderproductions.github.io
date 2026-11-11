// r!savings: lock Polygons away for interest.
//   r!savings                         your accounts (pays out any that are done)
//   r!savings deposit <amount> <days> 3, 7 or 14 days
//   r!savings withdraw <#>            close one early (no interest)
const config = require('../config');
const A = require('../achievements');
const S = require('../savings');
const loans = require('../loans');
const reserve = require('../reserve');
const { amt, have, relTime, parsePolygons } = require('../format');

const plans = () => Object.entries(S.RULES.plans).map(([d, bp]) => `**${d} days** · ${bp / 100}%`).join('  ·  ');

function view(ctx, paid = []) {
  const P = config.prefix;
  const p = ctx.db.player(ctx.guildId, ctx.user);
  const accts = S.list(ctx.db, ctx.guildId, ctx.user.id);
  const paidLines = paid.map((r) => `✅ A ${r.days}-day account finished: **${amt(r.amount)}** back plus **${amt(r.interest)}** interest.`);
  const lines = accts.map((a) => `**#${a.id}** · ${amt(a.amount)} for ${a.days} days at ${a.rate / 100}% · pays **${amt(a.amount + S.interest(a))}** ${relTime(a.ends_at)}`);
  return {
    embeds: [{
      title: '🐖 Savings',
      description: (paidLines.length ? paidLines.join('\n') + '\n\n' : '') +
        (lines.length ? lines.join('\n') : `No savings yet. Lock some Polygons away and they come back with interest.`) +
        `\n\nPlans: ${plans()}\nYou have **${have(p.cash)}** on hand · ${amt(S.total(ctx.db, ctx.guildId, ctx.user.id))} of ${amt(S.RULES.maxTotal)} saved.` +
        reserve.note(ctx.db),
      footer: { text: `${P}savings deposit <amount> <3|7|14> · ${P}savings withdraw <#> closes one early, without interest` },
      color: 0xff9ecb
    }]
  };
}

module.exports = {
  name: 'savings',
  aliases: ['save', 'bank', 'piggybank'],
  description: 'Lock Polygons away for 3, 7 or 14 days and get them back with interest',
  usage: '[deposit <amount> <days> | withdraw <#>]',
  options: [{ name: 'action', type: 'string', description: 'deposit <amount> <3|7|14>, or withdraw <#>' }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const words = String(args.action || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const paid = S.collect(ctx.db, ctx.guildId, ctx.user.id);
    if (paid.length) A.award(ctx, 'nest_egg');
    const action = words.shift();

    if (!action || ['view', 'list', 'collect'].includes(action)) return view(ctx, paid);

    if (['deposit', 'put', 'open', 'add', 'lock'].includes(action)) {
      const usage = `🐖 Usage: \`${P}savings deposit <amount> <days>\`, like \`${P}savings deposit 1000 7\`. Plans: ${plans()}`;
      const nums = words.map((w) => w.replace(/[,⬡]/g, '').replace(/d(ays?)?$/, ''));
      const cents = nums[0] === 'all' ? ctx.db.player(ctx.guildId, ctx.user).cash : parsePolygons(nums[0]);
      const days = Number(nums[1]);
      if (cents === null || !nums[1]) return usage;
      const p = ctx.db.player(ctx.guildId, ctx.user);
      if (p.debt > 0) return `🖥️ Saving MY Polygons? Pay me back first. You owe **${amt(p.debt)}**. (\`${P}repay\`)`;
      if (loans.active(ctx.db, ctx.guildId, { borrower: ctx.user.id }).some((l) => loans.overdue(l))) return `🏦 You have an overdue loan. Pay it back first (\`${P}loans\`).`;
      const r = S.open(ctx.db, ctx.guildId, ctx.user.id, cents, days);
      if (r.error === 'plan') return `🐖 Savings come in ${Object.keys(S.RULES.plans).join(', ')} days. ${usage}`;
      if (r.error === 'min') return `🐖 The smallest deposit is ${amt(S.RULES.min)}.`;
      if (r.error === 'cash') return `🐖 You only have **${have(r.have)}**.`;
      if (r.error === 'accounts') return `🐖 You can have ${S.RULES.maxAccounts} savings accounts at once. Wait for one to finish, or close one early.`;
      if (r.error === 'max') return `🐖 You can save up to ${amt(S.RULES.maxTotal)} in this server. Room left: **${amt(Math.max(0, r.room))}**.`;
      const a = r.acct;
      return `🐖 Locked away **${amt(a.amount)}** for ${a.days} days (account **#${a.id}**). It pays **${amt(a.amount + S.interest(a))}** ${relTime(a.ends_at)}.\n` +
        `-# Need it sooner? \`${P}savings withdraw ${a.id}\` gives back what you put in, without the interest.`;
    }

    if (['withdraw', 'close', 'take', 'cancel', 'out'].includes(action)) {
      const id = Number(String(words[0] || '').replace('#', ''));
      const a = S.list(ctx.db, ctx.guildId, ctx.user.id).find((x) => x.id === id);
      if (!a) return `🐖 Which one? \`${P}savings withdraw <#>\`. See your accounts with \`${P}savings\`.`;
      const r = S.close(ctx.db, a);
      return `🐖 Closed account #${a.id} early. **${amt(r.amount)}** is back in your pocket. The ${amt(S.interest(a))} of interest is gone.`;
    }

    return view(ctx, paid);
  }
};
