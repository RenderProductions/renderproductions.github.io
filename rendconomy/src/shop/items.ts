// Marquez's shop: the catalog, the shelves, and Marquez himself.
// `ready: false` keeps an item off the shelf until the system it belongs to is ported (fishing, casino...).
import { CROPS } from '../farming/farming';
import { polygons, type Cents } from '../core/money';
import type { Rng } from '../core/rng';

export type Shelf = 'work' | 'market' | 'casino' | 'fun' | 'tackle' | 'garden' | 'style' | 'chess' | 'rare' | 'holiday';

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
  /** An unlock: one per player, kept for good (Iso-Chess openings and skins). */
  unlock?: boolean;
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
  item('megaphone', '📣', 'Megaphone', 1000, 1, 'fun', 'An ad for your player company in the market news feed.'),
  item('title', '🏷️', 'Title', 5000, 1, 'fun', 'A custom title on your profile. Set it with /settitle.', { passive: true }),
  item('rod', '🎣', 'Fishing Rod', 300, 5, 'tackle', 'Lets you fish. Yours for good. Each cast costs ⬡5 of bait.', { passive: true }),
  item('lure', '🪝', 'Lure', 300, 4, 'tackle', 'No bait needed for 25 casts, and bigger fish bite more often.'),
  ...Object.values(CROPS).map((c) => item(`seed_${c.id}`, c.emoji, `${c.name} Seeds`, c.seedPrice, c.seedStock, 'garden',
    `Plant with /plant ${c.id}. Ready in ${c.growMs >= 3_600_000 ? `${c.growMs / 3_600_000} ${c.growMs === 3_600_000 ? 'hour' : 'hours'}` : `${c.growMs / 60_000} minutes`}${c.harvests > 1 ? `, and it gives ${c.harvests} harvests` : ''}.`)),
  item('fertilizer', '🧪', 'Fertilizer', 60, 10, 'garden', 'One crop grows 50% faster. /fertilize, or compost your fishing junk into it.'),
  item('scarecrow', '🧑‍🌾', 'Scarecrow', 400, 3, 'garden', 'Chases crows off your whole farm. Works on its own.', { passive: true }),
  item('sprinkler', '💦', 'Sprinkler', 2500, 2, 'garden', 'Waters every crop on your farm for you. Works on its own.', { passive: true }),
  item('greenhouse', '🏡', 'Greenhouse', 4000, 1, 'garden', 'Storms can\'t touch your crops. Works on its own.', { passive: true }),
  item('kit', '🎨', 'Profile Customizer Kit', 1500, 3, 'style', 'Unlocks customizing your profile, for good.'),
  item('paint_holo', '🌈', 'Holographic Paint', 5000, 2, 'style', 'Shifts through every color. A profile theme, yours forever.'),
  item('paint_terminal', '🖥️', 'TODD Terminal Paint', 3000, 2, 'style', 'Green on black, like TODD sees the world.'),
  item('paint_sunset', '🌇', 'Sunset Paint', 3000, 2, 'style', 'Warm orange and pink.'),
  item('paint_void', '🕳️', 'Void Paint', 3000, 2, 'style', 'Black and white. Nothing else.'),
  item('paint_goldrush', '🪙', 'Gold Rush Paint', 4000, 2, 'style', 'Shimmering gold, for the rich (or the hopeful).'),
  // Iso-Chess (renderproductions.github.io/games/chess): starting armies and piece skins, yours for good
  item('chess_gambit', '♛', 'Iso-Chess: The Gambit', 1500, 3, 'chess', 'Unlocks the Gambit opening: a Queen up front, First Blood and extra energy.', { passive: true, unlock: true }),
  item('chess_fortress', '♜', 'Iso-Chess: The Fortress', 1500, 3, 'chess', 'Unlocks the Fortress opening: two Rooks that pawns can\'t touch.', { passive: true, unlock: true }),
  item('chess_cavalry', '♞', 'Iso-Chess: The Cavalry', 2000, 3, 'chess', 'Unlocks the Cavalry opening: three Knights and a King who rides like one.', { passive: true, unlock: true }),
  item('skin_obsidian', '⚫', 'Iso-Chess: Obsidian Pieces', 800, 3, 'chess', 'Black pieces with gold edges, for your Iso-Chess army.', { passive: true, unlock: true }),
  item('skin_jade', '🟢', 'Iso-Chess: Jade Pieces', 800, 3, 'chess', 'Green jade pieces for your Iso-Chess army.', { passive: true, unlock: true }),
  item('skin_crimson', '🔴', 'Iso-Chess: Crimson Pieces', 800, 3, 'chess', 'Red pieces for your Iso-Chess army.', { passive: true, unlock: true }),
  item('skin_frost', '🔵', 'Iso-Chess: Frost Pieces', 800, 3, 'chess', 'Ice-blue pieces for your Iso-Chess army.', { passive: true, unlock: true }),
  item('paint_candycane', '🍬', 'Candy Cane Paint', 3000, 2, 'holiday', 'Red and white stripes. Only in December.'),
  item('paint_frost', '❄️', 'Frost Paint', 3000, 2, 'holiday', 'Ice blue, with snow on the banner. Only in December.')
].map((i) => [i.id, i]));

