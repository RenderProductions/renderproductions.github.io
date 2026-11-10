// r!help: every command, one page per topic. Buttons switch pages; r!help <topic> jumps straight there.
// Each page is an embed with one field per command, in that topic's color.
const config = require('../config');
const { button, rows } = require('../buttons');

// [usage, what it does]. Usage starts with the command name (no prefix).
const PAGES = {
  market: { label: 'Market', emoji: '📈', color: 0x57f287, blurb: 'Prices, trading, dividends', cmds: [
    ['market', 'Current prices, the market bell, booms and crashes'],
    ['buy <ticker> <amount>', 'Buy shares'],
    ['sell <ticker> <amount or all>', 'Sell shares back to the house'],
    ['chart <ticker>', 'A price chart'],
    ['compare <ticker> <ticker>', 'Two companies side by side'],
    ['balance [@player]', 'Polygons, shares and net worth'],
    ['daily', 'Free Polygons once a day (resets at midnight Eastern)'],
    ['dividends', "Collect what your shares have earned"],
    ['reserve', "How many Polygons the house has left. At zero, the market crashes"],
    ['leaderboard [worth|polygons|shifts|casino]', "This server's top players"],
    ['gift @player <amount> [note]', 'Send Polygons to someone (5% fee)']
  ] },
  jobs: { label: 'Jobs', emoji: '💼', color: 0x5865f2, blurb: 'Shifts, ranks, reviews, gigs', cmds: [
    ['apply <ticker>', 'Join a company. Your rank there is saved if you leave'],
    ['work', 'A shift every 15 minutes. Fast answers earn tips, coworkers earn a team bonus'],
    ['job', 'Your rank, next review, accuracy and earnings'],
    ['job remind on', 'A DM when your next shift is ready'],
    ['gig', "Quick freelance work when you don't have a job"],
    ['quit', 'Leave your job (24h after hiring)']
  ], note: '📋 A performance review every 10 shifts: **8+** right gets you promoted, **4 or fewer** demoted.' },
  casino: { label: 'Rend-Sino', emoji: '🎰', color: 0xeb459e, blurb: 'Ten games and a weekly lottery', cmds: [
    ['slots <bet>', 'The slot machine'],
    ['coinflip <bet> heads|tails', 'Call it right for 1.95x'],
    ['dice <bet> over|under <5-95>', 'Roll 1 to 100. Riskier calls pay more'],
    ['blackjack <bet>', 'Against TODD. Hit, Stand or Double'],
    ['bus <bet>', 'Ride the Bus: four card guesses, cash out between them'],
    ['hilo <bet>', 'Higher or Lower: build a streak, cash out before you miss'],
    ['mines <bet> [bombs]', 'Minesweeper: dodge the bombs, cash out any time'],
    ['rocket <bet>', 'Cash out before the rocket crashes'],
    ['derby <horse> <bet>', 'The Polygon Derby. The whole channel can bet'],
    ['lottery [buy <tickets>]', 'The weekly draw, Sunday 8 PM Eastern'],
    ['gambling', 'Your record at every game']
  ], note: "🖥️ No gambling while you owe TODD. Every bet goes into the Polygon Reserve." },
  shop: { label: 'Shop', emoji: '🛒', color: 0xf0b232, blurb: 'Items and your inventory', cmds: [
    ['shop', 'Items, stock, and the next restock'],
    ['purchase <item>', 'Buy coffee, overtime, mystery, resume, or title'],
    ['inventory', 'The items you own'],
    ['use <item>', 'Use an item'],
    ['settitle <text>', 'Set your custom title (uses a Title)']
  ] },
  companies: { label: 'Companies', emoji: '🏢', color: 0x3ba7f2, blurb: 'Found, grow and list your own', cmds: [
    ['found <ticker> <name>', 'Start a company (⬡ 2,500, needs mod approval)'],
    ['company [ticker]', 'A company card'],
    ['exchange', 'Every player company'],
    ['invest <amount>', 'Put Polygons into your company'],
    ['upgrade', 'Level it up'],
    ['ipo', 'List it for anyone to buy (Firm level)'],
    ['salary <amount>', 'Pay yourself from the treasury']
  ], note: '📊 Anyone can `buy`, `sell` and `apply` to public player companies.' },
  money: { label: 'Loans & TODD', emoji: '🏦', color: 0xed4245, blurb: 'Borrow, lend, bail out', cmds: [
    ['loan @player <amount> <interest>', 'Ask someone for a loan (interest is % a day)'],
    ['payback @player <amount or all>', 'Pay a loan back'],
    ['loans', 'What you owe and are owed'],
    ['forgive @player', 'Let someone off the hook'],
    ['bailout', "Borrow ⬡ 500 from TODD when you're broke (you owe ⬡ 600)"],
    ['repay <amount or all>', 'Pay TODD back'],
    ['receipts on|off', 'DM receipts for trades, purchases, loans and gifts']
  ] },
  mods: { label: 'Mods', emoji: '🛡️', color: 0x99aab5, blurb: 'Titles and company approvals', cmds: [
    ['cleartitle @user', "Remove someone's custom title"],
    ['review', 'Companies waiting for approval'],
    ['approve <ticker>', 'Approve a company'],
    ['reject <ticker> [reason]', 'Turn one down (the founder gets a refund)'],
    ['crash', 'Bot owner: start, end or cancel a market crash'],
    ['boost', 'Bot owner: boost the market for an event'],
    ['reserve fund <amount>', 'Bot owner: top up the Polygon Reserve']
  ] }
};
for (const pg of Object.values(PAGES)) pg.body = (P) => pg.cmds.map(([u, d]) => `${P}${u} ${d}`);
const ORDER = ['market', 'jobs', 'casino', 'shop', 'companies', 'money', 'mods'];
const ALIAS = { stocks: 'market', trading: 'market', work: 'jobs', job: 'jobs', gambling: 'casino', games: 'casino', rendsino: 'casino',
  items: 'shop', company: 'companies', loans: 'money', todd: 'money', mod: 'mods' };

