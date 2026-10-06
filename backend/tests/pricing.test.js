'use strict';
/**
 * FX pricing and the economic invariant of a transfer.
 *
 * total_debit = cost + spread + fee  (in minor units, exactly)
 *
 * This is the same equation `ledger.postTransferSettlement()` asserts before it
 * writes a journal, so a pricing change that breaks it fails here first.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const fx = require('../services/fx');
const money = require('../lib/money');

const corridor = {
  currency: 'NGN',
  base_rate: '421.06000000',
  retail_rate: '414.74410000',
};

const qarPerUsd = 3.64; // decimal: QAR per 1 USD (NOT minor units)

function priceOf(sendMajor, feeMajor) {
  return fx.price({
    sendAmountQarMinor: money.toMinor(sendMajor, 'QAR'),
    feeQarMinor: money.toMinor(feeMajor, 'QAR'),
    corridor,
    qarPerUsd,
  });
}

test('a priced transfer is economically balanced', () => {
  const priced = priceOf('500.00', '10.00');
  assert.equal(
    priced.totalDebitQarMinor,
    priced.costQarMinor + priced.spreadQarMinor + priced.feeQarMinor,
    'total debit must equal cost + spread + fee',
  );
});

test('the customer receives the retail rate, the platform books the base rate', () => {
  const priced = priceOf('500.00', '10.00');
  // 500.00 QAR × 414.744100 = 207,372.05 NGN
  assert.equal(priced.payoutAmountMinor, 20737205);
  // cost at the base rate: 207,372.05 / 421.06 = 492.50 QAR
  assert.equal(priced.costQarMinor, 49250);
  assert.equal(priced.spreadQarMinor, 750);          // 500.00 − 492.50
  assert.equal(priced.totalDebitQarMinor, 51000);    // 500.00 + 10.00 fee
});

test('zero-fee small tickets still balance', () => {
  const priced = priceOf('50.00', '0.00');
  assert.equal(priced.feeQarMinor, 0);
  assert.equal(priced.totalDebitQarMinor, priced.costQarMinor + priced.spreadQarMinor);
});

test('spread is never negative — retail must not exceed base', () => {
  assert.throws(
    () => fx.price({
      sendAmountQarMinor: 50000,
      feeQarMinor: 1000,
      corridor: { currency: 'NGN', base_rate: '400.00', retail_rate: '421.06' },
      qarPerUsd,
    }),
    /retail rate exceeds the base rate|inconsistent/i,
  );
});

test('the QAR cost converts to USD cents for the float ledger leg', () => {
  const priced = priceOf('500.00', '10.00');
  // 492.50 QAR ÷ 3.64 QAR/USD = 135.30 USD = 13,530 cents.
  // Regression guard: passing the rate in minor units (364) produced 135 cents,
  // a 100× error in the cross-currency journal.
  assert.equal(priced.usdCostMinor, 13530);
  assert.equal(priced.usdCostMinor, money.divideByRate(priced.costQarMinor, qarPerUsd));
});

test('a missing or zero QAR/USD rate is refused rather than guessed', () => {
  for (const bad of [0, null, undefined, 'abc']) {
    assert.throws(
      () => fx.price({
        sendAmountQarMinor: 50000,
        feeQarMinor: 1000,
        corridor,
        qarPerUsd: bad,
      }),
      /QAR\/USD rate is configured|Invalid rate/i,
    );
  }
});

test('the same invariants hold for every corridor exponent', () => {
  const cases = [
    { currency: 'KES', base: '35.55', retail: '35.01675000', exponent: 2 },
    { currency: 'GHS', base: '4.28', retail: '4.21580000', exponent: 2 },
    { currency: 'UGX', base: '1018.40', retail: '1003.12400000', exponent: 0 },
    { currency: 'XOF', base: '165.20', retail: '162.72200000', exponent: 0 },
  ];
  for (const item of cases) {
    const priced = fx.price({
      sendAmountQarMinor: 100000, // 1,000.00 QAR
      feeQarMinor: 1000,
      corridor: { currency: item.currency, base_rate: item.base, retail_rate: item.retail },
      qarPerUsd,
    });
    assert.equal(
      priced.totalDebitQarMinor,
      priced.costQarMinor + priced.spreadQarMinor + priced.feeQarMinor,
      `${item.currency} does not balance`,
    );
    assert.ok(priced.payoutAmountMinor > 0, `${item.currency} payout must be positive`);
    assert.equal(money.EXPONENTS[item.currency], item.exponent);
  }
});

test('payout amount is always positive for a minimum-size send', () => {
  const priced = priceOf('10.00', '0.00');
  assert.ok(priced.payoutAmountMinor > 0);
  assert.equal(priced.payoutAmountMinor, money.multiplyByRate(money.toMinor('10.00', 'QAR'), corridor.retail_rate));
});
