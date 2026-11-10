// r!help: every command, one page per topic. Buttons switch pages; r!help <topic> jumps straight there.
const config = require('../config');
const { button, rows } = require('../buttons');

const PAGES = {
  market: { label: 'Market', emoji: '📈', title: '📈 Market', body: (P) => [
    `\`${P}market\` shows current prices`,
    `\`${P}buy <ticker> <amount>\` buys shares`,
    `\`${P}sell <ticker> <amount or all>\` sells shares`,
    `\`${P}chart <ticker>\` shows a price chart`,
    `\`${P}compare <ticker> <ticker>\` compares two companies`,
    `\`${P}balance [@player]\` shows Polygons, shares and net worth`,
    `\`${P}daily\` gives free Polygons once a day (resets at midnight Eastern)`,
    `\`${P}dividends\` collects what your shares have earned`,
    `\`${P}reserve\` shows how many Polygons the house has left. If it hits zero, the market crashes`
  ] },
  jobs: { label: 'Jobs', emoji: '💼', title: '💼 Jobs', body: (P) => [
    `\`${P}apply <ticker>\` joins a company. Your rank there is saved if you leave`,
    `\`${P}work\` starts a shift, every 15 minutes. Fast right answers earn tips, coworkers in the same channel earn a team bonus`,
    `\`${P}job\` shows your rank, next performance review, accuracy and earnings`,
    `\`${P}job remind on\` DMs you when your next shift is ready`,
    `\`${P}gig\` is quick freelance work for when you don't have a job, every 10 minutes`,
    `\`${P}quit\` leaves your job (24h after hiring)`,
    '',
    'A performance review every 10 shifts: 8+ right gets you promoted, 4 or fewer demoted.'
  ] },
  casino: { label: 'Rend-Sino', emoji: '🎰', title: '🎰 The Rend-Sino', body: (P) => [
    `\`${P}slots <bet>\` spins the slot machine`,
    `\`${P}coinflip <bet> heads|tails\` pays 1.95x`,
    `\`${P}dice <bet> over|under <5-95>\` rolls 1 to 100. Riskier calls pay more`,
    `\`${P}blackjack <bet>\` against TODD. Hit, Stand or Double`,
    `\`${P}bus <bet>\` Ride the Bus: four card guesses, cash out between them`,
    `\`${P}hilo <bet>\` Higher or Lower: build a streak, cash out before you miss`,
    `\`${P}mines <bet> [bombs]\` Minesweeper: dodge the bombs, cash out any time`,
    `\`${P}rocket <bet>\` cash out before the rocket crashes`,
    `\`${P}derby <horse> <bet>\` the Polygon Derby. The whole channel can bet`,
    `\`${P}lottery\` · \`${P}lottery buy <tickets>\` the weekly draw, Sunday 8 PM Eastern`,
    `\`${P}gambling\` your record at every game`,
    '',
    "No gambling while you owe TODD. Bets go into the Polygon Reserve."
  ] },
  shop: { label: 'Shop', emoji: '🛒', title: '🛒 Shop', body: (P) => [
    `\`${P}shop\` shows items, stock, and the next restock`,
    `\`${P}purchase <item>\` buys coffee, overtime, mystery, resume, or title into your inventory`,
    `\`${P}inventory\` shows the items you own`,
    `\`${P}use <item>\` uses an item from your inventory`,
    `\`${P}settitle <text>\` sets your custom title (uses a Title)`
  ] },
  companies: { label: 'Companies', emoji: '🏢', title: '🏢 Your own company', body: (P) => [
    `\`${P}found <ticker> <name>\` starts a company (⬡ 2,500, needs mod approval)`,
    `\`${P}company [ticker]\` shows a company · \`${P}exchange\` lists them all`,
    `\`${P}invest <amount>\` puts Polygons into your company`,
    `\`${P}upgrade\` levels it up · \`${P}ipo\` lists it at Firm level`,
    `\`${P}salary <amount>\` pays you from the treasury`,
    '',
    'Anyone can `buy`, `sell` and `apply` to public player companies.'
  ] },
  money: { label: 'Loans & TODD', emoji: '🏦', title: '🏦 Loans and TODD', body: (P) => [
    `\`${P}loan @player <amount> <interest>\` asks someone for a loan (interest is % a day)`,
    `\`${P}payback @player <amount or all>\` pays a loan back`,
    `\`${P}loans\` shows what you owe and are owed · \`${P}forgive @player\` lets someone off`,
    `\`${P}bailout\` borrows ⬡ 500 from TODD when you're broke (you owe ⬡ 600)`,
    `\`${P}repay <amount or all>\` pays TODD back`,
    `\`${P}receipts on|off\` DM receipts for trades, purchases and loans`
  ] },
  mods: { label: 'Mods', emoji: '🛡️', title: '🛡️ Mods', body: (P) => [
    `\`${P}cleartitle @user\` removes someone's custom title`,
    `\`${P}review\` shows companies waiting for approval`,
    `\`${P}approve <ticker>\` · \`${P}reject <ticker> [reason]\``,
    '',
    `**Bot owner:** \`${P}crash\` and \`${P}boost\` run market events, \`${P}reserve fund <amount>\` tops up the reserve`
  ] }
};
const ORDER = ['market', 'jobs', 'casino', 'shop', 'companies', 'money', 'mods'];
const ALIAS = { stocks: 'market', trading: 'market', work: 'jobs', job: 'jobs', gambling: 'casino', games: 'casino', rendsino: 'casino',
  items: 'shop', company: 'companies', loans: 'money', todd: 'money', mod: 'mods' };

