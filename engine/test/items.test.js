// Marquez's shop: every new item does what it says, and the weekly collectible. Offline:  npm test
const assert = require('assert');
const path = require('path');
const config = require('../src/config');
config.githubToken = '';
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const shop = require('../src/shop');
const effects = require('../src/effects');

const base = require(path.join(__dirname, '..', '..', 'prices.json'));
const snap = (edit) => { const m = JSON.parse(JSON.stringify(base)); m.market = { ...m.market, status: 'open', open: true, halted: false }; m.crash = null; m.boost = null;
  for (const c of m.companies) { m.statuses[c.id] = 'ok'; m.wipes[c.id] = 0; m.prices[c.id] = 45.5; } if (edit) edit(m); return m; };
market.set(snap());

const G = '123456789012345678';
const mk = (id, username) => ({ id, username, send: async () => {} });
const ANA = mk('910000000000000001', 'ana'), BEN = mk('910000000000000002', 'ben');
let random = () => 0.5;
const ctxFor = (u) => ({ ...router.makeCtx({ guildId: G, channelId: 'c', user: u }, { db, market, client: { user: { id: '9' } } }), random: () => random() });
async function say(line, u = ANA, extra = {}) { const p = router.parsePrefix(line); return router.runCommand(p.cmd, ctxFor(u), { ...p.args, ...extra }); }
const text = (o) => (o == null ? '' : typeof o === 'string' ? o : (o.content || '') + JSON.stringify(o.embeds || []));
const buy = async (item, u = ANA) => { db.raw.prepare('DELETE FROM shop_buys').run(); return text(await say(`r!purchase ${item}`, u)); };
const fx = (u = ANA) => effects.get(db, G, u.id);

