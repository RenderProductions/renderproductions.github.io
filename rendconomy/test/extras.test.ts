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
import { seededRng, type Rng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { execute, press } from '../src/discord/router';
import { busStep, drawLotteries, nextDraw } from '../src/commands/extras';
import { answerDrop, chatPay, startDrop } from '../src/social/chatter';
import { deck } from '../src/casino/core';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const sat = eastern('2026-11-14T12:00', -5);

function setup() {
  const db = freshDb();
  let now = sat;
  const ctx = (user = A, rng: Rng = seededRng(1)): Ctx => ({ db, config: botConfig(), rng, now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: false, isMod: true, notes: [] });
  const run = async (name: string, args: Record<string, string> = {}, user = A) => { const r = await execute(find(name)!, ctx(user), args); now += 3000; return r; };
  return { db, ctx, run, later: (ms: number) => { now += ms; } };
}

test('Ride the Bus: odds come from the cards left, and a wrong guess loses', async () => {
  const st = { bet: 100, cards: deck((l) => [...l]).slice(0, 4), round: 1, mult: 1 };
  assert.ok(Math.abs(busStep(st, 'red') - 1.92) < 1e-9, 'red is 26 of 52: 0.96 x 2');
  const { run, ctx } = setup();
  await run('balance');
  const r = await run('bus', { amount: '50' });
  const out = press(ctx(), sessions.buttonId(r.session!, 'red'));
  assert.match(text(out.update), /Correct|Wrong/);
});

test('the lottery: tickets fill a pot, Sunday 8 PM Eastern draws a winner', async () => {
  assert.equal(nextDraw(sat).at, Date.parse('2026-11-16T01:00:00Z'), 'Sunday Nov 15, 8 PM EST');
  const { db, run } = setup();
  await run('balance', {}, B);
  assert.match(text(await run('lottery', { tickets: '4' })), /Bought 4 tickets for ⬡200\.00[\s\S]*Pot: \*\*⬡180\.00/);
  await run('lottery', { tickets: '1' }, B);
  assert.match(text(await run('lottery', { tickets: '20' })), /cannot exceed 16/);
  drawLotteries(db, nextDraw(sat).at - 1000, () => A);
  assert.equal(balance(db, `lottery:${G}`), polygons(225), 'not yet');
  const before = balance(db, wallet(G, A));
  drawLotteries(db, nextDraw(sat).at + 1000, () => A);
  assert.equal(balance(db, wallet(G, A)) - before, polygons(225));
  assert.equal(db.get<{ n: number }>('SELECT COUNT(*) AS n FROM lottery')!.n, 0);
  assert.ok(audit(db).ok);
});

test('the derby takes one bet per player while betting is open', async () => {
  const { run } = setup();
  await run('balance', {}, B);
  const r = await run('derby');
  assert.match(text(r), /Polygon Derby[\s\S]*Modsworth/);
  assert.ok(r.live, 'the race animates itself');
  assert.match(text(await run('derby', { horse: 'glitch', amount: '20' }, B)), /⬡20\.00 on 👾 \*\*Glitch\*\*/);
  assert.match(text(await run('derby', { horse: '1', amount: '20' }, B)), /One bet per race/);
});

test('chat pay: real messages, once a minute, daily cap; drop-ins pay the first right answer', async () => {
  const { db, ctx, run, later } = setup();
  await run('balance');
  const c1 = chatPay(ctx(), 'hello everyone, how is the market');
  assert.ok(c1 >= polygons(5) && c1 <= polygons(15));
  assert.equal(chatPay(ctx(), 'another message right away'), 0, 'once a minute');
  later(60_000);
  assert.equal(chatPay(ctx(), 'hello everyone, how is the market'), 0, 'not the same thing twice');
  assert.equal(chatPay(ctx(), 'hi'), 0, 'too short');
  for (let i = 0; i < 40; i++) { later(60_000); chatPay(ctx(), `message number ${i}`); }
  assert.ok(db.get<{ paid: number }>('SELECT paid FROM chat_pay WHERE user_id = ?', A)!.paid <= polygons(300), 'daily cap');
  const drop = startDrop(null, G, 'c', ctx().now, seededRng(3));
  assert.equal(answerDrop(ctx(), 'definitely wrong'), null);
  const win = answerDrop(ctx(), drop.answers[0]!);
  assert.match(win!, /answered first/);
  assert.equal(answerDrop(ctx(), drop.answers[0]!), null, 'only once');
  assert.ok(audit(db).ok);
});

test('drop-in settings, receipts, and the secret', async () => {
  const { run } = setup();
  assert.match(text(await run('dropin', { setting: 'here' })), /only in <#c>/);
  assert.match(text(await run('dropin', { setting: 'off' })), /off/);
  assert.match(text(await run('receipts', { setting: 'off' })), /off/);
  const s = await run('404');
  assert.equal(s.silent, true);
  assert.ok(s.dm === 'Soon, friend.' || s.dm!.startsWith('75.40'));
});
