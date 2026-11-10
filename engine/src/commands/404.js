// A secret. Prefix only: it's hidden from r!help and from Discord's slash command list.
// Deletes the command message and DMs the player. 1 in 4 times they get the frequency.
module.exports = {
  name: '404',
  description: 'Not found.',
  hidden: true,
  options: [],

  async run(ctx) {
    if (ctx.message) ctx.message.delete().catch(() => {}); // needs Manage Messages; fine if it can't
    const random = ctx.random || Math.random;
    const lucky = random() < 0.25;
    const text = lucky ? '75.40' : 'Soon, friend.';
    await ctx.user.send(text).catch(() => {}); // DMs might be closed
    if (lucky) {
      const line = require('../achievements').award(ctx, 'soon_friend');
      if (ctx.notes) ctx.notes.length = 0; // a secret stays secret: the unlock goes in a DM, not the channel
      if (line) await ctx.user.send(line).catch(() => {});
    }
    return null; // no reply in the channel
  }
};
