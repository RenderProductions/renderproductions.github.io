// Wires player companies into the rest of the bot: the daily cycle on market ticks, and net worth.
import { onTick } from '../market/market';
import { addWorthPart } from '../social/worth';
import { companySharesValue, companiesTick } from './companies';

let installed = false;
export function installCompanies(): void {
  if (installed) return;
  installed = true;
  onTick((db, _m, now, rng) => { companiesTick(db, now, () => rng.next()); });
  addWorthPart((db, _m, g, u) => companySharesValue(db, g, u));
}
