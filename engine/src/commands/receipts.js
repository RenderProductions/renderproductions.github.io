// r!receipts on|off: DM receipts for trades, purchases, loans, and company money.
const config = require('../config');

module.exports = {
  name: 'receipts',
  description: 'Turn DM receipts for your purchases on or off',
  usage: '<on or off>',
  options: [{ name: 'setting', type: 'string', description: '"on" or "off"', required: true }],

  async run(ctx, args) {
    const p = ctx.db.player(ctx.guildId, ctx.user);
    const want = String(args.setting || '').trim().toLowerCase();
    if (want !== 'on' && want !== 'off') {
      return `🧾 Receipts are **${p.receipts ? 'on' : 'off'}**. Use \`${config.prefix}receipts on\` or \`${config.prefix}receipts off\`.`;
    }
    ctx.db.updatePlayer(ctx.guildId, ctx.user.id, { receipts: want === 'on' ? 1 : 0 });
    return want === 'on'
      ? '🧾 Receipts are **on**. Trades, shop purchases, loans and company payments will be sent to your DMs.'
      : '🧾 Receipts are **off**. No more DMs.';
  }
};
