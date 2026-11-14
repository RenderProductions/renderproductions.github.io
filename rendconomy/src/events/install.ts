// Wires world events in: a new one may start on any market tick; their effects plug into shorts and chat.
import { setChatMultiplier } from '../social/chatter';
import { onTick } from '../market/market';
import { setShortFeeWaiver } from '../market/schemes';
import { isEvent, worldTick, type WorldEvent } from './world';

let announce: (e: WorldEvent) => void = () => {};
export const setEventAnnouncer = (fn: (e: WorldEvent) => void): void => { announce = fn; };

let installed = false;
export function installWorld(): void {
  if (installed) return;
  installed = true;
  onTick((db, m, now, rng) => { const e = worldTick(db, m, now, rng); if (e) announce(e); });
  setShortFeeWaiver((db, ticker) => isEvent(db, 'bear_rumors') || isEvent(db, 'fire_sale', ticker));
  setChatMultiplier((db) => (isEvent(db, 'chatty') ? 2 : 1));
}
