// The in-bot market (MARKET_ENGINE=bot): ticking, saving, crash and boost controls, and the old state format. Offline:  npm test
const assert = require('assert');
const path = require('path');
const crypto = require('crypto');
const config = require('../src/config');
config.githubToken = ''; config.newsWebhook = ''; config.marketEngine = 'bot'; config.ownerId = '600000000000000001';
global.fetch = async () => ({ ok: false, status: 503, text: async () => 'offline', json: async () => ({}) }); // no network in tests
const db = require('../src/db').open(':memory:');
const market = require('../src/market');
const router = require('../src/router');
const engine = require('../src/marketEngine');

const prices = require(path.join(__dirname, '..', '..', 'prices.json'));
const OWNER = { id: config.ownerId, username: 'render' };
const ctx = (user) => router.makeCtx({ guildId: '1', channelId: 'c', user, guildName: 'T' }, { db, market, client: { user: { id: '9' } } });
async function say(line, user = OWNER) { const p = router.parsePrefix(line); return JSON.stringify(await router.runCommand(p.cmd, ctx(user), p.args)); }

(async () => {
  db.setMeta('mk_old', JSON.stringify(prices));
  market.useLocal();

  // Steps forward from the saved prices, and the bot's feed shows them
  const t0 = Date.parse(prices.updated) + 5 * 60 * 1000;
  const a = await engine.step(db, t0);
  assert.ok(a && a.updated === new Date(t0).toISOString());
  assert.strictEqual((await market.get()).updated, a.updated);
  assert.ok(JSON.parse(db.meta('mk_state')), 'hidden state saved');
  const b = await engine.step(db, t0 + 5 * 60 * 1000);
  assert.notStrictEqual(JSON.stringify(b.prices), JSON.stringify(a.prices), 'prices move');

  // r!boost and r!crash change the market right away
  assert.ok((await say('r!boost start big 2 BNW | BNW strikes gold!')).includes('Boost on'));
  assert.strictEqual(engine.boost(db).strength, 'big');
  assert.deepStrictEqual(engine.boost(db).tickers, ['BNW']);
  let m = await market.get();
  assert.ok(m.boost && m.boost.tickers.join() === 'BNW');
  assert.ok(m.news.some((n) => n.headline === 'BNW strikes gold!'));
  assert.ok((await say('r!boost stop')).includes('Boost stopped'));
  assert.strictEqual((await market.get()).boost, null);

  assert.ok((await say('r!crash start mild 0 1 1')).includes('Crash scheduled'));
  assert.strictEqual((await market.get()).crash.phase, 'crash');
  assert.ok((await say('r!crash end')).includes('Recovery'));
  assert.strictEqual((await market.get()).crash.phase, 'recovery');
  assert.ok((await say('r!crash cancel')).includes('cancelled'));
  assert.strictEqual((await market.get()).crash, null);

  // Only the owner
  assert.ok((await say('r!crash start', { id: '7', username: 'x' })).includes('Only the bot owner'));
  assert.ok((await say('r!boost nonsense')).includes('boost start'));

  // An empty Polygon Reserve crashes the market from inside the bot
  const reserve = require('../src/reserve');
  reserve.move(db, -reserve.get(db));
  assert.strictEqual((await reserve.maybeCrash(db, await market.get())).started, true);
  assert.ok((await market.get()).crash, 'crash running');

  // Reads the GitHub Action's encrypted hidden state
  config.marketSecret = 'shh';
  const key = crypto.createHash('sha256').update('shh').digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify({ v: 2, hello: 1 }), 'utf8'), c.final()]);
  const raw = { encrypted: true, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  assert.strictEqual(engine.openState(raw).hello, 1);
  assert.strictEqual(engine.openState({ encrypted: false, state: { x: 1 } }).x, 1);

  console.log('All market engine tests passed.');
})().catch((e) => { console.error(e); process.exit(1); });
