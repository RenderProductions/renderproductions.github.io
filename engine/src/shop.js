// Marquez's shop: items, prices, stock, and hourly restocks. Stock is shared by every server.
// Bought items go to the player's inventory. Most are used with r!use; passive ones work on their own.
// One collectible is on the shelf each week, in very short supply.

const RESTOCK_MS = 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const MYSTERY_MIN = 75;   // Mystery's price is rolled every restock, in whole Polygons
const MYSTERY_MAX = 100;

// cat: which shelf it's on. passive: works by itself while it's in your inventory.
const ITEMS = {
  coffee:    { emoji: '☕', name: 'Coffee',           price: 100_00,  stock: 5, cat: 'work',   desc: 'Resets your work cooldown.' },
  overtime:  { emoji: '⏰', name: 'Overtime',         price: 250_00,  stock: 3, cat: 'work',   desc: 'Your next shift pays double.' },
  resume:    { emoji: '📄', name: 'Resume',           price: 350_00,  stock: 2, cat: 'work',   desc: 'Skips the 24h quit lock.' },
  stopwatch: { emoji: '⏱️', name: 'Stopwatch',        price: 150_00,  stock: 4, cat: 'work',   desc: 'Your next 3 shifts get 10 extra seconds.' },
  hardhat:   { emoji: '🪖', name: 'Hard Hat',         price: 300_00,  stock: 3, cat: 'work',   passive: true, desc: 'Keeps your job through one layoff. Works on its own.' },
  reference: { emoji: '✉️', name: 'Reference Letter', price: 250_00,  stock: 3, cat: 'work',   passive: true, desc: 'Cancels one demotion at a bad review. Works on its own.' },
  booster:   { emoji: '📈', name: 'Dividend Booster', price: 400_00,  stock: 2, cat: 'market', desc: '+50% on dividends you collect for 24 hours.' },
  insurance: { emoji: '🛡️', name: 'Insurance Policy', price: 750_00,  stock: 2, cat: 'market', passive: true, desc: 'Saves your shares in one company from a bankruptcy wipe. Works on its own.' },
  times:     { emoji: '📰', name: 'The Rend Times',   price: 200_00,  stock: 3, cat: 'market', desc: "A vague tip about one company's hidden mood. Insiders talk." },
  chip:      { emoji: '💿', name: 'Platinum Chip',    price: 600_00,  stock: 3, cat: 'casino', desc: 'Your next 5 Rend-Sino games pay 4% more: no house edge.' },
  fuel:      { emoji: '⛽', name: 'Rocket Fuel',      price: 500_00,  stock: 2, cat: 'casino', desc: 'Your next Rocket flies 20% higher before it crashes.' },
  mystery:   { emoji: '🎁', name: 'Mystery',          price: null,    stock: 5, cat: 'casino', desc: 'Random Polygons or an Overtime pass. Small jackpot chance. Price changes every restock.' },
  floppy:    { emoji: '💾', name: "TODD's Floppy Disk", price: 150_00, stock: 3, cat: 'fun',   desc: 'Does... something. TODD won\'t say what.' },
  wrap:      { emoji: '🎀', name: 'Gift Wrap',        price: 75_00,   stock: 5, cat: 'fun',    desc: 'Your next r!gift has no fee.' },
  megaphone: { emoji: '📣', name: 'Megaphone',        price: 1000_00, stock: 1, cat: 'fun',    desc: 'An ad for your player company in the market news feed. `r!use megaphone <your ad>`' },
  title:     { emoji: '🏷️', name: 'Title',            price: 5000_00, stock: 1, cat: 'fun',    desc: 'A custom title on your profile. Set it with `r!settitle`.' },
  rod:       { emoji: '🎣', name: 'Fishing Rod',      price: 300_00,  stock: 5, cat: 'tackle', passive: true, desc: 'Lets you `r!fish`. Yours for good. Each cast costs ⬡ 5 of bait.' },
  lure:      { emoji: '🪝', name: 'Lure',             price: 300_00,  stock: 4, cat: 'tackle', desc: 'No bait needed for 25 casts, and bigger fish bite more often.' },
  kit:       { emoji: '🎨', name: 'Profile Customizer Kit', price: 1500_00, stock: 3, cat: 'style', desc: 'Unlocks customizing your profile, for good: any color, the preset themes and banners. `r!use kit`, then `r!profile customize`.' }
};
// Profile Paint: fancy themes for your profile card (see src/styles.js)
for (const [id, p] of Object.entries(require('./styles').PAINTS)) {
  ITEMS[`paint_${id}`] = { emoji: p.emoji, name: `${p.label} Paint`, price: p.price, stock: 2, cat: 'style', desc: `${p.desc} A profile theme, yours forever.` };
}

// Collectibles: no effect, pure bragging rights. One is on sale each week, 3 for everyone.
const COLLECTIBLES = {
  col_nacho:   { emoji: '🧀', name: 'The Golden Nacho',        price: 2500_00, desc: "De Nacho's first nacho, dipped in gold. Do not eat." },
  col_todd:    { emoji: '🖥️', name: 'TODD Bobblehead',         price: 2500_00, desc: 'Nods at everything you say. Like TODD, but nicer.' },
  col_cart:    { emoji: '👾', name: 'Signed BSTG Cartridge',   price: 3000_00, desc: 'Signed by the whole Bastardly Glory dev team. It still has bugs.' },
  col_polygon: { emoji: '🔶', name: 'The First Polygon',       price: 5000_00, desc: 'Minted on day one. Probably.' },
  col_gavel:   { emoji: '🔨', name: "Render Room Mod Gavel",   price: 2500_00, desc: 'Used in the first ever ban. Still warm.' },
  col_brick:   { emoji: '🧱', name: 'The BLU Gold Brick',      price: 3000_00, desc: 'The cornerstone of the first BLU build.' },
  col_abacus:  { emoji: '🧮', name: 'The BNW Abacus',          price: 2500_00, desc: "BNW's original computer. Faster than the new one." },
  col_coin:    { emoji: '🪙', name: "Marquez's Lucky Coin",    price: 4000_00, desc: "Marquez swears it's lucky. Marquez also swears it's not for sale." }
};
const COLLECTIBLE_STOCK = 3;

