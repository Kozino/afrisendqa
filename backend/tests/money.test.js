'use strict';
/**
 * Money arithmetic.
 *
 * These are the tests that would have caught the float-drift bug found while
 * building the payout path: `Number(rate)` / `Number(minor)` silently rounded
 * KES payouts to zero. Every case below is integer-exact.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const money = require('../lib/money');

test('toMinor parses formatted amounts exactly', () => {
  assert.equal(money.toMinor('1,234.50', 'QAR'), 123450);
  assert.equal(money.toMinor('1234.5', 'QAR'), 123450);
  assert.equal(money.toMinor(1234.5, 'QAR'), 123450);
  assert.equal(money.toMinor('1000', 'UGX'), 1000);          // 0-exponent currency
  assert.equal(money.toMinor('0.01', 'QAR'), 1);
  assert.equal(money.toMinor('-50.00', 'QAR'), -5000);
});

test('toMinor rejects excess precision instead of silently rounding', () => {
  assert.throws(() => money.toMinor('10.005', 'QAR'), /decimal place/i);
  assert.throws(() => money.toMinor('10.5', 'UGX'), /decimal place/i);
  assert.throws(() => money.toMinor('abc', 'QAR'), /Invalid amount/i);
  assert.throws(() => money.toMinor('10', 'XYZ'), /Unknown currency/i);
});

test('format is exact and grouped', () => {
  assert.equal(money.format(123450, 'QAR'), '1,234.50');
  assert.equal(money.format(1750838, 'KES'), '17,508.38');
  assert.equal(money.format(1000, 'UGX'), '1,000');
  assert.equal(money.format(0, 'QAR'), '0.00');
  assert.equal(money.format(-5000, 'QAR'), '-50.00');
  assert.equal(money.formatWithCurrency(20750000, 'NGN'), '207,500.00 NGN');
});

test('multiplyByRate is exact with decimal rates', () => {
  // 500.00 QAR at 414.7441 NGN/QAR
  assert.equal(money.multiplyByRate(50000, '414.7441'), 20737205);
  // 500.00 QAR at 35.01675 KES/QAR  (the case that used to return 0)
  assert.equal(money.multiplyByRate(50000, '35.01675'), 1750838);
  assert.equal(money.multiplyByRate(50000, 35.55), 1777500);
  assert.equal(money.multiplyByRate(0, '421.06'), 0);
});

test('divideByRate is exact and uses half-up rounding', () => {
  assert.equal(money.divideByRate(1750838, '35.55'), 49250);
  assert.equal(money.divideByRate(20737205, '421.06'), 49250);
  assert.equal(money.divideByRate(20375, '3.64'), 5598);
  assert.equal(money.divideByRate(1, '0.5'), 2);              // 0.5 rounds up
  assert.throws(() => money.divideByRate(100, '0'), /zero/i);
});

test('multiply and divide round-trip within one minor unit', () => {
  const rates = ['421.06', '4.28', '35.55', '1018.40', '724.80', '394.50', '13.38', '165.20'];
  for (const rate of rates) {
    const qarMinor = 50000;
    const payout = money.multiplyByRate(qarMinor, rate);
    const back = money.divideByRate(payout, rate);
    assert.ok(Math.abs(back - qarMinor) <= 1, `${rate}: ${qarMinor} → ${payout} → ${back}`);
  }
});

test('parseRate rejects float artefacts and scientific notation', () => {
  assert.throws(() => money.parseRate('1e3'), /Invalid rate/i);
  assert.throws(() => money.parseRate('abc'), /Invalid rate/i);
  assert.deepEqual(money.parseRate('421.06000000'), { value: 42106000000n, scale: 100000000n });
});
