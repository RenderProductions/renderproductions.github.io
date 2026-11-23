// Discord's colored text: in a \`diff\` code block, lines starting with + are green and lines starting with - are
// red, on desktop and on phones. Used for money lists (history, payslips, receipts). Custom emojis and Discord
// timestamps don't render inside code blocks, so the lines are plain text.

export type DiffRow = [sign: '+' | '-' | ' ', amount: string, label: string, after?: string];

/** Rows as a \`diff\` block, amounts lined up in a column. */
export function diffBlock(rows: DiffRow[]): string {
  const w = Math.max(...rows.map((r) => r[1].length));
  const lw = Math.max(...rows.map((r) => r[2].length));
  const lines = rows.map(([sign, amount, label, after]) => `${sign} ${amount.padEnd(w)}  ${after ? label.padEnd(lw) + '  ' + after : label}`.trimEnd());
  return '```diff\n' + lines.join('\n').replace(/```/g, "'''") + '\n```';
}

/** "just now", "5m ago", "3h ago", "2d ago", or the date: for code blocks, where <t:…:R> shows as raw text. */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}
