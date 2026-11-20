// Wires the city into the rest of the bot: net worth, erasing players, the Ballroom's and the Stadium's chat pay,
// landmarks' rent, and the Bank Branch's savings bonus.
import { onErase } from '../core/players';
import { addChatBoost } from '../social/chatter';
import { addWorthPart } from '../social/worth';
import { addInterestBoost } from '../social/savings';
import { ESTATE, partyUntil, perkLevel, propertyWorth, releasePlayer } from './estate';
import { STADIUM_CHAT, installLandmarks, isBuilt } from './landmarks';
import { releasePlayer as releaseUnderground } from '../underground/underground';

let installed = false;
export function installEstates(): void {
  if (installed) return;
  installed = true;
  installLandmarks();
  addWorthPart((db, _m, g, u) => [{ label: 'Property', emoji: 'property', cents: propertyWorth(db, g, u) }]);
  onErase((db, g, u) => releasePlayer(db, g, u));
  onErase((db, g, u) => releaseUnderground(db, g, u));
  addChatBoost((db, guildId, now) => (partyUntil(db, guildId) > now ? 2 : 1));
  addChatBoost((db, guildId) => (isBuilt(db, guildId, 'stadium') ? STADIUM_CHAT : 1));
  addInterestBoost((db, g, u, now) => 1 + ESTATE.bankBonus * perkLevel(db, g, u, 'bank', now));
}
