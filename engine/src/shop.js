// The shop: items, prices, stock, and hourly restocks. Stock is shared by every server.
// Bought items go to the player's inventory and are used later with r!use.

const RESTOCK_MS = 60 * 60 * 1000;
const MYSTERY_MIN = 75;   // Mystery's price is rolled every restock, in whole Polygons
const MYSTERY_MAX = 100;

const ITEMS = {
  coffee:   { emoji: '☕', name: 'Coffee',   price: 100_00,  stock: 5, desc: 'Resets your work cooldown.' },
  overtime: { emoji: '⏰', name: 'Overtime', price: 250_00,  stock: 3, desc: 'Your next shift pays double.' },
  mystery:  { emoji: '🎁', name: 'Mystery',  price: null,    stock: 5, desc: 'Random Polygons or an Overtime pass. Small jackpot chance. Price changes every restock.' },
  resume:   { emoji: '📄', name: 'Resume',   price: 350_00,  stock: 2, desc: 'Skips the 24h quit lock.' },
  title:    { emoji: '🏷️', name: 'Title',    price: 5000_00, stock: 1, desc: 'A custom title on your profile. Set it with `r!settitle`.' }
};

// Restocks everything if an hour has passed (and rolls a new Mystery price).
// Returns when the current stock period started.
function restock(db, now = Date.now(), random = Math.random) {
  const last = Number(db.meta('lastRestock') || 0);
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
  return ITEMS[id].price;
}

module.exports = { ITEMS, RESTOCK_MS, restock, price };
