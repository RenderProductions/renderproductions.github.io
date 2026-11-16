import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR } from '../src/core/time';
import { execute } from '../src/discord/router';
import { has } from '../src/achievements/achievements';
import { RARITY } from '../src/achievements/list';
import { ESTATE, KINDS, LOTS, MAP, dayRent, lotsOf, partyUntil, saveLot, settle, taxRate, value } from '../src/estate/estate';
import { erasePlayer } from '../src/core/players';
import { netWorth } from '../src/social/worth';
import { addWeather } from '../src/farming/farming';
import { addItem } from '../src/shop/inventory';
import { approve, found, getCompany, treasuryId } from '../src/companies/companies';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-16T12:00', -5);

function setup() {
  const db = freshDb();
  let now = noon;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: user, name: user === A ? 'Ana' : 'Ben' }, isOwner: false, isMod: false, notes: [] });
  const run = (action = '', lot = '', amount = '', user = A) => execute(find('property')!, ctx(user), { action, lot, amount });
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  const take = (u: string) => transfer(db, { from: wallet(G, u), to: RESERVE, cents: balance(db, wallet(G, u)), reason: 'mod.take' });
  const lot = (n: number) => lotsOf(db, G)[n - 1]!;
  return { db, run, fund, take, lot, ctx, later: (ms: number) => { now += ms; }, now: () => now };
}

test('the map: 15 lots, bank-owned, in the agreed mix', async () => {
  const { db, run } = setup();
  await run('map');
  const lots = lotsOf(db, G);
  assert.equal(lots.length, LOTS);
  const n = (k: string) => MAP.filter((x) => x === k).length;
  assert.deepEqual([n('shack'), n('apartment'), n('shop'), n('lighthouse'), n('mansion')], [6, 4, 3, 1, 1]);
  assert.ok(lots.every((l) => l.status === 'bank' && l.condition === 100));
  assert.match(text(await run('map')), /Shack: for sale, \*\*⬡2,500/);
});

test('buying, then a day of rent, upkeep and wear; nothing is created or lost', async () => {
  const { db, run, fund, lot, later } = setup();
  await run(); fund(A, 10_000);
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('buy', '1')), /Lot 1 is yours/);
  assert.equal(balance(db, wallet(G, A)), before - value('shack') + RARITY.common.pay, 'paid, plus First Home');
  assert.ok(has(db, A, 'first_home'));
  assert.match(text(await run('buy', '1', '', B)), /belongs to Ana/);
  later(2 * DAY + HOUR);
  const mid = balance(db, wallet(G, A));
  const r = text(await run());
  assert.match(r, /Since you last looked/);
  // two days: 60 at 100%, then 60 at 98%; upkeep 15 a day, no tax for one lot
  assert.equal(balance(db, wallet(G, A)) - mid, polygons(60) + Math.floor(polygons(60) * 0.98) - 2 * polygons(15));
  assert.equal(lot(1).condition, 96);
  assert.ok(audit(db).ok);
});

test('property tax climbs with the number of lots, and counts in net worth', async () => {
  const { db, run, fund, later } = setup();
  await run(); fund(A, 50_000);
  for (const n of ['1', '2', '3']) await run('buy', n);
  assert.ok(has(db, A, 'landlord'));
  assert.equal(taxRate(2), 0); assert.equal(taxRate(3), 0.005); assert.equal(taxRate(6), 0.01); assert.equal(taxRate(10), 0.015);
  const mid = balance(db, wallet(G, A));
  later(DAY);
  await run();
  const rent = 3 * polygons(60), upkeep = 3 * polygons(15), tax = 3 * Math.floor(value('shack') * 0.005);
  assert.equal(balance(db, wallet(G, A)) - mid, rent - upkeep - tax);
  assert.ok(netWorth(db, null, G, A) >= balance(db, wallet(G, A)) + 3 * value('shack'));
});

test('a full set pays +50% rent and is announced', async () => {
  const { db, run, fund } = setup();
  await run(); fund(A, 40_000);
  for (const n of ['7', '8', '9']) await run('buy', n);
  const r = text(await run('buy', '10'));
  assert.match(r, /Ana owns every Apartment on the map/);
  assert.ok(has(db, A, 'full_house'));
  const l = lotsOf(db, G)[6]!;
  // Extra Unit (+25% above 75%) and the set bonus (+50%)
  assert.equal(dayRent(l, true), Math.floor(KINDS.apartment.rent * 1.5 * 1.25));
});

test('buyout bids: refused for a fee and a shield, or sold when nobody answers', async () => {
  const { db, run, fund, lot, later } = setup();
  await run(); await run('', '', '', B); fund(A, 5_000); fund(B, 20_000);
  await run('buy', '2');
  assert.match(text(await run('bid', '2', '2000', B)), /at least \*\*⬡3,125/);
  const b0 = balance(db, wallet(G, B));
  assert.match(text(await run('bid', '2', '4000', B)), /Bid sent/);
  assert.equal(balance(db, wallet(G, B)), b0 - polygons(4000), 'held in escrow');
  const a0 = balance(db, wallet(G, A));
  assert.match(text(await run('refuse', '2')), /shielded/);
  assert.equal(a0 - balance(db, wallet(G, A)), polygons(600), '15% of the bid');
  assert.equal(balance(db, wallet(G, B)), b0 + polygons(600), 'refunded, plus the fee');
  assert.match(text(await run('bid', '2', '4000', B)), /shielded from bids/);
  later(ESTATE.shieldDays * DAY + HOUR);
  await run('bid', '2', '4000', B);
  const a1 = balance(db, wallet(G, A));
  later(ESTATE.bidHours * HOUR + 1);
  await run('map', '', '', B);
  assert.equal(lot(2).owner_id, B);
  assert.ok(balance(db, wallet(G, A)) >= a1 + polygons(4000));
  assert.ok(audit(db).ok);
});

