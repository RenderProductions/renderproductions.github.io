// Wires Room to Grow into the rest of the bot: net worth, erasing players, and the Ballroom's chat pay.
import { onErase } from '../core/players';
import { addChatBoost } from '../social/chatter';
import { addWorthPart } from '../social/worth';
import { partyUntil, propertyWorth, releasePlayer } from './estate';
import { releasePlayer as releaseUnderground } from '../underground/underground';

let installed = false;
export function installEstates(): void {
  if (installed) return;
  installed = true;
  addWorthPart((db, _m, g, u) => [{ label: 'Property', emoji: 'property', cents: propertyWorth(db, g, u) }]);
  onErase((db, g, u) => releasePlayer(db, g, u));
  onErase((db, g, u) => releaseUnderground(db, g, u));
  addChatBoost((db, guildId, now) => (partyUntil(db, guildId) > now ? 2 : 1));
}
