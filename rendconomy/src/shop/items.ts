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
  // Refined Everything! (Kine's idea): restocks one item of your choice, for every server
  item('rushorder', '📦', 'Rush Order', 1_500, 2, 'fun', 'Marquez restocks one item of your choice right now, for everyone: /use rush order <item>. Not for collectibles.'),
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
  item('rod', '🎣', 'Bamboo Rod', 300, 5, 'tackle', 'Lets you fish the Lake and the Sewer. Yours for good. Each cast costs ⬡5 of bait. Better rods: Old Barnaby at the docks.', { passive: true }),
  // The Fishy Deep: Old Barnaby's gear at the docks (r!fish shop). Not on Marquez's shelves.
  item('rod_fiberglass', '🎣', 'Fiberglass Rod', 2_500, 0, 'tackle', 'Opens the River. Bigger fish a bit more often, and it holds more tension.', { passive: true, ready: false }),
  item('rod_carbon', '🎣', 'Carbon Rod', 10_000, 0, 'tackle', 'Opens the Pier. Better again.', { passive: true, ready: false }),
  item('rod_polygon', '🎣', 'Polygon Rod', 50_000, 0, 'tackle', 'The best odds and the most tension.', { passive: true, ready: false }),
  item('cooler', '🧊', 'Cooler', 3_000, 0, 'tackle', 'Your fish bag holds 100 instead of 50.', { passive: true, ready: false }),
  item('boat', '🛥️', 'Boat', 25_000, 0, 'tackle', 'Takes you out to the Deep.', { passive: true, ready: false }),
  item('worm', '🪱', 'Worm', 5, 0, 'tackle', 'Bait that small and medium fish love. Compost junk to get some: r!farm compost.', { ready: false }),
  item('lure', '🪝', 'Lure', 300, 4, 'tackle', 'No bait needed for 25 casts, and bigger fish bite more often.'),
  ...Object.values(CROPS).map((c) => item(`seed_${c.id}`, c.emoji, `${c.name} Seeds`, c.seedPrice, c.seedStock, 'garden',
    `Plant with /plant ${c.id}. Ready in ${c.growMs >= 3_600_000 ? `${c.growMs / 3_600_000} ${c.growMs === 3_600_000 ? 'hour' : 'hours'}` : `${c.growMs / 60_000} minutes`}${c.harvests > 1 ? `, and it gives ${c.harvests} harvests` : ''}.`)),
  item('fertilizer', '🧪', 'Fertilizer', 60, 10, 'garden', 'Crops grow 50% faster and come out Prime more often. /fertilize does every growing crop; your farmhand can use it too.'),
  // Oh My God, 2 in 1!: what Factories make (never on a shelf: ship it by freight or sell it with /property goods)
  item('goods', '📦', 'Goods', 20, 0, 'work', 'A crate from a Factory. Freight pays ⬡30 a crate, Marquez ⬡20.', { ready: false }),
  item('scarecrow', '🧑‍🌾', 'Scarecrow', 400, 3, 'garden', 'Chases crows off your whole farm. Works on its own.', { passive: true }),
  item('greenhouse', '🏡', 'Greenhouse', 4000, 1, 'garden', 'Storms can\'t touch your crops. Works on its own.', { passive: true }),
  item('kit', '🎨', 'Profile Customizer Kit', 1500, 3, 'style', 'Unlocks customizing your profile, for good.'),
  item('paint_holo', '🌈', 'Holographic Paint', 5000, 2, 'style', 'Shifts through every color. A profile theme, yours forever.'),
  item('paint_terminal', '🖥️', 'TODD Terminal Paint', 3000, 2, 'style', 'Green on black, like TODD sees the world.'),
  item('paint_sunset', '🌇', 'Sunset Paint', 3000, 2, 'style', 'Warm orange and pink.'),
  item('paint_void', '🕳️', 'Void Paint', 3000, 2, 'style', 'Black and white. Nothing else.'),
  item('paint_goldrush', '🪙', 'Gold Rush Paint', 4000, 2, 'style', 'Shimmering gold, for the rich (or the hopeful).'),
  // Iso-Chess (renderproductions.github.io/games/chess): starting armies and piece skins, yours for good
  item('chess_gambit', '👑', 'Iso-Chess: The Gambit', 1500, 3, 'chess', 'Unlocks the Gambit opening: a Queen up front, First Blood and extra energy.', { passive: true, unlock: true }),
  item('chess_fortress', '🏰', 'Iso-Chess: The Fortress', 1500, 3, 'chess', 'Unlocks the Fortress opening: two Rooks that pawns can\'t touch.', { passive: true, unlock: true }),
  item('chess_cavalry', '🐎', 'Iso-Chess: The Cavalry', 2000, 3, 'chess', 'Unlocks the Cavalry opening: three Knights and a King who rides like one.', { passive: true, unlock: true }),
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
    'A string of lights blinks over the counter. Marquez looks almost cheerful. "Hello, {n}."'],
  // Main Street: he warms up as you become a regular
  familiar: ['Marquez looks up and almost smiles. "You again, {n}. Good."', '"Ah, {n}. I was hoping you\'d stop by."', 'Marquez nods like he remembers you. "Back for more, {n}?"'],
  regular: ['"The usual, {n}?" Marquez is already reaching under the counter.', 'Marquez slides a cup of coffee across the counter without asking. "Morning, {n}."', '"Saved you a spot in line, {n}," Marquez says. There is no line.'],
  friend: ['Marquez lights up when you walk in. "There you are, {n}. Sit a minute if you like."', '"Business is better when you\'re around, {n}," Marquez says, and seems to mean it.', 'Marquez leans on the counter. "Tell me how you\'ve been, {n}. Then shop."'],
  family: ['Marquez steps out from behind the counter to greet you. "Family doesn\'t knock, {n}. Come in."', '"The back room\'s open for you, {n}. Always is."', 'Marquez hands you a key on a red string. "Don\'t lose it, {n}." He has done this before. You still have the last one.'],
  friday: ['Marquez is taping a hand-lettered SALE sign to the window. "Fridays, {n}. Don\'t tell anyone I\'m soft."', '"Everything\'s marked down, {n}. Go wild. Within reason."', 'There\'s a black ribbon on the door. "Black Friday, {n}. Every Friday. Don\'t ask."'],
  pricey: ['"{item}\'s been flying off the shelf, {n}. Price went up a little."', '"Folks can\'t get enough {item}, {n}. Supply and demand."'],
  cheap: ['"Nobody\'s touched the {item} in a while, {n}. I knocked a bit off."', '"{item}\'s just sitting there, {n}. Cheaper than it was."']
};

export function marquez(kind: keyof typeof LINES, rng: Rng, item = ''): string {
  return rng.pick(LINES[kind]!).replace(/\{n\}/g, () => rng.pick(PET)).replace(/\{item\}/g, item);
}
