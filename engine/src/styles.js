// Profile customizing: what a player's profile card looks like on the site (and its color in r!profile).
// Styles follow a player to every server. The Customizer Kit (from Marquez) unlocks the free basics:
// any accent color, the preset themes and the basic banners. Profile Paint (also from Marquez) unlocks the
// fancy themes, one each. Legendary achievements unlock the crown banner and the glowing frame.
// The site draws these from names, never raw CSS, so nobody can put anything odd on their page.
const A = require('./achievements');

// Preset themes match the site's section colors (style.css). hex = the accent, shown in Discord too.
const PRESETS = {
  gold: { label: 'Gold', hex: '#ffe600' }, market: { label: 'Market green', hex: '#3ddc84' }, rrm: { label: 'Render Room red', hex: '#ff5c61' },
  nach: { label: 'Nacho orange', hex: '#ff9f1c' }, blu: { label: 'BLU blue', hex: '#4da3ff' }, bnw: { label: 'BNW teal', hex: '#2ee6c5' },
  bstg: { label: 'BSTG purple', hex: '#b46cff' }, bot: { label: 'Blurple', hex: '#8c9bff' }, games: { label: 'Arcade pink', hex: '#ff4fd8' }, notes: { label: 'Cyan', hex: '#38e1ff' }
};
// Profile Paint: bought from Marquez (shop item paint_<id>), then free to use forever
const PAINTS = {
  holo:     { label: 'Holographic',   hex: '#c9a7ff', price: 5000_00, emoji: '🌈', desc: 'Shifts through every color. Very shiny.' },
  terminal: { label: 'TODD Terminal', hex: '#33ff66', price: 3000_00, emoji: '🖥️', desc: 'Green on black, like TODD sees the world.' },
  sunset:   { label: 'Sunset',        hex: '#ff7a59', price: 3000_00, emoji: '🌇', desc: 'Warm orange and pink.' },
  void:     { label: 'Void',          hex: '#e8e8e8', price: 3000_00, emoji: '🕳️', desc: 'Black and white. Nothing else.' },
  goldrush: { label: 'Gold Rush',     hex: '#ffcf33', price: 4000_00, emoji: '🪙', desc: 'Shimmering gold, for the rich (or the hopeful).' }
};
const BANNERS = { gradient: 'Gradient', scanlines: 'Scanlines', honeycomb: 'Honeycomb', grid: 'Grid', stars: 'Stars', crown: 'Crown (legendary achievements)' };
const FRAMES = { none: 'None', glow: 'Glow (legendary achievements)' };
const LEGENDARY_ONLY = new Set(['crown', 'glow']);
const KIT = 'customizer';

const key = (id) => `style:${id}`;
function get(db, userId) { try { return JSON.parse(db.meta(key(userId)) || '{}') || {}; } catch (e) { return {}; } }
function save(db, userId, s) { db.setMeta(key(userId), JSON.stringify(s)); }
const hasKit = (db, userId) => A.get(db, userId, KIT) > 0;
const ownsPaint = (db, userId, id) => A.get(db, userId, `paint_${id}`) > 0;
const legendary = (db, userId) => A.unlocked(db, userId).some((r) => A.BY_ID[r.id] && A.BY_ID[r.id].rarity === 'legendary');

// The accent color as a number, for Discord embeds
function color(db, userId, fallback) {
  const s = get(db, userId);
  const hex = s.color || (s.theme && (PRESETS[s.theme] || PAINTS[s.theme] || {}).hex);
  return hex ? parseInt(hex.slice(1), 16) : fallback;
}

// Changes one setting. Returns { ok: text } or { error: text }.
function set(db, userId, what, value) {
  const s = get(db, userId);
  const v = String(value || '').trim().toLowerCase();
  if (what === 'reset') { save(db, userId, {}); return { ok: 'Your profile is back to the default look.' }; }
  if (what === 'pin') {
    if (!v || v === 'none') { delete s.pin; save(db, userId, s); return { ok: 'Nothing pinned.' }; }
    return { pin: v }; // checked by the command (collectibles are per server)
  }
  if (!hasKit(db, userId)) return { error: 'You need a **Profile Customizer Kit** first. Marquez sells them: `r!shop profile`.' };
  if (what === 'color') {
    const m = v.match(/^#?([0-9a-f]{6})$/);
    if (!m) return { error: 'Colors look like `#ff4fd8`. Any six-digit hex code works.' };
    s.color = `#${m[1]}`;
    if (s.theme && PAINTS[s.theme]) delete s.theme; // a custom color replaces a paint
    save(db, userId, s);
    return { ok: `Your profile color is now **#${m[1]}**.` };
  }
  if (what === 'theme') {
    if (PRESETS[v]) { s.theme = v; delete s.color; save(db, userId, s); return { ok: `Your profile theme is now **${PRESETS[v].label}**.` }; }
    if (PAINTS[v]) {
      if (!ownsPaint(db, userId, v)) return { error: `**${PAINTS[v].label}** is Profile Paint. Buy it from Marquez (\`r!shop profile\`), then \`r!use ${PAINTS[v].label.toLowerCase()} paint\`.` };
      s.theme = v; delete s.color; save(db, userId, s);
      return { ok: `${PAINTS[v].emoji} Your profile is now **${PAINTS[v].label}**.` };
    }
    return { error: `Themes: ${Object.keys(PRESETS).join(', ')}, plus Profile Paint (${Object.keys(PAINTS).join(', ')}).` };
  }
  if (what === 'banner') {
    if (!BANNERS[v]) return { error: `Banners: ${Object.keys(BANNERS).join(', ')}.` };
    if (LEGENDARY_ONLY.has(v) && !legendary(db, userId)) return { error: 'The crown banner is for players with a legendary achievement.' };
    s.banner = v; save(db, userId, s);
    return { ok: `Your banner is now **${BANNERS[v]}**.` };
  }
  if (what === 'frame') {
    if (!FRAMES[v]) return { error: 'Frames: none, glow.' };
    if (LEGENDARY_ONLY.has(v) && !legendary(db, userId)) return { error: 'The glowing frame is for players with a legendary achievement.' };
    s.frame = v; save(db, userId, s);
    return { ok: `Your frame is now **${FRAMES[v]}**.` };
  }
  return { error: null };
}

module.exports = { PRESETS, PAINTS, BANNERS, FRAMES, KIT, get, save, set, color, hasKit, ownsPaint, legendary };
