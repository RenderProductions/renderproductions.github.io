import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit } from '../src/core/ledger';
import { seededRng } from '../src/core/rng';
import { execute, press } from '../src/discord/router';
import { pollRelay, toRelay } from '../src/discord/background';

const G = 'g1', A = '111111111111111111';

test('the Trading Floor plays button games: buttons come through, presses and live frames go back', async () => {
  const db = freshDb();
  const now = eastern('2026-11-16T12:00', -5);
  const ctx = (at = now): Ctx => ({ db, config: botConfig(), rng: seededRng(9), now: at, guildId: G, channelId: `activity:${G}`, user: { id: A, name: 'Floor' }, isOwner: false, isMod: false, notes: [] });
  await execute(find('balance')!, ctx(), {});

  // Blackjack: the reply carries its buttons, and pressing one updates it
  const bj = toRelay(await execute(find('blackjack')!, ctx(), { amount: '20' }), now);
  const buttons = (bj.buttons ?? []).flat();
  if (buttons.length) {
    const stand = buttons.find((b) => /stand/i.test(b.label ?? '')) ?? buttons[0]!;
    const r = press(ctx(now + 2000), stand.id);
    assert.ok(r.update || r.followUp, 'pressing a button changes the game');
    assert.ok(toRelay(r.update ?? r.followUp!, now + 2000).embeds?.length);
  }

  // Rocket: a live key to poll, frames while it flies, and a cash-out at the moment of the click
  const t = now + 60_000;
  const rk = toRelay(await execute(find('rocket')!, ctx(t), { amount: '20' }), t);
  assert.ok(rk.live, 'the rocket is live: ' + JSON.stringify(rk).slice(0, 300));
  assert.ok((rk.everyMs ?? 0) >= 1500, 'polled no faster than every 1.5s');
  const frame = pollRelay(db, rk.live!, t + 1500);
  assert.ok(frame.update?.embeds?.length || frame.done);
  const cash = (rk.buttons ?? []).flat().find((b) => /cash/i.test(b.label ?? ''));
  assert.ok(cash, 'a Cash out button');
  const out = press(ctx(t + 1200), cash!.id);
  assert.match(JSON.stringify(out.update?.embeds ?? []), /Cashed out at|Crashed/);
  assert.equal(pollRelay(db, 'nothing-here', now).done, true);
  assert.ok(audit(db).ok);
});
