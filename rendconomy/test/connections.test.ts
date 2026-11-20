import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { RESERVE, audit, balance, transfer, wallet } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR } from '../src/core/time';
import * as sessions from '../src/core/sessions';
import { execute, typedAnswer } from '../src/discord/router';
import { award, has } from '../src/achievements/achievements';
import { addItem, count, items } from '../src/shop/inventory';
import { unread } from '../src/social/inbox';
import { CROPS, FARMING, parseCropItem, plotsOf } from '../src/farming/farming';
import { liveSnapshot } from '../src/discord/background';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

function setup() {
  const db = freshDb();
  let now = eastern('2026-11-16T12:00', -5);
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(3), now, guildId: G, channelId: 'c', user: { id: user, name: user === A ? 'Ana' : 'Ben' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  return { db, run, fund, ctx, later: (ms: number) => { now += ms; }, now: () => now };
}

test('trade offers: held until answered, swapped on accept, returned on decline or expiry', async () => {
  const { db, run, fund, later } = setup();
  await run('balance'); await run('balance', {}, B); fund(A, 2000); fund(B, 2000);
  addItem(db, G, A, 'coffee', 2); addItem(db, G, B, 'col_snowglobe');
  const a0 = balance(db, wallet(G, A)), b0 = balance(db, wallet(G, B));
  const offer = text(await run('trade', { action: `<@${B}> 500 and 2 coffee for snow globe` }));
  assert.match(offer, /Trade offer #1[\s\S]*⬡500\.00\*\* and 2 × .*Coffee for your .*Snow Globe/);
  assert.equal(count(db, G, A, 'coffee'), 0, 'the coffee is held');
  assert.equal(a0 - balance(db, wallet(G, A)), polygons(500), 'the Polygons are held');
  assert.equal(unread(db, B), 1, 'the offer is in their inbox');
  assert.match(text(await run('trade', {}, B)), /#1\*\* from <@1+>[\s\S]*trade accept 1/);
  assert.match(text(await run('trade', { action: 'accept 1' })), /That offer is for someone else/);
  assert.match(text(await run('trade', { action: 'accept 1' }, B)), /Trade #1 done/);
  assert.equal(count(db, G, B, 'coffee'), 2);
  assert.equal(count(db, G, A, 'col_snowglobe'), 1);
  assert.equal(balance(db, wallet(G, B)) - b0, polygons(500) + polygons(250), 'the Polygons, plus Dealmaker');
  assert.ok(has(db, A, 'dealmaker') && has(db, B, 'dealmaker'));
  // declined and expired offers go back
  await run('trade', { action: `<@${B}> 100 for 1 coffee` });
  assert.match(text(await run('trade', { action: 'decline 2' }, B)), /declined trade #2/);
  await run('trade', { action: `<@${B}> 100 for 1 coffee` });
  const held = balance(db, wallet(G, A));
  later(25 * HOUR);
  await run('trade', {});
  assert.equal(balance(db, wallet(G, A)) - held, polygons(100), 'expired: refunded');
  assert.match(text(await run('trade', { action: `<@${B}> 100 for unicorn` })), /They doesn't have any "unicorn"|doesn't have any/);
  assert.ok(audit(db).ok);
});

test('the inbox collects receipts and market notes; the showcase pins unlocked achievements', async () => {
  const { db, run } = setup();
  await run('balance');
  award(db, G, A, 'first_paycheck'); award(db, G, A, 'beginners_luck'); award(db, G, A, 'green_thumb'); award(db, G, A, 'midas_touch');
  assert.match(text(await run('showcase', { action: 'add moby dick' })), /haven't unlocked/);
  for (const a of ['first paycheck', "beginner's luck", 'green thumb']) await run('showcase', { action: `add ${a}` });
  assert.match(text(await run('showcase', { action: 'add midas touch' })), /holds 3/);
  assert.match(text(await run('showcase', { action: 'remove green thumb' })), /2\/3/);
  addItem(db, G, A, 'coffee');
  const { receipt } = await import('../src/social/receipts.js');
  receipt(db, G, A, 'Test receipt', [['Paid', '⬡5.00']]);
  assert.ok(unread(db, A) >= 1);
  assert.match(text(await run('inbox', { action: 'count' })), /^\d+ unread/);
  assert.match(text(await run('inbox')), /Test receipt[\s\S]*Paid: ⬡5\.00/);
  assert.equal(unread(db, A), 0, 'reading marks them read');
});

test('odd jobs: right answers pay, wrong ones do not, and there is a daily cap', async () => {
  const { db, run, ctx, now } = setup();
  await run('balance');
  const job = async () => { await run('oddjob'); return sessions.active<{ answer: string; pay: number }>(db, 'oddjob', G, A, now())!.state; };
  let s = await job();
  const b = balance(db, wallet(G, A));
  assert.match(text(await run('oddjob', { answer: s.answer })), /Right! You earn/);
  assert.equal(balance(db, wallet(G, A)) - b, s.pay);
  s = await job();
  assert.match(text(await run('oddjob', { answer: s.answer + 'x' })), /Not quite/);
  // or just type it in the channel, like a work shift (other users and commands are left alone)
  s = await job();
  assert.equal(typedAnswer(ctx(B), s.answer), null);
  assert.equal(typedAnswer(ctx(), 'r!balance'), null);
  assert.match(text(typedAnswer(ctx(), ' ' + s.answer.toUpperCase() + ' ')!.reply), /Right! You earn/);
  assert.equal(typedAnswer(ctx(), s.answer), null, 'the job is over once answered');
  for (let i = 0; i < 8; i++) { s = await job(); await run('oddjob', { answer: s.answer }); }
  assert.match(text(await run('oddjob')), /all 10 odd jobs for today/);
});

test('the Farmhand waters and harvests for a daily wage, and leaves if unpaid', async () => {
  const { db, run, fund, later } = setup();
  await run('balance'); fund(A, 400);
  addItem(db, G, A, 'seed_carrot', 3);
  await run('plant', { crop: 'carrot' });
  assert.match(text(await run('farmhand', { action: 'hire' })), /You hire a farmhand for \*\*⬡150\.00 a day/);
  assert.ok(has(db, A, 'gentleman_farmer'));
  assert.ok(plotsOf(db, G, A).every((p) => p.watered === 1), 'watered right away');
  later(CROPS.carrot!.growMs + 1000);
  const v = text(await run('farm'));
  assert.match(v, /While you were gone\*\*, your farmhand harvested 3 crops into your basket/);
  assert.equal(plotsOf(db, G, A).length, 0);
  assert.equal(items(db, G, A).filter((r) => parseCropItem(r.item)?.crop.id === 'carrot').reduce((x, r) => x + r.qty, 0), 3);
  // wages: two more days get paid; then the money runs out and they leave
  const w = balance(db, wallet(G, A));
  later(DAY);
  await run('farm');
  assert.equal(w - balance(db, wallet(G, A)), FARMING.farmhandWage);
  transfer(db, { from: wallet(G, A), to: RESERVE, cents: balance(db, wallet(G, A)), reason: 'mod.take' });
  later(DAY);
  assert.match(text(await run('farm')), /Your farmhand left: you couldn't pay/);
  assert.ok(audit(db).ok);
});

test('the live feed has prices and the world event', () => {
  const { db } = setup();
  const s = liveSnapshot(db);
  assert.ok('prices' in s && 'event' in s && typeof s.reserve === 'number');
});
