import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eastern, freshDb } from './helpers';
import { find } from '../src/commands';
import type { Ctx, ReplyObject } from '../src/commands/types';
import { botConfig } from '../src/config';
import { audit, balance, transfer, wallet, RESERVE } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { seededRng } from '../src/core/rng';
import { DAY, HOUR } from '../src/core/time';
import { execute } from '../src/discord/router';
import { has } from '../src/achievements/achievements';
import { RARITY } from '../src/achievements/list';
import { newLot, saveLot, settle as settleEstate, KINDS } from '../src/estate/estate';
import { erasePlayer } from '../src/core/players';
import {
  UG, CONTRABAND, dropLoot, fencePrice, heatNow, isPasswordNight, lootOf, maybeRaid, nightKey, passwordFor, raid, raidChance, row, stars, stockFor, tonight
} from '../src/underground/underground';
import { connectorHijack } from '../src/commands/underground';
import { settle as settleCasino } from '../src/casino/core';

const G = 'g1', A = '111111111111111111', B = '222222222222222222';
const text = (r: ReplyObject | undefined | null) => [r?.content ?? '', ...(r?.embeds ?? []).map((e) => `${e.title}\n${e.description}`)].join('\n');
const night = eastern('2026-11-16T22:30', -5);   // a Monday night, open

/** A password-free night (most are), searching forward from a date. */
function quietNight(g = G): number {
  for (let d = 0; d < 30; d++) { const t = night + d * DAY; if (!isPasswordNight(g, nightKey(t)!)) return t; }
  throw new Error('no quiet night');
}
function passwordNight(g = G): number {
  for (let d = 0; d < 60; d++) { const t = night + d * DAY; if (isPasswordNight(g, nightKey(t)!)) return t; }
  throw new Error('no password night');
}

function setup(start = quietNight()) {
  const db = freshDb();
  let now = start;
  const ctx = (user = A): Ctx => ({ db, config: botConfig(), rng: seededRng(9), now, guildId: G, channelId: 'c', user: { id: user, name: user === A ? 'Ana' : 'Ben' }, isOwner: false, isMod: false, notes: [] });
  const run = (action = '', target = '', extra = '', user = A) => execute(find('underground')!, ctx(user), { action, target, extra });
  const fund = (u: string, p: number) => transfer(db, { from: RESERVE, to: wallet(G, u), cents: polygons(p), reason: 'mod.give' });
  const setHeat = (u: string, h: number) => { row(db, G, u, now); db.run('UPDATE underground SET heat = ?, heat_at = ? WHERE guild_id = ? AND user_id = ?', h, now, G, u); };
  return { db, run, fund, ctx, setHeat, later: (ms: number) => { now += ms; }, now: () => now };
}

test('the night: open 10 PM to 4 AM Eastern', () => {
  assert.equal(nightKey(eastern('2026-11-16T21:59', -5)), null);
  assert.equal(nightKey(eastern('2026-11-16T22:00', -5)), '2026-11-16');
  assert.equal(nightKey(eastern('2026-11-17T03:59', -5)), '2026-11-16', 'still Monday night');
  assert.equal(nightKey(eastern('2026-11-17T04:00', -5)), null);
  assert.equal(nightKey(eastern('2026-07-04T23:00', -4)), '2026-07-04', 'summer time too');
  let pw = 0;
  for (let d = 0; d < 300; d++) if (isPasswordNight(G, `2027-${String(1 + Math.floor(d / 28) % 12).padStart(2, '0')}-${String(1 + d % 28).padStart(2, '0')}`)) pw++;
  assert.ok(pw > 70 && pw < 130, `about a third are password nights (${pw}/300)`);
  assert.equal(stockFor(G, '2026-11-16').length, 4);
});

