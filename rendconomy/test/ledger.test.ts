import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers';
import { RESERVE, audit, balance, burn, history, mint, transfer, wallet } from '../src/core/ledger';
import { player } from '../src/core/economy';
import { polygons } from '../src/core/money';
import { GameError } from '../src/core/errors';

const G = 'guild1', A = 'alice', B = 'bob';

test('the Reserve is funded once', () => {
  const db = freshDb();
  assert.equal(balance(db, RESERVE), polygons(25_000_000));
  assert.ok(audit(db).ok);
});

test('new players get their starting Polygons from the Reserve, once', () => {
  const db = freshDb();
  assert.equal(player(db, G, A, polygons(500)).isNew, true);
  assert.equal(player(db, G, A, polygons(500)).isNew, false);
  assert.equal(balance(db, wallet(G, A)), polygons(500));
  assert.equal(balance(db, RESERVE), polygons(25_000_000 - 500));
  player(db, 'guild2', A, polygons(500));
  assert.equal(balance(db, wallet('guild2', A)), polygons(500), 'wallets are per server');
  assert.ok(audit(db).ok);
});

test('transfers are all or nothing and logged', () => {
  const db = freshDb();
  player(db, G, A, polygons(500));
  player(db, G, B, polygons(500));
  transfer(db, { from: wallet(G, A), to: wallet(G, B), cents: polygons(100), reason: 'gift', guildId: G, actorId: A });
  assert.equal(balance(db, wallet(G, A)), polygons(400));
  assert.equal(balance(db, wallet(G, B)), polygons(600));

  assert.throws(() => transfer(db, { from: wallet(G, A), to: wallet(G, B), cents: polygons(401), reason: 'gift' }),
    (e: unknown) => e instanceof GameError && e.code === 'funds.short');
  assert.equal(balance(db, wallet(G, A)), polygons(400), 'a failed transfer changes nothing');

  const h = history(db, wallet(G, A));
  assert.equal(h[0]!.reason, 'gift');
  assert.equal(h[1]!.reason, 'start');
  assert.ok(audit(db).ok);
});

test('a failure later in a transaction undoes the money too', () => {
  const db = freshDb();
  player(db, G, A, polygons(500));
  assert.throws(() => db.tx(() => {
    transfer(db, { from: wallet(G, A), to: RESERVE, cents: polygons(200), reason: 'stock.buy' });
    throw new Error('the share update failed');
  }));
  assert.equal(balance(db, wallet(G, A)), polygons(500));
  assert.ok(audit(db).ok);
});

test('balances can never go negative, even by writing to the table directly', () => {
  const db = freshDb();
  player(db, G, A, polygons(5));
  assert.throws(() => db.run('UPDATE accounts SET balance = -1 WHERE id = ?', wallet(G, A)));
});

test('an empty Reserve refuses payouts instead of going negative', () => {
  const db = freshDb(polygons(10));
  player(db, G, A, 0);
  assert.throws(() => transfer(db, { from: RESERVE, to: wallet(G, A), cents: polygons(11), reason: 'daily' }),
    (e: unknown) => e instanceof GameError && e.code === 'reserve.empty');
});

test('mint and burn keep the books balanced', () => {
  const db = freshDb();
  player(db, G, A, polygons(500));
  mint(db, polygons(1000), 'reserve.refill');
  burn(db, wallet(G, A), polygons(500), 'reset.wipe');
  const a = audit(db);
  assert.ok(a.ok);
  assert.equal(a.inAccounts, polygons(25_000_000 + 1000 - 500));
});

test('money can only be whole, positive cents', () => {
  const db = freshDb();
  player(db, G, A, polygons(500));
  assert.throws(() => transfer(db, { from: wallet(G, A), to: RESERVE, cents: 1.5, reason: 'x' }));
  assert.throws(() => transfer(db, { from: wallet(G, A), to: RESERVE, cents: -100, reason: 'x' }));
  assert.throws(() => transfer(db, { from: RESERVE, to: RESERVE, cents: 100, reason: 'x' }));
});
