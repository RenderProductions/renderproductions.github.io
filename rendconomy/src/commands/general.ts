import { embed } from '../discord/style';
import type { Command, System } from './types';

export const ping: Command = {
  name: 'ping',
  description: 'Check that the bot is responding',
  system: 'general',
  run(ctx) {
    return ctx.ping !== undefined && ctx.ping >= 0 ? `Online. Latency: ${Math.round(ctx.ping)} ms.` : 'Online.';
  }
};

const SECTIONS: Record<System, string> = { wallet: 'Wallet', market: 'Stock market', work: 'Work', reserve: 'The Reserve', general: 'General' };

/** Built from the command list, so it can never fall out of date. */
export function makeHelp(list: () => Command[]): Command {
  return {
    name: 'help',
    description: 'List every command',
    system: 'general',
    run(ctx) {
      const p = ctx.config.prefix;
      const groups = new Map<System, string[]>();
      for (const c of list()) {
        const line = `\`/${c.name}\`${c.aliases?.length ? ` (${c.aliases.map((a) => p + a).join(', ')})` : ''}: ${c.description}`;
        groups.set(c.system, [...(groups.get(c.system) ?? []), line]);
      }
      const order: System[] = ['wallet', 'work', 'market', 'reserve', 'general'];
      const lines = order.filter((s) => groups.has(s)).flatMap((s) => [`**${SECTIONS[s]}**`, ...groups.get(s)!, '']);
      return {
        embeds: [embed('general', `${ctx.config.name} commands`, [
          ...lines,
          `Every command also works with the \`${p}\` prefix, for example \`${p}daily\`.`
        ])]
      };
    }
  };
}
