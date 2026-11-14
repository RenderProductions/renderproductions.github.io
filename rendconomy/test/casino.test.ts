import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH } from '../src/achievements/achievements';
ACH.pay = false;
import { freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng, type Rng } from '../src/core/rng';
import * as sessions from '../src/core/sessions';
import { execute, press } from '../src/discord/router';
import { crashPoint, minesMult } from '../src/commands/casino';
import { addItem } from '../src/shop/inventory';

const G = 'g1', A = '111111111111111111';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

function setup(seed = 1) {
  const db = freshDb();
  let now = 1_000_000;
  let rng: Rng = seededRng(seed);
  const ctx = (): Ctx => ({ db, config: botConfig(), rng, now, guildId: G, channelId: 'c', user: { id: A, name: 'A' }, isOwner: false, isMod: false, notes: [] });
  const run = async (name: string, args: Record<string, string | number> = {}) => { const r = await execute(find(name)!, ctx(), args as never); now += 3000; return r; };
  const cash = () => balance(db, wallet(G, A));
  return { db, ctx, run, cash, setRng: (r: Rng) => { rng = r; }, later: (ms: number) => { now += ms; }, fund: (p: number) => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(p), reason: 'mod.give' }) };
}

test('bets are checked: minimum, maximum, balance', async () => {
  const { run } = setup();
  await run('balance');
  assert.match(text(await run('coinflip', { amount: '5' })), /at least ⬡10\.00/);
  assert.match(text(await run('coinflip', { amount: '3000' })), /cannot exceed ⬡2,500\.00/);
  assert.match(text(await run('coinflip', { amount: '600' })), /Insufficient/);
});

test('instant games return close to their stated odds over many plays, and the books balance', async () => {
  const { db, run, fund, cash } = setup(42);
  await run('balance');
  fund(10_000_000);
  for (const [game, args, expect] of [
    ['coinflip', {}, 0.975], ['dice', { call: 'over 50' }, 0.96], ['roulette', { on: 'red' }, 0.973], ['slots', {}, 0.888]
  ] as const) {
    const before = cash();
    const n = 4000;
    for (let i = 0; i < n; i++) await run(game, { amount: '100', ...args });
    db.run('UPDATE casino SET ban_until = 0'); // TODD's ban would stop a long sim
    const ret = (cash() - before + n * polygons(100)) / (n * polygons(100));
    assert.ok(Math.abs(ret - expect) < 0.06, `${game}: returned ${ret.toFixed(3)}, stated ${expect}`);
  }
  assert.ok(audit(db).ok);
});

test('blackjack: hit and stand with buttons; one game at a time', async () => {
  const { run, ctx, cash } = setup(3);
  await run('balance');
  const r = await run('blackjack', { amount: '50' });
  if (!r.session) { assert.match(text(r), /Blackjack/); return; } // dealt a natural
  assert.match(text(await run('coinflip', { amount: '10' })), /Finish your current game/);
  const after = press(ctx(), sessions.buttonId(r.session, 'stand'));
  assert.match(text(after.update), /TODD:.*\(\*\*\d+\*\*\)/);
  assert.deepEqual(after.update!.buttons, []);
  assert.deepEqual(press(ctx(), sessions.buttonId(r.session, 'stand')).update, { buttons: [] }, 'a second press is answered but does nothing');
  assert.ok(cash() >= 0);
});

test('mines: multipliers follow the fair odds, cash out pays, a bomb loses', async () => {
  assert.ok(Math.abs(minesMult(3, 1) - 0.96 * 16 / 13) < 1e-9);
  const { db, run, ctx, cash } = setup(5);
  await run('balance');
  const r = await run('mines', { amount: '100', bombs: 3 });
  const s = sessions.get<{ bombs: number[] }>(db, r.session!, 0)!;
  const safe = Array.from({ length: 16 }, (_, i) => i).find((i) => !s.state.bombs.includes(i))!;
  press(ctx(), sessions.buttonId(r.session!, String(safe)));
  const before = cash();
  const out = press(ctx(), sessions.buttonId(r.session!, 'cash'));
  assert.match(text(out.update), /Cashed out: ⬡118\.15/);
  assert.equal(cash() - before, Math.floor(polygons(100) * minesMult(3, 1)));

  const r2 = await run('mines', { amount: '100', bombs: 3 });
  const s2 = sessions.get<{ bombs: number[] }>(db, r2.session!, 0)!;
  assert.match(text(press(ctx(), sessions.buttonId(r2.session!, String(s2.state.bombs[0]))).update), /A bomb/);
});

test('rocket: crash points follow edge ÷ x; cashing out in time pays, too late loses', async () => {
  assert.equal(crashPoint(0.96), 1);
  assert.equal(crashPoint(0.096), 10);
  assert.equal(crashPoint(0.0001), 50, 'capped');
  assert.ok(Math.abs(crashPoint(0.096, true) - 12) < 1e-9, 'Rocket Fuel flies 20% higher');
  const { run, ctx, later, setRng } = setup();
  await run('balance');
  setRng({ ...seededRng(1), next: () => 0.096 } as Rng); // crashes at 10x
  const r = await run('rocket', { amount: '10' });
  later(20_000); // e^(0.06*20) ≈ 3.3x
  assert.match(text(press(ctx(), sessions.buttonId(r.session!, 'cash')).update), /Cashed out at 3\.\d\dx/);
  const r2 = await run('rocket', { amount: '10' });
  later(60_000);
  assert.match(text(press(ctx(), sessions.buttonId(r2.session!, 'cash')).update), /Crashed at 10\.00x/);
});

test('TODD throws you out after 10 wins in a row', async () => {
  const { run, setRng, fund } = setup();
  await run('balance');
  fund(10_000);
  setRng({ ...seededRng(1), chance: () => true } as Rng); // every coinflip lands heads
  let last: ReplyObject | undefined;
  for (let i = 0; i < 10; i++) last = await run('coinflip', { amount: '10', side: 'heads' });
  assert.match(text(last), /TODD escorts you out/);
  assert.match(text(await run('coinflip', { amount: '10' })), /barred you from the Rend-Sino/);
});

test('a Platinum Chip adds 4% to winnings', async () => {
  const { db, run, setRng, cash } = setup();
  await run('balance');
  addItem(db, G, A, 'chip');
  await run('use', { item: 'chip' });
  setRng({ ...seededRng(1), chance: () => true } as Rng);
  const before = cash();
  assert.match(text(await run('coinflip', { amount: '100', side: 'heads' })), /Platinum Chip: \+4%/);
  assert.equal(cash() - before, Math.round(polygons(195) * 1.04) - polygons(100));
});

test('odds lists every game', async () => {
  const { run } = setup();
  const t = text(await run('odds'));
  for (const g of ['Slots', 'Coinflip', 'Dice', 'Roulette', 'Blackjack', 'Higher or Lower', 'Minesweeper', 'Rocket']) assert.ok(t.includes(g), g);
});
