import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE, ensureEscrow, escrow } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR } from '../src/core/time';
import { execute } from '../src/discord/router';
import { has } from '../src/achievements/achievements';
import { RARITY } from '../src/achievements/list';
import { ESTATE, KINDS, around, effects, lotAt, lotsOf, parseTile, partyUntil, saveLot, taxRate, tileName, trainsOf, value } from '../src/estate/estate';
import { LANDMARKS, STATUE_RENT, isBuilt } from '../src/estate/landmarks';
import { erasePlayer } from '../src/core/players';
import { netWorth } from '../src/social/worth';
import { addWeather, plotCount, setPlotCount } from '../src/farming/farming';
import { addItem, count } from '../src/shop/inventory';
import { approve, found, getCompany, treasuryId } from '../src/companies/companies';
import { UG, tonight } from '../src/underground/underground';
import { runHeist } from '../src/heists/heists';
import { runFixes } from '../src/fixes';
import { player } from '../src/core/economy';

const G = 'g1', A = '111111111111111111', B = '222222222222222222', C = '333333333333333333';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-16T12:00', -5);
const NAMES: Record<string, string> = { [A]: 'Ana', [B]: 'Ben', [C]: 'Cy' };

function setup() {
  const db = freshDb();
  runFixes(db, noon);
  let now = noon;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: user, name: NAMES[user]! }, isOwner: false, isMod: false, notes: [] });
  const run = (action = '', lot = '', amount = '', user = A) => execute(find('property')!, ctx(user), { action, lot, amount });
  const fund = (u: string, p: number) => { player(db, G, u, 0, now); db.run('UPDATE players SET name = ? WHERE guild_id = ? AND user_id = ?', NAMES[u] ?? 'r', G, u); transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' }); };
  const at = (name: string) => lotAt(lotsOf(db, G), parseTile(name)!);
  return { db, run, fund, at, ctx, later: (ms: number) => { now += ms; }, now: () => now };
}

test('tiles: names, parsing and neighbors on the 8×8 grid', () => {
  assert.equal(tileName(1), 'A1'); assert.equal(tileName(64), 'H8'); assert.equal(tileName(20), 'D3');
  assert.equal(parseTile('d3'), 20); assert.equal(parseTile('3D'), 20); assert.equal(parseTile('#20'), 20); assert.equal(parseTile('I1'), null); assert.equal(parseTile('65'), null);
  assert.equal(around(1).length, 3, 'a corner has 3 neighbors');
  assert.equal(around(20).length, 8);
  assert.equal(around(20, 2).length, 24, 'D3 has a full 5×5 around it');
  assert.equal(around(10, 2).length, 15, 'B2 is cut off by two edges');
});

test('the map starts empty; building takes the price plus the land, and real time', async () => {
  const { db, run, fund, at, later } = setup();
  assert.equal(lotsOf(db, G).length, 0);
  assert.match(text(await run('map')), /Open land, all 64 tiles/);
  fund(A, 10_000);
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('build', 'C4', 'shack')), /Breaking ground on C4/);
  assert.equal(before - balance(db, wallet(G, A)), KINDS.shack.price + ESTATE.land - RARITY.common.pay, 'paid, plus First Home');
  assert.ok(has(db, A, 'first_home'));
  assert.equal(at('C4')!.build_until, noon + HOUR);
  assert.match(text(await run('build', 'C4', 'park', B)), /belongs to Ana/);
  assert.match(text(await run('build', 'C4', 'castle')), /Build what/);
  assert.ok(!has(db, A, 'groundbreaking'));
  later(HOUR + 1);
  const r = text(await run());
  assert.match(r, /is finished/);
  assert.ok(has(db, A, 'groundbreaking'));
  // a day: 60 rent, 15 upkeep, no tax for one building; then 2 points of wear
  const mid = balance(db, wallet(G, A));
  later(DAY);
  await run();
  assert.equal(balance(db, wallet(G, A)) - mid, polygons(60) - polygons(15));
  assert.equal(at('C4')!.condition, 98);
  assert.ok(audit(db).ok);
});

