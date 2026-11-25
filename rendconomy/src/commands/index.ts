import { installAchievementListeners } from '../achievements/listeners';
// Every command. Add new ones here.
import { freeze, give, giveitem, take, takeitem, unfreeze, wipe } from './admin';
import { achievements, importAchievements } from './achievements';
import { blackjack, coinflip, dice, hilo, mines, odds, rocket, vip, table, roulette, slots } from './casino';
import { daily } from './daily';
import { makeHelp, ping } from './general';
import { history } from './history';
import { buy, chart, dividends, market, money, sell } from './market';
import { farmCommands } from './farming';
import { holidayCommands } from './holidays';
import { connectionCommands } from './connections';
import { funCommands } from './fun';
import { reserve } from './reserve';
import { announce } from './announce';
import { event, heist } from './heists';
import { installWorld } from '../events/install';
import { installEstates } from '../estate/install';
import { propertyCommands } from './property';
import { undergroundCommands } from './underground';
import { approve, closecompany, company, exchange, found, invest, ipo, merge, reject, review, salary, sellcompany, takeover, upgrade } from './companies';
import { installCompanies } from '../companies/install';
import { profile } from './profile';
import { bus, derby, dropin, gambling, installExtras, lottery, notFound, receipts } from './extras';
import { boost, broker, compare, cover, crash, order, short } from './schemes';
import { installSchemes } from '../market/schemes';
import { fish, sellfish } from './fishing';
import { bailout, collect, forgive, loan, loans, payback, repay } from './loans';
import { impeachCmd, mayorCmd, vote } from './city';
import { installCity } from '../city/install';
import { installLoans } from '../loans/loans';
import { cleartitle, discard, inventory, purchase, sellitem, settitle, shop, use } from './shop';
import { gift, leaderboard, savings } from './social';
import { apply, gig, job, quit, work } from './work';
import { beg } from './beg';
import type { Command } from './types';

export const commands: Command[] = [];
commands.push(daily, money, history, profile, bailout, repay, loan, loans, payback, forgive, collect, mayorCmd, vote, impeachCmd, shop, purchase, inventory, use, sellitem, discard, settitle, fish, sellfish, ...farmCommands, ...holidayCommands, ...connectionCommands, ...funCommands, ...propertyCommands, ...undergroundCommands, achievements, gift, leaderboard, savings, work, gig, beg, apply, quit, job, market, chart, compare, buy, sell, dividends, order, broker, short, cover, found, company, exchange, invest, upgrade, ipo, salary, closecompany, sellcompany, takeover, merge, event, slots, coinflip, dice, roulette, blackjack, hilo, mines, rocket, vip, table, bus, derby, lottery, gambling, heist, odds, reserve, receipts, ping, notFound, give, take, giveitem, takeitem, freeze, unfreeze, wipe, importAchievements, cleartitle, crash, boost, dropin, review, approve, reject, announce, makeHelp(() => commands));

// Helpers: commands folded under a parent, to keep under Discord's 100 slash commands and keep families together.
// r!company close runs r!closecompany (which still works); /company action:close does the same.
const HELPERS: Record<string, Record<string, string>> = {
  company: { found: 'found', invest: 'invest', upgrade: 'upgrade', ipo: 'ipo', salary: 'salary', close: 'closecompany', sell: 'sellcompany', takeover: 'takeover', merge: 'merge' },
  market: { chart: 'chart', compare: 'compare', dividends: 'dividends', order: 'order', orders: 'order', broker: 'broker', short: 'short', cover: 'cover', event: 'event' },
  mayor: { vote: 'vote', impeach: 'impeach' },
  loans: { pay: 'payback', payback: 'payback', forgive: 'forgive', collect: 'collect' },
  farm: { fertilize: 'fertilize', compost: 'compost' },
  fish: {},
  shop: { buy: 'purchase', sell: 'sellitem' }
};
/** Commands the parent already handles itself (r!farm plant…), so they don't need their own slash command either. */
const HANDLED: Record<string, string[]> = { farm: ['plant', 'water', 'harvest', 'sellcrops', 'buyplot'], fish: ['sellfish'] };
for (const [parent, map] of Object.entries(HELPERS)) {
  const p = commands.find((c) => c.name === parent)!;
  p.helpers = map;
  for (const child of [...Object.values(map), ...(HANDLED[parent] ?? [])]) commands.find((c) => c.name === child)!.helperOf = parent;
}

installAchievementListeners();
installLoans();
installSchemes();
installExtras();
installCompanies();
installWorld();
installEstates();
installCity();

/** Finds a command by name or alias (case-insensitive). */
export function find(name: string): Command | undefined {
  const n = name.toLowerCase();
  return commands.find((c) => c.name === n || c.aliases?.includes(n));
}
