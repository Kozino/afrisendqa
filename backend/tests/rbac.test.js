'use strict';
/**
 * Role Based Access Control matrix.
 *
 * These assertions encode the separation-of-duties rules the compliance design
 * depends on. If someone later widens a role by accident, this fails.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROLES, P, PERMISSIONS, can, permissionsFor, MAKER_CHECKER_REQUIRED,
} = require('../config/permissions');
const makerChecker = require('../services/makerChecker');

test('every role is defined and can see the overview', () => {
  for (const role of Object.values(ROLES)) {
    assert.ok(Array.isArray(PERMISSIONS[role]), `${role} has no permission list`);
    assert.ok(can(role, P.OVERVIEW_READ), `${role} must be able to read the overview`);
  }
});

test('only the MLRO and super admin may release AML holds', () => {
  assert.ok(can('COMPLIANCE_MLRO', P.AML_RELEASE));
  assert.ok(can('SUPER_ADMIN', P.AML_RELEASE));
  assert.ok(!can('COMPLIANCE_ANALYST', P.AML_RELEASE), 'analysts escalate, they do not release funds');
  assert.ok(!can('TREASURY_OFFICER', P.AML_RELEASE));
  assert.ok(!can('SUPPORT_AGENT', P.AML_RELEASE));
  assert.ok(!can('AUDITOR', P.AML_RELEASE));
});

test('treasury officers propose but never approve', () => {
  assert.ok(can('TREASURY_OFFICER', P.MAKER_CREATE));
  assert.ok(!can('TREASURY_OFFICER', P.MAKER_APPROVE), 'treasury must not approve its own float moves');
  assert.ok(!can('TREASURY_OFFICER', P.CUSTOMERS_WRITE));
  assert.ok(!can('TREASURY_OFFICER', P.KYC_REVIEW));
});

test('support agents are read-only on money', () => {
  assert.ok(can('SUPPORT_AGENT', P.TRANSFERS_READ));
  assert.ok(!can('SUPPORT_AGENT', P.TRANSFERS_ACT));
  assert.ok(!can('SUPPORT_AGENT', P.AML_REVIEW));
  assert.ok(!can('SUPPORT_AGENT', P.MAKER_CREATE));
  assert.ok(!can('SUPPORT_AGENT', P.MAKER_APPROVE));
});

test('auditors can read everything and change nothing', () => {
  assert.ok(can('AUDITOR', P.AUDIT_READ));
  assert.ok(can('AUDITOR', P.LEDGER_READ));
  assert.ok(can('AUDITOR', P.REPORTS_GENERATE));
  assert.ok(!can('AUDITOR', P.MAKER_CREATE));
  assert.ok(!can('AUDITOR', P.MAKER_APPROVE));
  assert.ok(!can('AUDITOR', P.CUSTOMERS_WRITE));
  assert.ok(!can('AUDITOR', P.KYC_REVIEW));
});

test('unknown roles get nothing', () => {
  assert.equal(permissionsFor('HACKER').length, 0);
  assert.ok(!can('HACKER', P.OVERVIEW_READ));
  assert.ok(!can(undefined, P.OVERVIEW_READ));
  assert.ok(!can(null, P.AML_RELEASE));
});

test('every four-eyes action has a handler, and handlers are not orphaned', () => {
  for (const type of MAKER_CHECKER_REQUIRED) {
    assert.ok(makerChecker.HANDLERS[type], `${type} is required to be four-eyes but has no handler`);
  }
  for (const type of Object.keys(makerChecker.HANDLERS)) {
    assert.ok(MAKER_CHECKER_REQUIRED.has(type), `${type} has a handler but is not in the four-eyes list`);
  }
});

test('roles cannot escalate: no role holds a permission outside the catalogue', () => {
  const catalogue = new Set(Object.values(P));
  for (const [role, permissions] of Object.entries(PERMISSIONS)) {
    for (const permission of permissions) {
      assert.ok(catalogue.has(permission), `${role} references unknown permission ${permission}`);
    }
  }
});
