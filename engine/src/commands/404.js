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
    const text = random() < 0.25 ? '75.40' : 'Soon, friend.';
    await ctx.user.send(text).catch(() => {}); // DMs might be closed
    return null; // no reply in the channel
  }
};
