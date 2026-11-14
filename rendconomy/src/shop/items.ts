// Marquez's shop: the catalog, the shelves, and Marquez himself.
// `ready: false` keeps an item off the shelf until the system it belongs to is ported (fishing, casino...).
import { polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';

export type Shelf = 'work' | 'market' | 'casino' | 'fun' | 'tackle' | 'style' | 'rare';

export interface Item {
  id: string;
  emoji: string;
  name: string;
  /** null: rolled every restock (Mystery). */
  price: Cents | null;
  stock: number;
  shelf: Shelf;
  desc: string;
  /** Works on its own while in the inventory (no /use). */
  passive?: boolean;
  /** On sale yet (its system is ported). */
  ready?: boolean;
}

const item = (id: string, emoji: string, name: string, price: number | null, stock: number, shelf: Shelf, desc: string, extra: Partial<Item> = {}): Item =>
  ({ id, emoji, name, price: price === null ? null : polygons(price), stock, shelf, desc, ready: true, ...extra });

export const ITEMS: Record<string, Item> = Object.fromEntries([
  item('coffee', '☕', 'Coffee', 100, 5, 'work', 'Resets your work cooldown.'),
  item('overtime', '⏰', 'Overtime', 250, 3, 'work', 'Your next shift pays double.'),
  item('resume', '📄', 'Resume', 350, 2, 'work', 'Skips the 24-hour quit lock. Used automatically when you quit.', { passive: true }),
  item('stopwatch', '⏱️', 'Stopwatch', 150, 4, 'work', 'Your next 3 shifts get 10 extra seconds.'),
  item('hardhat', '🪖', 'Hard Hat', 300, 3, 'work', 'Keeps your job through one layoff. Works on its own.', { passive: true }),
  item('reference', '✉️', 'Reference Letter', 250, 3, 'work', 'Cancels one demotion at a bad review. Works on its own.', { passive: true }),
  item('booster', '📈', 'Dividend Booster', 400, 2, 'market', '+50% on dividends you collect for 24 hours.'),
  item('insurance', '🛡️', 'Insurance Policy', 750, 2, 'market', 'Saves your shares in one company from a bankruptcy wipe. Works on its own.', { passive: true }),
  item('times', '📰', 'The Rend Times', 200, 3, 'market', "A vague tip about one company's hidden mood."),
  item('chip', '💿', 'Platinum Chip', 600, 3, 'casino', 'Your next 5 Rend-Sino games pay 4% more: no house edge.'),
  item('fuel', '⛽', 'Rocket Fuel', 500, 2, 'casino', 'Your next Rocket flies 20% higher before it crashes.'),
  item('mystery', '🎁', 'Mystery', null, 5, 'casino', 'Random Polygons or an Overtime pass. Small jackpot chance. The price changes every restock.'),
  item('floppy', '💾', "TODD's Floppy Disk", 150, 3, 'fun', "Does... something. TODD won't say what."),
  item('wrap', '🎀', 'Gift Wrap', 75, 5, 'fun', 'Your next gift has no fee.'),
  item('megaphone', '📣', 'Megaphone', 1000, 1, 'fun', 'An ad for your player company in the market news feed.', { ready: false }),
  item('title', '🏷️', 'Title', 5000, 1, 'fun', 'A custom title on your profile. Set it with /settitle.', { passive: true }),
  item('rod', '🎣', 'Fishing Rod', 300, 5, 'tackle', 'Lets you fish. Yours for good. Each cast costs ⬡5 of bait.', { passive: true }),
  item('lure', '🪝', 'Lure', 300, 4, 'tackle', 'No bait needed for 25 casts, and bigger fish bite more often.'),
  item('kit', '🎨', 'Profile Customizer Kit', 1500, 3, 'style', 'Unlocks customizing your profile, for good.', { ready: false }),
  item('paint_holo', '🌈', 'Holographic Paint', 5000, 2, 'style', 'Shifts through every color. A profile theme, yours forever.', { ready: false }),
  item('paint_terminal', '🖥️', 'TODD Terminal Paint', 3000, 2, 'style', 'Green on black, like TODD sees the world.', { ready: false }),
  item('paint_sunset', '🌇', 'Sunset Paint', 3000, 2, 'style', 'Warm orange and pink.', { ready: false }),
  item('paint_void', '🕳️', 'Void Paint', 3000, 2, 'style', 'Black and white. Nothing else.', { ready: false }),
  item('paint_goldrush', '🪙', 'Gold Rush Paint', 4000, 2, 'style', 'Shimmering gold, for the rich (or the hopeful).', { ready: false })
].map((i) => [i.id, i]));

/** Collectibles: no effect, pure bragging rights. One is on sale each week, 3 for everyone. */
export const COLLECTIBLES: Record<string, Item> = Object.fromEntries([
  item('col_nacho', '🧀', 'The Golden Nacho', 2500, 3, 'rare', "De Nacho's first nacho, dipped in gold. Do not eat."),
  item('col_todd', '🖥️', 'TODD Bobblehead', 2500, 3, 'rare', 'Nods at everything you say. Like TODD, but nicer.'),
  item('col_cart', '👾', 'Signed BSTG Cartridge', 3000, 3, 'rare', 'Signed by the whole Bastardly Glory dev team. It still has bugs.'),
  item('col_polygon', '🔶', 'The First Polygon', 5000, 3, 'rare', 'Minted on day one. Probably.'),
  item('col_gavel', '🔨', 'Render Room Mod Gavel', 2500, 3, 'rare', 'Used in the first ever ban. Still warm.'),
  item('col_brick', '🧱', 'The BLU Gold Brick', 3000, 3, 'rare', 'The cornerstone of the first BLU build.'),
  item('col_abacus', '🧮', 'The BNW Abacus', 2500, 3, 'rare', "BNW's original computer. Faster than the new one."),
  item('col_coin', '🪙', "Marquez's Lucky Coin", 4000, 3, 'rare', "Marquez swears it's lucky. Marquez also swears it's not for sale.")
].map((i) => [i.id, i]));

export const SHELVES: Record<Shelf, { label: string; emoji: string }> = {
  work: { label: 'Work', emoji: '💼' },
  market: { label: 'Market', emoji: '📈' },
  casino: { label: 'Rend-Sino', emoji: '🎰' },
  fun: { label: 'Odds & Ends', emoji: '🎀' },
  tackle: { label: 'Bait & Tackle', emoji: '🎣' },
  style: { label: 'Profile', emoji: '🎨' },
  rare: { label: 'Collectible', emoji: '🗃️' }
};

export const anyItem = (id: string): Item | undefined => ITEMS[id] ?? COLLECTIBLES[id];
export const isCollectible = (id: string): boolean => id.startsWith('col_');

/** Words players type for an item: "rocket fuel", "floppy", "golden nacho"... */
export function findItem(text: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/^the\s+/, '').replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  const raw = String(text ?? '').trim().toLowerCase();
  if (anyItem(raw)) return raw;
  const t = norm(raw);
  if (!t) return null;
  if (anyItem(t)) return t;
  const all = { ...ITEMS, ...COLLECTIBLES };
  const paint = 'paint_' + t.replace(/\s*paint$/, '');
  if (all[paint]) return paint;
  return Object.keys(all).find((id) => norm(all[id]!.name) === t || norm(all[id]!.name).split(' ').includes(t))
    ?? Object.keys(all).find((id) => t.length >= 4 && norm(all[id]!.name).includes(t)) ?? null;
}

