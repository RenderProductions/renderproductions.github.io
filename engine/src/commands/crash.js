// r!crash: the bot owner's crash controls. Same as the Actions tab's "Crash the market".
//   r!crash                              what's going on now
//   r!crash start [mild|normal|brutal] [warning hours] [crash hours] [recovery hours]
//   r!crash end                          stop the selling, skip to recovery
//   r!crash cancel                       stop everything now, no recovery
const config = require('../config');
const engine = require('../marketEngine');

const HELP = (P) => `🚨 \`${P}crash start [mild|normal|brutal] [warning] [crash] [recovery]\` (hours, defaults 2 48 72) · \`${P}crash end\` skips to recovery · \`${P}crash cancel\` stops it all`;

module.exports = {
  name: 'crash',
  description: 'Bot owner: start, end or cancel a market crash',
  usage: 'start [severity] [warning] [crash] [recovery] | end | cancel',
  modOnly: true,
  options: [{ name: 'action', type: 'string', description: 'start [mild|normal|brutal] [warning] [crash] [recovery], end, or cancel' }],

  async run(ctx, args) {
    const P = config.prefix;
    if (!config.ownerId || ctx.user.id !== config.ownerId) return '🚨 Only the bot owner can crash the market. (Thankfully.)';
    const words = String(args.action || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
    const action = words.shift();
    if (!action) {
      const m = await ctx.market.get();
      return `${(m && m.crashText) || '🌤️ No crash right now.'}\n${HELP(P)}`;
    }
    if (!['start', 'end', 'cancel'].includes(action)) return HELP(P);
    const severity = words.find((w) => ['mild', 'normal', 'brutal'].includes(w)) || 'normal';
    const [warning, crash, recovery] = words.filter((w) => /^\d+(\.\d+)?$/.test(w));
    const input = { action, severity, warning, crash, recovery };

    if (engine.enabled()) {
      const r = await engine.control(ctx.db, 'crash', input);
      if (r.error) return `🚨 ${r.error}`;
    } else {
      const label = { start: 'start a crash', end: 'end the selling (skip to recovery)', cancel: 'cancel (stop everything now, no recovery)' }[action];
      const r = await engine.dispatch('crash.yml', { action: label, severity, warning_hours: warning || '2', crash_hours: crash || '48', recovery_hours: recovery || '72' });
      if (r.error) return `🚨 ${r.error}`;
      return `🚨 Sent to GitHub: **${label}**. The market picks it up within a minute or two.`;
    }
    const m = await ctx.market.get();
    return action === 'start' ? `🚨 **Crash scheduled** (${severity}).\n${(m && m.crashText) || ''}`
      : action === 'end' ? `🩹 **The selling is over.** Recovery has begun.` : '🛑 **Crash cancelled.** No recovery phase.';
  }
};