test('neglect: squatters move into a run-down place, and one that falls apart is condemned and auctioned', async () => {
  const { db, run, fund, lot, later } = setup();
  await run(); await run('', '', '', B); fund(A, 3_000);
  await run('buy', '3');
  let l = lot(3); l.condition = 39; saveLot(db, l);
  let d = 0;
  for (; d < 15 && !lot(3).squatters; d++) { later(DAY); await run(); }
  assert.equal(lot(3).squatters, 1, 'squatters showed up within 15 days at 20% a day');
  const paidBefore = balance(db, wallet(G, A));
  later(DAY); await run();
  assert.ok(balance(db, wallet(G, A)) <= paidBefore, 'no rent while they squat');
  l = lot(3); l.condition = 3; saveLot(db, l);
  later(2 * DAY);
  const r = text(await run());
  assert.equal(lot(3).status, 'auction', 'condemned at 0%');
  assert.match(r, /was condemned/);
  assert.ok(has(db, A, 'condemned'));
  fund(B, 5_000);
  assert.match(text(await run('bid', '3', '500', B)), /at least \*\*⬡750/);
  await run('bid', '3', '800', B);
  later(ESTATE.auctionHours * HOUR + 1);
  await run('map', '', '', B);
  assert.equal(lot(3).owner_id, B);
  assert.equal(lot(3).condition, ESTATE.auctionCondition);
  assert.ok(audit(db).ok);
});

test('repairs: Fixer-Upper, and squatters leave when the hammering starts; evicting costs 3 days of rent', async () => {
  const { db, run, fund, lot } = setup();
  await run(); fund(A, 10_000);
  await run('buy', '4');
  const l = lot(4); l.condition = 20; l.squatters = 1; saveLot(db, l);
  const r = text(await run('repair', '4'));
  assert.match(r, /20% → \*\*100%\*\*/);
  assert.match(r, /squatters packed up/);
  assert.ok(has(db, A, 'fixer_upper'));
  const l2 = lot(4); l2.squatters = 1; saveLot(db, l2);
  const before = balance(db, wallet(G, A));
  await run('evict', '4');
  assert.equal(before - balance(db, wallet(G, A)), 3 * KINDS.shack.rent);
  assert.equal(lot(4).squatters, 0);
});

test('selling back to the bank pays 80% (less for a wreck)', async () => {
  const { db, run, fund, lot } = setup();
  await run(); fund(A, 10_000);
  await run('buy', '5');
  const b = balance(db, wallet(G, A));
  await run('sell', '5');
  assert.equal(balance(db, wallet(G, A)) - b, value('shack') * 0.8);
  assert.equal(lot(5).status, 'bank');
});

test('perks: Bait Shed, Beacon, Ballroom, Storefront; storms hurt, less with a Lighthouse', async () => {
  const { db, run, fund, lot, later, ctx } = setup();
  await run(); fund(A, 300_000);
  await run('buy', '1');
  addItem(db, G, A, 'rod');
  const b = balance(db, wallet(G, A));
  const fished = text(await execute(find('fish')!, ctx(), {}));
  assert.match(fished, /Bait Shed: free/);
  assert.ok(balance(db, wallet(G, A)) >= b, 'no bait paid');
  await run('buy', '15');
  assert.ok(has(db, A, 'lord_of_the_manor'));
  assert.match(text(await run('party')), /Chat pay is doubled/);
  assert.ok(partyUntil(db, G) > noon);
  assert.match(text(await run('party')), /already going/);
  // the storefront
  found(db, G, A, 'Ana', 'ANA', 'Ana Co', [], noon);
  approve(db, 'ANA', noon);
  await run('buy', '11');
  assert.match(text(await run('storefront', '11', 'ana')), /now runs the storefront/);
  const t0 = balance(db, treasuryId('ANA'));
  // a storm: Shack 1 loses 2 + 6 = 8 without a Lighthouse
  addWeather(db, 'storm', noon + HOUR, noon + 3 * HOUR);
  later(DAY);
  await run();
  assert.ok(balance(db, treasuryId('ANA')) > t0, 'the company got its cut');
  assert.equal(lot(1).condition, 100 - ESTATE.decay - ESTATE.stormDamage);
  await run('buy', '14');
  addWeather(db, 'storm', noon + DAY + HOUR, noon + DAY + 2 * HOUR);
  const c = lot(1).condition;
  later(DAY);
  await run();
  assert.equal(lot(1).condition, c - ESTATE.decay - ESTATE.stormDamage / 2);
  assert.ok(getCompany(db, 'ANA'));
  assert.ok(audit(db).ok);
});

test('an erased player\'s property goes back to the bank', async () => {
  const { db, run, fund, lot } = setup();
  await run(); fund(A, 10_000);
  await run('buy', '6');
  erasePlayer(db, G, A, noon);
  assert.equal(lot(6).status, 'bank');
  assert.equal(lot(6).owner_id, null);
  assert.ok(audit(db).ok);
});
