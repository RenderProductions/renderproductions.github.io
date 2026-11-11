// r!merge <ticker>: propose merging your company with another (both owners have to agree).
// The one worth more absorbs the other. See src/takeovers.js.
const config = require('../config');
const co = require('../companies');
const T = require('../takeovers');
const A = require('../achievements');
const { amt, relTime } = require('../format');

module.exports = {
  name: 'merge',
  aliases: ['merger'],
  description: 'Merge your company with another player company (both owners agree)',
  usage: '<ticker>',
  options: [{ name: 'ticker', type: 'string', description: 'The company to merge with', required: true }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const mine = co.ownedBy(ctx.db, ctx.user.id);
    if (!mine || !co.alive(mine)) return `🤝 You need a running company to merge. (\`${P}found\`)`;
    const t = String(args.ticker || '').toUpperCase();
    const other = co.get(ctx.db, t);
    if (!t) return `🤝 Usage: \`${P}merge <ticker>\`.`;
    if (!other || !co.alive(other)) return `🤝 ${t} isn't a running player company.`;
    if (other.ticker === mine.ticker) return "🤝 That's your own company.";
    if (T.bid(ctx.db, mine.ticker) || T.bid(ctx.db, other.ticker)) return '🤝 One of these companies is in the middle of a takeover fight.';

    // They already asked us: do it
    const theirs = T.proposal(ctx.db, mine.ticker);
    if (theirs && theirs.from === other.ticker && theirs.by === other.owner_id) {
      const r = T.merge(ctx.db, mine, other);
      if (r.error) return `🤝 The combined treasury (${amt(r.have)}) can't buy out the smaller company's shareholders (${amt(r.cost)}). Grow it a bit first.`;
      A.award(ctx, 'merger');
      A.award(ctx, 'merger', other.owner_id);
      try { const u = await ctx.client.users.fetch(other.owner_id); await u.send(`🤝 **${ctx.user.username} accepted.** ${r.absorbed.name} merged into **${r.survivor.name} (${r.survivor.ticker})**.`); } catch (e) { /* DMs closed */ }
      return `🤝 **Merger done!** ${r.absorbed.name} (${r.absorbed.ticker}) is now part of **${r.survivor.name} (${r.survivor.ticker})**.\n` +
        `Treasury: ${amt(r.survivor.treasury)} · Level: ${co.level(r.survivor).name}` + (r.holders ? ` · ${r.holders} shareholder${r.holders === 1 ? '' : 's'} bought out for ${amt(r.paid)}` : '') +
        `\n-# ${r.absorbed.ticker}'s employees work for ${r.survivor.ticker} now. ${r.absorbed.ticker === mine.ticker ? 'You' : other.owner_name} can found a new company.`;
    }

    T.propose(ctx.db, mine, other);
    const [big, small] = T.worth(mine) >= T.worth(other) ? [mine, other] : [other, mine];
    try { const u = await ctx.client.users.fetch(other.owner_id); await u.send(`🤝 **${ctx.user.username} wants to merge ${mine.name} (${mine.ticker}) with your ${other.name} (${other.ticker}).** ` +
      `${big.ticker} would absorb ${small.ticker}. To agree, run \`${P}merge ${mine.ticker}\` in a server with the bot (within 24 hours).`); } catch (e) { /* DMs closed */ }
    return `🤝 Merger proposed to **${other.owner_name}** (${other.ticker}). If they run \`${P}merge ${mine.ticker}\` ${relTime(Date.now() + T.RULES.mergeMs)}, it happens.\n` +
      `-# The company worth more (${big.ticker}) absorbs the other: treasuries combine, the higher level stays, ${small.ticker}'s shareholders get bought out at its price, and its employees move over.`;
  }
};
