// Game events: systems announce what happened ("a shift was worked", "shares were sold") and other
// systems listen. Achievements, stats and the site will subscribe here instead of being called from
// every command. Listeners run synchronously, inside the caller's transaction.

export interface GameEvents {
  'daily.claimed': { guildId: string; userId: string; streak: number; cents: number };
  'stock.bought': { guildId: string; userId: string; ticker: string; qty: number; priceCents: number };
  'stock.sold': { guildId: string; userId: string; ticker: string; qty: number; priceCents: number; costCents: number; lots: { qty: number; price_cents: number; bought_at: number }[] };
  'work.shift': { guildId: string; userId: string; ticker: string; result: 'pass' | 'wrong' | 'slow'; cents: number; rush: number; team: boolean };
  'work.review': { guildId: string; userId: string; ticker: string; score: number; outcome: 'promoted' | 'bonus' | 'kept' | 'demoted'; rank: number };
  'work.gig': { guildId: string; userId: string; result: 'pass' | 'wrong' | 'slow'; cents: number };
  'work.laidoff': { guildId: string; userId: string; ticker: string; cents: number };
  'dividends.claimed': { guildId: string; userId: string; cents: number };
  'savings.matured': { guildId: string; userId: string; cents: number };
  'stock.insured': { guildId: string; userId: string; ticker: string; shares: number };
  'stock.wiped': { guildId: string; userId: string; ticker: string; shares: number };
  'achievement.unlocked': { guildId: string | null; userId: string; id: string };
  'shop.bought': { guildId: string; userId: string; item: string; qty: number; cents: number };
  'gift.sent': { guildId: string; fromId: string; toId: string; cents: number };
  'mod.action': { guildId: string; modId: string; action: string; targetId?: string; cents?: number; reason?: string };
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
