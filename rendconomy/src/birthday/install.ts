// Wires the birthdays in: shifts and gigs add to the server's cake, and each market tick checks whether a party
// (or its Birthday Bash) just started, tops up the jackpots once, and announces it in the market news.
import { on } from '../core/events';
import { onTick } from '../market/market';
import { cakeHere, onPartyShelf, partyOf, partyTick } from './birthday';
import { setStock } from '../shop/shop';
import { PARTY_ITEMS } from '../shop/items';

let announce: (text: string) => void = () => {};
export const setBirthdayAnnouncer = (fn: (text: string) => void): void => { announce = fn; };

let installed = false;
export function installBirthdays(): void {
  if (installed) return;
  installed = true;
  on('work.shift', (e) => { if (e.result === 'pass') cakeHere(1); });
  on('work.gig', (e) => { if (e.result === 'pass') cakeHere(1); });
  onTick((db, _m, now) => {
    const said = partyTick(db, now);
    // a party just started: put the Party shelf out in every server now, not at the next delivery
    if (said.length && !db.meta(`birthday.shelf:${partyOf(now)?.key}`)) {
      db.setMeta(`birthday.shelf:${partyOf(now)?.key}`, String(now));
      for (const r of db.all<{ guild_id: string }>('SELECT DISTINCT guild_id FROM players'))
        for (const it of Object.values(PARTY_ITEMS)) setStock(db, r.guild_id, it.id, onPartyShelf(it.id, now) ? it.stock : 0);
    }
    for (const text of said) announce(text);
  });
}
