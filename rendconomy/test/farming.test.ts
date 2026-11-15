import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { HOUR, MINUTE } from '../src/core/time';
import { execute } from '../src/discord/router';
import { startEvent } from '../src/events/world';
import { has } from '../src/achievements/achievements';
import { CROPS, FARMING, newPlot, parseCropItem, plotsOf, simulate, type Env, type Plot } from '../src/farming/farming';
import { addItem, count } from '../src/shop/inventory';

const G = 'g1', A = '111111111111111111';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-15T12:00', -5);
const dry: Env = { sprinkler: false, greenhouse: false, scarecrow: false, weather: [] };
const plotOf = (crop: string, wet = false, crowAt: number | null = null): Plot => ({ ...newPlot(G, A, 0, crop, noon, seededRng(1), wet), crow_at: crowAt });

function setup() {
  const db = freshDb();
  let now = noon;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(11), now, guildId: G, channelId: 'c', user: { id: user, name: 'Farmer' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  const rich = () => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(50_000), reason: 'mod.give' });
  return { db, run, rich, later: (ms: number) => { now += ms; }, now: () => now };
}

test('growth: watered crops grow on time, dry ones at half speed, and 12 thirsty hours in all wilts a crop', () => {
  const c = CROPS.corn!;   // 2 hours
  // watered in both stages: ready right on time
  let p = simulate(plotOf('corn', true), dry, noon + c.growMs / 2).plot;
  assert.equal(p.ready_at, null);
  assert.equal(p.watered, 0, 'a new stage needs water again');
  p = simulate({ ...p, watered: 1 }, dry, noon + c.growMs).plot;
  assert.equal(p.ready_at, noon + c.growMs);
  // never watered: half speed, so the first stage alone takes the full grow time
  const d = simulate(plotOf('corn'), dry, noon + c.growMs - 10_000).plot;
  assert.ok(d.progress < c.growMs / 2 && d.progress > c.growMs / 2 - 10_000);
  assert.ok(d.dry_ms > 0);
  // 12 thirsty hours in all: wilted
  const w = simulate(plotOf('pumpkin'), dry, noon + FARMING.wiltMs + 1);
  assert.equal(w.plot.wilted, 1);
  assert.deepEqual(w.events.map((e) => e.kind), ['wilted']);
  // a sprinkler means it never goes thirsty
  const s = simulate(plotOf('pumpkin'), { ...dry, sprinkler: true }, noon + CROPS.pumpkin!.growMs);
  assert.equal(s.plot.ready_at, noon + CROPS.pumpkin!.growMs);
  assert.equal(s.plot.dry_ms, 0);
});

test('crows, rain and storms', () => {
  const c = CROPS.corn!;
  const crow = noon + 30 * MINUTE;
  const ate = simulate(plotOf('corn', true, crow), dry, noon + HOUR);
  assert.equal(ate.gone, true);
  assert.deepEqual(ate.events, [{ kind: 'crow_ate', slot: 0, crop: 'corn', at: crow }]);
  const scared = simulate(plotOf('corn', true, crow), { ...dry, scarecrow: true }, noon + HOUR);
  assert.equal(scared.gone, false);
  assert.equal(scared.events[0]!.kind, 'crow_scared');
  // rain waters the crop while it falls
  const rain = { ...dry, weather: [{ kind: 'rain' as const, from: noon + 10 * MINUTE, until: noon + 70 * MINUTE }] };
  const r = simulate(plotOf('corn'), rain, noon + c.growMs);
  assert.ok(r.plot.progress > c.growMs / 2, 'rain made it grow at full speed');
  // a storm is rolled once per plot (the same answer every time), and a Greenhouse ignores it
  const storm = (seed: number) => ({ ...plotOf('pumpkin', true), seed });
  const sky = { ...dry, sprinkler: true, weather: [{ kind: 'storm' as const, from: noon + HOUR, until: noon + 2 * HOUR }] };
  const results = Array.from({ length: 400 }, (_, i) => simulate(storm(i + 1), sky, noon + 3 * HOUR).gone);
  const lost = results.filter(Boolean).length;
  assert.ok(lost > 60 && lost < 140, `about a quarter flattened (${lost} of 400)`);
  assert.deepEqual(Array.from({ length: 400 }, (_, i) => simulate(storm(i + 1), sky, noon + 3 * HOUR).gone), results, 'looking twice changes nothing');
  assert.ok(Array.from({ length: 400 }, (_, i) => simulate(storm(i + 1), { ...sky, greenhouse: true }, noon + 3 * HOUR).gone).every((g) => !g));
  // a storm only gets one roll per plot, even if it's looked at mid-storm
  const mid = simulate(storm(7), sky, noon + 90 * MINUTE);
  if (!mid.gone) assert.equal(simulate(mid.plot, sky, noon + 3 * HOUR).gone, false);
});

test('crop items: names, values and mutations', () => {
  assert.equal(parseCropItem('crop_carrot')!.value, CROPS.carrot!.value);
  assert.equal(parseCropItem('crop_golden_corn')!.name, 'Golden Corn');
  assert.equal(parseCropItem('crop_rainbow_polyfruit')!.value, CROPS.polyfruit!.value * 12);
  assert.equal(parseCropItem('crop_squarepumpkin')!.value, CROPS.pumpkin!.value * 5);
  assert.equal(parseCropItem('crop_nope'), null);
  assert.equal(parseCropItem('fish_boot'), null);
});