/** Collectibles: no effect, pure bragging rights. One is on sale each week, 3 for everyone. */
const ROTATING: Record<string, Item> = Object.fromEntries([
  item('col_nacho', '🧀', 'The Golden Nacho', 2500, 3, 'rare', "De Nacho's first nacho, dipped in gold. Do not eat."),
  item('col_todd', '🖥️', 'TODD Bobblehead', 2500, 3, 'rare', 'Nods at everything you say. Like TODD, but nicer.'),
  item('col_cart', '👾', 'Signed BSTG Cartridge', 3000, 3, 'rare', 'Signed by the whole Bastardly Glory dev team. It still has bugs.'),
  item('col_polygon', '🔶', 'The First Polygon', 5000, 3, 'rare', 'Minted on day one. Probably.'),
  item('col_gavel', '🔨', 'Render Room Mod Gavel', 2500, 3, 'rare', 'Used in the first ever ban. Still warm.'),
  item('col_brick', '🧱', 'The BLU Gold Brick', 3000, 3, 'rare', 'The cornerstone of the first BLU build.'),
  item('col_abacus', '🧮', 'The BNW Abacus', 2500, 3, 'rare', "BNW's original computer. Faster than the new one."),
  item('col_coin', '🪙', "Marquez's Lucky Coin", 4000, 3, 'rare', "Marquez swears it's lucky. Marquez also swears it's not for sale.")
].map((i) => [i.id, i]));
/** The weekly special shelf goes round these. */
export const ROTATION = Object.keys(ROTATING);
/** Polygon Holidays: on the Holiday shelf in December only (one of each per customer), and behind advent doors. */
export const HOLIDAY_COLLECTIBLES: Record<string, Item> = Object.fromEntries([
  item('col_ornament', '🔴', 'Polygon Ornament', 500, 5, 'holiday', 'A glass Polygon for the tree. Handle with care.'),
  item('col_gingerbread', '🍪', 'Gingerbread TODD', 800, 5, 'holiday', 'TODD, in gingerbread. He looks smug about it.'),
  item('col_snowglobe', '🔮', 'Snow Globe', 1500, 4, 'holiday', 'A tiny Render Room, snowing forever.'),
  item('col_nutcracker', '💂', 'Nutcracker', 2000, 3, 'holiday', 'Stands guard over your Polygons.'),
  item('col_startopper', '⭐', 'Star Topper', 0, 0, 'holiday', 'Only behind the last door of the advent calendar.')
].map((i) => [i.id, i]));
export const COLLECTIBLES: Record<string, Item> = { ...ROTATING, ...HOLIDAY_COLLECTIBLES };

export const SHELVES: Record<Shelf, { label: string; emoji: string }> = {
  work: { label: 'Work', emoji: '💼' },
  market: { label: 'Market', emoji: '📈' },
  casino: { label: 'Rend-Sino', emoji: '🎰' },
  fun: { label: 'Odds & Ends', emoji: '🎀' },
  tackle: { label: 'Bait & Tackle', emoji: '🎣' },
  garden: { label: 'Garden', emoji: '🌾' },
  style: { label: 'Profile', emoji: '🎨' },
  chess: { label: 'Iso-Chess', emoji: '♟️' },
  rare: { label: 'Collectible', emoji: '🗃️' },
  holiday: { label: 'Holiday', emoji: '🎄' }
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
  notThisWeek: ['"Not this week, {n}. Something else is on the special shelf."'],
  catch: ['Marquez looks over your catch. "Nice haul, {n}."', '"These\'ll do fine, {n}," Marquez says, weighing them.', 'Marquez nods at the bucket. "Fresh. Thank you, {n}."', 'Marquez holds one up to the light. "Not bad at all, {n}."'],
  whale: ['Marquez stares at the White Whale for a long moment. "...Well. I\'ll be. Good work, {n}."'],
  koi: ['Marquez sets down his coffee. "That\'s the real thing, {n}. Careful with it."'],
  crops: ['Marquez turns a tomato over in his hand. "Good soil out there, {n}."', '"Fresh from the field. Thank you, {n}."', 'Marquez nods at the basket. "You\'ve been busy, {n}."',
    '"These\'ll be gone before lunch, {n}," Marquez says.', 'Marquez weighs the basket and smiles a little. "Honest work, {n}."'],
  square: ['Marquez sets the square pumpkin on the counter and just looks at it for a while. "...How, {n}?"'],
  golden: ['Marquez squints at the gold. "That\'s not paint, is it, {n}?"'],
  holiday: ['Marquez is wearing a Santa hat. He does not mention it. "Evening, {n}."', 'There\'s tinsel on the register. "Happy holidays, {n}," Marquez says.',
    'Marquez hums along to the radio, quietly. "Cocoa\'s on the house, {n}. Have a look around."', '"Cold one out there, {n}," Marquez says. "Warm up a minute."',
    'A string of lights blinks over the counter. Marquez looks almost cheerful. "Hello, {n}."']
};

export function marquez(kind: keyof typeof LINES, rng: Rng): string {
  return rng.pick(LINES[kind]!).replace(/\{n\}/g, () => rng.pick(PET));
}