test('neighbors: Parks lift rent, Factories pollute, Stations bring trade, Shops love homes', async () => {
  const { db, run, fund, at, later } = setup();
  fund(A, 200_000); fund(B, 100_000);
  await run('build', 'D4', 'shack');
  await run('build', 'E4', 'park');
  await run('build', 'D6', 'station');
  later(5 * HOUR);
  await run();
  let fx = effects(lotsOf(db, G), at('D4')!, noon + 5 * HOUR);
  assert.equal(fx.parks, 1); assert.ok(fx.rail);
  assert.ok(Math.abs(fx.mult - (1 + ESTATE.park + ESTATE.rail)) < 1e-9);
  // Ben builds a Factory next to Ana's Shack: Not in My Backyard, and pollution
  await run('build', 'C4', 'factory', B);
  assert.ok(has(db, A, 'not_in_my_backyard'));
  assert.ok(has(db, B, 'smokestack') === false, 'Smokestack comes when it\'s finished');
  later(7 * HOUR);
  await run('', '', '', B);
  assert.ok(has(db, B, 'smokestack'));
  fx = effects(lotsOf(db, G), at('D4')!, noon + 12 * HOUR);
  assert.equal(fx.factories, 1);
  assert.ok(Math.abs(fx.mult - (1 + ESTATE.park + ESTATE.rail - ESTATE.pollution)) < 1e-9);
  // industrial buildings don't mind the smoke
  assert.equal(effects(lotsOf(db, G), { lot: parseTile('C5')!, kind: 'station' }, noon + 12 * HOUR).factories, 0);
  // a Corner Shop next to homes
  await run('build', 'E5', 'shop');
  assert.equal(effects(lotsOf(db, G), at('E5')!, noon + DAY).customers, 1);
  // the Factory makes Goods
  later(DAY);
  await run('', '', '', B);
  assert.equal(count(db, G, B, 'goods'), ESTATE.goodsPerDay);
  assert.ok(audit(db).ok);
});

test('rules: Lighthouses on the edge, one Barn each, and the Barn unlocks 6 more farm plots', async () => {
  const { db, run, fund, ctx, later } = setup();
  fund(A, 200_000);
  assert.match(text(await run('build', 'D4', 'lighthouse')), /edge of the map/);
  assert.match(text(await run('build', 'A4', 'lighthouse')), /Breaking ground/);
  await run('build', 'B2', 'barn');
  assert.match(text(await run('build', 'B3', 'barn')), /already have a Barn/);
  setPlotCount(db, G, A, 9);
  assert.match(text(await execute(find('buyplot')!, ctx(), {})), /still|Barn on the city map/);
  later(5 * HOUR);
  await run();
  assert.ok(has(db, A, 'old_macdonald'));
  for (let i = 0; i < 6; i++) await execute(find('buyplot')!, ctx(), {});
  assert.equal(plotCount(db, G, A), 15);
  assert.ok(has(db, A, 'fifteen_acres'));
  assert.match(text(await execute(find('buyplot')!, ctx(), {})), /all 15 plots/);
  // the farm never has more than 3 rows: 3 rows of 5
  const farm = await execute(find('farm')!, ctx(), {});
  const rows = (farm?.content ?? '').split('\n');
  assert.equal(rows.length, 3);
});

test('upgrades: cost, construction time, and more rent', async () => {
  const { db, run, fund, at, later } = setup();
  fund(A, 50_000);
  await run('build', 'B2', 'apartment');
  assert.match(text(await run('upgrade', 'B2')), /under construction/);
  later(3 * HOUR + 1);
  await run();
  const b = balance(db, wallet(G, A));
  assert.match(text(await run('upgrade', 'B2')), /level 2/);
  assert.equal(b - balance(db, wallet(G, A)), Math.ceil(KINDS.apartment.price * 0.75));
  assert.equal(at('B2')!.level, 2);
  later(2 * HOUR); await run();
  await run('upgrade', 'B2');
  later(2 * HOUR); await run();
  assert.equal(at('B2')!.level, 3);
  assert.ok(has(db, A, 'skyline'));
  assert.match(text(await run('upgrade', 'B2')), /top level/);
  assert.equal(value(at('B2')!), KINDS.apartment.price + ESTATE.land + Math.ceil(KINDS.apartment.price * 0.75) + Math.ceil(KINDS.apartment.price * 1.25));
});

test('property tax climbs with the number of buildings, and counts in net worth', async () => {
  const { db, run, fund, later } = setup();
  fund(A, 50_000);
  for (const t of ['A1', 'C1', 'E1', 'G1']) await run('build', t, 'shack');
  assert.ok(has(db, A, 'landlord'));
  assert.equal(taxRate(3), 0); assert.equal(taxRate(4), 0.005); assert.equal(taxRate(9), 0.01); assert.equal(taxRate(17), 0.015);
  later(HOUR + 1); await run();
  const mid = balance(db, wallet(G, A));
  later(DAY);
  await run();
  const v = KINDS.shack.price + ESTATE.land;
  assert.equal(balance(db, wallet(G, A)) - mid, 4 * polygons(60) - 4 * polygons(15) - 4 * Math.floor(v * 0.005));
  assert.ok(netWorth(db, null, G, A) >= balance(db, wallet(G, A)) + 4 * v);
});

