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
  style:  { label: 'Profile', emoji: '🎨' },
  rare:   { label: 'Collectible', emoji: '🗃️' }
};

// Marquez behind the counter. One line is picked each time the shop opens.
const MARQUEZ = [
  'Marquez looks up from the counter. "Welcome in! Take a look around."',
  'Marquez is restocking a shelf. "Back again? Good taste."',
  '"Everything\'s fair price," Marquez says. "Mostly."',
  'Marquez polishes a Platinum Chip. "Don\'t tell TODD what\'s in the back."',
  '"New stock every hour," Marquez says. "And something special every week."',
  'Marquez slides a coffee across the counter. "On the house. Kidding. That\'s ⬡ 100."'
];

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

module.exports = { ITEMS, COLLECTIBLES, COLLECTIBLE_STOCK, SHELVES, MARQUEZ, RESTOCK_MS, WEEK_MS, restock, price, find, any, isCollectible, collectibleOfWeek };
