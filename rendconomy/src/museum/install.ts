// Wires the museum in: collectibles count toward net worth at their collector value, and the server's museum
// adds its bonuses (chat pay here; shift pay, rent, advent doors and the birthday cake read it directly).
import { setAwardBoost } from '../achievements/achievements';
import { birthdaysSoFar, partiesStarted } from '../birthday/birthday';
import { currentRequest } from '../core/request';
import { addChatBoost } from '../social/chatter';
import { addWorthPart } from '../social/worth';
import { collectionValue, museumAwards, museumPay, setBirthdaysSoFar, setPartyHatOut } from './museum';

let installed = false;
export function installMuseum(): void {
  if (installed) return;
  installed = true;
  setBirthdaysSoFar(birthdaysSoFar);
  setPartyHatOut(partiesStarted);
  addWorthPart((db, _m, g, u) => [{ label: 'Collectibles', emoji: 'museum', cents: collectionValue(db, g, u, currentRequest()?.now ?? Date.now()) }]);
  addChatBoost((db, g) => museumPay(db, g));
  setAwardBoost((db, g) => museumAwards(db, g));
}
