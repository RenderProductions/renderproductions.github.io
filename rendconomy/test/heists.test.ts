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
import { heistOdds } from '../src/heists/heists';
import { activeEvent, shiftMultiplier, startEvent, worldTick } from '../src/events/world';
import { tick } from '../src/market/market';

const G = 'g1', P = ['111111111111111111', '222222222222222222', '333333333333333333'], OWNER = '999999999999999999';
const text = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const noon = eastern('2026-11-13T12:00', -5);

function setup(rng: Rng = seededRng(1)) {
  const db = freshDb();
  const ctx = (user = P[0]!, owner = false): Ctx => ({ db, config: botConfig(), rng, now: noon, guildId: G, channelId: 'c', user: { id: user, name: user.slice(0, 3) }, isOwner: owner, isMod: owner, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = P[0]!, owner = false) => execute(find(name)!, ctx(user, owner), args);
  return { db, ctx, run };
}

test('odds: roles add up, a second of a role counts half, the Reserve needs a hacker', () => {
  const m = (role: 'hacker' | 'driver' | 'lookout' | 'muscle') => ({ id: role, name: role, role });
  assert.ok(Math.abs(heistOdds('vault', [m('hacker'), m('lookout'), m('muscle')]) - (0.45 + 0.1 + 0.08 + 0.05)) < 1e-9);
  assert.ok(Math.abs(heistOdds('vault', [m('hacker'), m('hacker'), m('hacker')]) - (0.45 + 0.1 + 0.05 + 0.05)) < 1e-9);
  assert.ok(heistOdds('reserve', [m('driver'), m('lookout'), m('muscle')]) < heistOdds('reserve', [m('hacker'), m('lookout'), m('muscle')]) - 0.2);
});

test('a crew joins with buttons, the leader starts it, stakes go in and a haul comes out', async () => {
  const { db, run, ctx } = setup({ ...seededRng(1), next: () => 0.01, chance: () => false } as Rng);
  for (const p of P) { await run('balance', {}, p); transfer(db, { from: RESERVE, to: wallet(G, p), cents: polygons(1000), reason: 'mod.give' }); }
  const r = await run('heist', { target: 'vault', role: 'hacker' });
  assert.match(text(r), /Heist: a company vault[\s\S]*Crew 1\/5/);
  assert.match(press(ctx(P[1]!), sessions.buttonId(r.session!, 'start')).notice!, /Only the leader/);
  press(ctx(P[1]!), sessions.buttonId(r.session!, 'join:lookout'));
  press(ctx(P[2]!), sessions.buttonId(r.session!, 'join:muscle'));
  const done = press(ctx(), sessions.buttonId(r.session!, 'start'));
  assert.match(text(done.update), /Clean getaway[\s\S]*each/);
  for (const p of P) assert.ok(balance(db, wallet(G, p)) > polygons(1500) - polygons(250), 'each came out ahead');
  assert.match(text(await run('heist', { target: 'vault' })), /still hot/);
  assert.ok(audit(db).ok);
});

test('world events: start, effects, and the timer', () => {
  const db = freshDb();
  tick(db, seededRng(1), noon);
  assert.equal(worldTick(db, null, noon, seededRng(1)), null, 'the first one is scheduled, not started');
  startEvent(db, 'labor_shortage', undefined, noon);
  assert.equal(shiftMultiplier(db, 'RRM', noon + 1000), 1.5);
  startEvent(db, 'spotlight', 'RRM', noon);
  assert.equal(shiftMultiplier(db, 'RRM', noon + 1000), 2);
  assert.equal(shiftMultiplier(db, 'BLU', noon + 1000), 1);
  assert.equal(activeEvent(db, noon + 2 * 3600_000), null, 'events last an hour');
});

test('/event shows the current event; only the owner starts one', async () => {
  const { run } = setup();
  assert.match(text(await run('event')), /Nothing special/);
  assert.match(text(await run('event', { action: 'start chatty' })), /restricted to the bot owner/);
  assert.match(text(await run('event', { action: 'start chatty' }, OWNER, true)), /Gossip Hour/);
});
