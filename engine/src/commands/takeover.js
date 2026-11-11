// r!takeover: hostile takeovers of player companies (see src/takeovers.js)
//   r!takeover <ticker>   bid for a company you hold half the public shares of
//   r!takeover accept     (owner) take the premium and hand it over now
//   r!takeover defend     (owner) pay the poison pill and kill the bid
//   r!takeover            bids you've made, or bids on your company
const config = require('../config');
const co = require('../companies');
const T = require('../takeovers');
const A = require('../achievements');
const { amt, have, relTime } = require('../format');

async function dm(ctx, userId, text) {
  try { const u = await ctx.client.users.fetch(userId); await u.send(text); } catch (e) { /* DMs closed */ }
}

module.exports = {
  name: 'takeover',
  aliases: ['hostiletakeover', 'raid'],
  description: 'Take over a player company you hold half the public shares of',
  usage: '[<ticker> | accept | defend]',
  options: [{ name: 'action', type: 'string', description: 'A ticker to bid on, or accept / defend (owners)' }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const word = String(args.action || '').trim();
    const mine = co.ownedBy(ctx.db, ctx.user.id);
    const onMine = mine && T.bid(ctx.db, mine.ticker);

    if (!word) {
      const lines = [];
      for (const b of T.bidsBy(ctx.db, ctx.user.id)) lines.push(`🦈 Your bid for **${b.ticker}** goes through ${relTime(b.ends_at)} unless the owner fights it. Premium held: ${amt(b.premium)}.`);
      if (onMine) lines.push(`🚨 **${onMine.bidder}** is trying to take over **${mine.ticker}**! It goes through ${relTime(onMine.ends_at)}.\n\`${P}takeover defend\` costs **${amt(Math.round(T.worth(mine) * T.RULES.poisonPill))}** and kills the bid. \`${P}takeover accept\` hands it over now for **${amt(onMine.premium)}**.`);
      return {
        embeds: [{
          title: '🦈 Hostile takeovers',
          description: (lines.length ? lines.join('\n\n') + '\n\n' : '') +
            `Own **${Math.ceil(co.RULES.float * T.RULES.stake)}** of a company's ${co.RULES.float} public shares and you can bid to take it over with \`${P}takeover <ticker>\`. ` +
            `You put up a premium (${T.RULES.premium * 100}% of the company's worth). The owner has 24 hours to accept it, or fight it off with a poison pill (${T.RULES.poisonPill * 100}% of the company's worth from their own pocket). ` +
            `If they do nothing, it's yours. You can't run two companies at once.\n\n-# Friendlier? Owners can merge two companies with \`${P}merge <ticker>\`.`,
          color: 0x2b6cb0
        }]
      };
    }

    const w = word.toLowerCase();
    if (w === 'accept' || w === 'defend') {
      if (!mine) return "🦈 You don't run a company.";
      if (!onMine) return `🦈 Nobody is trying to take over ${mine.ticker}.`;
      if (w === 'accept') {
        const r = T.complete(ctx.db, onMine);
        if (!r.done) return '🦈 That bid fell through. The premium went back to the bidder.';
        A.award(ctx, 'hostile', onMine.bidder_id);
        dm(ctx, onMine.bidder_id, `🦈 **${ctx.user.username} accepted your takeover.** ${r.company.name} (${r.company.ticker}) is yours now.`);
        return `🤝 You sold **${mine.name}** to **${onMine.bidder}** for **${amt(onMine.premium)}**. You're free to found something new.`;
      }
      const r = T.defend(ctx.db, { guildId: ctx.guildId, user: ctx.user, ticker: mine.ticker });
      if (r.error === 'cash') return `🛡️ The poison pill costs **${amt(r.cost)}**. You have ${have(r.have)}.`;
      if (r.error) return '🦈 Something went wrong there.';
      A.award(ctx, 'poison_pill');
      dm(ctx, onMine.bidder_id, `🛡️ **${ctx.user.username} fought off your takeover of ${mine.ticker}** with a poison pill. Your ${amt(onMine.premium)} premium is back.`);
      return `🛡️ **Poison pill!** You paid **${amt(r.cost)}** and the takeover of ${mine.ticker} is dead. ${onMine.bidder} gets their premium back.`;
    }

    const r = T.startBid(ctx.db, { guildId: ctx.guildId, user: ctx.user, ticker: word.toUpperCase() });
    const t = word.toUpperCase();
    if (r.error === 'notpublic') return `🦈 Only listed player companies can be taken over. ${t} isn't one.`;
    if (r.error === 'own') return "🦈 That's your own company.";
    if (r.error === 'haveone') return `🦈 You already run a company. One at a time. (Try \`${P}merge ${t}\` instead.)`;
    if (r.error === 'pending') return `🦈 Someone already has a takeover bid on ${t}.`;
    if (r.error === 'onebid') return '🦈 You already have a takeover bid going.';
    if (r.error === 'stake') return `🦈 You need **${r.need}** shares of ${t} to bid (you have ${r.held}). Buy more with \`${P}buy ${t} <shares>\`.`;
    if (r.error === 'cash') return `🦈 The premium is **${amt(r.premium)}** (${T.RULES.premium * 100}% of the company's worth). You have ${have(r.have)}.`;
    const c = r.company;
    dm(ctx, c.owner_id, `🚨 **${ctx.user.username} launched a hostile takeover of ${c.name} (${c.ticker})!**\nIt goes through ${relTime(r.bid.ends_at)} unless you act:\n` +
      `• \`${P}takeover defend\`: pay **${amt(Math.round(T.worth(c) * T.RULES.poisonPill))}** and the bid is dead.\n• \`${P}takeover accept\`: take **${amt(r.bid.premium)}** and hand it over now.`);
    return `🦈 **Hostile takeover launched on ${c.name} (${c.ticker})!** You put up **${amt(r.bid.premium)}**.\n` +
      `The owner has until ${relTime(r.bid.ends_at)} to accept or fight it off. If they do nothing, the company is yours.`;
  }
};
