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
import { event, heist } from './heists';
import { installWorld } from '../events/install';
import { approve, company, exchange, found, invest, ipo, merge, reject, review, salary, takeover, upgrade } from './companies';
import { installCompanies } from '../companies/install';
import { profile } from './profile';
import { bus, derby, dropin, gambling, installExtras, lottery, notFound, receipts } from './extras';
import { boost, broker, compare, cover, crash, order, short } from './schemes';
import { installSchemes } from '../market/schemes';
import { fish, sellfish } from './fishing';
import { bailout, forgive, loan, loans, payback, repay } from './loans';
import { installLoans } from '../loans/loans';
import { cleartitle, inventory, purchase, settitle, shop, use } from './shop';
import { gift, leaderboard, savings } from './social';
import { apply, gig, job, quit, work } from './work';
import type { Command } from './types';

export const commands: Command[] = [];
commands.push(daily, balance, history, profile, bailout, repay, loan, loans, payback, forgive, shop, purchase, inventory, use, settitle, fish, sellfish, achievements, gift, leaderboard, savings, work, gig, apply, quit, job, market, chart, compare, buy, sell, portfolio, dividends, order, broker, short, cover, found, company, exchange, invest, upgrade, ipo, salary, takeover, merge, event, slots, coinflip, dice, roulette, blackjack, hilo, mines, rocket, bus, derby, lottery, gambling, heist, odds, reserve, receipts, ping, notFound, give, take, freeze, unfreeze, wipe, importAchievements, cleartitle, crash, boost, dropin, review, approve, reject, makeHelp(() => commands));

installAchievementListeners();
installLoans();
installSchemes();
installExtras();
installCompanies();
installWorld();

/** Finds a command by name or alias (case-insensitive). */
export function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}