test('where he squats: a condemned lot, else the most run-down place (half rent that day), else an empty lot', async () => {
  const { db, run, later, now } = setup();
  await run('', '', '', B);
  assert.equal(tonight(db, G, now())!.where, 'empty');
  db.run("DELETE FROM meta WHERE key LIKE 'ug.night:%'");
  const built = (t: number, condition: number) => saveLot(db, { ...newLot(G, t, 'shack', B, now() - DAY, 0), build_until: now() - 3 * HOUR, built_at: null, condition, settled_at: now() - 2 * HOUR });
  built(2, 60); built(3, 30);
  const t = tonight(db, G, now())!;
  assert.equal(t.where, 'rundown'); assert.equal(t.lot, 3);
  assert.match(text(await run()), /most run-down Shack/);
  later(DAY);
  const ev = settleEstate(db, G, now());
  const paid = Object.fromEntries(ev.filter((e) => e.kind === 'paid').map((e) => [(e as { lot: number }).lot, (e as { rent: number }).rent]));
  assert.equal(paid[3], Math.floor(Math.floor(KINDS.shack.rent * 0.3) / 2), 'half rent the night he squatted there');
  db.run("DELETE FROM meta WHERE key LIKE 'ug.night:%'");
  saveLot(db, { ...newLot(G, 6, 'shack', B, now() - DAY, 0), build_until: 0, built_at: null, owner_id: null, status: 'auction', condition: 0, auction_until: now() + DAY });
  assert.deepEqual([tonight(db, G, now())!.where, tonight(db, G, now())!.lot], ['condemned', 6]);
});