test('farming: seeds from Marquez, plant, water, harvest, sell', async () => {
  const { db, run, rich, later } = setup();
  await run('balance');
  rich();
  assert.match(text(await run('plant', { crop: 'carrot' })), /no Carrot Seeds[\s\S]*shop garden/);
  assert.match(text(await run('purchase', { item: 'carrot seeds 5' })), /5 × 🥕 Carrot Seeds/);
  // three plots to start: three carrots go in, two seeds stay in the pocket
  const planted = text(await run('plant', { crop: 'carrots' }));
  assert.match(planted, /You plant 3 Carrots in plots 1, 2, 3[\s\S]*needs water/);
  assert.match(planted, /2 Carrot seeds left/);
  assert.equal(count(db, G, A, 'seed_carrot'), 2);
  assert.match(text(await run('plant', { crop: 'carrot' })), /Every plot is in use/);
  assert.match(text(await run('harvest')), /Nothing is ready yet/);
  assert.match(text(await run('water')), /You water 3 crops[\s\S]*watered · ready/);
  assert.match(text(await run('water')), /already watered/);
  later(15 * MINUTE);
  assert.match(text(await run('farm')), /growing · \*\*needs water\*\*/, 'the second stage needs water too');
  await run('water');
  later(15 * MINUTE);
  const ready = text(await run('farm'));
  assert.match(ready, /ready to harvest/);
  const h = text(await run('harvest'));
  assert.match(h, /Harvest time[\s\S]*plot 1[\s\S]*plot 3/);
  assert.match(h, /Basket: 3 crops/);
  assert.ok(has(db, A, 'green_thumb'));
  assert.ok(has(db, A, 'early_bird'), 'harvested the minute they were ready');
  assert.equal(plotsOf(db, G, A).length, 0, 'carrots leave the plot empty');
  assert.match(text(await run('inventory')), /Harvest basket\*\* \(3\)/);
  // a carrot makes good bait
  addItem(db, G, A, 'rod');
  assert.match(text(await run('fish', { bait: 'carrot' })), /used a Carrot as bait/);
  const before = balance(db, wallet(G, A));
  assert.match(text(await run('farm', { action: 'sell' })), /Harvest sold[\s\S]*He pays \*\*⬡/);
  assert.ok(balance(db, wallet(G, A)) > before);
  assert.match(text(await run('sellcrops')), /basket is empty/);
  assert.ok(audit(db).ok);
});

test('farming: tomatoes give three harvests, plots expand to nine, compost and fertilizer', async () => {
  const { db, run, rich, later } = setup();
  await run('balance');
  rich();
  addItem(db, G, A, 'seed_tomato'); addItem(db, G, A, 'sprinkler');
  assert.match(text(await run('plant', { crop: 'tomato', plot: '2' })), /plot 2\. The Sprinkler waters it/);
  for (let i = 0; i < 3; i++) {
    later(CROPS.tomato!.growMs);
    assert.match(text(await run('harvest')), /Tomato|Golden|Rainbow/);
  }
  assert.ok(has(db, A, 'ketchup'));
  assert.equal(plotsOf(db, G, A).length, 0, 'the plant is done after three');
  // buying plots
  for (let n = 4; n <= 9; n++) assert.match(text(await run('buyplot')), new RegExp(`You buy plot ${n}`));
  assert.match(text(await run('buyplot')), /all 9 plots/);
  assert.ok(has(db, A, 'full_acreage'));
  // compost: a boot makes one, other junk two for one
  addItem(db, G, A, 'fish_boot'); addItem(db, G, A, 'fish_can', 3);
  assert.match(text(await run('compost')), /You get \*\*2 Fertilizer\*\*[\s\S]*left over/);
  assert.ok(has(db, A, 'one_mans_trash'));
  assert.equal(count(db, G, A, 'fish_can'), 1);
  addItem(db, G, A, 'seed_pumpkin');
  await run('plant', { crop: 'pumpkin' });
  assert.match(text(await run('fertilize')), /Fertilizer into plot 1/);
  later(CROPS.pumpkin!.growMs / FARMING.fertRate);
  assert.match(text(await run('farm')), /Pumpkin: .*ready to harvest/);
  assert.ok(audit(db).ok);
});

test('farming: rain from the world events, and every crop at once', async () => {
  const { db, run, rich, now } = setup();
  await run('balance');
  rich();
  await run('buyplot'); await run('buyplot');
  for (const c of Object.keys(CROPS)) addItem(db, G, A, `seed_${c}`);
  startEvent(db, 'rain', undefined, now());
  for (const c of ['carrot', 'corn', 'tomato', 'pumpkin']) await run('plant', { crop: c });
  const last = text(await run('plant', { crop: 'polygon', plot: 'fruit' }));
  assert.match(last, /Polygon Fruit[\s\S]*The rain waters it/);
  assert.match(last, /raining/);
  assert.ok(has(db, A, 'something_for_everyone'));
  assert.ok(plotsOf(db, G, A).every((p) => p.watered === 1));
});
