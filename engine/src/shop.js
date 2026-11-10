// The shop: items, prices, stock, and hourly restocks. Stock is shared by every server.
// PRICES ARE PLACEHOLDERS: the BDFD prices lived in server variables that weren't in the export.

const RESTOCK_MS = 60 * 60 * 1000;

const ITEMS = {
  coffee:   { emoji: '☕', name: 'Coffee',   price: 50_00,  stock: 5, desc: 'Resets your work cooldown.' },
  overtime: { emoji: '⏰', name: 'Overtime', price: 150_00, stock: 3, desc: 'Your next shift pays double.' },
  mystery:  { emoji: '🎁', name: 'Mystery',  price: 100_00, stock: 5, desc: 'Random Polygons or an Overtime pass. Small jackpot chance.' },
  resume:   { emoji: '📄', name: 'Resume',   price: 200_00, stock: 2, desc: 'Skips the 24h quit lock.' },
  title:    { emoji: '🏷️', name: 'Title',    price: 500_00, stock: 1, desc: 'A custom title on your profile. Set it with `r!settitle`.' }
};

// Restocks everything if an hour has passed. Returns when the current stock period started.
function restock(db, now = Date.now()) {
  const last = Number(db.meta('lastRestock') || 0);
  if (now >= last + RESTOCK_MS) {
    db.tx(() => {
      for (const [id, item] of Object.entries(ITEMS)) db.setStock(id, item.stock);
      db.setMeta('lastRestock', now);
    });
    return now;
  }
  return last;
}

module.exports = { ITEMS, RESTOCK_MS, restock };
