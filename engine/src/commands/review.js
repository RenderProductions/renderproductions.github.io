const config = require('../config');
const co = require('../companies');
const { relTime } = require('../format');
const { button, rows } = require('../buttons');

const SHOWN = 5; // Discord fits 5 rows of buttons: one row (Approve + Reject) per company

// The review list, with Approve/Reject buttons for the first 5 companies
function listing(ctx, note) {
  const P = config.prefix;
  const pending = co.list(ctx.db, ['pending']);
  if (!pending.length) return { content: [note, '✅ No companies waiting for approval.'].filter(Boolean).join('\n'), embeds: [], components: [] };
  const more = pending.length > SHOWN ? `\n\n…and ${pending.length - SHOWN} more after these.` : '';
  return {
    content: note || '',
    embeds: [{
      title: '🏢 Waiting for approval',
      description: pending.map((c) => `**${c.ticker}** · ${c.name} · by ${c.owner_name || c.owner_id} · filed ${relTime(c.created_at)}`).join('\n') +
        `${more}\n\nUse the buttons, or \`${P}reject <ticker> <reason>\` to tell the founder why.`,
      color: config.color
    }],
    components: pending.slice(0, SHOWN).flatMap((c) => rows([
      button(`Approve ${c.ticker}`, `review:approve:${c.ticker}`, 'green'),
      button(`Reject ${c.ticker}`, `review:reject:${c.ticker}`, 'red')
    ]))
  };
}

module.exports = {
  name: 'review',
  description: 'Mods: list companies waiting for approval',
  modOnly: true,
  options: [],
  buttonPrefix: 'review',

  async run(ctx) {
    if (!co.approvalsConfigured()) return '⚙️ Company approvals aren\'t set up yet. Add BOT_OWNER_ID or HOME_GUILD_ID to the bot\'s .env.';
    if (!co.canApprove(ctx)) return '🚫 Only Render Room mods can review companies.';
    return listing(ctx);
  },

  // Approve/Reject pressed: do it, then refresh the list in place
  async onButton(ctx, [action, ticker]) {
    if (!co.canApprove(ctx)) return { reply: '🚫 Only Render Room mods can review companies.' };
    const cmd = require(action === 'approve' ? './approve' : './reject');
    const result = await cmd.run(ctx, { ticker });
    return { update: listing(ctx, typeof result === 'string' ? result : '') };
  }
};
