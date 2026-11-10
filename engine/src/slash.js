// Builds the slash-command definitions Discord needs, from the command files.
// Used by index.js (registers automatically on every start) and register.js (by hand).
const { ApplicationCommandOptionType } = require('discord.js');
const { list } = require('./commands');

const TYPES = { string: ApplicationCommandOptionType.String, integer: ApplicationCommandOptionType.Integer };

function slashCommands() {
  return list.map((c) => ({
    name: c.name,
    description: c.description,
    dm_permission: false,
    options: (c.options || []).map((o) => ({
      name: o.name,
      description: o.description,
      type: TYPES[o.type] || TYPES.string,
      required: !!o.required
    }))
  }));
}

module.exports = { slashCommands };