test('Full House: three of a kind in a row', async () => {
  const { db, run, fund } = setup();
  fund(A, 20_000);
  await run('build', 'A1', 'shack'); await run('build', 'B1', 'shack');
  assert.ok(!has(db, A, 'full_house'));
  await run('build', 'C1', 'shack');
  assert.ok(has(db, A, 'full_house'));
});

test('buyout bids: refused for a fee and a shield, or sold when nobody answers', async () => {
  const { db, run, fund, at, later } = setup();
  await run('', '', '', B); fund(A, 5_000); fund(B, 20_000);
  await run('build', 'B2', 'shack');
  const min = Math.ceil((KINDS.shack.price + ESTATE.land) * ESTATE.bidOver);
  assert.match(text(await run('bid', 'B2', '2000', B)), new RegExp(`at least \\*\\*⬡${(min / 100).toLocaleString('en-US')}`));
  const b0 = balance(db, wallet(G, B));
  assert.match(text(await run('bid', 'B2', '5000', B)), /Bid sent/);
  assert.equal(balance(db, wallet(G, B)), b0 - polygons(5000), 'held in escrow');
  const a0 = balance(db, wallet(G, A));
  assert.match(text(await run('refuse', 'B2')), /shielded/);
  assert.equal(a0 - balance(db, wallet(G, A)), polygons(750), '15% of the bid');
  assert.equal(balance(db, wallet(G, B)), b0 + polygons(750), 'refunded, plus the fee');
  assert.match(text(await run('bid', 'B2', '5000', B)), /shielded from bids/);
  later(ESTATE.shieldDays * DAY + HOUR);
  await run('bid', 'B2', '5000', B);
  const a1 = balance(db, wallet(G, A));
  later(ESTATE.bidHours * HOUR + 1);
  await run('map', '', '', B);
  assert.equal(at('B2')!.owner_id, B);
  assert.ok(balance(db, wallet(G, A)) >= a1 + polygons(5000));
  assert.ok(audit(db).ok);
});

test('neglect: squatters, condemnation, an auction, and a wreck nobody wants is torn down', async () => {
  const { db, run, fund, at, later } = setup();
  await run('', '', '', B); fund(A, 10_000);
  await run('build', 'C3', 'shack');
  await run('build', 'F6', 'shack');
  later(HOUR + 1); await run();
  let l = at('C3')!; l.condition = 39; saveLot(db, l);
  for (let d = 0; d < 15 && !at('C3')!.squatters; d++) { later(DAY); await run(); }
  assert.equal(at('C3')!.squatters, 1, 'squatters showed up within 15 days at 20% a day');
  l = at('C3')!; l.condition = 3; saveLot(db, l);
  const f = at('F6')!; f.condition = 3; saveLot(db, f);
  later(2 * DAY);
  const r = text(await run());
  assert.equal(at('C3')!.status, 'auction', 'condemned at 0%');
  assert.match(r, /was condemned/);
  assert.ok(has(db, A, 'condemned'));
  fund(B, 5_000);
  await run('bid', 'C3', '2000', B);
  later(ESTATE.auctionHours * HOUR + 1);
  await run('map', '', '', B);
  assert.equal(at('C3')!.owner_id, B);
  assert.equal(at('C3')!.condition, ESTATE.auctionCondition);
  assert.equal(at('F6'), undefined, 'nobody bid on F6: torn down');
  assert.ok(audit(db).ok);
});

test('repairs, evictions, and selling back to the bank', async () => {
  const { db, run, fund, at } = setup();
  fund(A, 10_000);
  await run('build', 'D4', 'shack');
  const l = at('D4')!; l.condition = 20; l.squatters = 1; saveLot(db, l);
  const r = text(await run('repair', 'D4'));
  assert.match(r, /20% → \*\*100%\*\*/);
  assert.match(r, /squatters packed up/);
  assert.ok(has(db, A, 'fixer_upper'));
  const l2 = at('D4')!; l2.squatters = 1; saveLot(db, l2);
  const before = balance(db, wallet(G, A));
  await run('evict', 'D4');
  assert.equal(before - balance(db, wallet(G, A)), 3 * Math.max(KINDS.shack.rent, ESTATE.land / 10));
  const b = balance(db, wallet(G, A));
  await run('sell', 'D4');
  assert.equal(balance(db, wallet(G, A)) - b, (KINDS.shack.price + ESTATE.land) * 0.8);
  assert.equal(at('D4'), undefined);
});

