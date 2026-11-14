import { installAchievementListeners } from '../achievements/listeners';
// Every command. Add new ones here.
import { freeze, give, take, unfreeze, wipe } from './admin';
import { achievements, importAchievements } from './achievements';
import { blackjack, coinflip, dice, hilo, mines, odds, rocket, roulette, slots } from './casino';
import { balance } from './balance';
import { daily } from './daily';
import { makeHelp, ping } from './general';
import { history } from './history';
import { buy, chart, dividends, market, portfolio, sell } from './market';
import { reserve } from './reserve';
import { cleartitle, inventory, purchase, settitle, shop, use } from './shop';
import { gift, leaderboard, savings } from './social';
import { apply, gig, job, quit, work } from './work';
import type { Command } from './types';

export const commands: Command[] = [];
commands.push(daily, balance, history, shop, purchase, inventory, use, settitle, achievements, gift, leaderboard, savings, work, gig, apply, quit, job, market, chart, buy, sell, portfolio, dividends, slots, coinflip, dice, roulette, blackjack, hilo, mines, rocket, odds, reserve, ping, give, take, freeze, unfreeze, wipe, importAchievements, cleartitle, makeHelp(() => commands));

installAchievementListeners();

/** Finds a command by name or alias (case-insensitive). */
export function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}