// ---------------------------------------------------------------- Marquez
// Reserved, kind, a man of few words. He calls everyone friend, pal, kiddo and the like ({n}).
// His real name never appears anywhere players can see it.
const PET = ['friend', 'pal', 'kiddo', 'bud', 'champ', 'sport', 'my friend'];
const LINES: Record<string, string[]> = {
  greet: [
    'Marquez nods from behind the counter. "Evening, {n}. Take your time."',
    'Marquez looks up from his ledger. "Oh. Hello, {n}. Have a look around."',
    'Marquez is quietly restocking a shelf. "Good to see you, {n}."',
    '"No rush, {n}," Marquez says. "The shelves aren\'t going anywhere."',
    'Marquez sets down his coffee. "Something catch your eye, {n}?"',
    'Marquez gives a small wave. "Welcome back, {n}."',
    '"Stay out of trouble out there, {n}," Marquez says, straightening a display.',
    'Marquez polishes a Platinum Chip and says nothing for a moment. "...Holler if you need me, {n}."',
    '"Fair prices, honest goods," Marquez says. "That\'s all I\'ve got, {n}."',
    'Marquez glances at the clock, then at you. "Long day, {n}? Have a look. No pressure."'
  ],
  thanks: ['"Thank you, {n}. Take care of it."', '"Good choice, {n}."', '"Pleasure doing business, {n}."', 'Marquez wraps it up carefully. "There you go, {n}."', '"Use it well, {n}."', 'Marquez nods. "Thanks, {n}."'],
  soldOut: ['"Sorry, {n}. That one\'s all gone for now."', 'Marquez shakes his head. "Sold the last one, {n}. Check back soon."'],
  broke: ['"Ah. Not quite enough, {n}. No shame in it. Come back when you\'re ready."', 'Marquez looks at the Polygons, then at you, kindly. "Not today, {n}. It\'ll keep."'],
  once: ['"One per customer, {n}. Gotta leave some for the others."', 'Marquez smiles a little. "Already got yours, {n}."'],
  notThisWeek: ['"Not this week, {n}. Something else is on the special shelf."']
};

export function marquez(kind: keyof typeof LINES, rng: Rng): string {
  return rng.pick(LINES[kind]!).replace(/\{n\}/g, () => rng.pick(PET));
}