test('perks: Bait Shed, Ballroom, Storefront, Bank Branch; storms hurt, less with a Lighthouse; Police keep squatters off', async () => {
  const { db, run, fund, at, later, ctx } = setup();
  fund(A, 400_000);
  await run('build', 'B2', 'shack');
  later(HOUR + 1); await run();
  addItem(db, G, A, 'rod');
  const b = balance(db, wallet(G, A));
  assert.match(text(await execute(find('fish')!, ctx(), {})), /Bait Shed: free/);
  assert.ok(balance(db, wallet(G, A)) >= b, 'no bait paid');
  await run('build', 'F6', 'mansion');
  assert.match(text(await run('party')), /isn't ready/);
  later(12 * HOUR); await run();
  assert.ok(has(db, A, 'lord_of_the_manor'));
  assert.match(text(await run('party')), /Chat pay is doubled/);
  assert.ok(partyUntil(db, G) > noon);
  // the storefront
  found(db, G, A, 'Ana', 'ANA', 'Ana Co', [], noon);
  approve(db, 'ANA', noon);
  await run('build', 'D7', 'shop');
  later(6 * HOUR); await run();
  assert.match(text(await run('storefront', 'D7', 'ana')), /now runs the storefront/);
  const t0 = balance(db, treasuryId('ANA'));
  // a storm: the Shack loses 2 + 6 = 8 without a Lighthouse
  const s0 = at('B2')!.condition, t = noon + 19 * HOUR;
  addWeather(db, 'storm', t + HOUR, t + 3 * HOUR);
  later(DAY); await run();
  assert.ok(balance(db, treasuryId('ANA')) > t0, 'the company got its cut');
  assert.equal(at('B2')!.condition, s0 - ESTATE.decay - ESTATE.stormDamage);
  await run('build', 'A8', 'lighthouse');
  later(8 * HOUR); await run();
  const c = at('B2')!.condition;
  addWeather(db, 'storm', noon + 2 * DAY + 4 * HOUR, noon + 2 * DAY + 6 * HOUR);
  later(DAY); await run();
  assert.equal(at('B2')!.condition, c - ESTATE.decay - ESTATE.stormDamage / 2);
  // Police: no squatters next door
  await run('build', 'C2', 'police');
  later(6 * HOUR); await run();
  assert.ok(effects(lotsOf(db, G), at('B2')!, ctx().now).watched);
  assert.ok(has(db, A, 'law_and_order'));
  assert.ok(getCompany(db, 'ANA'));
  assert.ok(audit(db).ok);
});

test('freight: a Station ships the basket and the Goods, and a heist crew can rob the train', async () => {
  const { db, run, fund, ctx, later } = setup();
  fund(A, 50_000);
  assert.match(text(await run('freight')), /need a finished Station/);
  await run('build', 'H1', 'station');
  later(4 * HOUR + 1);
  assert.match(text(await run('freight')), /Nothing to ship/);
  addItem(db, G, A, 'crop_pumpkin', 10);
  addItem(db, G, A, 'goods', 20);
  assert.match(text(await run('freight')), /All aboard/);
  assert.ok(has(db, A, 'special_delivery'));
  assert.equal(count(db, G, A, 'crop_pumpkin'), 0);
  const [f] = trainsOf(db, G, ctx().now);
  assert.ok(f && f.cents > 20 * ESTATE.freightGoods);
  assert.match(text(await run('freight')), /next train can leave/);
  // three robbers
  for (const u of [B, C, '444444444444444444']) fund(u, 1_000);
  const crew = [B, C, '444444444444444444'].map((id, i) => ({ id, name: `r${i}`, role: (['hacker', 'driver', 'lookout'] as const)[i]! }));
  const rng = { next: () => 0.01, chance: () => true, int: (a: number) => a, pick: <T>(l: readonly T[]) => l[0]!, shuffle: <T>(l: readonly T[]) => [...l] } as unknown as Parameters<typeof runHeist>[4];
  const r = runHeist(db, G, 'train', crew, rng, ctx().now);
  assert.equal(r.outcome, 'clean');
  assert.ok(r.haul > 0 && r.haul <= Math.floor(f!.cents / 2));
  assert.ok(has(db, B, 'great_train_robbery'));
  const a0 = balance(db, wallet(G, A));
  later(ESTATE.freightMs + 1);
  const news = text(await run());
  assert.match(news, /freight train arrived/);
  assert.match(news, /Robbers got away/);
  assert.equal(balance(db, wallet(G, A)) - a0, f!.cents - r.haul);
  assert.ok(audit(db).ok);
});

test('landmarks: the server funds them together; the TODD Statue adds rent everywhere', async () => {
  const { db, run, fund, ctx, later } = setup();
  fund(A, 300_000); fund(B, 300_000);
  await run('build', 'B2', 'shack');
  assert.match(text(await run('landmark')), /funding now/);
  await run('landmark', 'donate', '100000', B);
  assert.ok(has(db, B, 'brick_by_brick'));
  const r = text(await run('landmark', 'donate', '200000'));
  assert.match(r, /is finished/);
  assert.ok(isBuilt(db, G, 'statue'));
  assert.ok(has(db, A, 'ribbon_cutting') && has(db, B, 'ribbon_cutting'));
  assert.ok(has(db, A, 'foreman') && !has(db, B, 'foreman'));
  assert.ok(balance(db, wallet(G, A)) > polygons(300_000 - 150_000 - 4_000) - polygons(1), 'only what the Statue still needed was taken');
  later(HOUR + 1); await run();
  const mid = balance(db, wallet(G, A));
  later(DAY); await run();
  assert.equal(balance(db, wallet(G, A)) - mid, Math.floor(polygons(60) * (1 + STATUE_RENT)) - polygons(15));
  assert.match(text(await execute(find('landmark')!, ctx(), {})), new RegExp(LANDMARKS[1]!.name));
});

test('the Connector won\'t set up next to a Police Station; with nowhere left, he takes the alley', async () => {
  const { db, run, fund, ctx } = setup();
  fund(A, 100_000);
  await run('build', 'D4', 'police');
  const night = eastern('2026-11-17T23:00', -5);
  const old = UG.policeRadius;
  try {
    UG.policeRadius = 8;   // one station covers the whole map
    const n = tonight(db, G, night)!;
    assert.equal(n.where, 'alley');
    assert.ok(n.password, 'always a password in the alley');
  } finally { UG.policeRadius = old; }
  const n2 = tonight(db, G, eastern('2026-11-18T23:00', -5))!;
  assert.notEqual(n2.where, 'alley');
  assert.ok(!around(parseTile('D4')!).includes(n2.lot) && n2.lot !== parseTile('D4'));
  void ctx;
});

test('an erased player\'s buildings are torn down', async () => {
  const { db, run, fund, at } = setup();
  fund(A, 10_000);
  await run('build', 'F6', 'shack');
  erasePlayer(db, G, A, noon);
  assert.equal(at('F6'), undefined);
  assert.ok(audit(db).ok);
});

test('the plow: the old 15 lots are refunded in full, bids come back, Eminent Domain for everyone', async () => {
  const db = freshDb();
  for (const u of [A, B]) { player(db, G, u, 0, noon); transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(10), reason: 'mod.give' }); }
  const add = (lot: number, kind: string, owner: string | null, status: string, bidder: string | null, bid: number) =>
    db.run('INSERT INTO estates_old (guild_id, lot, kind, owner_id, status, settled_at, bidder_id, bid_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', G, lot, kind, owner, status, noon, bidder, bid);
  add(1, 'shack', A, 'owned', B, polygons(4000));
  add(15, 'mansion', A, 'owned', null, 0);
  add(7, 'apartment', null, 'bank', null, 0);
  ensureEscrow(db, G, B, noon);
  transfer(db, { from: RESERVE, to: escrow(G, B), cents: polygons(4000), reason: 'mod.give' });
  const a0 = balance(db, wallet(G, A)), b0 = balance(db, wallet(G, B));
  const out = runFixes(db, noon);
  assert.ok(out.some((x) => x.startsWith('2026-11-19-plow: refunded 2 players')));
  assert.ok(balance(db, wallet(G, A)) - a0 >= polygons(122_500));
  assert.ok(balance(db, wallet(G, B)) - b0 >= polygons(4000));
  assert.ok(has(db, A, 'eminent_domain') && has(db, B, 'eminent_domain'));
  assert.ok(!db.get("SELECT 1 FROM sqlite_master WHERE name = 'estates_old'"));
  assert.ok(audit(db).ok);
});
