const config = require('../config');

module.exports = {
  name: 'help',
  description: 'List the bot commands',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const m = await ctx.market.get();
    return {
      embeds: [{
        title: 'Rend-Conomy',
        description: 'A fictional stock market. Prices change every few minutes, and everything here is fake money. ' +
          'Trading is open 3 AM to 9 PM Eastern, every day.\n\n' +
          '**Market**\n' +
          `\`${P}market\` shows current prices\n` +
          `\`${P}buy <ticker> <amount>\` buys shares\n` +
          `\`${P}sell <ticker> <amount or all>\` sells shares\n` +
          `\`${P}chart <ticker>\` shows a price chart\n` +
          `\`${P}compare <ticker> <ticker>\` compares two companies\n` +
          `\`${P}balance\` shows your cash, shares, and net worth\n` +
          `\`${P}daily\` gives free Polygons once a day (resets at midnight Eastern)\n` +
          `\`${P}reserve\` shows how many Polygons the house has left\n` +
          `\`${P}dividends\` collects what your shares have earned\n\n` +
          '**Jobs**\n' +
          `\`${P}apply <ticker>\` joins a company as an Intern\n` +
          `\`${P}work\` starts a shift (every 15 minutes)\n` +
          `\`${P}quit\` leaves your job (24h after hiring, resets your rank)\n\n` +
          '**Shop**\n' +
          `\`${P}shop\` shows items, stock, and the next restock\n` +
          `\`${P}purchase <item>\` buys coffee, overtime, mystery, resume, or title into your inventory\n` +
          `\`${P}inventory\` shows the items you own\n` +
          `\`${P}use <item>\` uses an item from your inventory\n` +
          `\`${P}settitle <text>\` sets your custom title (uses a Title)\n` +
          `\`${P}slots <amount>\` spins the Rend-Sino slot machine\n\n` +
          '**Your own company**\n' +
          `\`${P}found <ticker> <name>\` starts a company (⬡ 2,500, needs mod approval)\n` +
          `\`${P}company [ticker]\` shows a company · \`${P}exchange\` lists them all\n` +
          `\`${P}invest <amount>\` · \`${P}upgrade\` · \`${P}ipo\` · \`${P}salary <amount>\` run your company\n` +
          'Anyone can `buy`, `sell`, and `apply` to public player companies.\n\n' +
          '**Loans between players**\n' +
          `\`${P}loan @player <amount> <interest>\` asks someone for a loan (interest is % a day)\n` +
          `\`${P}payback @player <amount or all>\` · \`${P}loans\` · \`${P}forgive @player\` lets someone off\n\n` +
          '**TODD**\n' +
          `\`${P}bailout\` borrow ⬡ 500 when you're broke (you owe ⬡ 600)\n` +
          `\`${P}repay <amount or all>\` pay TODD back\n\n` +
          `🧾 Receipts for trades, purchases and loans go to your DMs. \`${P}receipts off\` to stop them.\n\n` +
          '**Mods**\n' +
          `\`${P}cleartitle @user\` removes someone's custom title\n` +
          `\`${P}review\` · \`${P}approve <ticker>\` · \`${P}reject <ticker> [reason]\` new companies\n\n` +
          `Tickers: ${ctx.market.tickerList(m)}\n` +
          `Live board: ${config.siteUrl}/rend-conomy/\nFull guide: ${config.siteUrl}/bot/`,
        footer: { text: 'Every command also works as a slash command, like /market.' },
        color: config.color
      }]
    };
  }
};
