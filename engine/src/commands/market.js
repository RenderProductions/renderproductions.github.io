const config = require('../config');
const { money, pct } = require('../format');

module.exports = {
  name: 'market',
  description: 'Show current prices and changes',
  options: [],

  async run(ctx) {
    const m = await ctx.market.get();
    const lines = m.companies.map((c) => {
      const status = m.statusText && m.statusText[c.id] ? ' · ' + m.statusText[c.id] : '';
      return `**${c.name}** \`${c.id}\`\n${money(Math.round(c.price * 100))} · ${pct(c.change)}${status}`;
    });

    const parts = [];
    if (m.market && m.market.text) parts.push(m.market.text);
    if (m.crashText) parts.push(m.crashText);
    parts.push(lines.join('\n\n'));
    if (m.headlineText) parts.push('**Latest news**\n' + m.headlineText);

    return {
      embeds: [{
        title: '📈 Rend-Conomy Market',
        description: parts.join('\n\n').slice(0, 4000),
        color: config.color,
        footer: { text: 'Fictional companies. Live board: renderproductions.github.io/rend-conomy' },
        timestamp: m.updated
      }]
    };
  }
};
