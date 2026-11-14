import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH } from '../src/achievements/achievements';
ACH.pay = false;
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
import { activeLoans } from '../src/loans/loans';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}\n${e.footer?.text ?? ''}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup() {
  const db = freshDb();
  let now = noon;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(1), now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  return { db, ctx, run, later: (ms: number) => { now += ms; } };
}

test('TODD bails out only the broke, blocks gambling and gifts until repaid', async () => {
  const { db, run } = setup();
  assert.match(text(await run('bailout')), /NOT broke/);
  transfer(db, { from: wallet(G, A), to: RESERVE, cents: polygons(450), reason: 'mod.take' });
  assert.match(text(await run('bailout')), /\+⬡500\.00[\s\S]*owe TODD \*\*⬡600\.00/);
  assert.match(text(await run('bailout')), /STILL owe me ⬡600\.00/);
  assert.match(text(await run('coinflip', { amount: '10' })), /With MY money/);
  assert.match(text(await run('gift', { player: B, amount: '10' })), /Pay me back first/);
  assert.match(text(await run('repay', { amount: '200' })), /Still owed to TODD: \*\*⬡400\.00/);
  transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(400), reason: 'mod.give' });
  assert.match(text(await run('repay', { amount: 'all' })), /PAID IN FULL/);
  assert.match(text(await run('coinflip', { amount: '10' })), /Coinflip/);
  assert.ok(audit(db).ok);
});

test('player loans: request, accept, interest, overdue garnishing, payback', async () => {
  const { db, run, ctx, later } = setup();
  await run('balance', {}, B);
  const req = await run('loan', { lender: B, amount: '200', rate: '10' });
  assert.match(text(req), /asks to borrow \*\*⬡200\.00\*\* at \*\*10%/);
  assert.match(press(ctx(A), sessions.buttonId(req.session!, 'yes')).notice!, /Only the player asked/);
  assert.match(text(press(ctx(B), sessions.buttonId(req.session!, 'yes')).update), /Loan issued/);
  assert.equal(balance(db, wallet(G, A)), polygons(700));
  assert.equal(balance(db, wallet(G, B)), polygons(300));

  later(2 * DAY);
  assert.match(text(await run('loans')), /⬡242\.00\*\* at 10%/, '200 x 1.1 x 1.1');
  later(6 * DAY); // overdue: interest stopped at 7 days
  const owedAtDue = Math.round(20000 * 1.1 ** 7);
  assert.equal(activeLoans(db, G, { borrower: A }, noon + 8 * DAY)[0]!.owed, owedAtDue);

  const before = balance(db, wallet(G, B));
  const daily = await run('daily');
  assert.match(text(daily), /⬡125\.00 of that went to <@222222222222222222> for an overdue loan/);
  assert.equal(balance(db, wallet(G, B)) - before, polygons(125));
  assert.match(text(await run('gift', { player: B, amount: '10' })), /overdue loan/);
  assert.match(text(await run('payback', { lender: B, amount: 'all' })), /repaid in full|Still owed/);
  assert.ok(audit(db).ok);
});

test('declining and forgiving', async () => {
  const { run, ctx } = setup();
  await run('balance', {}, B);
  const req = await run('loan', { lender: B, amount: '50' });
  assert.match(text(press(ctx(B), sessions.buttonId(req.session!, 'no')).update), /declined/);
  const req2 = await run('loan', { lender: B, amount: '50' });
  press(ctx(B), sessions.buttonId(req2.session!, 'yes'));
  assert.match(text(await run('forgive', { borrower: A }, B)), /no longer owes you ⬡50\.00/);
  assert.match(text(await run('loans')), /You owe\*\*\nNothing/);
});
