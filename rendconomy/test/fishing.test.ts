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
import { tick } from '../src/market/market';
import { addItem, count } from '../src/shop/inventory';
import { SPECIES, addToBag, bagOf, cast, odds, rollWeight, worth } from '../src/fishing/fishing';
import { REEL, reelStep, startReel } from '../src/fishing/reel';
import { logCatch, settleTourneys } from '../src/fishing/docks';
import { FIXES } from '../src/fixes';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const saturday = eastern('2026-11-28T12:00', -5);

function setup(start = eastern('2026-11-24T12:00', -5)) {
  const db = freshDb();
  tick(db, seededRng(5), start);
  let now = start, seed = 1;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(seed++), now, guildId: G, channelId: 'c', user: { id: user, name: user }, isOwner: false, isMod: false, notes: [] });
  const run = (name: string, args: Record<string, string> = {}, user = A) => execute(find(name)!, ctx(user), args);
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  return { db, ctx, run, fund, later: (ms: number) => { now += ms; }, at: (t: number) => { now = t; } };
}

test('reeling in is winnable with sense, and a bigger fish is harder', () => {
  const rng = seededRng(3);
  for (const [strength, rod, floor] of [[2, 100, 0.9], [3, 100, 0.9], [5, 100, 0.25], [5, 135, 0.4], [5.25, 135, 0.2]] as const) {
    let won = 0;
    for (let i = 0; i < 400; i++) {
      let st = startReel(strength, rod), end: string | null = null;
      for (let k = 0; k < 60 && !end; k++) { const r = reelStep(st, st.tension > st.max - 30 ? 'let' : 'reel', rng); st = r.st; end = r.end; }
      if (end === 'landed') won++;
    }
    assert.ok(won / 400 >= floor, `strength ${strength} with a ${rod} rod: landed ${won} of 400`);
    if (strength >= 5) assert.ok(won / 400 < 0.8, `a legend (strength ${strength}) should often get away: landed ${won}`);
  }
  // reeling blindly snaps the line on big fish
  let snaps = 0;
  for (let i = 0; i < 200; i++) { let st = startReel(4, 100), end: string | null = null; for (let k = 0; k < 60 && !end; k++) { const r = reelStep(st, 'reel', rng); st = r.st; end = r.end; } if (end === 'snapped') snaps++; }
  assert.ok(snaps > 100, `reeling blindly snapped ${snaps} of 200`);
  assert.equal(REEL.ms, 60_000);
});

test('places, odds, weights and giants', () => {
  const rng = seededRng(9);
  const cond = { rodTier: 0, hour: 12, rain: false, storm: false, luck: 0 };
  assert.equal(odds('deep', 'bait', cond)['1'], 0, 'no small fish in the Deep');
  assert.ok(odds('lake', 'lure', cond)['3'] > odds('lake', 'bait', cond)['3']);
  assert.ok(odds('lake', 'bait', { ...cond, rodTier: 3 })['4'] > odds('lake', 'bait', cond)['4'], 'better rods, more legends');
  let giants = 0;
  for (let i = 0; i < 5000; i++) { const w = rollWeight(SPECIES.bluegill!, rng); if (w.giant) { giants++; assert.ok(w.lb >= 0.3 * 4 - 1e-9); } else assert.ok(w.lb >= 0.3 && w.lb <= 1.2); }
  assert.ok(giants > 20 && giants < 90, `${giants} giants in 5,000`);
  assert.ok(worth(SPECIES.bass!, 8) > worth(SPECIES.bass!, 2), 'heavier is worth more');
  for (let i = 0; i < 300; i++) { const r = cast('sewer', 'bait', cond, rng); if (r.kind === 'fish') assert.equal(SPECIES[r.id]!.place, 'sewer'); }
});