const SHELVES = {
  work:   { label: 'Work',     emoji: '💼' },
  market: { label: 'Market',   emoji: '📈' },
  casino: { label: 'Rend-Sino', emoji: '🎰' },
  fun:    { label: 'Odds & Ends', emoji: '🎀' },
  tackle: { label: 'Bait & Tackle', emoji: '🎣' },
  style:  { label: 'Profile', emoji: '🎨' },
  rare:   { label: 'Collectible', emoji: '🗃️' }
};

// Marquez behind the counter. One line is picked each time the shop opens.
// Marquez: reserved, kind, a man of few words. He calls everyone friend, pal, kiddo and the like.
// ({n} is where he calls you something.) Don't use his real name anywhere players can see it.
const PET = ['friend', 'pal', 'kiddo', 'bud', 'champ', 'sport', 'my friend'];
const MARQUEZ = [
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
];
const LINES = {
  thanks: ['"Thank you, {n}. Take care of it."', '"Good choice, {n}."', '"Pleasure doing business, {n}."', 'Marquez wraps it up carefully. "There you go, {n}."', '"Use it well, {n}."', 'Marquez nods. "Thanks, {n}."'],
  soldOut: ['"Sorry, {n}. That one\'s all gone for now."', 'Marquez shakes his head. "Sold the last one, {n}. Check back soon."'],
  broke: ['"Ah. Not quite enough, {n}. No shame in it. Come back when you\'re ready."', 'Marquez looks at the Polygons, then at you, kindly. "Not today, {n}. It\'ll keep."'],
  once: ['"One per customer, {n}. Gotta leave some for the others."', 'Marquez smiles a little. "Already got yours, {n}."'],
  catch: ['Marquez looks over your catch. "Nice haul, {n}."', '"These\'ll do fine, {n}," Marquez says, weighing them.', 'Marquez nods at the bucket. "Fresh. Thank you, {n}."', 'Marquez holds one up to the light. "Not bad at all, {n}."'],
  notThisWeek: ['"Not this week, {n}. Something else is on the special shelf."'],
  whale: ['Marquez stares at the White Whale for a long moment. "...Well. I\'ll be. Good work, {n}."'],
  koi: ['Marquez sets down his coffee. "That\'s the real thing, {n}. Careful with it."']
};
// A Marquez line, with whatever he calls you this time
function marquez(kind, random = Math.random) {
  const list = kind === 'greet' ? MARQUEZ : LINES[kind] || MARQUEZ;
  return list[Math.floor(random() * list.length)].replace(/\{n\}/g, () => PET[Math.floor(random() * PET.length)]);
}


const week = (now = Date.now()) => Math.floor(now / WEEK_MS);
const collectibleOfWeek = (now = Date.now()) => { const ids = Object.keys(COLLECTIBLES); return ids[week(now) % ids.length]; };
const isCollectible = (id) => id && id.startsWith('col_');
const any = (id) => ITEMS[id] || COLLECTIBLES[id] || null;

// Restocks everything if an hour has passed (and rolls a new Mystery price). The collectible restocks weekly.
// Returns when the current stock period started.
function restock(db, now = Date.now(), random = Math.random) {
  const last = Number(db.meta('lastRestock') || 0);
  const wk = String(week(now));
  if (db.meta('collectibleWeek') !== wk) {
    db.tx(() => { db.setStock(collectibleOfWeek(now), COLLECTIBLE_STOCK); db.setMeta('collectibleWeek', wk); });
  }
  if (now >= last + RESTOCK_MS) {
    db.tx(() => {
      for (const [id, item] of Object.entries(ITEMS)) db.setStock(id, item.stock);
      const mystery = MYSTERY_MIN + Math.floor(random() * (MYSTERY_MAX - MYSTERY_MIN + 1));
      db.setMeta('mysteryPrice', mystery * 100);
      db.setMeta('lastRestock', now);
    });
    return now;
  }
  return last;
}

// An item's current price in cents
function price(db, id) {
  if (id === 'mystery') return Number(db.meta('mysteryPrice')) || MYSTERY_MIN * 100;
  return any(id).price;
}

// Words players might type for an item: "rocket fuel", "floppy", "insurance policy", "golden nacho"...
function find(text) {
  const t = String(text || '').trim().toLowerCase().replace(/^the\s+/, '').replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  if (!t) return null;
  if (any(t)) return t;
  const all = { ...ITEMS, ...COLLECTIBLES };
  const norm = (s) => s.toLowerCase().replace(/^the\s+/, '').replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]/g, '');
  const paint = 'paint_' + t.replace(/\s*paint$/, '');
  if (all[paint]) return paint;
  return Object.keys(all).find((id) => norm(all[id].name) === t || norm(all[id].name).split(' ').includes(t))
    || Object.keys(all).find((id) => t.length >= 4 && norm(all[id].name).includes(t)) || null;
}

module.exports = { ITEMS, COLLECTIBLES, COLLECTIBLE_STOCK, SHELVES, MARQUEZ, LINES, PET, marquez, RESTOCK_MS, WEEK_MS, restock, price, find, any, isCollectible, collectibleOfWeek };
