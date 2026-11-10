const config = require('../config');
const co = require('../companies');
const { money, have, amt } = require('../format');

module.exports = {
  name: 'exchange',
  aliases: ['ex'],
  description: 'Show the player-run companies',
  options: [],

  async run(ctx) {
    const P = config.prefix;
    const pub = co.list(ctx.db, ['public']);
    const priv = co.list(ctx.db, ['private']);

    const fields = pub.slice(0, 20).map((c) => {
      const pct = co.change(c);
      return {
        name: `${c.name} (${c.ticker}) · ${co.level(c).name}`,
        value: `**${amt(Math.round(c.price * 100))}**  (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)${c.strikes ? ' ⚠️' : ''}\n${co.spark(c.history) || ' '}`
      };
    });
    const privateLine = priv.length
      ? `\n\n**Private companies:** ${priv.map((c) => `${c.name} (${c.ticker})`).join(', ')}` : '';

    return {
      embeds: [{
        title: '🏢 The Exchange',
        description: (pub.length ? 'Player-run companies anyone can invest in.' : 'No player companies are public yet.') +
          privateLine + `\n\nStart your own with \`${P}found <ticker> <name>\`. Details: \`${P}company <ticker>\`.`,
        fields,
        footer: { text: `Live board: ${config.siteUrl}/rend-conomy/exchange/` },
        color: config.color
      }]
    };
  }
};