test('closed by day; the shelf by night; buying adds Heat and works', async () => {
  const { db, run, fund, later } = setup();
  await run(); fund(A, 20_000);
  later(-2 * HOUR - 31 * 60 * 1000);   // 8 PM: closed
  assert.match(text(await run()), /comes back/);
  assert.match(text(await run('buy', 'dice')), /comes back/);
  later(2 * HOUR + 31 * 60 * 1000);
  const view = text(await run());
  assert.match(view, /Tonight's shelf/);
  const stock = stockFor(G, nightKey(night + 0)!) ;
  const n = tonight(db, G, setupNow(view))!;
  const item = stockFor(G, n.night).find((x) => x !== 'insider_tip' && x !== 'rumor_mill' && x !== 'squatter_crew')!;
  const before = balance(db, wallet(G, A));
  const r = text(await run('buy', item));
  assert.match(r, /You paid/);
  assert.equal(before - balance(db, wallet(G, A)), CONTRABAND[item].price);
  assert.ok(heatNow(db, G, A, setupNow(view)) >= CONTRABAND[item].heat || /BUSTED/.test(r));
  void stock;
  assert.ok(audit(db).ok);
});
function setupNow(_: string): number { return quietNight(); }

test('Heat: stars, raid odds, cooling, and held loot keeping it warm', () => {
  const { db, setHeat, now } = setup();
  assert.deepEqual([0, 1, 20, 21, 41, 81, 100].map(stars), [0, 1, 1, 2, 3, 5, 5]);
  assert.deepEqual([0, 20, 40, 60, 80, 100].map(raidChance), [0, 0.02, 0.08, 0.18, 0.32, 0.5]);
  setHeat(A, 50);
  assert.equal(heatNow(db, G, A, now() + 2 * DAY), 30, 'cools 10 a day');
  setHeat(A, 50);
  dropLoot(db, G, A, now(), () => 0);
  assert.equal(heatNow(db, G, A, now() + 2 * DAY), 40, '+5 a day for each piece held');
});

test('a raid: Busted!, contraband and loot confiscated, a capped fine, Heat back to two stars', async () => {
  const { db, run, fund, setHeat, now } = setup();
  await run(); fund(A, 100_000);
  setHeat(A, 100);
  db.run('UPDATE underground SET dice = 3, lockpick = 1 WHERE guild_id = ? AND user_id = ?', G, A);
  dropLoot(db, G, A, now(), () => 0);
  const before = balance(db, wallet(G, A));
  const r = maybeRaid(db, G, A, now(), () => 0)!;
  assert.ok(r, 'at five stars a raid is a coin flip, and this one landed');
  assert.equal(r.fine, UG.raidFineMax, '10% of the wallet, at most ⬡5,000');
  assert.equal(before - balance(db, wallet(G, A)), UG.raidFineMax - RARITY.rare.pay, 'the fine, less the Busted! reward');
  assert.equal(lootOf(db, G, A).length, 0);
  const after = row(db, G, A, now());
  assert.deepEqual([after.dice, after.lockpick, after.heat, after.raids], [0, 0, UG.raidHeat, 1]);
  assert.ok(has(db, A, 'busted'));
  assert.ok(audit(db).ok);
});

test('fencing pays 50% hot, 90% after three days; laundering pays it all through your own shop', async () => {
  const { db, run, fund, later, now } = setup();
  await run(); fund(A, 30_000);
  const l = dropLoot(db, G, A, now(), () => 0)!;
  assert.equal(fencePrice(l, now()), l.value * 0.5);
  assert.equal(fencePrice(l, now() + 3 * DAY), Math.floor(l.value * 0.9));
  const b = balance(db, wallet(G, A));
  const r = text(await run('fence', String(l.id)));
  assert.match(r, /Fenced|BUSTED/);
  if (!/BUSTED/.test(r)) assert.equal(balance(db, wallet(G, A)) - b, l.value * 0.5);
  // laundering
  db.run('UPDATE underground SET heat = 0 WHERE guild_id = ? AND user_id = ?', G, A);
  const l2 = dropLoot(db, G, A, now(), () => 0)!;
  assert.match(text(await run('launder', String(l2.id), '11')), /Corner Shop you own/);
  saveLot(db, { ...newLot(G, 11, 'shop', A, now() - DAY, 0), build_until: 0, built_at: null, settled_at: now() });
  const r2 = text(await run('launder', String(l2.id), '11'));
  if (/BUSTED/.test(r2)) return;
  assert.match(r2, /out the back/);
  const b2 = balance(db, wallet(G, A));
  later(DAY + 1);
  const r3 = text(await run('heat'));
  assert.match(r3, /came back clean|out the back/);
  assert.ok(balance(db, wallet(G, A)) - b2 >= l2.value, 'the full value');
  assert.ok(audit(db).ok);
});

test('smuggling: one run a night, lands in two hours', async () => {
  const { db, run, fund, later } = setup();
  await run(); fund(A, 20_000);
  const r = text(await run('smuggle', '1000'));
  if (/BUSTED/.test(r)) return;
  assert.match(r, /onto a boat/);
  assert.match(text(await run('smuggle', '1000')), /still on the water/);
  const b = balance(db, wallet(G, A));
  later(2 * HOUR + 1);
  const r2 = text(await run('heat'));
  assert.match(r2, /made it across|harbor patrol/);
  if (/made it across/.test(r2)) assert.ok(balance(db, wallet(G, A)) - b >= polygons(1100));
  assert.match(text(await run('smuggle', '1000')), /One boat a night/);
  assert.ok(audit(db).ok);
});

test('snitching: a hot target gets raided and you get paid; a cold one turns TODD on you', async () => {
  const { db, run, fund, setHeat } = setup();
  await run(); await run('', '', '', B); fund(A, 5_000); fund(B, 20_000);
  setHeat(B, 70);
  const r = text(await run('snitch', `<@${B}>`));
  assert.match(r, /kicked a door in/);
  assert.ok(has(db, A, 'snitches_get_stitches'));
  assert.equal(row(db, G, B, Date.now()).raids, 1);
  assert.match(text(await run('snitch', `<@${B}>`)), /one call a day/);
  const { run: run2, fund: fund2, db: db2 } = setup();
  await run2(); await run2('', '', '', B); fund2(A, 5_000);
  assert.match(text(await run2('snitch', `<@${B}>`)), /looking at \*\*you\*\*/);
  assert.equal(row(db2, G, A, Date.now()).heat, UG.snitchMiss);
});

test('password nights: Mr. Glaz hijacks a drop-in once, from 8 PM; you need the word to get in', async () => {
  const t = passwordNight();
  const { db, run, later } = setup(t);
  await run();
  const pw = passwordFor(G, nightKey(t)!);
  assert.match(text(await run()), /Password/);
  assert.match(text(await run('buy', 'dice')), /Password/);
  assert.match(text(await run('nope')), /slams shut/);
  const r = text(await run(pw));
  assert.match(r, /door opens/);
  assert.ok(has(db, A, 'password_please'));
  assert.match(text(await run()), /Tonight's shelf/);
  // the hijack, on a fresh server: not at 7 PM, yes at 8:30 PM, and only once
  const db2 = freshDb();
  const seven = t - 3.5 * HOUR, eightThirty = t - 2 * HOUR;
  assert.equal(connectorHijack(db2, G, seven), null);
  const h = connectorHijack(db2, G, eightThirty)!;
  assert.match(h.embeds![0]!.description!, /MR. GLAZ HAS TAKEN CONTROL OF THIS INFERNAL MACHINE/);
  assert.match(h.embeds![0]!.description!, new RegExp(pw));
  assert.equal(connectorHijack(db2, G, eightThirty + 60_000), null, 'once a night');
  later(0);
});

test('contraband elsewhere: Loaded Dice in the casino, a Fake ID past TODD, a Smoke Bomb on a bid', async () => {
  const { db, ctx, fund } = setup();
  const c = ctx(); await execute(find('balance')!, c, {}); fund(A, 50_000);
  row(db, G, A, c.now);
  db.run('UPDATE underground SET dice = 1 WHERE guild_id = ? AND user_id = ?', G, A);
  const seq = [0.5, 0.1];   // not caught, then the save
  const c2 = { ...ctx(), rng: { ...seededRng(1), next: () => seq.shift() ?? 0.9 } } as Ctx;
  const res = settleCasino(c2, G, 'coinflip', polygons(100), 0);
  assert.equal(res.paid, polygons(100), 'the dice saved the bet');
  assert.match(res.lines.join(' '), /roll your way/);
  // Fake ID
  db.run('INSERT OR IGNORE INTO casino (guild_id, user_id) VALUES (?, ?)', G, A);
  db.run('UPDATE casino SET ban_until = ? WHERE guild_id = ? AND user_id = ?', c.now + HOUR, G, A);
  db.run('UPDATE underground SET fake_id = 1 WHERE guild_id = ? AND user_id = ?', G, A);
  const flip = text(await execute(find('coinflip')!, ctx(), { amount: '10', side: 'heads' }));
  assert.match(flip, /Fake ID/);
  // Smoke Bomb
  db.run('UPDATE underground SET smoke = 1 WHERE guild_id = ? AND user_id = ?', G, A);
  const p = (action: string, lot: string, amount: string, u = A) => execute(find('property')!, ctx(u), { action, lot, amount });
  await p('build', 'A1', 'shack');
  await execute(find('balance')!, ctx(B), {}); transfer(db, { from: RESERVE, to: wallet(G, B), cents: polygons(10_000), reason: 'mod.give' });
  await p('bid', 'A1', '5000', B);
  const before = balance(db, wallet(G, A));
  assert.match(text(await p('refuse', 'A1', '')), /Smoke Bomb/);
  assert.equal(balance(db, wallet(G, A)), before, 'no fee');
  assert.ok(audit(db).ok);
});

test('an erased player\'s Heat and loot go too', () => {
  const { db, setHeat, now } = setup();
  setHeat(A, 60); dropLoot(db, G, A, now(), () => 0);
  erasePlayer(db, G, A, now());
  assert.equal(db.get('SELECT 1 FROM underground WHERE user_id = ?', A), undefined);
  assert.equal(lootOf(db, G, A).length, 0);
  void raid;
});
