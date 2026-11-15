import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { execute } from '../src/discord/router';
import { describeEvent, pickEvent, startEvent } from '../src/events/world';
import { has } from '../src/achievements/achievements';
import { holidayDay, holidayTick, isHoliday, santaRows, season } from '../src/holidays/holidays';
import { buy, collectibleOfWeek } from '../src/shop/shop';
import { HOLIDAY_COLLECTIBLES } from '../src/shop/items';
import { addItem, count } from '../src/shop/inventory';

const G = 'g1', A = '111111111111111111', B = '222222222222222222', C = '333333333333333333', D = '444444444444444444';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const at = (d: string) => eastern(d, -5);

function setup(start: string) {
  const db = freshDb();
  let now = at(start);
  const ctx = (user: string): Ctx => ({ db, config: botConfig(), rng: seededRng(5), now, guildId: G, channelId: 'c', user: { id: user, name: `P${user[0]}` }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, run, set: (d: string) => { now = at(d); }, now: () => now };
}

test('the season: December, Eastern time', () => {
  assert.equal(isHoliday(at('2026-11-30T23:59')), false);
  assert.equal(holidayDay(at('2026-12-01T00:01')), 1);
  assert.equal(holidayDay(at('2026-12-25T12:00')), 25);
  assert.equal(isHoliday(at('2027-01-01T00:01')), false);
  assert.equal(season(at('2027-01-03T12:00')), 2026);
  // Snow Day only turns up in December
  const rng = seededRng(1);
  const dec = Array.from({ length: 200 }, () => pickEvent(null, rng, at('2026-12-10T12:00')).id);
  const nov = Array.from({ length: 200 }, () => pickEvent(null, rng, at('2026-11-10T12:00')).id);
  assert.ok(dec.includes('snow_day'));
  assert.ok(!nov.includes('snow_day'));
});

test('advent calendar: one door a day, catch up on missed ones, all 25 for Every Door', async () => {
  const { db, run, set } = setup('2026-11-20T12:00');
  await run('balance');
  assert.match(text(await run('advent')), /runs in December/);
  set('2026-12-03T09:00');
  const first = await run('advent');
  assert.match(text(first), /You open 3 doors[\s\S]*Door 1:.*⬡250[\s\S]*Door 2:.*3 × Carrot Seeds[\s\S]*Door 3:.*2 × Coffee/);
  assert.equal(first!.content!.split('\n').length, 5, 'the calendar is a 5 × 5 grid of doors');
  assert.equal([...first!.content!.matchAll(/🌟/g)].length, 3);
  assert.equal(count(db, G, A, 'seed_carrot'), 3);
  assert.match(text(await run('advent')), /Door 3 is already open\. Door 4 opens tomorrow/);
  set('2026-12-26T09:00');
  const rest = text(await run('advent'));
  assert.match(rest, /You open 22 doors[\s\S]*Door 25:.*Star Topper.*⬡2,500/);
  assert.ok(has(db, A, 'every_door'));
  for (const id of ['col_ornament', 'col_snowglobe', 'col_gingerbread', 'col_nutcracker', 'col_startopper']) assert.equal(count(db, G, A, id), 1, id);
  set('2027-01-02T09:00');
  assert.match(text(await run('advent')), /runs in December/);
  assert.ok(audit(db).ok);
});

test('Marquez\'s Holiday shelf: December only, one of each, and the Star Topper is not for sale', async () => {
  const { db, run, set, now } = setup('2026-11-20T12:00');
  await run('balance');
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(20_000), reason: 'mod.give' });
  assert.doesNotMatch(text(await run('shop', { shelf: 'holiday' })), /Polygon Ornament/);
  assert.throws(() => buy(db, seededRng(1), G, A, 'col_ornament', 1, now()), /back in December/);
  set('2026-12-05T12:00');
  const shelf = text(await run('shop', { shelf: 'holiday' }));
  assert.match(shelf, /Polygon Ornament[\s\S]*Candy Cane Paint/);
  assert.doesNotMatch(shelf, /Star Topper/);
  buy(db, seededRng(1), G, A, 'col_ornament', 1, now());
  assert.throws(() => buy(db, seededRng(1), G, A, 'col_ornament', 1, now()), /already have this year's/);
  assert.throws(() => buy(db, seededRng(1), G, A, 'col_startopper', 1, now()), /last door of the advent calendar/);
  buy(db, seededRng(1), G, A, 'paint_frost', 1, now());
  // the weekly special shelf never lands on a holiday collectible
  for (let w = 0; w < 30; w++) assert.ok(!HOLIDAY_COLLECTIBLES[collectibleOfWeek(now() + w * 7 * 86_400_000)]);
  assert.ok(audit(db).ok);
});

