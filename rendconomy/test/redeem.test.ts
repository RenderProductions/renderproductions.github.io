import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, wallet } from '../src/core/ledger';
import { seededRng } from '../src/core/rng';
import { execute, press } from '../src/discord/router';
import { REDEEM, redeemSpin } from '../src/commands/casino';
import { has } from '../src/achievements/achievements';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const all = (r: ReplyObject | undefined) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');

test('the redeem board: 15 reels, and the best run is its most common symbol', () => {
  const seq = ['🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🍒', '🔔', '🔔', '💎', '🍋', '🔺', '🔔', '🍋', '🔺'];
  let i = 0;
  const r = redeemSpin(() => seq[i++]!);
  assert.equal(r.board.length, REDEEM.reels);
  assert.deepEqual([r.best, r.count], ['🍒', 7]);
});

test('Redeem yourself: offered after a losing spin, one free spin, 7 of a kind wins the bet back', async () => {
  const db = freshDb();
  let now = eastern('2026-11-16T12:00', -5);
  let seed = 1;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(seed), now, guildId: G, channelId: 'c', user: { id: user, name: 'Spinner' }, isOwner: false, isMod: false, notes: [] });
  await execute(find('balance')!, ctx(), {});
  await execute(find('balance')!, ctx(B), {});
  let offers = 0, wins = 0;
  for (let n = 0; n < 400 && (offers < 40 || !wins); n++) {
    seed = n + 7; now += 10_000;
    const spin = await execute(find('slots')!, ctx(), { amount: '10' });
    const button = spin.buttons?.flat().find((b) => b.label === 'Redeem yourself');
    if (!/No match/.test(all(spin))) { assert.equal(button, undefined, 'only after a loss'); continue; }
    assert.ok(button, 'a losing spin offers Redeem yourself');
    assert.match(all(spin), /Redeem yourself:.*15 reels.*7 of a kind/);
    offers++;
    if (offers === 1) {
      assert.match(press(ctx(B), button!.id).notice ?? '', /another player/);
      // the offer doesn't block the next spin
      now += 10_000;
      const again = await execute(find('slots')!, ctx(), { amount: '10' });
      assert.doesNotMatch(all(again), /Finish your current game/);
      // a new loss replaces the offer: only the latest loss can be redeemed
      if (/No match/.test(all(again))) { assert.match(press(ctx(), button!.id).notice ?? '', /expired/); continue; }
    }
    const before = balance(db, wallet(G, A));
    const r = press(ctx(), button!.id);
    assert.ok(r.update?.live, 'the reels spin: ' + JSON.stringify(r).slice(0, 300));
    assert.equal(r.update!.content!.split('\n').length, 3, 'a 5 × 3 board');
    let last: ReplyObject | null = r.update!;
    for (let f = 0; f < 10; f++) { const nx = r.update!.live!.next(); if (!nx) break; last = nx; }
    const text = all(last!);
    assert.match(text, /Redemption!|Best run: \d+ × /);
    if (/Redemption!/.test(text)) { wins++; assert.equal(balance(db, wallet(G, A)) - before, wins === 1 ? 1000 + 100_000 : 1000, 'the bet back (plus Redemption Arc\'s payout the first time)'); }
    else assert.equal(balance(db, wallet(G, A)), before);
    const twice = press(ctx(), button!.id);
    assert.ok(!twice.update?.live && /expired/.test(twice.notice ?? ''), 'one try per loss');
  }
  assert.ok(offers >= 40, `losses offer a redeem (${offers})`);
  assert.ok(wins >= 1, 'and sometimes it works');
  assert.ok(has(db, A, 'redemption_arc'));
  assert.ok(audit(db).ok);
});
