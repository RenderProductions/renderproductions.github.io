// r!dropin: TODD's drop-ins and chat pay for this server.
//   r!dropin           how it works, and today's chat pay
//   r!dropin off|on    mods: stop or allow drop-ins here
//   r!dropin now       mods: TODD drops in right now, in this channel
//   r!dropin here      mods: TODD only drops into this channel (anywhere: undo)
const config = require('../config');
const C = require('../chatter');
const { amt } = require('../format');

module.exports = {
  name: 'dropin',
  aliases: ['dropins', 'chatpay'],
  description: "TODD's drop-ins and chat pay (mods can switch drop-ins off or start one)",
  usage: '[on | off | now | here | anywhere]',
  options: [{ name: 'action', type: 'string', description: 'Mods: on, off, now, here (only this channel), or anywhere' }],

  async run(ctx, args = {}) {
    const P = config.prefix;
    const action = String(args.action || '').trim().toLowerCase();
    if (['on', 'off', 'now', 'here', 'anywhere'].includes(action)) {
      const owner = config.ownerId && ctx.user.id === config.ownerId;
      if (!ctx.isMod && !owner) return '🖥️ Only mods can boss TODD around.';
      if (action === 'here') { C.setHome(ctx.db, ctx.guildId, ctx.channelId); return `🖥️ Got it. TODD only drops in here, in <#${ctx.channelId}>.`; }
      if (action === 'anywhere') { C.setHome(ctx.db, ctx.guildId, ''); return '🖥️ TODD can drop into any busy channel again.'; }
      if (action === 'now') {
        if (C.home(ctx.db, ctx.guildId) && C.home(ctx.db, ctx.guildId) !== ctx.channelId) return `🖥️ TODD only drops in at <#${C.home(ctx.db, ctx.guildId)}>. Run this there.`;
        const channel = ctx.message ? ctx.message.channel : await ctx.client.channels.fetch(ctx.channelId).catch(() => null);
        if (!channel) return "🖥️ TODD can't get into this channel.";
        if (C.active.has(ctx.channelId)) return '🖥️ TODD is already here. Answer the question!';
        await C.startDrop(ctx, ctx.guildId, ctx.channelId, (p) => channel.send(p));
        return null;
      }
      C.setOff(ctx.db, ctx.guildId, action === 'off');
      return action === 'off' ? '🖥️ Fine. TODD will stop dropping in here. (`' + P + 'dropin on` to undo)' : '🖥️ TODD is back on the prowl. He drops in while chat is busy.';
    }
    const R = C.RULES;
    const today = C.chatToday(ctx.db, ctx.guildId, ctx.user.id);
    return {
      embeds: [{
        title: '🖥️ Drop-ins & chat pay',
        description:
          `**Chat pay:** talking in the server pays ${amt(R.chat.min)} to ${amt(R.chat.max)} a message, once a minute, up to **${amt(R.chat.perDay)}** a day. ` +
          `Commands and repeats don't count.\nYou've earned **${amt(today)}** from chatting today.\n\n` +
          `**Drop-ins:** while chat is busy, TODD sometimes barges in with a question. First right answer wins ${amt(R.drop.potMin)} to ${amt(R.drop.potMax)}. ` +
          `Drop-ins are **${C.off(ctx.db, ctx.guildId) ? 'off' : 'on'}** in this server` + (C.home(ctx.db, ctx.guildId) ? `, only in <#${C.home(ctx.db, ctx.guildId)}>.` : '.') +
          (ctx.isMod ? `\n\n-# Mods: \`${P}dropin here\` keeps TODD to this channel (\`${P}dropin anywhere\` undoes it) · \`${P}dropin off\` / \`${P}dropin on\` · \`${P}dropin now\` starts one.` : ''),
        color: 0x38e1ff
      }]
    };
  }
};
