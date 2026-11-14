// Every command. Add new ones here.
import { balance } from './balance';
import { daily } from './daily';
import { makeHelp, ping } from './general';
import { history } from './history';
import { buy, market, portfolio, sell } from './market';
import { reserve } from './reserve';
import { apply, gig, job, quit, work } from './work';
import type { Command } from './types';

export const commands: Command[] = [];
commands.push(daily, balance, history, work, gig, apply, quit, job, market, buy, sell, portfolio, reserve, ping, makeHelp(() => commands));

/** Finds a command by name or alias (case-insensitive). */
export function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}