const avatar = () => `${config.siteUrl}/bot/avatar.png`;

function page(ctx, key, m) {
  const P = config.prefix;
  const pg = PAGES[key];
  if (!pg) {
    return { embeds: [{
      author: { name: "Render's Vision · Help", icon_url: avatar() },
      title: '📖 The Rend-Conomy',
      description: 'A fictional stock market. Prices move every 5 minutes, and everything runs on fake money called **Polygons**. ' +
        'Trading is open **3 AM to 9 PM Eastern**, every day.\n\n' +
        `**New here?** \`${P}daily\` for free Polygons → \`${P}apply <ticker>\` for a job → \`${P}work\`.`,
      thumbnail: { url: avatar() },
      fields: [
        ...ORDER.map((k) => ({ name: `${PAGES[k].emoji} ${PAGES[k].label}`, value: `${PAGES[k].blurb}\n\`${P}help ${k}\``, inline: true })),
        { name: '📊 Tickers', value: ctx.market.tickerList(m) || 'RRM NACH BLU BNW BSTG', inline: true },
        { name: '🔗 Links', value: `[Live board](${config.siteUrl}/rend-conomy/) · [Full guide](${config.siteUrl}/bot/) · [Patch notes](${config.siteUrl}/patch-notes/)` }
      ],
      footer: { text: 'Pick a topic below · Every command also works as a slash command, like /market' },
      color: config.color
    }], components: buttons(ctx, null) };
  }
  return { embeds: [{
    author: { name: "Render's Vision · Help", icon_url: avatar() },
    title: `${pg.emoji} ${pg.label}`,
    description: pg.note || null,
    fields: pg.cmds.map(([u, d]) => ({ name: `${P}${u}`, value: d })),
    footer: { text: `${ORDER.indexOf(key) + 1} of ${ORDER.length} · Every command also works as a slash command` },
    color: pg.color
  }], components: buttons(ctx, key) };
}

function buttons(ctx, current) {
  return rows([...ORDER, 'home'].map((k) => k === 'home'
    ? button('All topics', `help:${ctx.user.id}:home`, 'green', current === null, '📖')
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
