import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { DAY } from '../src/core/time';
import { execute, press } from '../src/discord/router';
import { tick } from '../src/market/market';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  tick(db, seededRng(4), noon);
  let now = noon;
  const ctx = (user: string): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now, guildId: G, channelId: 'c', user: { id: user, name: user === A ? 'Alice' : 'Bob' }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, ctx, run, later: (ms: number) => { now += ms; } };
}

test('gifts: 5% fee to the Reserve, a daily limit, and the recipient gets the full amount', async () => {
  const { db, run } = setup();
  await run('balance', {}, A);
  const reserveBefore = balance(db, RESERVE);
  assert.match(text(await run('gift', { player: B, amount: '100', note: 'thanks' })), /received \*\*⬡100\.00\*\*[\s\S]*Fee: ⬡5\.00/);
  assert.equal(balance(db, wallet(G, A)), polygons(395));
  assert.equal(balance(db, wallet(G, B)), polygons(600), 'new recipients get their starting balance too');
  assert.equal(balance(db, RESERVE), reserveBefore + polygons(5) - polygons(500));
  assert.match(text(await run('gift', { player: A, amount: '1' })), /yourself/);
  assert.match(text(await run('gift', { player: B, amount: '400' })), /costs ⬡420\.00/);
  assert.ok(audit(db).ok);
});

test('gift limit is per Eastern day', async () => {
  const { db, run, later } = setup();
  await run('balance');
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(20_000), reason: 'mod.give' });
  await run('gift', { player: B, amount: '5000' });
  assert.match(text(await run('gift', { player: B, amount: '1' })), /daily gift limit/);
  later(DAY);
  assert.match(text(await run('gift', { player: B, amount: '1' })), /Gift sent/);
});

test('leaderboard ranks by net worth and switches boards with buttons', async () => {
  const { run, ctx } = setup();
  await run('balance', {}, B);
  await run('daily', {}, A);
  const r = await run('leaderboard');
  assert.match(text(r), /Leaderboard: Net worth[\s\S]* 1\.` \*\*Alice \(you\)\*\* · ⬡750\.00[\s\S]* 2\.` Bob · ⬡500\.00/);
  const shifts = press(ctx(A), sessions.buttonId(r.session!, 'shifts'));
  assert.match(text(shifts.update), /Shifts worked/);
  assert.match(press(ctx(B), sessions.buttonId(r.session!, 'cash')).notice!, /open your own/);
});

test('savings: deposit, close early without interest, mature with interest', async () => {
  const { db, run, later } = setup();
  assert.match(text(await run('savings', { action: 'deposit 200 7' })), /Deposited \*\*⬡200\.00\*\* for 7 days at 6%/);
  assert.equal(balance(db, wallet(G, A)), polygons(300));
  assert.match(text(await run('portfolio')), /Savings: ⬡200\.00[\s\S]*Net worth: ⬡500\.00/);
  assert.match(text(await run('savings', { action: 'deposit 50 3' })), /at least ⬡100\.00/);
  await run('savings', { action: 'deposit 100 3' });
  const id = db.get<{ id: number }>('SELECT id FROM savings WHERE days = 7')!.id;
  assert.match(text(await run('savings', { action: `withdraw #${id}` })), /closed early\. ⬡200\.00 returned, without interest/);
  later(3 * DAY);
  assert.match(text(await run('savings')), /3-day account has matured: ⬡100\.00 returned with ⬡2\.00 interest/);
  assert.equal(balance(db, wallet(G, A)), polygons(502));
  assert.ok(audit(db).ok);
});
