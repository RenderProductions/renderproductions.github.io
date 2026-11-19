import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { RESERVE, audit, balance, transfer, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR, MINUTE } from '../src/core/time';
import { execute } from '../src/discord/router';
import { CROPS, plotsOf } from '../src/farming/farming';
import { runShift, shedOf } from '../src/farming/farmhand';
import { addItem, count, items } from '../src/shop/inventory';
import { FIXES } from '../src/fixes';
import { anyItem } from '../src/shop/items';

const G = 'g1', A = '111111111111111111';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

function setup() {
  const db = freshDb();
  let now = eastern('2026-11-18T12:00', -5);
  const ctx = (): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: A, name: 'Ana' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}) => execute(find(name)!, ctx(), args);
  const fund = (p: number) => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(p), reason: 'mod.give' });
  return { db, run, fund, later: (ms: number) => { now += ms; }, now: () => now };
}
const crops = (db: ReturnType<typeof freshDb>) => items(db, G, A).filter((r) => r.item.startsWith('crop_')).reduce((s, r) => s + r.qty, 0);

test('the farmhand keeps a seed shed, replants while you are away, and says when he runs out', async () => {
  const { db, run, fund, later } = setup();
  await run('balance'); fund(2000);
  addItem(db, G, A, 'seed_carrot', 6);
  assert.match(text(await run('farmhand', { action: 'give carrot 3' })), /no farmhand/);
  const hired = text(await run('farmhand', { action: 'hire' }));
  assert.match(hired, /replants from his seed shed[\s\S]*farmhand give carrot 10/);
  // giving seeds: he plants the empty plots straight away
  assert.match(text(await run('farmhand', { action: 'give carrot 5' })), /You hand your farmhand 5 Carrot seeds\. He has 2 now/);
  assert.equal(count(db, G, A, 'seed_carrot'), 1);
  assert.equal(plotsOf(db, G, A).length, 3);
  assert.ok(plotsOf(db, G, A).every((p) => p.watered === 1));
  // two hours away: three plots × 30-minute carrots, but only two seeds left to replant with
  later(2 * HOUR);
  const v = text(await run('farm'));
  assert.match(v, /While you were gone\*\*, your farmhand harvested \d+ crops? into your basket/);
  assert.match(v, /He's out of seeds \(Carrot\): \d plots? sits? empty/);
  assert.deepEqual(shedOf(db, G, A), {});
  assert.ok(crops(db) >= 3, 'the first crops are in the basket');
  assert.doesNotMatch(text(await run('farm')), /While you were gone/, 'you only hear it once');
  // taking seeds back, and firing him returns the shed
  addItem(db, G, A, 'seed_corn', 4);
  await run('farmhand', { action: 'give corn' });
  assert.equal(shedOf(db, G, A).corn, 1, 'three went straight into the empty plots');
  assert.match(text(await run('farmhand', { action: 'take corn 1' })), /take back 1 Corn seed/);
  addItem(db, G, A, 'seed_pumpkin', 2);
  await run('farmhand', { action: 'give pumpkin' });
  assert.match(text(await run('farmhand', { action: 'fire' })), /tips his hat on the way out and hands back 2 seeds/);
  assert.equal(count(db, G, A, 'seed_corn'), 1);
  assert.equal(count(db, G, A, 'seed_pumpkin'), 2);
  assert.ok(audit(db).ok);
});

test('tomatoes regrow for him: three harvests into the basket, then the plot is free', async () => {
  const { db, run, fund, later } = setup();
  await run('balance'); fund(2000);
  await run('farmhand', { action: 'hire' });
  addItem(db, G, A, 'seed_tomato', 1);
  await run('farmhand', { action: 'give tomato' });
  later(CROPS.tomato!.growMs * 2 + 1000);   // first harvest at 4h, then 6h, then 8h
  const v = text(await run('farm'));
  assert.match(v, /harvested 3 crops into your basket/);
  assert.doesNotMatch(v, /sold/, 'he never sells for you');
  assert.equal(crops(db), 3);
  assert.equal(db.get<{ n: number }>("SELECT COUNT(*) AS n FROM ledger WHERE reason = 'farm.sell'")?.n ?? 0, 0, 'nothing sold');
  assert.equal(plotsOf(db, G, A).length, 0, 'the tomato plant is done after three');
  assert.ok(audit(db).ok);
});

test('the background shift: one out-of-seeds DM, and he quits if unpaid', async () => {
  const { db, run, fund, later, now } = setup();
  await run('balance'); fund(400);
  await run('farmhand', { action: 'hire' });
  addItem(db, G, A, 'seed_carrot', 3);
  await run('farmhand', { action: 'give carrot' });
  later(31 * MINUTE);
  const rng = seededRng(9);
  const first = runShift(db, G, A, now(), rng);
  assert.equal(first.newlyOut, true);
  assert.equal(runShift(db, G, A, now() + MINUTE, rng).newlyOut, false, 'just the one DM');
  // the wage runs out: he quits and the shed comes back
  addItem(db, G, A, 'seed_corn', 6);
  await run('farmhand', { action: 'give corn' });
  transfer(db, { from: wallet(G, A), to: RESERVE, cents: balance(db, wallet(G, A)), reason: 'mod.take' });
  later(DAY);
  const q = runShift(db, G, A, now(), rng);
  assert.equal(q.left, true);
  assert.ok(count(db, G, A, 'seed_corn') >= 1, 'seeds back in the inventory');
  assert.match(text(await run('farm')), /Your farmhand left: you couldn't pay/);
  assert.ok(audit(db).ok);
});

test('Sprinklers are gone: owners are refunded ⬡2,500 each', async () => {
  const { db, run } = setup();
  await run('balance');
  assert.equal(anyItem('sprinkler'), undefined);
  addItem(db, G, A, 'sprinkler', 2);
  const before = balance(db, wallet(G, A));
  const fix = FIXES.find((f) => f.id === '2026-11-18-sprinklers')!;
  assert.match(fix.run(db, Date.now()), /refunded 1 owner \(2 sprinklers\)/);
  assert.equal(balance(db, wallet(G, A)) - before, polygons(5000));
  assert.equal(count(db, G, A, 'sprinkler'), 0);
  assert.ok(audit(db).ok);
});
