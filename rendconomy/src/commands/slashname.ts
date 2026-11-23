import type { Command } from './types';

/** How to run a command as a slash command: /daily, or /company close for one folded under a parent. */
export function slashFor(c: Command, all: Command[]): string {
  if (!c.helperOf) return `/${c.name}`;
  const parent = all.find((x) => x.name === c.helperOf);
  const word = Object.entries(parent?.helpers ?? {}).find(([, v]) => v === c.name)?.[0]
    ?? ({ sellcrops: 'sell', sellfish: 'sell', buyplot: 'buy' } as Record<string, string>)[c.name] ?? c.name;
  return `/${c.helperOf} ${word}`;
}
