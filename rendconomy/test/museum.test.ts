import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { seededRng } from '../src/core/rng';
import { execute } from '../src/discord/router';
import { has } from '../src/achievements/achievements';
import { MUSEUM, WINGS, collectionValue, donate, museumPay, prices, released, sellToGlaz, valueOf, wingsDone } from '../src/museum/museum';
import { addItem, count, takeItem } from '../src/shop/inventory';
import { COLLECTIBLES, HOLIDAY_COLLECTIBLES, ROTATION } from '../src/shop/items';
import { netWorth } from '../src/social/worth';
import { DAY } from '../src/core/time';
import { player } from '../src/core/economy';
import { economy } from '../src/config';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const at = (d: string) => eastern(d, -5);

function setup(start: string) {
  const db = freshDb();
  let now = at(start);
  const ctx = (user: string): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: user, name: `P${user[0]}` }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, run, set: (d: string) => { now = at(d); }, now: () => now };
}

test('collector value: rarer than average is worth more, common less, between 0.5x and 5x', () => {
  const db = freshDb();
  const now = at('2027-02-01T12:00');
  for (let i = 0; i < 20; i++) addItem(db, G, `u${i}`, 'col_nacho');   // very common
  addItem(db, G, A, 'col_coin');                                          // very rare
  for (let i = 0; i < 6; i++) addItem(db, G, `v${i}`, 'col_todd');
  const p = prices(db, now);
  assert.ok(p.col_coin!.cents > COLLECTIBLES.col_coin!.price!, 'the rare one is worth more than Marquez\'s price');
  assert.ok(p.col_nacho!.cents < COLLECTIBLES.col_nacho!.price!, 'the common one less');
  assert.ok(p.col_nacho!.cents >= COLLECTIBLES.col_nacho!.price! * MUSEUM.minMult);
  assert.equal(p.col_gavel!.cents, COLLECTIBLES.col_gavel!.price! * MUSEUM.maxMult, 'none exist: the most it can be');
  assert.equal(p.col_coin!.copies, 1);
  assert.ok(!released(now).some((c) => c.id === 'col_candle1' || c.id === 'col_partyhat'), 'no birthday collectibles before the first party');
  assert.ok(released(at('2027-11-20T12:00')).some((c) => c.id === 'col_candle1'));
  assert.ok(!released(at('2027-11-20T12:00')).some((c) => c.id === 'col_candle2'));
  // the same all day; tomorrow it moves with supply, and the week's change shows
  for (let i = 0; i < 10; i++) addItem(db, G, `w${i}`, 'col_coin');
  assert.equal(prices(db, now + 3_600_000).col_coin!.cents, p.col_coin!.cents);
  const later = prices(db, now + 2 * DAY);
  assert.ok(later.col_coin!.cents < p.col_coin!.cents);
  assert.ok(later.col_coin!.change < 0);
});

test('collectibles count toward net worth at their collector value', async () => {
  const { db, run, now } = setup('2027-02-01T12:00');
  await run('balance');
  const before = netWorth(db, null, G, A);
  addItem(db, G, A, 'col_brick');
  assert.equal(netWorth(db, null, G, A) - before, valueOf(db, 'col_brick'));
  assert.equal(collectionValue(db, G, A), valueOf(db, 'col_brick'));
  void now;
  assert.match(text(await run('collection')), /BLU Gold Brick · \*\*⬡[\d,]+/);
});

test('the museum: donate for 75% and a plaque; Museum Donor; per-exhibit bonus; a wing', async () => {
  const { db, run, now } = setup('2027-02-01T12:00');
  await run('balance'); await run('balance', {}, B);
  addItem(db, G, A, 'col_abacus');
  const each = valueOf(db, 'col_abacus', now()), w0 = balance(db, wallet(G, A));
  const r = text(await run('museum', { action: 'donate the bnw abacus' }));
  assert.match(r, /first of its kind here, so \*\*your name goes on the plaque/);
  assert.ok(balance(db, wallet(G, A)) - w0 >= Math.round(each * MUSEUM.donorShare) - 1);
  assert.equal(count(db, G, A, 'col_abacus'), 0, 'gone for good');
  assert.ok(has(db, A, 'museum_donor'));
  assert.equal(museumPay(db, G), 1 + MUSEUM.perExhibit);
  addItem(db, G, B, 'col_abacus');
  assert.match(text(await run('museum', { action: 'donate', item: 'abacus' }, B)), /already one on display/);
  assert.equal(museumPay(db, G), 1 + MUSEUM.perExhibit, 'a second copy adds nothing');
  for (const id of Object.keys(HOLIDAY_COLLECTIBLES)) { addItem(db, G, A, id); donate(db, G, A, id, now()); }
  assert.ok(wingsDone(db, G, now()).some((w) => w.id === 'winter'));
  assert.match(text(await run('museum')), /✅ \*\*Winter Wing\*\*/);
  assert.ok(audit(db).ok);
});

test('The Curator: every collectible there is, surrendered', () => {
  const db = freshDb();
  const now = at('2027-02-01T12:00');
  player(db, G, A, economy.startingCash, 0);
  const all = released(now).map((c) => c.id);
  let last = { curator: false };
  for (const id of all) { addItem(db, G, A, id); last = donate(db, G, A, id, now); }
  assert.ok(last.curator);
  assert.ok(has(db, A, 'the_curator'));
  assert.equal(WINGS.find((w) => w.id === 'full')!.items(now).length, all.length);
  assert.ok(wingsDone(db, G, now).some((w) => w.id === 'full') && wingsDone(db, G, now).some((w) => w.id === 'founders'));
  assert.equal(ROTATION.length + Object.keys(HOLIDAY_COLLECTIBLES).length, all.length);
});

test('Mr. Glaz buys collectibles: 125%, held a week, one a night, gone for good', () => {
  const db = freshDb();
  const now = at('2027-02-01T23:00');
  player(db, G, A, economy.startingCash, 0);
  db.run('INSERT OR IGNORE INTO collectible_since (guild_id, user_id, item, since) VALUES (?, ?, ?, ?)', G, A, 'col_todd', now - DAY);
  addItem(db, G, A, 'col_todd'); addItem(db, G, A, 'col_cart');
  db.run('UPDATE collectible_since SET since = ? WHERE item = ?', now - 8 * DAY, 'col_cart');
  assert.throws(() => sellToGlaz(db, G, A, 'col_todd', 'n1', now), /glaz.fresh/);
  const each = valueOf(db, 'col_cart', now), w0 = balance(db, wallet(G, A));
  sellToGlaz(db, G, A, 'col_cart', 'n1', now);
  assert.ok(balance(db, wallet(G, A)) - w0 >= Math.round(each * MUSEUM.glazShare) - 1);
  assert.equal(count(db, G, A, 'col_cart'), 0);
  db.run('UPDATE collectible_since SET since = 0');
  assert.throws(() => sellToGlaz(db, G, A, 'col_todd', 'n1', now), /glaz.tonight/);
  sellToGlaz(db, G, A, 'col_todd', 'n2', now + DAY);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM collectible_since WHERE item = 'col_todd'")!.n, 0, 'nothing left to remember');
  void takeItem;
});
