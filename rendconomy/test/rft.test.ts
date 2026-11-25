import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TUNING as ACH, has } from '../src/achievements/achievements';
ACH.pay = false;
import { freshDb } from './helpers';
import { balance, wallet, audit } from '../src/core/ledger';
import { polygons } from '../src/core/money';
import { player } from '../src/core/economy';
import { RFT, rftAchieve, rftCashout, rftStatus } from '../src/games/rft';

const G = 'g1', A = '111111111111111111';

test('File Tycoon: ⬡5 per ⬡1,000 earned in the game, ⬡500 a day, never the same earnings twice', () => {
  const db = freshDb();
  const day1 = Date.UTC(2026, 10, 25, 17), day2 = day1 + 86_400_000;
  player(db, G, A, polygons(500), day1);
  const start = balance(db, wallet(G, A));
  assert.match(rftCashout(db, G, A, '{"earned":900}', day1), /Nothing new/);
  assert.match(rftCashout(db, G, A, '{"earned":12345}', day1), /paid ⬡60\.00/);           // 12 thousands
  assert.equal(balance(db, wallet(G, A)) - start, polygons(60));
  assert.match(rftCashout(db, G, A, '{"earned":12345}', day1), /Nothing new/, 'the same earnings never pay twice');
  assert.match(rftCashout(db, G, A, '{"earned":1012345}', day1), /paid ⬡440\.00[\s\S]*the rest keeps/);   // capped at 500 for the day
  assert.match(rftCashout(db, G, A, '{"earned":1012345}', day1), /already cashed out today/);
  assert.match(rftCashout(db, G, A, '{"earned":1012345}', day2), /paid ⬡500\.00/, 'the rest pays the next day');
  assert.equal(rftStatus(db, A, day2).paid, 500);
  assert.match(rftCashout(db, G, A, '{"earned":-5}', day2), /didn't believe/);
  assert.match(rftCashout(db, G, A, 'nope', day2), /could not be read/);
  assert.equal(RFT.dailyCap, polygons(500));
  assert.ok(audit(db).ok);
});

test('File Tycoon achievements unlock in the bot, and only its own', () => {
  const db = freshDb();
  player(db, G, A, polygons(500), 0);
  assert.match(rftAchieve(db, G, A, 'rft_first_byte'), /First Byte/);
  assert.ok(has(db, A, 'rft_first_byte'));
  assert.match(rftAchieve(db, G, A, 'rft_first_byte'), /Already/);
  assert.match(rftAchieve(db, G, A, 'millionaire'), /Unknown/);
  assert.deepEqual(rftStatus(db, A).achievements, ['rft_first_byte']);
});

test('chat pay keeps a fingerprint of the last paid message, never its text', async () => {
  const { fingerprint } = await import('../src/social/chatter.js');
  const a = fingerprint('hello there friends'), b = fingerprint('hello there friends');
  assert.equal(a, b);
  assert.notEqual(a, fingerprint('hello there friend'));
  assert.ok(!a.includes('hello'));
});
