const config = require('../config');
const { money, have, amt } = require('../format');
const econ = require('../economy');
const loans = require('../loans');
const reserve = require('../reserve');

// What r!balance shows when you look up the bot itself
function housePortfolio(bot, m, ctx) {
  const INF = '∞';
  return {
    embeds: [{
      title: `${bot.username}'s portfolio`,
      description: `🏷️ *The House*\nPolygons: **${have(reserve.get(ctx.db))}** (the Polygon Reserve)\nStocks: **⬢ ${INF}**\nNet worth: **⬢ ${INF}** (probably)\n\n` +
        `*The house always wins. Until it runs out.* See \`${config.prefix}reserve\`.`,
      fields: m.companies.map((c) => {
        const q = ctx.market.quote(m, c.id);
        return { name: `${q.name} (${q.id})`, value: `${INF} shares, worth ⬢ ${INF}` };
      }),
      color: config.color
    }]
  };
}

module.exports = {
  name: 'balance',
  aliases: ['bal', 'portfolio', 'pf'],
  description: 'Show cash, shares, debt, and net worth',
  usage: '[@user]',
  options: [
    { name: 'user', type: 'user', description: 'Whose portfolio to show (default: yours)' }
  ],

  async run(ctx, args) {
    const target = args.user || ctx.user;
    const m = await ctx.market.get();
    if (!m) return 'The market is offline right now. Try again in a minute.';

    // Easter egg: the bot is the house. Its Polygons are the Polygon Reserve; its shares are endless
    const botId = (ctx.client && ctx.client.user && ctx.client.user.id) || config.clientId;
    if (target.id === botId) return housePortfolio(target, m, ctx);
    if (target.bot) return `🤖 **${target.username}** is a bot. Bots don't play the market. (Well. Most of them.)`;

    const p = ctx.db.player(ctx.guildId, target);
    let stocks = 0;
    const fields = m.companies.map((c) => {
      const q = ctx.market.quote(m, c.id);
      const owned = econ.shares(ctx, m, c.id, target.id);
      const value = owned * q.priceCents;
      stocks += value;
      return { name: `${q.name} (${q.id})`, value: `${owned} shares, worth ${have(value)}` };
    });

    const pcv = econ.playerCompanyValue(ctx, target.id);
    stocks += pcv.total;
    for (const r of pcv.rows) fields.push({ name: `🏢 ${r.name} (${r.ticker})`, value: `${r.shares} shares, worth ${have(r.value)}` });

    const titleLine = p.title ? `🏷️ *${p.title}*\n` : '';
    const owedLoans = loans.totalOwed(ctx.db, ctx.guildId, target.id);
    const lentLoans = loans.totalLent(ctx.db, ctx.guildId, target.id);
    if (target.id === ctx.user.id && p.cash + stocks + require('../savings').total(ctx.db, ctx.guildId, target.id) - p.debt - owedLoans + lentLoans >= 1_000_000_00) require('../achievements').award(ctx, 'millionaire');
    const debtLine = (p.debt > 0 ? `\n🖥️ Owed to TODD: **${amt(p.debt)}**` : '') +
      (owedLoans > 0 ? `\n🏦 Owed to players: **${amt(owedLoans)}**` : '') +
      (lentLoans > 0 ? `\n🏦 Lent out: **${have(lentLoans)}**` : '');
    const saved = require('../savings').total(ctx.db, ctx.guildId, target.id);
    const shorted = require('../shorts').value(ctx.db, ctx.guildId, target.id, m, ctx.market.quote);
    const savedLine = (saved > 0 ? `\n🐖 In savings: **${have(saved)}**` : '') + (require('../shorts').list(ctx.db, ctx.guildId, target.id).length ? `\n🐻 Shorts: **${have(shorted)}**` : '');
    const chat = require('../chatter');
    const chatLine = target.id === ctx.user.id ? `\n-# 💬 Chat pay today: ${amt(chat.chatToday(ctx.db, ctx.guildId, target.id))} / ${amt(chat.RULES.chat.perDay)}` : '';

    return {
      embeds: [{
        title: `${target.username}'s portfolio`,
        description: `${titleLine}Polygons: **${have(p.cash)}**\nStocks: **${have(stocks)}**${savedLine}${debtLine}\n` +
          `Net worth: **${have(p.cash + stocks + saved + shorted - p.debt - owedLoans + lentLoans)}**${chatLine}`,
        fields,
        footer: { text: 'Prices as of' },
        timestamp: m.updated,
        color: config.color
      }]
    };
  }
};
