const config = require('../config');
const co = require('../companies');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'found',
  description: 'Start your own company (⬡ 2,500, needs mod approval)',
  usage: '<ticker> <name>',
  options: [
    { name: 'ticker', type: 'string', description: '2 to 5 letters, like MEOW', required: true },
    { name: 'name', type: 'string', description: 'Company name, 3 to 32 characters', required: true }
  ],

  async run(ctx, args) {
    const P = config.prefix;
    const ticker = String(args.ticker || '').toUpperCase();
    const name = co.cleanName(args.name);
    const cost = co.LEVELS[0].cost;
    if (!ticker || !args.name) return `🏢 Usage: \`${P}found <ticker> <name>\`, for example \`${P}found MEOW Meow Industries\`. Costs ${amt(cost)}.`;

    const p = ctx.db.player(ctx.guildId, ctx.user);
    if (p.debt > 0) return `🖥️ Start a COMPANY?! With MY money?! Pay me back first. (\`${P}repay\`)`;
    const mine = co.ownedBy(ctx.db, ctx.user.id);
    if (mine) return `🏢 You already run **${mine.name}** (${mine.ticker}). One company at a time.`;

    const m = await ctx.market.get();
    const problem = co.checkNew(ctx.db, ticker, name, ctx.market.ids(m));
    if (problem) return `🏢 ${problem}`;
    if (p.cash < cost) return `🏢 Founding a company costs **${amt(cost)}**. You have ${have(p.cash)}.`;

    ctx.db.tx(() => {
      ctx.db.addCash(ctx.guildId, ctx.user.id, -cost);
      co.found(ctx.db, { ticker, name, owner: ctx.user, guildId: ctx.guildId });
    });

    // Let the bot owner know there's something to review
    if (config.ownerId && ctx.client) {
      ctx.client.users.fetch(config.ownerId)
        .then((u) => u.send(`🏢 New company waiting for approval: **${name}** (${ticker}) by ${ctx.user.username}. Use \`${P}review\`.`))
        .catch(() => {});
    }

    return `🏢 **${name}** (${ticker}) is filed! ${amt(cost)} is held while a mod reviews the name.\n` +
      "If it's approved, that money becomes your company's treasury. If it's rejected, you get it all back.";
  }
};
