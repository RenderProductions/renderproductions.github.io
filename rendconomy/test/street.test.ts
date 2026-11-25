import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH, has } from '../src/achievements/achievements';
ACH.pay = false;
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { HOUR, MINUTE } from '../src/core/time';
import { execute, press } from '../src/discord/router';
import { tick } from '../src/market/market';
import { addItem, count } from '../src/shop/inventory';
import { ITEMS } from '../src/shop/items';
import { backOf, buy, factorOf, quote, restock, sellBackPrice, stockOf } from '../src/shop/shop';
import { LOYALTY, STREET, TUNING, dailyDeal, featuredShelf, isFriday, lastDelivery, levelOf, nextDelivery, regular, truckDue, wish, wishNotices, wishlist } from '../src/shop/street';
import { buyFrom, listings, stock, sweepStores } from '../src/shop/stores';
import { saveLot, type Lot } from '../src/estate/estate';

const G = 'g1', G2 = 'g2', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const friday = eastern('2026-11-27T12:00', -5);   // Black Friday itself
const tuesday = eastern('2026-11-24T12:00', -5);

function setup(start = tuesday, prices = true) {
  TUNING.prices = prices;
  const db = freshDb();
  tick(db, seededRng(5), start);
  let now = start;
  const ctx = (user = A, guildId = G): Ctx => ({ db, config: botConfig(), rng: seededRng(7), now, guildId, channelId: 'c', user: { id: user, name: user }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A, guildId = G) => execute(find(name)!, ctx(user, guildId), args);
  const fund = (user: string, p: number, guildId = G) => transfer(db, { from: RESERVE, to: wallet(guildId, user), cents: polygons(p), reason: 'mod.give' });
  return { db, ctx, run, fund, at: () => now, later: (ms: number) => { now += ms; } };
}
const done = () => { TUNING.prices = false; };

test('the truck comes at 8 AM, 2 PM and 8 PM Eastern', () => {
  const t = eastern('2026-11-24T13:59', -5);
  assert.equal(lastDelivery(t), eastern('2026-11-24T08:00', -5));
  assert.equal(nextDelivery(t), eastern('2026-11-24T14:00', -5));
  assert.equal(lastDelivery(eastern('2026-11-24T07:00', -5)), eastern('2026-11-23T20:00', -5));
  assert.equal(nextDelivery(eastern('2026-11-24T21:00', -5)), eastern('2026-11-25T08:00', -5));
  assert.ok(isFriday(friday) && !isFriday(tuesday));
});

test('stock is per server, the truck refills it, and it announces itself after the head start', async () => {
  const { db, run, fund, at, later } = setup(tuesday, false);
  await run('balance'); await run('balance', {}, A, G2);
  fund(A, 10_000); fund(A, 10_000, G2);
  await run('purchase', { item: 'coffee 5' });
  assert.equal(stockOf(db, G, 'coffee'), 0);
  restock(db, seededRng(1), G2, at());
  assert.equal(stockOf(db, G2, 'coffee'), 5, 'another server has its own shelf');
  assert.equal(truckDue(db, G, at()), null, 'the first fill is silent');
  later(2 * HOUR);   // 2 PM
  assert.ok(restock(db, seededRng(1), G, at()).delivered);
  assert.equal(stockOf(db, G, 'coffee'), 5);
  assert.equal(truckDue(db, G, at()), null, 'Good Friends get their head start first');
  later(STREET.headStartMs);
  assert.ok(truckDue(db, G, at()));
  assert.equal(truckDue(db, G, at()), null, 'announced once');
  assert.ok(audit(db).ok);
  done();
});

test('prices move with demand at each delivery, within limits', async () => {
  const { db, run, fund, at, later } = setup();
  await run('balance');
  fund(A, 20_000);
  await run('purchase', { item: 'coffee 5' });       // sold out
  later(2 * HOUR); restock(db, seededRng(1), G, at());
  assert.equal(factorOf(db, G, 'coffee'), 1 + STREET.factor.up);
  assert.equal(factorOf(db, G, 'stopwatch'), 1 - STREET.factor.down, 'nobody bought a stopwatch');
  for (let i = 0; i < 30; i++) { later(6 * HOUR); restock(db, seededRng(1), G, at()); }
  assert.equal(factorOf(db, G, 'stopwatch'), STREET.factor.min, 'never below the floor');
  const q = quote(db, G, 'stopwatch', null, at());
  assert.ok(q.each < q.base);
  assert.equal(quote(db, G, 'title', null, at()).each, ITEMS.title!.price, 'the Title never moves');
  done();
});

test('the daily deal, Black Friday (featured shelf and the rest), the best sale wins', () => {
  const { db } = setup(friday);
  restock(db, seededRng(1), G, friday);
  const shelf = featuredShelf(friday);
  const featured = Object.values(ITEMS).find((i) => regular(i) && i.shelf === shelf && i.id !== dailyDeal(friday))!;
  const other = Object.values(ITEMS).find((i) => regular(i) && i.shelf !== shelf && i.id !== dailyDeal(friday))!;
  assert.equal(quote(db, G, featured.id, null, friday).sale?.off, STREET.friday.featured);
  assert.equal(quote(db, G, other.id, null, friday).sale?.off, STREET.friday.rest);
  const deal = quote(db, G, dailyDeal(friday), null, friday);
  assert.ok(deal.sale && deal.sale.off >= STREET.dailyDeal, 'the deal is at least 30%, or the featured 40% if better');
  const tue = quote(db, G, dailyDeal(tuesday), null, tuesday);
  assert.equal(tue.sale?.why, 'deal');
  assert.equal(quote(db, G, 'title', null, friday).sale, null);
  assert.equal(dailyDeal(tuesday), dailyDeal(tuesday + HOUR), 'one deal all day');
  done();
});

test('buying cheap and selling back never pays', () => {
  const { db } = setup(friday);
  restock(db, seededRng(1), G, friday);
  const cheapest = STREET.factor.min * (1 - STREET.friday.featured) * (1 - LOYALTY[LOYALTY.length - 1]!.off);
  for (const it of Object.values(ITEMS).filter((i) => regular(i))) {
    assert.ok(sellBackPrice(db, G, it.id) < Math.floor(it.price! * cheapest), it.id);
  }
  done();
});

test('loyalty: spending moves you up a level, with a discount and an achievement', async () => {
  const { db, run, fund, ctx } = setup();
  await run('balance');
  fund(A, 60_000);
  const r = buy(db, ctx().rng, G, A, 'title', 1, ctx().now);   // ⬡5,000, never discounted, still counts
  assert.equal(r.level?.id, 'familiar');
  assert.equal(levelOf(db, G, A).id, 'familiar');
  assert.ok(has(db, A, 'familiar_face'));
  const q = quote(db, G, 'stopwatch', A, ctx().now);
  assert.equal(q.loyalty, 0.02);
  assert.match(text(await run('shop', { shelf: 'card' })), /Familiar Face[\s\S]*Spent here: ⬡5,000/);
  done();
});

test('the back room: Family can buy past the shelf on rare items', async () => {
  const { db, run, fund, ctx } = setup(tuesday, false);
  await run('balance'); await run('balance', {}, B);
  fund(A, 10_000); fund(B, 10_000);
  db.run('INSERT INTO shop_loyalty (guild_id, user_id, spent) VALUES (?, ?, ?)', G, A, LOYALTY.find((l) => l.id === 'family')!.spent);
  restock(db, seededRng(1), G, ctx().now);
  assert.equal(backOf(db, G, 'megaphone'), 1);
  buy(db, ctx().rng, G, B, 'megaphone', 1, ctx().now);
  assert.throws(() => buy(db, ctx().rng, G, B, 'megaphone', 1, ctx().now), /sold out/);
  const r = buy(db, ctx().rng, G, A, 'megaphone', 1, ctx().now);
  assert.equal(r.fromBack, 1);
  assert.ok(has(db, A, 'in_the_back'));
  done();
});

test('wishlists: Good Friends hear first, everyone else after the head start; buying takes it off', async () => {
  const { db, run, fund, ctx, at, later } = setup(tuesday, false);
  await run('balance'); await run('balance', {}, B);
  fund(A, 10_000);
  db.run('INSERT INTO shop_loyalty (guild_id, user_id, spent) VALUES (?, ?, ?)', G, B, LOYALTY.find((l) => l.id === 'friend')!.spent);
  assert.match(text(await run('shop', { shelf: 'want', details: 'coffee' })), /On your wishlist: .*Coffee/);
  wish(db, G, B, 'coffee', at());
  assert.match(text(await run('shop', { shelf: 'want', details: 'golden nacho' })), /regular shelves/);
  later(2 * HOUR); restock(db, seededRng(1), G, at());
  assert.deepEqual(wishNotices(db, G, at()).map((n) => n.userId), [B], 'the Good Friend first');
  assert.deepEqual(wishNotices(db, G, at()), [], 'once');
  later(STREET.headStartMs);
  assert.deepEqual(wishNotices(db, G, at()).map((n) => n.userId), [A]);
  const r = buy(db, ctx().rng, G, A, 'coffee', 1, at());
  assert.ok(r.wished);
  assert.deepEqual(wishlist(db, G, A), []);
  assert.ok(has(db, A, 'worth_the_wait'));
  done();
});

function cornerShop(db: ReturnType<typeof freshDb>, owner: string, lot: number, now: number, condition = 100): Lot {
  const l: Lot = { guild_id: G, lot, kind: 'shop', owner_id: owner, status: 'owned', level: 1, condition, settled_at: now, built_at: now - HOUR, build_until: now - MINUTE, spent: polygons(21_000),
    squatters: 0, shield_until: 0, storefront: null, auction_until: null, bidder_id: null, bid_cents: 0, bid_until: null };
  saveLot(db, l);
  return l;
}

test('player stores: stock a Corner Shop at any price, others buy, the owner keeps the price', async () => {
  const { db, run, fund, ctx, at } = setup(tuesday, false);
  await run('balance'); await run('balance', {}, B);
  fund(B, 10_000);
  addItem(db, G, A, 'coffee', 6);
  assert.match(text(await run('shop', { shelf: 'stock', details: 'coffee 3 at 150' })).replace(/\s+/g, ' '), /Corner Shop/);
  const l = cornerShop(db, A, 20, at());
  const r = await run('shop', { shelf: 'stock', details: 'coffee 3 at 150' });
  assert.match(text(r), /On the shelf at .*3 × .*Coffee.* at \*\*⬡150\.00\*\*/);
  assert.equal(count(db, G, A, 'coffee'), 3);
  await run('shop', { shelf: 'stock', details: 'coffee 1 at 9999' });
  assert.equal(listings(db, G, A)[0]!.qty, 4, 'restocking the same item adds to it');
  assert.equal(listings(db, G, A)[0]!.price, polygons(9999), 'no price cap');
  const before = balance(db, wallet(G, A));
  const store = await run('shop', { shelf: `<@${A}>` }, B);
  assert.match(text(store), /store[\s\S]*Coffee\*\* × 4/);
  const pressed = press(ctx(B), sessions.buttonId(store.session!, `sbuy:${listings(db, G, A)[0]!.id}`));
  assert.match(text(pressed.update), /Bought Coffee/);
  assert.equal(balance(db, wallet(G, A)) - before, polygons(9999));
  assert.equal(count(db, G, B, 'coffee'), 1);
  assert.ok(has(db, A, 'grand_opening'));
  assert.throws(() => buyFrom(db, G, A, listings(db, G, A)[0]!.id, 1, at()), /your own shelf/);
  // a run-down shop closes; a gone one hands the stock back
  saveLot(db, { ...l, condition: 10 });
  assert.throws(() => buyFrom(db, G, B, listings(db, G, A)[0]!.id, 1, at()), /closed/);
  db.run('DELETE FROM estates WHERE guild_id = ? AND lot = ?', G, 20);
  assert.equal(sweepStores(db, G, at()), 1);
  assert.equal(count(db, G, A, 'coffee'), 5, '6, less the one B bought');
  assert.throws(() => stock(db, G, A, 'coffee', 1, 100, at()), /Corner Shop/);
  assert.ok(audit(db).ok);
  done();
});

test('the panel: Main Street hub, dropdowns, item detail, Barnaby\'s', async () => {
  const { db, run, fund, ctx } = setup(friday);
  await run('balance');
  fund(A, 5_000);
  const hub = await run('shop');
  assert.match(text(hub), /Main Street[\s\S]*Daily deal[\s\S]*Black Friday[\s\S]*Barnaby[\s\S]*Player stores/);
  const shelf = press(ctx(), sessions.buttonId(hub.session!, 'go:shelf'));
  assert.ok(shelf.update?.buttons?.[0]?.[0]?.options, 'a shelf dropdown');
  const market = press(ctx(), `${sessions.buttonId(hub.session!, 'shelf')}:market`);   // a dropdown pick
  assert.match(text(market.update), /Market[\s\S]*Dividend Booster/);
  const look = press(ctx(), `${sessions.buttonId(hub.session!, 'look')}:booster`);
  assert.match(text(look.update), /Dividend Booster[\s\S]*Price:[\s\S]*Stock:/);
  const b = press(ctx(), sessions.buttonId(hub.session!, 'buy:booster:1'));
  assert.match(text(b.update), /1 × .*Dividend Booster/);
  const w = press(ctx(), sessions.buttonId(hub.session!, 'wish:coffee'));
  assert.match(text(w.update), /On your wishlist/);
  const docks = await run('fish', { action: 'shop' });
  assert.match(text(docks), /Barnaby's Bait & Tackle[\s\S]*Lure[\s\S]*Fiberglass Rod/);
  assert.match(text(await run('fish', { action: 'buy lure' })), /Lure/);
  assert.equal(count(db, G, A, 'lure'), 1);
  done();
});

test('no two buttons in a Main Street view share an id (Discord refuses the message)', async () => {
  const { run, fund, ctx } = setup(friday);
  await run('balance');
  fund(A, 100);   // can afford exactly one, so "Buy max" would be 1
  const hub = await run('shop');
  for (const v of ['go:shelf', 'go:barnaby', 'go:stores', 'go:card', 'go:hub']) {
    const r = press(ctx(), sessions.buttonId(hub.session!, v));
    const ids = (r.update?.buttons ?? []).flat().map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, v);
  }
  for (const id of Object.keys(ITEMS).filter((i) => regular(ITEMS[i]))) {
    const r = press(ctx(), `${sessions.buttonId(hub.session!, 'look')}:${id}`);
    const ids = (r.update?.buttons ?? []).flat().map((b) => b.id);
    assert.equal(new Set(ids).size, ids.length, id);
    assert.ok((r.update?.buttons ?? []).length <= 5 && (r.update?.buttons ?? []).every((row) => row.length <= 5));
  }
  done();
});
