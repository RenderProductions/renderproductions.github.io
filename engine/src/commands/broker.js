// r!broker: hire someone to trade for you.
//   r!broker                       their report: holdings, rules, profit, fees, recent trades
//   r!broker hire                  meet today's candidates and hire one (sign-on bonus)
//   r!broker buy RRM until 2.50    keep buying RRM while it's at or under ⬡ 2.50 (up to 25 shares)
//   r!broker sell RRM at 4         sell all their RRM at or over ⬡ 4
//   r!broker stop RRM at 1.50      sell all their RRM if it falls to ⬡ 1.50
//   r!broker clear RRM             forget the rules for RRM (or "clear all")
//   r!broker fire                  let them go; what they hold comes back to you
const config = require('../config');
const trading = require('../trading');
const { amt, have, parsePolygons, relTime } = require('../format');
const { button, rows } = require('../buttons');

const T = trading.TRAITS;
const traitLine = (k) => `${T[k].emoji} **${T[k].label}** · ${amt(T[k].salary)}/day + ${Math.round(T[k].cut * 100)}% of profits\n-# ${T[k].desc}`;

function report(ctx, b, m) {
  const P = config.prefix;
  const tr = T[b.trait] || T.steady;
  const hs = trading.holdings(ctx.db, ctx.guildId, ctx.user.id);
  const rs = trading.rules(ctx.db, ctx.guildId, ctx.user.id);
  let log = [];
  try { log = JSON.parse(b.log || '[]'); } catch (e) { log = []; }
  const worth = trading.value(ctx.db, ctx.guildId, ctx.user.id, m);
  const ruleText = rs.length ? rs.map((r) => `**${r.ticker}**: ${[r.buy != null && `buy until ${amt(r.buy)}`, r.sell != null && `sell at ${amt(r.sell)}`, r.stop != null && `stop at ${amt(r.stop)}`].filter(Boolean).join(' · ')}`).join('\n')
    : `No rules yet. Try \`${P}broker buy RRM until 2.50\`.`;
  return { embeds: [{
    author: { name: 'Your broker' },
    title: `${tr.emoji} ${b.name}`,
    description: `${tr.label} · ${amt(tr.salary)}/day + ${Math.round(tr.cut * 100)}% of profits · hired ${relTime(b.hired_at)}`,
    fields: [
      { name: '📦 Holding', value: hs.length ? hs.map((h) => `${h.shares}/${trading.BROKERS.cap} ${h.ticker} (paid ${amt(h.cost)})`).join('\n') + `\nWorth now: **${amt(worth)}**` : 'Nothing right now', inline: true },
      { name: '📈 Results', value: `Profit: **${b.profit >= 0 ? '+' : '−'}${amt(Math.abs(b.profit))}**\nPaid to them: ${amt(b.fees)}`, inline: true },
      { name: '📜 Your rules', value: ruleText },
      { name: '🕒 Recent trades', value: log.length ? log.slice(0, 5).map(([t, l]) => `<t:${Math.floor(t / 1000)}:R> ${l}`).join('\n') : 'None yet. They trade every 5 minutes while the market is open.' }
    ],
    footer: { text: `Payday is daily: miss it and they quit · Fire them with ${P}broker fire` },
    color: 0x3ba7f2
  }] };
}

function hireView(ctx) {
  const cost = trading.nextBonus(ctx.db, ctx.guildId, ctx.user.id);
  const cands = trading.candidates(ctx.user.id);
  return {
    embeds: [{
      title: '💼 Brokers looking for work',
      description: `Sign-on bonus: **${amt(cost)}**${cost > trading.BROKERS.baseBonus ? ' (it grows 1.25x every time you hire, and eases back for every week you keep one)' : ' (it grows 1.25x every time you hire)'}\n\n` +
        cands.map((c, i) => `**${i + 1}. ${c.name}**\n${traitLine(c.trait)}`).join('\n\n') +
        '\n\n-# They manage up to 25 shares per company, trade with your Polygons, and quit if they miss a payday. New faces every hour.',
      color: 0x3ba7f2
    }],
    components: rows(cands.map((c, i) => button(`Hire ${c.name.replace(/"[^"]*"\s*/, '')}`, `broker:${ctx.user.id}:hire:${i}`, 'green', false, T[c.trait].emoji)))
  };
}

