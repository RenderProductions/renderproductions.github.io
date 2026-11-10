const config = require('../config');
const co = require('../companies');
const { money, relTime } = require('../format');

module.exports = {
  name: 'company',
  aliases: ['co'],
  description: 'Show a player company (yours if no ticker)',
  usage: '[ticker]',
  options: [{ name: 'ticker', type: 'string', description: 'Company ticker (default: yours)' }],

  async run(ctx, args) {
    const P = config.prefix;
    const c = args.ticker ? co.get(ctx.db, args.ticker) : co.ownedBy(ctx.db, ctx.user.id);
    if (!c || c.status === 'rejected') {
      return args.ticker ? `🏢 No player company called ${String(args.ticker).toUpperCase()}. Try \`${P}exchange\`.`
        : `🏢 You don't run a company. Start one with \`${P}found <ticker> <name>\`.`;
    }

    const lvl = co.level(c);
    const next = co.nextLevel(c);
    const mine = c.owner_id === ctx.user.id;
    const statusText = { pending: '⏳ Waiting for approval', private: '🔒 Private', public: '📈 Public', dead: '💀 Closed' }[c.status];
    const lines = [`Owner: **${c.owner_name || 'unknown'}** · ${statusText}`, `Level ${c.level}: **${lvl.name}**`];

    if (c.status === 'dead') {
      lines.push(`Closed ${relTime(c.died_at)}: ${c.note || 'it went under'}.`);
    } else if (c.status !== 'pending') {
      lines.push(`Treasury: **${money(c.treasury)} Polygons**`);
      lines.push(`Upkeep: ${money(lvl.upkeep)} a day, next due ${relTime(c.last_upkeep + co.RULES.dayMs)}`);
      if (c.strikes > 0) lines.push(`⚠️ **Missed upkeep ${c.strikes} time${c.strikes > 1 ? 's' : ''} in a row.** Fill the treasury fast.`);
      lines.push(`Employees: ${co.employees(ctx.db, c.ticker)} (pay ${lvl.payMult}x)`);
      if (c.status === 'public') {
        const pct = co.change(c);
        lines.push(`Price: **${money(Math.round(c.price * 100))}** (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%) ${co.spark(c.history)}`);
        lines.push(`Shares available: ${co.RULES.float - co.sharesHeld(ctx.db, c.ticker)} of ${co.RULES.float}` +
          (c.offering_left > 0 ? ` (${c.offering_left} IPO shares left, their money goes to the company)` : ''));
      }
      if (next) lines.push(`Next level: **${next.name}** for ${money(next.cost)} from the treasury`);
      else lines.push('Max level reached.');
    }

    if (mine && (c.status === 'private' || c.status === 'public')) {
      const tips = [`\`${P}invest <amount>\` adds your Polygons to the treasury`];
      if (next) tips.push(`\`${P}upgrade\` levels up`);
      if (c.status === 'private' && c.level >= co.RULES.ipoLevel) tips.push(`\`${P}ipo\` goes public (${money(co.RULES.listingFee)} fee)`);
      if (c.status === 'private' && c.level < co.RULES.ipoLevel) tips.push(`reach **${co.LEVELS[co.RULES.ipoLevel - 1].name}** to go public`);
      if (c.status === 'public') tips.push(`\`${P}salary <amount>\` pays you from the treasury (up to 10% a day)`);
      lines.push('\n' + tips.join('\n'));
    }

    return {
      embeds: [{
        title: `🏢 ${c.name} (${c.ticker})`,
        description: lines.join('\n'),
        color: c.status === 'dead' ? config.colorTodd : config.color
      }]
    };
  }
};
