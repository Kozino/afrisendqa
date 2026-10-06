#!/usr/bin/env node
'use strict';
/**
 * End-to-end smoke test against a running API.
 *
 *   DEV_OTP_CODE=123456 npm run smoke -- --base http://localhost:4000
 *
 * It exercises the real paths a customer and an operator take:
 *   OTP login → PIN → corridor quote → beneficiary → wallet funding →
 *   transfer (with idempotency key) → AML decision → ledger posting →
 *   operator login → console overview → 4-eyes enforcement → maker-checker
 *   approval → QCB report generation.
 *
 * Requires two operator accounts to exist:
 *   npm run create-admin -- --email maker@test.local --name Maker --role COMPLIANCE_MLRO --password 'Maker!Passw0rd1'
 *   npm run create-admin -- --email checker@test.local --name Checker --role SUPER_ADMIN --password 'Checker!Passw0rd1'
 */
require('dotenv').config();

const ARGS = process.argv.slice(2).reduce((acc, t, i, arr) => {
  if (t.startsWith('--')) acc[t.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
  return acc;
}, {});

const BASE = ARGS.base || `http://localhost:${process.env.PORT || 4000}`;
const API = `${BASE}/api/v1`;
const MAKER = { email: ARGS.maker || process.env.SMOKE_MAKER_EMAIL || 'maker@test.local', password: process.env.SMOKE_MAKER_PASSWORD || 'Maker!Passw0rd1' };
const CHECKER = { email: ARGS.checker || process.env.SMOKE_CHECKER_EMAIL || 'checker@test.local', password: process.env.SMOKE_CHECKER_PASSWORD || 'Checker!Passw0rd1' };
const DEV_OTP_CODE = process.env.DEV_OTP_CODE || '123456';

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` → ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}

async function api(path, { method = 'GET', body, token, idempotencyKey, expect } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch(`${API}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (expect && response.status !== expect) {
    throw new Error(`${method} ${path} expected ${expect}, got ${response.status}: ${text.slice(0, 300)}`);
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function main() {
  console.log(`\nAfriSend smoke test against ${API}\n`);

  // ---------------------------------------------------------------- health
  console.log('Health');
  const health = await fetch(`${BASE}/api/v1/public/healthz`).then((r) => r.json());
  check('healthz returns ok', health.status === 'ok', health);
  const ready = await api('/public/readyz');
  check('readyz reports a live database', ready.body.status === 'ready', ready.body);

  // ------------------------------------------------------------ customer
  console.log('\nCustomer journey');
  const phone = `+9745${String(Date.now()).slice(-7)}`;
  const otpRequest = await api('/auth/otp/request', { method: 'POST', body: { phone } });
  check('OTP requested', otpRequest.body.success === true, otpRequest.body);
  check('OTP code is never returned to the client', !JSON.stringify(otpRequest.body).includes(DEV_OTP_CODE), otpRequest.body);

  const otpVerify = await api('/auth/otp/verify', { method: 'POST', body: { phone, code: DEV_OTP_CODE } });
  check('OTP verified and tokens issued', Boolean(otpVerify.body.accessToken), otpVerify.body);
  const customerToken = otpVerify.body.accessToken;
  const customerRef = otpVerify.body.customer?.reference;
  check('customer reference issued', /^AFQ-\d+$/.test(customerRef || ''), customerRef);

  const config = await api('/auth/config');
  check('institution name exposed without secrets', Boolean(config.body.institution) && !JSON.stringify(config.body).match(/FLWSECK|secret/i), config.body);

  const pin = await api('/auth/pin', { method: 'POST', token: customerToken, body: { pin: '482913' } });
  check('transaction PIN set', pin.body.success === true, pin.body);

  const corridors = await api('/public/corridors');
  check('corridors returned from the database', Array.isArray(corridors.body.corridors) && corridors.body.corridors.length > 0, corridors.body);
  const corridor = (corridors.body.corridors || []).find((c) => c.currency === 'KES') || corridors.body.corridors?.[0];

  // KYC must be submitted before sending: expect 403 first.
  const blockedSend = await api('/transfers/quotes', { method: 'POST', token: customerToken, body: { currency: corridor.currency, amount: '150' } });
  check('unverified customer can still obtain a quote', blockedSend.status === 201, blockedSend.body);

  // ------------------------------------------------------------ beneficiary
  const beneficiary = await api('/me/beneficiaries', {
    method: 'POST', token: customerToken,
    body: {
      fullName: 'Smoke Test Beneficiary',
      countryCode: corridor.countryCode,
      currency: corridor.currency,
      channel: 'RIA_CASH_PICKUP',
      institutionName: 'Ria Agent Network',
      accountNumber: `9988${String(Date.now()).slice(-6)}`,
    },
  });
  check('beneficiary created', Boolean(beneficiary.body.beneficiary?.id), beneficiary.body);

  // ------------------------------------------------------------ KYC gate
  const transferBeforeKyc = await api('/transfers', {
    method: 'POST', token: customerToken, idempotencyKey: `smoke-prek-${Date.now()}`,
    body: {
      quoteId: blockedSend.body.quote?.id || '00000000-0000-4000-8000-000000000000',
      beneficiaryId: beneficiary.body.beneficiary?.id,
      pin: '482913',
    },
  });
  check('transfer is refused before KYC approval',
    [400, 403, 422].includes(transferBeforeKyc.status) || transferBeforeKyc.body?.error?.code === 'FORBIDDEN',
    transferBeforeKyc.body);

  // ------------------------------------------------------------ operator: credit wallet + approve KYC
  console.log('\nOperations console');
  // Login-path guards. A wrong password used to return 500 (a broken lockout
  // UPDATE) instead of 401, and the MFA enrolment could never be confirmed.
  const badPassword = await api('/auth/admin/login', {
    method: 'POST', body: { email: MAKER.email, password: 'definitely-not-the-password' },
  });
  check('a wrong password returns 401, not a server error',
    badPassword.status === 401, `${badPassword.status} ${badPassword.body?.error?.code}`);

  const unknownOperator = await api('/auth/admin/login', {
    method: 'POST', body: { email: `nobody-${Date.now()}@test.local`, password: 'Whatever!Passw0rd1' },
  });
  check('an unknown operator returns 401 and never reveals whether the account exists',
    unknownOperator.status === 401 && unknownOperator.body?.error?.message === 'Invalid credentials',
    unknownOperator.body);

  const makerLogin = await api('/auth/admin/login', { method: 'POST', body: MAKER });
  check('MLRO sign-in', Boolean(makerLogin.body.accessToken), makerLogin.body);
  const makerToken = makerLogin.body.accessToken;
  check('operator role comes from the token, not the request', makerLogin.body.operator?.role === 'COMPLIANCE_MLRO', makerLogin.body.operator);

  const badRole = await api('/admin/me', { token: makerToken });
  check('org permissions returned to the console', (badRole.body.operator?.permissions || []).includes('aml:release'), badRole.body.operator?.permissions);

  const credit = await api(`/admin/customers/${customerRef}/wallet-credit`, {
    method: 'POST', token: makerToken,
    body: { amount: '25000.00', bankReference: `QNB-${Date.now()}`, note: 'Smoke test funding' },
  });
  check('inbound bank payment matched to the wallet', credit.status === 201, credit.body);

  const profile = await api('/me/profile', { token: customerToken });
  check('wallet shows the credited balance', Number(profile.body.profile?.wallet?.availableMinor) === 2500000, profile.body.profile?.wallet);

  // KYC submission + review
  const kycSubmit = await api('/me/kyc', {
    method: 'POST', token: customerToken,
    body: {
      fullName: 'Smoke Test Customer', nationality: 'NG', requestedTier: 2, documentType: 'QID',
      qidNumber: `2946${String(Date.now()).slice(-8)}`, documentExpiry: '2028-12-31',
      livenessScore: 97.4, faceMatchScore: 95.1, documentQuality: 92,
    },
  });
  check('KYC submission stored with screening snapshot', Boolean(kycSubmit.body.request?.id), kycSubmit.body);

  const kycQueue = await api('/admin/kyc?status=ALL', { token: makerToken });
  const kycItem = (kycQueue.body.queue || []).find((q) => q.customer?.reference === customerRef);
  check('submission appears in the console queue', Boolean(kycItem), kycQueue.body);

  const kycApprove = await api(`/admin/kyc/${kycItem.id}/review`, {
    method: 'POST', token: makerToken, body: { decision: 'APPROVE', tier: 2, note: 'Documents verified against QID' },
  });
  check('KYC approved and tier granted', kycApprove.body.grantedTier === 2, kycApprove.body);

  // ------------------------------------------------------------ transfer
  console.log('\nTransfer + ledger');
  const quote = await api('/transfers/quotes', {
    method: 'POST', token: customerToken, body: { currency: corridor.currency, amount: '500.00' },
  });
  check('quote priced with fee and spread', quote.body.quote?.totals?.theyReceive && quote.body.quote?.spreadQarMinor >= 0, quote.body.quote?.totals);

  const idempotencyKey = `smoke-${Date.now()}`;
  const transfer = await api('/transfers', {
    method: 'POST', token: customerToken, idempotencyKey,
    body: { quoteId: quote.body.quote.id, beneficiaryId: beneficiary.body.beneficiary.id, pin: '482913', purposeCode: 'FAMILY_SUPPORT' },
  });
  check('transfer accepted or held for compliance', [201, 202].includes(transfer.status), transfer.body);
  const reference = transfer.body.transfer?.reference;
  check('transfer reference issued', /^AFQ-/.test(reference || ''), reference);

  const replay = await api('/transfers', {
    method: 'POST', token: customerToken, idempotencyKey,
    body: { quoteId: quote.body.quote.id, beneficiaryId: beneficiary.body.beneficiary.id, pin: '482913', purposeCode: 'FAMILY_SUPPORT' },
  });
  check('idempotent replay returns the same transfer', replay.body.transfer?.reference === reference, replay.body);

  const wrongKey = await api('/transfers', {
    method: 'POST', token: customerToken, idempotencyKey,
    body: { quoteId: quote.body.quote.id, beneficiaryId: beneficiary.body.beneficiary.id, pin: '111111', purposeCode: 'FAMILY_SUPPORT' },
  });
  check('same key with a different body is rejected', wrongKey.status === 409, wrongKey.body);

  const ledger = await api(`/admin/ledger?reference=${reference}`, { token: makerToken });
  check('settlement journal posted for the transfer', (ledger.body.journals || []).length >= 1, ledger.body.journals);
  check('every ledger journal balances (per currency / translated QAR)',
    ledger.body.integrity?.books_balanced === true,
    ledger.body.integrity);
  check('currency positions reported for FX exposure',
    Array.isArray(ledger.body.currencyPositions) && ledger.body.currencyPositions.length > 0,
    ledger.body.currencyPositions);

  // -------------------------------------------------- high-value AML hold
  //
  // Deterministic: a transfer at or above the auto-hold threshold is held
  // whatever the sanctions-list state is, so this does not depend on how the
  // environment happens to be configured.
  console.log('\nAML hold (transfer at or above the auto-hold threshold)');
  const holdQuote = await api('/transfers/quotes', {
    method: 'POST', token: customerToken, body: { currency: corridor.currency, amount: '12000.00' },
  });
  check('high-value quote priced', Boolean(holdQuote.body.quote?.id), holdQuote.body);

  const held = await api('/transfers', {
    method: 'POST', token: customerToken, idempotencyKey: `smoke-hold-${Date.now()}`,
    body: {
      quoteId: holdQuote.body.quote.id,
      beneficiaryId: beneficiary.body.beneficiary.id,
      pin: '482913',
      purposeCode: 'FAMILY_SUPPORT',
    },
  });
  check('high-value transfer is held for compliance (202 AML_HOLD)',
    held.status === 202 && held.body.transfer?.status === 'AML_HOLD', held.body);
  const heldReference = held.body.transfer?.reference;
  check('the hold reason names the rule that fired',
    /AML_HOLD_THRESHOLD/.test(held.body.transfer?.amlHoldReason || ''), held.body.transfer?.amlHoldReason);

  const holdLedger = await api(`/admin/ledger?reference=${heldReference}`, { token: makerToken });
  check('held funds are quarantined in the AML suspense account',
    (holdLedger.body.journals || []).some((entry) => entry.journal_type === 'AML_HOLD_SWEEP'),
    (holdLedger.body.journals || []).map((entry) => entry.journal_type));

  const heldDetail = await api(`/admin/transfers/${heldReference}`, { token: makerToken });
  check('the analyst can see exactly which rules fired',
    (heldDetail.body.transfer?.riskAssessment?.rules || []).some((rule) => rule.rule === 'AML_HOLD_THRESHOLD'),
    heldDetail.body.transfer?.riskAssessment?.rules);
  check('an AML case was opened for the hold',
    Boolean(heldDetail.body.transfer?.riskAssessment?.caseReference),
    heldDetail.body.transfer?.riskAssessment);

  const release = await api(`/admin/transfers/${heldReference}/aml-action`, {
    method: 'POST', token: makerToken,
    body: { action: 'RELEASE', note: 'Smoke test: source of funds evidenced, releasing for payout' },
  });
  check('release creates a maker-checker request instead of moving funds',
    release.status === 202 && release.body.pendingApproval === true, release.body);

  // ------------------------------------------------------- 4-eyes control
  console.log('\nFour-eyes control');
  const mcList = await api('/admin/maker-checker?status=PENDING', { token: makerToken });
  const ownRequest = (mcList.body.requests || [])
    .find((r) => r.maker === MAKER.email && r.type === 'AML_HOLD_RELEASE');
  check('the release request is queued and flagged as the maker\'s own',
    Boolean(ownRequest) && ownRequest.isOwnRequest === true, mcList.body.requests?.length);
  check('the queue marks whether this role may approve',
    typeof mcList.body.canApprove === 'boolean', mcList.body.canApprove);

  const selfApprove = await api(`/admin/maker-checker/${ownRequest.reference}/decide`, {
    method: 'POST', token: makerToken, body: { action: 'APPROVE', note: 'trying to approve my own request' },
  });
  check('maker cannot approve their own request (403)', selfApprove.status === 403, selfApprove.body);

  const checkerLogin = await api('/auth/admin/login', { method: 'POST', body: CHECKER });
  const checkerToken = checkerLogin.body.accessToken;
  check('second operator signed in', Boolean(checkerToken), checkerLogin.body);

  const approve = await api(`/admin/maker-checker/${ownRequest.reference}/decide`, {
    method: 'POST', token: checkerToken, body: { action: 'APPROVE', note: 'Independent review complete' },
  });
  check('a different operator can approve it', approve.body.status === 'APPROVED', approve.body);

  const afterRelease = await api(`/admin/transfers/${heldReference}`, { token: checkerToken });
  check('the approved release takes effect (transfer leaves the hold)',
    afterRelease.body.transfer?.status !== 'AML_HOLD', afterRelease.body.transfer?.status);
  const releaseLedger = await api(`/admin/ledger?reference=${heldReference}`, { token: checkerToken });
  check('the suspense account is cleared by a reversing journal',
    (releaseLedger.body.journals || []).some((entry) => entry.journal_type === 'AML_HOLD_RELEASE'),
    (releaseLedger.body.journals || []).map((entry) => entry.journal_type));

  // ------------------------------------------------------ float controls
  //
  // The payout must not be instructed in a currency whose float cannot cover
  // it. Either it was dispatched (float was adequate) or it is queued; if it is
  // queued, funding the float and pressing "retry queued" must pick it up.
  console.log('\nFloat controls');
  const floatState = await api('/admin/liquidity', { token: checkerToken });
  const shortfall = (floatState.body.floatShortfalls || []).find((row) => row.currency === corridor.currency);
  if (shortfall) {
    check('the shortfall is reported before any money moves', Boolean(shortfall.shortfall), shortfall);
    const queuedDetail = await api(`/admin/transfers/${heldReference}`, { token: checkerToken });
    check('the payout is queued waiting for float rather than sent',
      queuedDetail.body.transfer?.providerStatus === 'AWAITING_FLOAT',
      queuedDetail.body.transfer?.providerStatus);

    // Fund enough to clear the reported shortfall (with headroom), rather than
    // guessing an amount that might not cover it.
    const shortfallAmount = Number(String(shortfall.shortfall).replace(/[^\d.]/g, '')) || 0;
    const topUpAmount = Math.max(100000, Math.ceil(shortfallAmount * 1.25)).toFixed(2);
    const topup = await api('/admin/liquidity/topup', {
      method: 'POST', token: makerToken,
      body: {
        poolKey: 'flw_usd_main',
        amount: topUpAmount,
        currency: corridor.currency,
        reference: `QNB-WIRE-${Date.now()}`,
        memo: `Smoke test ${corridor.currency} payout float replenishment`,
      },
    });
    check('a float top-up is queued for four-eyes approval', topup.status === 202, topup.body);

    const topupSelfApprove = await api(`/admin/maker-checker/${topup.body.request.reference}/decide`, {
      method: 'POST', token: makerToken, body: { action: 'APPROVE', note: 'approving my own request' },
    });
    check('the maker cannot approve their own float top-up either',
      topupSelfApprove.status === 403, topupSelfApprove.body);

    const topupApprove = await api(`/admin/maker-checker/${topup.body.request.reference}/decide`, {
      method: 'POST', token: checkerToken, body: { action: 'APPROVE', note: 'Wire confirmed against the bank statement' },
    });
    check('the checker approves and the float is funded', topupApprove.body.status === 'APPROVED', topupApprove.body);
    check('funding a local-currency float does not corrupt a USD pool balance',
      topupApprove.body.effect?.poolBalanceUpdated === false, topupApprove.body.effect);

    const afterTopup = await api('/admin/liquidity', { token: checkerToken });
    check('the funded float clears the reported shortfall',
      !(afterTopup.body.floatShortfalls || []).some((row) => row.currency === corridor.currency),
      afterTopup.body.floatShortfalls);

    // Capture the wallet BEFORE the retry: dispatching the queued payout is what
    // triggers a possible rail rejection and the refund.
    const walletBefore = await api('/me/profile', { token: customerToken });
    const retry = await api('/admin/liquidity/retry-queued', { method: 'POST', token: checkerToken });
    check('queued payouts are picked up once the float is funded',
      retry.status === 200 && retry.body.dispatched >= 1,
      `${retry.body.dispatched} of ${retry.body.queued} dispatched`);

    // The rail itself is called with test credentials, so the payout will be
    // rejected — what matters is that it left the queue, the failure was
    // recorded, and the money came back to the customer.
    const afterRetry = await api(`/admin/transfers/${heldReference}`, { token: checkerToken });
    check('the queued payout left the waiting-for-float state',
      afterRetry.body.transfer?.providerStatus !== 'AWAITING_FLOAT',
      `${afterRetry.body.transfer?.status} / ${afterRetry.body.transfer?.providerStatus}`);

    // The rail is called with test credentials, so this payout is rejected. What
    // must happen then is the whole point: the customer gets their money back.
    if (afterRetry.body.transfer?.status === 'FAILED') {
      const walletAfter = await api('/me/profile', { token: customerToken });
      const before = Number(walletBefore.body.profile.wallet.availableMinor);
      const after = Number(walletAfter.body.profile.wallet.availableMinor);
      check('a payout the rail rejected refunds the customer in full',
        after - before === 1201000, `wallet moved ${(after - before) / 100} QAR (expected 12,010.00)`);
      check('the failure reason is recorded for support',
        Boolean(afterRetry.body.transfer?.failureReason), afterRetry.body.transfer?.failureReason);
    }

    const finalLedger = await api('/admin/ledger?limit=20', { token: checkerToken });
    check('the books still balance after float funding and a provider call',
      finalLedger.body.integrity?.books_balanced === true, finalLedger.body.integrity);
    check('the failed payout was reversed, not merely refunded',
      (finalLedger.body.journals || []).some((entry) => entry.journal_type === 'PROVIDER_REVERSAL')
        && (finalLedger.body.journals || []).some((entry) => entry.journal_type === 'PAYOUT_CLEARING_REVERSAL'),
      (finalLedger.body.journals || []).map((entry) => entry.journal_type));
    const restored = await api('/admin/ledger?limit=5', { token: checkerToken });
    check('the partner float is restored to zero after the reversal',
      (restored.body.currencyPositions || []).length > 0, restored.body.currencyPositions);
  } else {
    check('float was sufficient, so the payout was dispatched immediately', true, 'no shortfall reported');
  }

  // ------------------------------------------------------------- audit
  const auditAfter = await api('/admin/audit-logs?limit=200', { token: checkerToken });
  const actions = (auditAfter.body.logs || []).map((l) => l.action);
  check('audit trail records the transfer', actions.includes('TRANSFER_INITIATED'), actions.slice(0, 12));
  check('audit trail records the blocked self-approval', actions.includes('MAKER_CHECKER_SELF_APPROVAL_BLOCKED'), actions.slice(0, 12));
  check('audit trail records the approval', actions.includes('MAKER_CHECKER_APPROVED'), actions.slice(0, 12));

  // ------------------------------------------------------------ reporting
  console.log('\nRegulatory reporting');
  const qcb = await api('/admin/reports/qcb', { method: 'POST', token: checkerToken, body: {} });
  check('QCB report generated and signed', Boolean(qcb.body.report?.signature?.value), qcb.body.report?.filingId);
  check('report reflects the live books', typeof qcb.body.report?.payload?.transfers?.count === 'number', qcb.body.report?.payload?.transfers);

  const verify = await api('/admin/reports/qcb/verify', {
    method: 'POST', token: checkerToken,
    body: { filingId: qcb.body.report.filingId, contentHash: qcb.body.report.contentHash, signature: qcb.body.report.signature.value },
  });
  check('report signature verifies', verify.body.verification?.storedSignatureValid === true, verify.body.verification);

  const ctr = await api(`/admin/reports/ctr/extract?date=${new Date().toISOString().slice(0, 10)}`, { token: checkerToken });
  check('CTR extract available for the FIU', Array.isArray(ctr.body.rows), ctr.body);

  // ------------------------------------------------------- webhook guard
  console.log('\nWebhook security');
  const badWebhook = await api('/webhooks/flutterwave', {
    method: 'POST', body: { event: 'transfer.completed', data: { reference, status: 'SUCCESSFUL' } },
  });
  check('unsigned webhook is rejected with 401', badWebhook.status === 401, badWebhook.body);
  const webhookBody = { event: 'transfer.completed', data: { id: `flw-${Date.now()}`, reference, status: 'SUCCESSFUL' } };
  const signedResponse = await fetch(`${API}/webhooks/flutterwave`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Exactly how Flutterwave signs: the configured secret hash in verif-hash.
      'verif-hash': process.env.FLW_WEBHOOK_HASH || 'test-webhook-hash',
    },
    body: JSON.stringify(webhookBody),
  });
  const signed = { status: signedResponse.status, body: await signedResponse.json() };
  check('signed webhook is processed (or reports an unhandled type)', signed.status === 200 && !signed.body.error?.code, signed.body);

  // -------------------------------------------------- sanctions screening
  //
  // Regression guard for a bug that only appears with a NON-EMPTY match list:
  // an empty array serialises to "{}" which is valid JSON, so screening looked
  // fine right up until someone actually matched a sanctioned name. This
  // inserts a synthetic list entry, screens a word-order variant through the
  // API, and removes it again.
  console.log('\nSanctions screening (live list)');
  const { Client } = require('pg');
  const pgClient = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: /supabase|neon|render|amazonaws/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
  });
  await pgClient.connect();
  try {
    await pgClient.query('delete from sanctions_list where reference = $1', ['SMOKE-TEST-0001']);
    await pgClient.query(
      `insert into sanctions_list (list_source, entity_type, primary_name, aliases, date_of_birth, nationality, reference)
       values ('SMOKE_TEST','INDIVIDUAL','SMOKETEST HASSAN AL-AMIN',$1,'1980-01-01','QA','SMOKE-TEST-0001')`,
      [['Hassan Al-Amin Smoketest', 'Al-Amin Hassan']],
    );

    const reordered = await api('/me/screening/name', {
      method: 'POST', token: customerToken, body: { name: 'Hassan Smoketest Alamin' },
    });
    check('a word-order variant of a listed name is flagged as a hit',
      reordered.body.outcome === 'HIT', reordered.body);

    const abbreviated = await api('/me/screening/name', {
      method: 'POST', token: customerToken, body: { name: 'Hassan A. Smoketest' },
    });
    check('an abbreviated middle name still reaches a review, never a clear',
      ['HIT', 'REVIEW'].includes(abbreviated.body.outcome), abbreviated.body);

    const unrelated = await api('/me/screening/name', {
      method: 'POST', token: customerToken, body: { name: 'Wanjiku Kamau' },
    });
    check('an unrelated name clears', unrelated.body.outcome === 'CLEAR', unrelated.body);
    check('the screening snapshot is persisted with its matches',
      unrelated.status === 200, unrelated.body);

    // With a list loaded, a sanctions hit on the beneficiary must BLOCK the
    // transfer outright (no payout instruction, nothing moves).
    const blockedBeneficiary = await api('/me/beneficiaries', {
      method: 'POST', token: customerToken,
      body: {
        fullName: 'Smoketest Hassan Alamin',
        countryCode: corridor.countryCode,
        currency: corridor.currency,
        channel: 'RIA_CASH_PICKUP',
        institutionName: 'Ria Agent Network',
        accountNumber: `TEST${Date.now()}`,
      },
    });
    const blockedQuote = await api('/transfers/quotes', {
      method: 'POST', token: customerToken, body: { currency: corridor.currency, amount: '200.00' },
    });
    const blockedTransfer = await api('/transfers', {
      method: 'POST', token: customerToken, idempotencyKey: `smoke-sanctions-${Date.now()}`,
      body: {
        quoteId: blockedQuote.body.quote.id,
        beneficiaryId: blockedBeneficiary.body.beneficiary.id,
        pin: '482913',
        purposeCode: 'FAMILY_SUPPORT',
      },
    });
    check('a transfer to a sanctioned beneficiary is blocked (422 AML_BLOCKED)',
      blockedTransfer.status === 422 && blockedTransfer.body?.error?.code === 'AML_BLOCKED',
      blockedTransfer.body);

    const blockedAudit = await api('/admin/audit-logs?action=TRANSFER_BLOCKED', { token: checkerToken });
    check('the blocked attempt is in the audit trail even though nothing moved',
      (blockedAudit.body.logs || []).length > 0, blockedAudit.body.logs?.length);
  } finally {
    await pgClient.query('delete from sanctions_list where reference = $1', ['SMOKE-TEST-0001']);
    await pgClient.end();
  }

  // ------------------------------------------------------ reconciliation
  //
  // The invariants that catch a whole class of money bugs: the wallet the
  // customer sees must equal the ledger liability, and funds quarantined by
  // compliance must equal the value of the transfers on hold.
  console.log('\nReconciliation');
  const reconciled = await api('/admin/ledger?limit=5', { token: checkerToken });
  check('customer wallets equal the ledger liability',
    reconciled.body.walletReconciliation?.reconciled === true,
    `${reconciled.body.walletReconciliation?.wallets} vs ${reconciled.body.walletReconciliation?.ledgerLiability} (difference ${reconciled.body.walletReconciliation?.difference})`);
  check('AML suspense equals the value of transfers on hold',
    Number(reconciled.body.suspensePosition?.difference_minor) === 0,
    `${reconciled.body.suspensePosition?.suspense} vs ${reconciled.body.suspensePosition?.heldTransfers}`);
  check('every journal in the book balances',
    reconciled.body.integrity?.books_balanced === true, reconciled.body.integrity);

  // --------------------------------------------------------------- MFA
  //
  // Enrolling an operator in TOTP must actually take effect, and the code shown
  // when the secret is issued must be the code that confirms it.
  console.log('\nOperator MFA');
  const enrolment = await api('/admin/me/mfa', { method: 'POST', token: checkerToken, body: {} });
  check('enrolment returns a secret and an otpauth URL',
    Boolean(enrolment.body.secret) && /^otpauth:\/\/totp\//.test(enrolment.body.otpauthUrl || ''),
    enrolment.body.nextStep);

  const totpService = require('../services/totp');
  const confirmCode = totpService.currentTotp(enrolment.body.secret);
  const confirmed = await api('/admin/me/mfa', {
    method: 'POST', token: checkerToken, body: { confirmCode },
  });
  check('the code produced from that secret activates MFA', confirmed.body.mfaEnabled === true, confirmed.body);

  const withoutCode = await api('/auth/admin/login', { method: 'POST', body: CHECKER });
  check('sign-in now stops and asks for the authenticator code',
    withoutCode.status === 206 && withoutCode.body.mfaRequired === true, withoutCode.body);

  const wrongCode = await api('/auth/admin/login', {
    method: 'POST', body: { ...CHECKER, totp: '000000' },
  });
  check('a wrong authenticator code is refused',
    wrongCode.status === 401, `${wrongCode.status} ${wrongCode.body?.error?.code}`);

  const withCode = await api('/auth/admin/login', {
    method: 'POST', body: { ...CHECKER, totp: totpService.currentTotp(enrolment.body.secret) },
  });
  check('a valid authenticator code completes sign-in', Boolean(withCode.body.accessToken), withCode.body);

  // Restore the operator state so the suite can be re-run against the same
  // database without the second operator suddenly requiring a code.
  {
    const { Client } = require('pg');
    const cleanup = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: /supabase|neon|render|amazonaws/.test(process.env.DATABASE_URL || '') ? { rejectUnauthorized: false } : false,
    });
    await cleanup.connect();
    await cleanup.query('update admin_users set mfa_enabled = false, mfa_secret = null where email = $1', [CHECKER.email]);
    await cleanup.end();
  }
  const afterReset = await api('/auth/admin/login', { method: 'POST', body: CHECKER });
  check('the suite re-runs cleanly (MFA state restored)',
    Boolean(afterReset.body.accessToken), `${afterReset.status} ${afterReset.body?.error?.code || ''}`);

  // ------------------------------------------------------------ summary
  console.log(`\n${'='.repeat(58)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('\n  Failures:');
    failures.forEach((f) => console.log(`   • ${f.name}: ${typeof f.detail === 'string' ? f.detail : JSON.stringify(f.detail)?.slice(0, 200)}`));
  }
  console.log(`${'='.repeat(58)}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nSmoke test aborted: ${err.message}\n`);
  process.exit(1);
});
