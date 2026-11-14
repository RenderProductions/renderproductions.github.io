// Game events: systems announce what happened ("a shift was worked", "shares were sold") and other
// systems listen. Achievements, stats and the site will subscribe here instead of being called from
// every command. Listeners run synchronously, inside the caller's transaction.

export interface GameEvents {
  'daily.claimed': { guildId: string; userId: string; streak: number; cents: number };
  'stock.bought': { guildId: string; userId: string; ticker: string; qty: number; priceCents: number };
  'stock.sold': { guildId: string; userId: string; ticker: string; qty: number; priceCents: number; costCents: number };
  'work.shift': { guildId: string; userId: string; ticker: string; result: 'pass' | 'wrong' | 'slow'; cents: number; rush: number };
  'work.review': { guildId: string; userId: string; ticker: string; score: number; outcome: 'promoted' | 'bonus' | 'kept' | 'demoted'; rank: number };
  'work.gig': { guildId: string; userId: string; result: 'pass' | 'wrong' | 'slow'; cents: number };
  'work.laidoff': { guildId: string; userId: string; ticker: string; cents: number };
}

type Listener<K extends keyof GameEvents> = (e: GameEvents[K]) => void;
const listeners: { [K in keyof GameEvents]?: Listener<K>[] } = {};

export function on<K extends keyof GameEvents>(name: K, fn: Listener<K>): () => void {
  const list = (listeners[name] ??= []) as Listener<K>[];
  list.push(fn);
  return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1); };
}

export function emit<K extends keyof GameEvents>(name: K, e: GameEvents[K]): void {
  for (const fn of (listeners[name] ?? []) as Listener<K>[]) fn(e);
}
