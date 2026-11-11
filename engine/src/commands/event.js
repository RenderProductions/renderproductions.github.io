// r!event: the world event running now, and what kinds there are.
// Bot owner: r!event start <id> [ticker] · r!event end
const config = require('../config');
const W = require('../worldEvents');

module.exports = {
  name: 'event',
  aliases: ['events', 'worldevent'],
  description: 'The world event running right now (they happen every few hours)',
  usage: '',
  options: [{ name: 'action', type: 'string', description: 'Bot owner: start <id> [ticker], or end' }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const words = String(args.action || '').trim().split(/\s+/).filter(Boolean);
    if (words.length) {
      if (!config.ownerId || ctx.user.id !== config.ownerId) return '🌍 Only the bot owner can start or end world events.';
      if (words[0].toLowerCase() === 'end') { W.end(ctx.db); return '🌍 Event over. The next one comes in a few hours.'; }
      const id = String(words[1] || '').toLowerCase();
      if (words[0].toLowerCase() !== 'start' || !W.EVENTS[id]) return `🌍 \`${P}event start <${Object.keys(W.EVENTS).join('|')}> [ticker]\` or \`${P}event end\`.`;
      const ticker = words[2] ? words[2].toUpperCase() : (id === 'spotlight' || id === 'fire_sale' ? 'RRM' : undefined);
      const e = W.start(ctx.db, id, ticker);
      W.announce(e);
      return `🌍 Started: ${W.describe(e)}`;
    }
    const e = W.active(ctx.db);
    const list = Object.values(W.EVENTS).map((x) => `${x.emoji} **${x.name}**: ${typeof x.desc === 'function' ? x.desc('A company') : x.desc}`).join('\n');
    return {
      embeds: [{
        title: '🌍 World events',
        description: (e ? `**Right now:** ${W.describe(e)}\nEnds <t:${Math.floor(e.until / 1000)}:R>.` : 'Nothing happening right now. Something will.') +
          `\n\nEvery few hours, something shakes up the whole Rend-Conomy for an hour. It's announced in the market news.\n\n${list}`,
        color: 0x8c6239
      }]
    };
  }
};