(async () => {
  for (const u of [ANA, BEN]) { db.player(G, u); db.updatePlayer(G, u.id, { cash: 100000_00 }); }

  // ---- buying by name ----
  assert.ok((await buy('rocket fuel')).includes('Bought a **Rocket Fuel**'));
  assert.ok((await buy("todd's floppy disk")).includes("TODD's Floppy Disk"));
  assert.ok((await buy('insurance')).includes('works on its own'));
  assert.ok((await buy('unicorn')).includes('Which item'));

  // ---- the weekly collectible ----
  const col = shop.collectibleOfWeek();
  const other = Object.keys(shop.COLLECTIBLES).find((id) => id !== col);
  assert.ok((await buy(shop.COLLECTIBLES[other].name)).includes("doesn't have"));
  assert.ok((await buy(shop.COLLECTIBLES[col].name)).includes(`Bought **${shop.COLLECTIBLES[col].name}**`));
  assert.ok(text(await say(`r!purchase ${shop.COLLECTIBLES[col].name}`)).includes('already bought'), 'one per player per week');
  assert.strictEqual(db.stock(col), shop.COLLECTIBLE_STOCK - 1, 'shared stock');
  assert.ok(text(await say('r!inventory')).includes('Collectibles') && text(await say('r!profile')).includes('Collectibles","value":"1"'));
  assert.ok(text(await say(`r!use ${shop.COLLECTIBLES[col].name}`)).includes("doesn't do anything"));
  assert.ok(text(await say('r!shop collectible')).includes("This week's collectible"));

  // ---- Stopwatch: +10 seconds for 3 shifts ----
  await buy('stopwatch');
  assert.ok(text(await say('r!use stopwatch')).includes('next 3 shifts'));
  const work = require('../src/commands/work');
  work.TUNING.tipMax = 0; work.TUNING.kind = 'order';
  db.updatePlayer(G, ANA.id, { job: 'NACH', hired_at: 0, last_work: 0 });
  const shift = await say('r!work');
  assert.ok(text(shift).includes('+10 seconds') && text(shift).includes('**30 seconds**'));
  assert.strictEqual(fx().stopwatch, 2);
  work.active.clear(); router.pending.clear();

  // ---- Platinum Chip: 5 games at +4% ----
  await buy('platinum chip');
  await say('r!use chip');
  const casino = require('../src/casino');
  casino.last.clear();
  random = () => 0.1; // heads
  assert.ok(text(await say('r!coinflip 100 heads')).includes('Polygons'));
  const flipStat = db.raw.prepare("SELECT paid FROM gambling WHERE user_id = ? AND game = 'coinflip'").get(ANA.id);
  assert.strictEqual(flipStat.paid, Math.round(195_00 * 1.04));
  assert.strictEqual(fx().chip, 4);

  // ---- Rocket Fuel: 20% higher ----
  await say('r!use rocket fuel');
  assert.ok(text(await say('r!use fuel')).includes('already full') || db.itemCount(G, ANA.id, 'fuel') === 0);
  casino.last.clear(); casino.sessions.clear();
  random = () => 0.24; // 4x normally
  await say('r!rocket 100');
  const s = casino.sessions.get(`${G}:${ANA.id}`);
  assert.ok(Math.abs(s.crashAt - 4.8) < 1e-9 && s.fuel, 'fuel took 4x to 4.8x');
  casino.sessions.clear();
  random = () => 0.5;

  // ---- Gift Wrap: no fee ----
  await buy('gift wrap');
  await say('r!use gift wrap');
  const c0 = db.player(G, ANA).cash;
  assert.ok(text(await say('r!gift', ANA, { player: BEN, amount: '100' })).includes('Gift wrapped'));
  assert.strictEqual(db.player(G, ANA).cash, c0 - 100_00);
  assert.ok(text(await say('r!gift', ANA, { player: BEN, amount: '100' })).includes('Fee: ⬡ 5.00'), 'only once');

  // ---- Dividend Booster ----
  await buy('dividend booster');
  assert.ok(text(await say('r!use booster')).includes('+50%'));
  assert.ok(effects.active(db, G, ANA.id, 'divBoostUntil'));
  assert.ok(text(await say('r!use booster')).includes('already running') || db.itemCount(G, ANA.id, 'booster') === 0);

  // ---- Insurance: shares survive a bankruptcy ----
  db.updateHolding(G, ANA.id, 'BNW', { shares: 40 });
  market.set(snap((m) => { m.wipes.BNW = 1; }));
  const bal = text(await say('r!balance'));
  assert.ok(bal.includes('Insurance paid out') && db.holding(G, ANA.id, 'BNW').shares === 40, bal);
  assert.strictEqual(db.itemCount(G, ANA.id, 'insurance'), 0, 'used up');
  market.set(snap((m) => { m.wipes.BNW = 2; }));
  await say('r!balance');
  assert.strictEqual(db.holding(G, ANA.id, 'BNW').shares, 0, 'without insurance, wiped');
  market.set(snap());

  // ---- Hard Hat: keeps the job through a layoff ----
  await buy('hard hat');
  market.set(snap((m) => { m.statuses.NACH = 'bankrupt'; }));
  db.updatePlayer(G, ANA.id, { job: 'NACH', last_work: 0 });
  const hh = text(await say('r!work'));
  assert.ok(hh.includes('Hard Hat kept you') && db.player(G, ANA).job === 'NACH', hh);
  work.active.clear(); router.pending.clear();
  market.set(snap());

  // ---- Reference Letter: no demotion ----
  await buy('reference letter');
  db.updateCareer(G, ANA.id, 'NACH', { rank: 2, rev_total: 9, rev_right: 1 });
  db.updatePlayer(G, ANA.id, { last_work: 0 });
  await say('r!work');
  const w = router.pending.get(`c:${ANA.id}`); router.pending.delete(`c:${ANA.id}`);
  const rev = await w.handler({ content: 'wrong' });
  assert.ok(String(rev).includes('Reference Letter') && db.career(G, ANA.id, 'NACH').rank === 2, rev);

  // ---- The Rend Times ----
  await buy('the rend times');
  assert.ok(text(await say('r!use times')).includes('presses are down'), 'no hidden state without the bot market');
  const E = require('../../.github/scripts/market/engine');
  const r = E.tick({ old: base, state: null, now: Date.parse(base.updated) + 300000 });
  db.setMeta('mk_state', JSON.stringify(r.state)); db.setMeta('mk_old', JSON.stringify(r.data));
  db.raw.prepare('DELETE FROM shop_buys').run(); db.setStock('times', 3); await say('r!purchase times');
  const tip = text(await say('r!use times'));
  assert.ok(tip.includes('The Rend Times') && tip.includes('**') && !tip.includes('presses are down'), tip);

  // ---- Megaphone: an ad for your company ----
  const posts = [];
  global.fetch = async (url, o) => { posts.push(JSON.parse(o.body)); return { ok: true }; };
  config.newsWebhook = 'https://example.test/hook';
  const co = require('../src/companies');
  co.found(db, { ticker: 'MEOW', name: 'Meow Industries', owner: ANA, guildId: G });
  db.raw.prepare("UPDATE pc_companies SET status = 'private' WHERE ticker = 'MEOW'").run();
  db.setStock('megaphone', 1); db.raw.prepare('DELETE FROM shop_buys').run(); await say('r!purchase megaphone');
  assert.ok(text(await say('r!use megaphone')).includes("What's the ad"));
  assert.ok(text(await say('r!use megaphone MEOW is hiring @everyone')).includes('on the market news feed'));
  assert.ok(posts[0].embeds[0].title.includes('Meow Industries') && !posts[0].embeds[0].description.includes('@everyone'), 'no mass pings');
  config.newsWebhook = '';

  // ---- TODD's Floppy Disk: every outcome ----
  const floppy = require('../src/floppy');
  const outcomes = [0.1, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9, 0.99].map((x) => floppy.run(ctxFor(BEN), () => x));
  assert.ok(outcomes[0].includes('CORRUPTED') && outcomes[2].includes('DAILY_X2') && outcomes[3].includes('borrows') && outcomes[7].includes('song'));
  assert.strictEqual(fx(BEN).dailyDouble, 1);
  db.updatePlayer(G, BEN.id, { daily_day: '' });
  assert.ok(text(await say('r!daily', BEN)).includes('⬡ 500.00'), 'the next daily pays double');

  // ---- Profile customizing ----
  const styles = require('../src/styles');
  assert.ok(text(await say('r!profile color #ff4fd8')).includes('Customizer Kit'), 'needs the kit first');
  await buy('customizer kit');
  assert.ok(text(await say('r!use kit')).includes('Customizer unlocked'));
  assert.ok(text(await say('r!profile color #ff4fd8')).includes('#ff4fd8'));
  assert.strictEqual(styles.get(db, ANA.id).color, '#ff4fd8');
  assert.ok(text(await say('r!profile color pink')).includes('six-digit'));
  assert.ok(text(await say('r!profile theme market')).includes('Market green'));
  assert.ok(text(await say('r!profile theme holo')).includes('Profile Paint'), 'paints have to be bought');
  db.setStock('paint_holo', 2); await buy('holo paint');
  assert.ok(text(await say('r!use holo paint')).includes('is yours'));
  assert.ok(text(await say('r!profile theme holo')).includes('Holographic'));
  assert.ok(text(await say('r!profile banner stars')).includes('Stars'));
  assert.ok(text(await say('r!profile banner crown')).includes('legendary'), 'crown is for legendary achievers');
  require('../src/achievements').award({ db, guildId: G, user: ANA, notes: [] }, 'jackpot');
  assert.ok(text(await say('r!profile frame glow')).includes('Glow'));
  assert.ok(text(await say(`r!profile pin ${shop.COLLECTIBLES[col].name}`)).includes('pinned'));
  assert.ok(text(await say('r!profile pin golden toaster')).includes('only pin a collectible you own'));
  const card = await say('r!profile');
  assert.strictEqual(card.embeds[0].color, parseInt('c9a7ff', 16), 'Discord shows your color too');
  assert.ok(JSON.stringify((await say('r!profile customize')).embeds[0]).includes('Holographic** ✅'));
  // The site gets the style (as names only)
  const pub = require('../src/profiles').snapshot(db, null).users[ANA.id];
  assert.deepStrictEqual(Object.keys(pub.style).sort(), ['banner', 'frame', 'pin', 'theme']);
  assert.ok(text(await say('r!profile reset')).includes('default'));

  // ---- the shop itself ----
  for (const shelf of ['work', 'market', 'casino', 'fun', 'style', 'rare']) {
    const out = await say(`r!shop ${shelf}`);
    assert.ok(out.embeds[0].author.name === "Marquez's Shop" && out.components.length <= 5 && JSON.stringify(out.embeds[0]).length < 6000, shelf);
  }
  for (const [id, it] of Object.entries({ ...shop.ITEMS, ...shop.COLLECTIBLES })) assert.strictEqual(shop.find(it.name), id, `"${it.name}" finds ${id}`);

  // Marquez's lines always fill in what he calls you
  for (const k of ['greet', 'thanks', 'soldOut', 'broke', 'once', 'catch', 'whale', 'koi']) for (let i = 0; i < 30; i++) assert.ok(!shop.marquez(k).includes('{n}'), k);
  console.log('All item tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
