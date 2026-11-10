const config = require('../config');
const reserve = require('../reserve');
const { money, have, amt } = require('../format');
const econ = require('../economy');

const LOAN = 500_00;       // what TODD gives you
const OWED = 600_00;       // what you owe him (20% fee)
const BROKE_BELOW = 100_00; // net worth must be under this

module.exports = {
  name: 'bailout',
  description: "Borrow ⬡ 500 from TODD when you're broke (you owe ⬡ 600)",
  options: [],

  async run(ctx) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt > 0) {
      return `🖥️ **MORE?!?** You STiLL owe ME **${amt(p.debt)}**! PAY UP first?! (\`${config.prefix}repay\`)`;
    }

    const m = await ctx.market.get();
    if (!m) return "⚠️ Couldn't reach the market data. Try again in a minute.";
    const worth = econ.worth(ctx, m, p);
    if (worth >= BROKE_BELOW) {
      return `🖥️ You're NOT broke?!? You're worth **${have(worth)}**! TODD is NOT a CHARITY!!`;
    }

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, LOAN);
      reserve.spend(ctx.db, LOAN);
      ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { debt: OWED });
    });

    return {
      embeds: [{
        title: '🖥️ TODD LOANS',
        description: "OH?! BROKE?? DoN'T worry, TODD's GOT you!!!\n\n" +
          `**+${amt(LOAN)}**, all YOURS?!\nYou now owe TODD **${amt(OWED)}**.\n\n` +
          "I'LL rememBER this. I remember EVERYTHING. (mostly.)\n\n" +
          `Pay it back with \`${config.prefix}repay <amount>\` or \`${config.prefix}repay all\`. No GAMBLING with MY money until then!!`,
        color: config.colorTodd
      }]
    };
  }
};
