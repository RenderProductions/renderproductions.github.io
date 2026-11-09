const config = require('../config');

module.exports = {
  name: 'help',
  description: 'List the bot commands',
  options: [],

  async run(ctx) {
    // Required here (not at the top) to avoid a circular require with commands/index.js.
    const { list } = require('./index');
    const lines = list.map((c) =>
      `\`${config.prefix}${c.name}${c.usage ? ' ' + c.usage : ''}\` · ${c.description}`);
    return {
      embeds: [{
        title: 'Rend-Conomy commands',
        description: lines.join('\n') + `\n\nEvery command also works as a slash command, like \`/${list[0].name}\`.`,
        color: config.color
      }]
    };
  }
};
