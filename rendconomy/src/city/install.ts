// Wires Under New Management into the rest of the bot: a chat-pay public work. (Taxes, rent works, Happy Hour,
// frozen companies and decrees are read straight from city/state.ts where they apply.)
import { addChatBoost } from '../social/chatter';
import { workBonus } from './state';

let installed = false;
export function installCity(): void {
  if (installed) return;
  installed = true;
  addChatBoost((db, guildId, now) => 1 + workBonus(db, guildId, 'chat', now));
}
