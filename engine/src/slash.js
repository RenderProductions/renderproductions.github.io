// Builds the slash-command definitions Discord needs, from the command files.
// Used by index.js (registers automatically on every start) and register.js (by hand).
// Commands marked hidden (like r!404) stay prefix-only, so they don't show in Discord's command list.
const { ApplicationCommandOptionType, PermissionFlagsBits } = require('discord.js');
const { list } = require('./commands');

const TYPES = {
  string: ApplicationCommandOptionType.String,
  integer: ApplicationCommandOptionType.Integer,
  user: ApplicationCommandOptionType.User
};

function slashCommands() {
  return list.filter((c) => !c.hidden).map((c) => ({
    name: c.name,
    description: c.description,
    dm_permission: false,
    // Mod-only commands are hidden from members who lack Manage Messages
    default_member_permissions: c.modOnly ? String(PermissionFlagsBits.ManageMessages) : null,
    options: (c.options || []).map((o) => ({
      name: o.name,
      description: o.description,
      type: TYPES[o.type] || TYPES.string,
      required: !!o.required
    }))
  }));
}

module.exports = { slashCommands };
