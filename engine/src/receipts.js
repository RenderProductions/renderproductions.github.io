// DM receipts, so players can track what they bought and paid. Players can turn them off with r!receipts off.
const config = require('./config');

// Sends a receipt to a player. lines: [['Label', 'value'], ...]. Never throws (DMs may be closed).
// userId lets you send to someone other than the person who ran the command (like a lender).
async function send(ctx, { title, lines, userId = ctx.user.id, username }) {
  try {
    const p = ctx.db.player(ctx.guildId, { id: userId, username });
    if (!p.receipts) return false;
    const user = userId === ctx.user.id && ctx.user.send ? ctx.user
      : ctx.client ? await ctx.client.users.fetch(userId) : null;
    if (!user) return false;
    await user.send({
      embeds: [{
        title: `🧾 ${title}`,
        fields: lines.map(([name, value]) => ({ name, value: String(value), inline: true })),
        footer: { text: `${ctx.guildName ? ctx.guildName + ' · ' : ''}Turn these off with ${config.prefix}receipts off` },
        timestamp: new Date().toISOString(),
        color: config.color
      }],
      allowedMentions: { parse: [] }
    });
    return true;
  } catch (e) {
    return false; // DMs closed, or the user can't be found
  }
}

module.exports = { send };
