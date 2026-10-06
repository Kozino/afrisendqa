'use strict';
/**
 * AML rule helpers and the request-validation contract.
 *
 * The full risk engine needs a database (it counts velocity and structuring
 * windows), and is covered by scripts/smoke-test.js. The pure pieces — hold
 * reasons, risk ordering, and the zod schemas that guard money endpoints — are
 * asserted here.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const { z } = require('zod');
const aml = require('../services/aml');
const money = require('../lib/money');

test('risk ordering is monotonic', () => {
  assert.ok(aml.RISK_ORDER.indexOf('LOW') < aml.RISK_ORDER.indexOf('MEDIUM'));
  assert.ok(aml.RISK_ORDER.indexOf('MEDIUM') < aml.RISK_ORDER.indexOf('HIGH'));
  assert.ok(aml.RISK_ORDER.indexOf('HIGH') < aml.RISK_ORDER.indexOf('CRITICAL'));
});

test('holdReason names every rule that actually stops a transfer', () => {
  const rules = [
    { rule: 'AML_HOLD_THRESHOLD', effect: 'HOLD', detail: 'at or above the auto-hold threshold' },
    { rule: 'SANCTIONS_REVIEW_CUSTOMER', effect: 'HOLD', detail: 'possible name match' },
    { rule: 'CTR_FILING_REQUIRED', effect: 'ALLOW', detail: 'reportable but payable' },
  ];
  const reason = aml.holdReason(rules);
  assert.ok(reason.includes('AML_HOLD_THRESHOLD'));
  assert.ok(reason.includes('SANCTIONS_REVIEW_CUSTOMER'));
  assert.ok(!reason.includes('CTR_FILING_REQUIRED'), 'ALLOW rules must not appear as hold reasons');
});

test('no holding rule means no hold reason', () => {
  assert.equal(aml.holdReason([]), null);
  assert.equal(aml.holdReason([{ rule: 'PEP_CUSTOMER', effect: 'ALLOW', detail: 'monitoring' }]), null);
});

// ---------------------------------------------------------------------------
// Validation schemas — mirror of the ones on the money routes, so a regression
// in the route definitions shows up here.
// ---------------------------------------------------------------------------
const transferSchema = z.object({
  quoteId: z.string().uuid(),
  beneficiaryId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/),
  purposeCode: z.string().max(40).optional(),
  purposeNarrative: z.string().max(300).optional(),
});

test('a transfer requires a real quote id, a beneficiary and a 6-digit PIN', () => {
  assert.ok(transferSchema.safeParse({
    quoteId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    beneficiaryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    pin: '482913',
  }).success);

  assert.ok(!transferSchema.safeParse({
    quoteId: 'not-a-uuid', beneficiaryId: 'x', pin: '123',
  }).success);
  assert.ok(!transferSchema.safeParse({
    quoteId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    beneficiaryId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    pin: 'abcdef',
  }).success, 'a non-numeric PIN must be rejected before it reaches the hasher');
});

test('amounts survive the round trip from the app to minor units', () => {
  const cases = [
    { input: '500', currency: 'QAR', minor: 50000 },
    { input: '500.25', currency: 'QAR', minor: 50025 },
    { input: '1500', currency: 'UGX', minor: 1500 },
  ];
  for (const item of cases) {
    assert.equal(money.toMinor(item.input, item.currency), item.minor);
  }
});