module.exports = {
  name: 'broker',
  aliases: ['brokers'],
  description: 'Hire a broker to trade for you',
  usage: 'hire | buy <ticker> until <price> | sell <ticker> at <price> | stop <ticker> at <price> | clear <ticker|all> | fire',
  options: [{ name: 'action', type: 'string', description: 'hire, "buy RRM until 2.50", "sell RRM at 4", "stop RRM at 1.50", "clear RRM", or fire' }],
  buttonPrefix: 'broker',

  async run(ctx, args) {
    const P = config.prefix;
    const words = String(args.action || '').trim().split(/\s+/).filter(Boolean);
    const action = (words[0] || '').toLowerCase();
    const m = await ctx.market.get();
    const b = trading.get(ctx.db, ctx.guildId, ctx.user.id);

    if (action === 'hire') return b ? `💼 You already have a broker: **${b.name}**. See \`${P}broker\`.` : hireView(ctx);
    if (!b) return action ? `💼 You don't have a broker. \`${P}broker hire\` to meet the candidates.` : hireView(ctx);

    if (!action) return report(ctx, b, m);
    if (action === 'fire') {
      return { content: `🤔 Fire **${b.name}**? What they hold comes back to you, and hiring again costs **${amt(trading.nextBonus(ctx.db, ctx.guildId, ctx.user.id))}**.`,
        components: rows([button('Fire them', `broker:${ctx.user.id}:fire:yes`, 'red'), button('Keep them', `broker:${ctx.user.id}:fire:no`, 'grey')]) };
    }
    if (action === 'clear') {
      const t = String(words[1] || '').toUpperCase();
      if (!t) return `💼 Clear which? \`${P}broker clear RRM\` or \`${P}broker clear all\`.`;
      trading.clearRules(ctx.db, ctx.guildId, ctx.user.id, t === 'ALL' ? null : t);
      return `💼 **${b.name}** forgets ${t === 'ALL' ? 'all your rules' : `the rules for ${t}`}. They keep holding what they have until you tell them to sell (or fire them).`;
    }
    const field = { buy: 'buy', sell: 'sell', stop: 'stop' }[action];
    if (field) {
      const t = String(words[1] || '').toUpperCase();
      const how = String(words[2] || '').toLowerCase();
      const price = parsePolygons(words[3]);
      const want = field === 'buy' ? 'until' : 'at';
      if (!m || !ctx.market.ids(m).includes(t) || how !== want || price === null || price <= 0) {
        return `💼 Like this: \`${P}broker buy RRM until 2.50\`, \`${P}broker sell RRM at 4\`, or \`${P}broker stop RRM at 1.50\`.`;
      }
      trading.setRule(ctx.db, ctx.guildId, ctx.user.id, t, field, price);
      const said = { buy: `keep buying **${t}** while it's at or under **${amt(price)}** (up to ${trading.BROKERS.cap} shares)`,
        sell: `sell all their **${t}** once it's at or over **${amt(price)}**`, stop: `sell all their **${t}** if it falls to **${amt(price)}**` }[field];
      return `💼 **${b.name}** will ${said}.\n-# ${t} is at ${amt(trading.priceOf(m, t))} now. They act every 5 minutes while the market is open.`;
    }
    return `💼 Try \`${P}broker\`, \`${P}broker buy RRM until 2.50\`, \`${P}broker sell RRM at 4\`, \`${P}broker stop RRM at 1.50\`, \`${P}broker clear RRM\`, or \`${P}broker fire\`.`;
  },

  async onButton(ctx, [userId, action, arg]) {
    if (ctx.user.id !== userId) return { reply: `This isn't your brokerage. Try \`${config.prefix}broker hire\`.` };
    if (action === 'hire') {
      const c = trading.candidates(ctx.user.id)[Number(arg)];
      if (!c) return { update: { components: [] } };
      const r = trading.hire(ctx, c);
      if (r.error) return { reply: r.error };
      return { update: { embeds: [], components: [], content: `🤝 You hired **${c.name}** (${T[c.trait].emoji} ${T[c.trait].label}) for a **${amt(r.cost)}** sign-on bonus.\n` +
        `Give them some rules: \`${config.prefix}broker buy RRM until 2.50\`, then \`${config.prefix}broker sell RRM at 4\`.\n-# Their salary is ${amt(T[c.trait].salary)} a day. Keep enough Polygons around or they'll walk.` } };
    }
    if (action === 'fire') {
      if (arg !== 'yes') return { update: { content: '🤝 They stay. For now.', components: [] } };
      const r = trading.fire({ db: ctx.db, client: ctx.client, market: ctx.market }, ctx, await ctx.market.get());
      if (!r) return { update: { content: "💼 You don't have a broker.", components: [] } };
      return { update: { content: `📦 **${r.broker.name}** packs up their desk.${r.returned.length ? ` They hand back ${r.returned.join(', ')}.` : ''}\n-# Hiring again costs ${amt(trading.nextBonus(ctx.db, ctx.guildId, ctx.user.id))}.`, components: [] } };
    }
    return null;
  }
};
