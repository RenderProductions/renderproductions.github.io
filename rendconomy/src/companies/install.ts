// Wires player companies into the rest of the bot: the daily cycle on market ticks, and net worth.
import { onTick } from '../market/market';
import { addWorthPart } from '../social/worth';
import { companySharesValue, companiesTick, getCompany } from './companies';
import { settleWorkers } from './workers';

let installed = false;
export function installCompanies(): void {
  if (installed) return;
  installed = true;
  onTick((db, _m, now, rng) => {
    companiesTick(db, now, () => rng.next());
    // NPC workers: a day's wages, work and moods, for every open company with staff
    for (const r of db.all<{ ticker: string }>('SELECT DISTINCT ticker FROM workers')) {
      const c = getCompany(db, r.ticker);
      if (c && (c.status === 'private' || c.status === 'public')) settleWorkers(db, c, () => rng.next(), now);
    }
  });
  addWorthPart((db, _m, g, u) => [{ label: 'Player company shares', emoji: 'company', cents: companySharesValue(db, g, u) }]);
}
