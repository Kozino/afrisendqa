'use strict';
/**
 * Role Based Access Control.
 *
 * The mobile console cannot choose its own role — the role is a claim inside the
 * JWT issued after password (+ TOTP) authentication, and every admin route is
 * guarded by the permission list below. The 4-eyes rule is on top of this:
 * holding `maker_checker:approve` is not enough, the checker must be a
 * different human being from the maker.
 */

const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  COMPLIANCE_MLRO: 'COMPLIANCE_MLRO',
  COMPLIANCE_ANALYST: 'COMPLIANCE_ANALYST',
  TREASURY_OFFICER: 'TREASURY_OFFICER',
  SUPPORT_AGENT: 'SUPPORT_AGENT',
  AUDITOR: 'AUDITOR',
};

const P = {
  OVERVIEW_READ: 'overview:read',
  TRANSFERS_READ: 'transfers:read',
  TRANSFERS_ACT: 'transfers:act',              // retry / cancel
  AML_REVIEW: 'aml:review',                    // open cases, add notes
  AML_RELEASE: 'aml:release',                  // release or block a held transfer (MLRO only)
  KYC_READ: 'kyc:read',
  KYC_REVIEW: 'kyc:review',
  CUSTOMERS_READ: 'customers:read',
  CUSTOMERS_WRITE: 'customers:write',          // suspend / reactivate
  LEDGER_READ: 'ledger:read',
  FX_READ: 'fx:read',
  LIQUIDITY_READ: 'liquidity:read',
  LIQUIDITY_OPERATE: 'liquidity:operate',      // re-dispatch payouts queued on a float shortfall
  MAKER_CREATE: 'maker_checker:create',
  MAKER_APPROVE: 'maker_checker:approve',
  AUDIT_READ: 'audit:read',
  REPORTS_GENERATE: 'reports:generate',
  SETTINGS_WRITE: 'settings:write',
};

const PERMISSIONS = {
  // Full platform control, still bound by the 4-eyes rule.
  SUPER_ADMIN: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.TRANSFERS_ACT, P.AML_REVIEW, P.AML_RELEASE,
    P.KYC_READ, P.KYC_REVIEW, P.CUSTOMERS_READ, P.CUSTOMERS_WRITE, P.LEDGER_READ,
    P.FX_READ, P.LIQUIDITY_READ, P.LIQUIDITY_OPERATE, P.MAKER_CREATE, P.MAKER_APPROVE,
    P.AUDIT_READ, P.REPORTS_GENERATE, P.SETTINGS_WRITE,
  ],
  // Money Laundering Reporting Officer: the only role that can release AML holds
  // and file with the QCB.
  COMPLIANCE_MLRO: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.AML_REVIEW, P.AML_RELEASE, P.KYC_READ,
    P.KYC_REVIEW, P.CUSTOMERS_READ, P.CUSTOMERS_WRITE, P.LEDGER_READ, P.AUDIT_READ,
    P.REPORTS_GENERATE, P.MAKER_CREATE, P.MAKER_APPROVE,
  ],
  // First-line analyst: investigates and escalates, cannot release funds.
  COMPLIANCE_ANALYST: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.AML_REVIEW, P.KYC_READ, P.KYC_REVIEW,
    P.CUSTOMERS_READ, P.LEDGER_READ, P.AUDIT_READ, P.MAKER_CREATE,
  ],
  // Treasury: rates and float, always via maker-checker (create, not approve).
  TREASURY_OFFICER: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.LEDGER_READ, P.FX_READ, P.LIQUIDITY_READ,
    P.LIQUIDITY_OPERATE, P.MAKER_CREATE,
  ],
  SUPPORT_AGENT: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.CUSTOMERS_READ, P.KYC_READ,
  ],
  AUDITOR: [
    P.OVERVIEW_READ, P.TRANSFERS_READ, P.KYC_READ, P.CUSTOMERS_READ,
    P.LEDGER_READ, P.AUDIT_READ, P.REPORTS_GENERATE, P.FX_READ, P.LIQUIDITY_READ,
  ],
};

/** Actions that ALWAYS require a maker-checker request, regardless of role. */
const MAKER_CHECKER_REQUIRED = new Set([
  'FX_RATE_CHANGE',
  'FLOAT_TOPUP',
  'FLOAT_RECONCILIATION',
  'CUSTOMER_LIMIT_UPGRADE',
  'CUSTOMER_STATUS_CHANGE',
  'AML_HOLD_RELEASE',
  'SANCTIONS_MATCH_CLEAR',
  'PROVIDER_RAIL_CHANGE',
]);

function can(role, permission) {
  return Array.isArray(PERMISSIONS[role]) && PERMISSIONS[role].includes(permission);
}

function permissionsFor(role) {
  return PERMISSIONS[role] || [];
}

module.exports = { ROLES, P, PERMISSIONS, can, permissionsFor, MAKER_CHECKER_REQUIRED };