test('Secret Santa: sign up, draw a loop, wrap gifts, delivered on Christmas morning', async () => {
  const { db, run, set, now } = setup('2026-12-02T12:00');
  const people = [A, B, C, D];
  for (const p of people) { await run('balance', {}, p); transfer(db, { from: RESERVE, to: wallet(G, p), cents: polygons(2_000), reason: 'mod.give' }); }
  for (const p of people) assert.match(text(await run('santa', { action: 'join' }, p)), /You're in!/);
  assert.match(text(await run('santa', { action: 'leave' }, D)), /left Secret Santa/);
  assert.match(text(await run('santa', {}, A)), /signed up, along with 2 others/);
  assert.match(text(await run('santa', { action: 'gift', amount: '100' }, A)), /drawn on December 15/);
  set('2026-12-15T08:00');
  assert.match(text(await run('santa', { action: 'join' }, D)), /closed on December 14/);
  const dms: { to: string; text: string }[] = [];
  const send = (to: string, _g: string, t: (s: string) => string) => dms.push({ to, text: t('The Render Room') });
  holidayTick(db, now(), seededRng(2), send, (id) => id, 'r!');
  const rows = santaRows(db, G, 2026);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.target_id).sort(), [A, B, C].sort(), 'everyone is somebody\'s Santa');
  assert.ok(rows.every((r) => r.target_id !== r.user_id), 'nobody draws themselves');
  assert.equal(dms.filter((d) => /you're shopping for/.test(d.text)).length, 3);
  holidayTick(db, now(), seededRng(2), send, (id) => id, 'r!');
  assert.equal(dms.length, 3, 'told once');
  // A wraps Polygons and a holiday collectible; B wraps an item; C forgets
  addItem(db, G, A, 'col_snowglobe'); addItem(db, G, B, 'coffee');
  const targetOf = (u: string) => rows.find((r) => r.user_id === u)!.target_id!;
  assert.match(text(await run('santa', { action: 'gift', amount: '500', item: 'snow globe' }, A)), /You wrap \*\*⬡500\.00\*\* and .*Snow Globe/);
  assert.match(text(await run('santa', { action: 'gift', amount: 'coffee' }, B)), /You wrap .*Coffee/);
  assert.match(text(await run('santa', { action: 'gift', amount: '50' }, A)), /already wrapped/);
  assert.ok(has(db, A, 'secret_santa') && has(db, A, 'regift'));
  assert.equal(balance(db, 'santa:' + G), polygons(500), 'the Polygons wait in escrow');
  assert.match(text(await run('santa', {}, A)), /shopping for <@\d+>[\s\S]*Under the tree/);
  const before = (u: string) => balance(db, wallet(G, u));
  const beforeA = before(targetOf(A)), beforeC = before(targetOf(C));
  set('2026-12-24T23:00');
  holidayTick(db, now(), seededRng(2), send, (id) => id, 'r!');
  assert.equal(dms.length, 3, 'nothing opens before Christmas');
  set('2026-12-25T07:00');
  holidayTick(db, now(), seededRng(2), send, (id) => id, 'r!');
  const xmas = dms.slice(3);
  assert.equal(xmas.length, 3);
  assert.equal(before(targetOf(A)) - beforeA, polygons(500));
  assert.equal(count(db, G, targetOf(A), 'col_snowglobe'), 1);
  assert.equal(count(db, G, targetOf(B), 'coffee') >= 1, true);
  assert.equal(before(targetOf(C)) - beforeC, polygons(250), 'C forgot, so Marquez covers it');
  assert.ok(xmas.some((d) => /forgot, so Marquez/.test(d.text)) && xmas.some((d) => new RegExp(`was <@${A}>`).test(d.text)));
  holidayTick(db, now(), seededRng(2), send, (id) => id, 'r!');
  assert.equal(dms.length, 6, 'delivered once');
  assert.match(text(await run('santa', {}, targetOf(A))), new RegExp(`Secret Santa was <@${A}>`));
  assert.ok(audit(db).ok);
});

test('Secret Santa needs 3 people; Snow Day closes the office and doubles chat pay', async () => {
  const { db, run, set, now } = setup('2026-12-02T12:00');
  for (const p of [A, B]) { await run('balance', {}, p); await run('santa', { action: 'join' }, p); }
  set('2026-12-16T12:00');
  const dms: string[] = [];
  holidayTick(db, now(), seededRng(1), (_u, _g, t) => dms.push(t('S')), (id) => id, 'r!');
  assert.equal(dms.length, 2);
  assert.match(dms[0]!, /needs at least 3 people/);
  assert.match(text(await run('santa', {}, A)), /off in this server/);
  assert.match(describeEvent(startEvent(db, 'snow_day', undefined, now())), /Snow Day.*No work today/);
  await run('apply', { ticker: 'RRM' });
  assert.match(text(await run('work')), /Snow Day!.*office is closed/);
});