test('gear opens places; the sewer adds Heat; worms come from compost', async () => {
  const { db, run, fund, later } = setup();
  await run('balance'); fund(A, 60_000);
  addItem(db, G, A, 'rod');
  assert.match(text(await run('fish', { action: 'river' })), /Fiberglass Rod/);
  assert.match(text(await run('fish', { action: 'shop' })), /Old Barnaby's Bait & Tackle[\s\S]*Fiberglass Rod[\s\S]*Boat/);
  assert.match(text(await run('fish', { action: 'buy fiberglass' })), /Fiberglass Rod/);
  assert.match(text(await run('fish', { action: 'buy fiberglass' })), /already have/);
  assert.match(text(await run('fish', { action: 'river' })), /The River/);
  later(3 * 60_000);
  assert.match(text(await run('fish', { action: 'deep' })), /You need a Boat/);
  assert.match(text(await run('fish', { action: 'ice' })), /only freezes in December/);
  const before = (db.get<{ heat: number }>('SELECT heat FROM underground WHERE guild_id = ? AND user_id = ?', G, A)?.heat ?? 0);
  const sewer = await run('fish', { action: 'sewer' });
  if (sewer.session) sessions.end(db, sewer.session);
  assert.match(text(sewer), /Sewer/);
  assert.equal(db.get<{ heat: number }>('SELECT heat FROM underground WHERE guild_id = ? AND user_id = ?', G, A)!.heat, before + 3);
  addItem(db, G, A, 'fish_boot', 1); addItem(db, G, A, 'fish_can', 2);
  assert.match(text(await run('compost')), /2 Fertilizer\*\* and \*\*6 Worms/);
  assert.equal(count(db, G, A, 'worm'), 6);
  assert.ok(db.get("SELECT 1 FROM achievements WHERE user_id = ? AND id = 'homebrew_bait'", A));
  assert.ok(audit(db).ok);
});

test('the Fishdex pays for a finished place; records; mounting a trophy', async () => {
  const { db, run } = setup();
  await run('balance');
  const b0 = balance(db, wallet(G, A));
  const lake = Object.values(SPECIES).filter((s) => s.place === 'lake');
  for (const s of lake) logCatch(db, G, A, s.id, s.lb[1], Date.now());
  assert.ok(balance(db, wallet(G, A)) - b0 >= polygons(900), 'the Lake page pays (shrunk only if the Reserve is low)');
  assert.match(text(await run('fish', { action: 'dex lake' })), /The Lake\*\* · 7 \/ 7/);
  logCatch(db, G, B, 'bass', 7.5, Date.now());
  assert.match(text(await run('fish', { action: 'records' })), /Largemouth Bass\*\*: 8\.0 lb by <@111111111111111111>/);
  addToBag(db, G, A, 'pike', 12, Date.now()); addToBag(db, G, A, 'pike', 18.5, Date.now());
  assert.match(text(await run('fish', { action: 'mount pike' })), /18\.5 lb Northern Pike/);
  assert.equal(bagOf(db, G, A).length, 1, 'the heaviest went on the wall');
  assert.match(text(await run('profile')), /On the wall:\*\* .* a 18\.5 lb Northern Pike/);
});

test('the Saturday tournament: entries, the heaviest fish wins, the Reserve adds the seed', async () => {
  const { db, run, fund, at } = setup(saturday);
  for (const u of [A, B]) { await run('balance', {}, u); fund(u, 1000); }
  assert.match(text(await run('fish', { action: 'tournament join' })), /You're in/);
  await run('fish', { action: 'tournament join' }, B);
  logCatch(db, G, A, 'bass', 5, saturday + 1000);
  logCatch(db, G, B, 'pike', 15, saturday + 2000);
  logCatch(db, G, A, 'minnow', 0.1, saturday + 3000);
  assert.match(text(await run('fish', { action: 'tournament' })), /🥇 <@222222222222222222>: 15\.0 lb Northern Pike[\s\S]*🥈 <@111111111111111111>: 5\.0 lb/);
  const a0 = balance(db, wallet(G, A)), b0 = balance(db, wallet(G, B));
  at(saturday + DAY);
  const r = settleTourneys(db, saturday + DAY);
  assert.equal(r[0]!.winners[0]!.user_id, B);
  const pot = polygons(200 + 2500);
  assert.equal(balance(db, wallet(G, B)) - b0, Math.floor(pot * 0.6));
  assert.equal(balance(db, wallet(G, A)) - a0, pot - Math.floor(pot * 0.6), 'second of two takes the rest');
  assert.equal(settleTourneys(db, saturday + 2 * DAY).length, 0, 'once');
  assert.ok(audit(db).ok);
});

test('the one-time fix moves old fish into the bag at their middle weight', () => {
  const db = freshDb();
  db.run("INSERT INTO players (guild_id, user_id, joined_at) VALUES (?, ?, 0)", G, A);
  addItem(db, G, A, 'fish_bass', 3); addItem(db, G, A, 'fish_boot', 2);
  FIXES.find((f) => f.id === '2026-11-23-fish-bag')!.run(db, Date.now());
  assert.equal(bagOf(db, G, A).length, 3);
  assert.equal(bagOf(db, G, A)[0]!.lb, 4.5);
  assert.equal(count(db, G, A, 'fish_bass'), 0);
  assert.equal(count(db, G, A, 'fish_boot'), 2, 'junk stays in the inventory');
});

test('reeling through the buttons lands a fish or loses it, never both', async () => {
  const { db, run, ctx, fund } = setup();
  await run('balance'); fund(A, 1000);
  addItem(db, G, A, 'rod'); addItem(db, G, A, 'lure');
  await run('use', { item: 'lure' });
  let landed = 0, lost = 0;
  for (let i = 0; i < 60 && landed + lost < 6; i++) {
    db.run("DELETE FROM cooldowns WHERE name = 'fish'");
    const reply = await run('fish');
    if (!reply.session) continue;
    assert.match(text(await run('fish')), /already got one on the line/);
    let view = reply;
    for (let k = 0; k < 60 && view.buttons?.length; k++) {
      const m = /Tension:\*\* \S+ (\d+) \/ (\d+)/.exec(text(view));
      view = press(ctx(), sessions.buttonId(reply.session, m && Number(m[1]) > Number(m[2]) - 30 ? 'let' : 'reel')).update!;
    }
    if (/You caught/.test(text(view))) landed++; else lost++;
  }
  assert.ok(landed + lost >= 3, `fought ${landed + lost}`);
  assert.ok(landed >= 1);
  assert.ok(audit(db).ok);
});
