import { test } from 'node:test';
import assert from 'node:assert/strict';
import { format, formatShort, parseAmount, parseCount, polygons, percentOf } from '../src/core/money';
import { GameError } from '../src/core/errors';

const code = (fn: () => unknown) => {
  try { fn(); } catch (e) { if (e instanceof GameError) return e.code; throw e; }
  return 'ok';
};

test('format shows Polygons with cents', () => {
  assert.equal(format(123456), '⬡1,234.56');
  assert.equal(format(5), '⬡0.05');
  assert.equal(format(-250), '-⬡2.50');
  assert.equal(formatShort(polygons(1_250_000)), '⬡1.3M');
  assert.equal(formatShort(polygons(25_000_000)), '⬡25M');
  assert.equal(formatShort(polygons(999)), '⬡999.00');
});

test('parseAmount reads every format', () => {
  assert.equal(parseAmount('500'), 50000);
  assert.equal(parseAmount('1,000'), 100000);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('⬡12.34'), 1234);
  assert.equal(parseAmount('1.5k'), 150000);
  assert.equal(parseAmount('2M'), 2_000_000_00);
  assert.equal(parseAmount('all', { all: 9999 }), 9999);
  assert.equal(parseAmount('half', { all: 9999 }), 4999);
  assert.equal(parseAmount('50%', { all: 1001 }), 500, 'percentages round down');
  assert.equal(parseAmount('max', { all: 50000, max: 20000 }), 20000);
});

test('parseAmount refuses bad input with a reason', () => {
  assert.equal(code(() => parseAmount('')), 'amount.missing');
  assert.equal(code(() => parseAmount('abc')), 'amount.invalid');
  assert.equal(code(() => parseAmount('-5')), 'amount.invalid');
  assert.equal(code(() => parseAmount('1.234')), 'amount.precision');
  assert.equal(code(() => parseAmount('0')), 'amount.small');
  assert.equal(code(() => parseAmount('all')), 'amount.relative');
  assert.equal(code(() => parseAmount('150%', { all: 100 })), 'amount.percent');
  assert.equal(code(() => parseAmount('1e9')), 'amount.invalid', 'no scientific notation');
  assert.equal(code(() => parseAmount('Infinity')), 'amount.invalid');
  assert.equal(code(() => parseAmount('999999999999999b')), 'amount.large');
  assert.equal(code(() => parseAmount('600', { max: polygons(500) })), 'amount.over');
});

test('parseCount is for whole things', () => {
  assert.equal(parseCount('5'), 5);
  assert.equal(parseCount('1k'), 1000);
  assert.equal(parseCount('all', { all: 25 }), 25);
  assert.equal(code(() => parseCount('2.5')), 'count.whole');
  assert.equal(code(() => parseCount('0')), 'count.small');
});

test('percentOf never pays a fraction', () => {
  assert.equal(percentOf(999, 2.5), 24);
});