function page(ctx, key, m) {
  const P = config.prefix;
  if (!PAGES[key]) {
    return { embeds: [{
      title: 'Rend-Conomy',
      description: 'A fictional stock market. Prices change every 5 minutes, and everything here is fake money called Polygons. ' +
        'Trading is open 3 AM to 9 PM Eastern, every day.\n\n' +
        ORDER.map((k) => `${PAGES[k].emoji} **${PAGES[k].label}** · \`${P}help ${k}\``).join('\n') +
        `\n\n**New here?** \`${P}daily\` for free Polygons, \`${P}apply <ticker>\` for a job, then \`${P}work\`.\n\n` +
        `Tickers: ${ctx.market.tickerList(m)}\nLive board: ${config.siteUrl}/rend-conomy/ · Full guide: ${config.siteUrl}/bot/`,
      footer: { text: 'Pick a topic below. Every command also works as a slash command, like /market.' },
      color: config.color
    }], components: buttons(ctx, null) };
  }
  return { embeds: [{ title: PAGES[key].title, description: PAGES[key].body(P).join('\n'), color: config.color,
    footer: { text: 'Every command also works as a slash command, like /market.' } }], components: buttons(ctx, key) };
}

function buttons(ctx, current) {
  return rows([...ORDER, 'home'].map((k) => k === 'home'
    ? button('All topics', `help:${ctx.user.id}:home`, 'grey', current === null)
    : button(PAGES[k].label, `help:${ctx.user.id}:${k}`, k === current ? 'blue' : 'grey', k === current, PAGES[k].emoji)), 4);
}

module.exports = {
  name: 'help',
  description: 'List the bot commands',
  usage: '[topic]',
  options: [{ name: 'topic', type: 'string', description: 'market, jobs, casino, shop, companies, money or mods' }],
  buttonPrefix: 'help',
  PAGES,

  async run(ctx, args) {
    const t = String(args.topic || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return page(ctx, ALIAS[t] || t, await ctx.market.get());
  },

  async onButton(ctx, [userId, key]) {
    if (ctx.user.id !== userId) return { reply: page(ctx, key, await ctx.market.get()) }; // someone else's help: show them their own copy
    return { update: page(ctx, key, await ctx.market.get()) };
  }
};
