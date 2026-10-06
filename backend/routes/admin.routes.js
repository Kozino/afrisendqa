'use strict';
/**
 * Operations console API.
 *
 * Every route is behind an operator JWT and a permission check; sensitive
 * mutations additionally require a second operator (maker-checker). Nothing here
 * accepts a client-supplied role.
 */
const express = require('express');
const { z } = require('zod');
const jwt = require('jsonwebtoken');
const db = require('../db/pool');
const { env } = require('../config/env');
const {
  P, can, permissionsFor, PERMISSIONS, ROLES, MAKER_CHECKER_REQUIRED,
} = require('../config/permissions');
const { requireOperator, requirePermission } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../middleware/validate');
const { badRequest, forbidden, notFound } = require('../lib/errors');
const money = require('../lib/money');

const transfers = require('../services/transfers');
const ledger = require('../services/ledger');
const kyc = require('../services/kyc');
const fx = require('../services/fx');
const aml = require('../services/aml');
const screening = require('../services/screening');
const makerChecker = require('../services/makerChecker');
const reports = require('../services/reports');
const audit = require('../services/audit');
const sse = require('../services/sse');
const auth = require('../services/auth');
const totp = require('../services/totp');
const { encryptPII, decryptPII } = require('../lib/crypto');

const router = express.Router();

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------
router.get('/me', requireOperator, async (req, res) => {
  const { rows } = await db.query(
    'select id, email, full_name, role, mfa_enabled, last_login_at from admin_users where id = $1',
    [req.operator.id],
  );
  if (!rows[0]) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Operator no longer exists' } });
  return res.json({
    success: true,
    operator: {
      id: rows[0].id, email: rows[0].email, name: rows[0].full_name, role: rows[0].role,
      mfaEnabled: rows[0].mfa_enabled, lastLoginAt: rows[0].last_login_at,
      permissions: permissionsFor(rows[0].role),
    },
  });
});

/**
 * Operator MFA (TOTP).
 *
 * Two-step, and the pending secret is PERSISTED between the steps: the first
 * call returns a secret (and stores it encrypted with mfa_enabled still false),
 * the second call confirms the 6-digit code against *that* secret. Generating a
 * fresh secret on each call made confirmation impossible — the code the operator
 * had just scanned could never match.
 *
 *   POST /admin/me/mfa {}                      → { secret, otpauthUrl }
 *   POST /admin/me/mfa { confirmCode: "123456" } → { mfaEnabled: true }
 *
 * Until the code is confirmed, MFA stays off, so a half-finished enrolment can
 * never lock an operator out of the console.
 */
router.post('/me/mfa', requireOperator, async (req, res, next) => {
  try {
    const { rows } = await db.query(
      'select mfa_secret, mfa_enabled from admin_users where id = $1::uuid', [req.operator.id],
    );
    const current = rows[0];
    if (!current) throw notFound('Operator not found');

    if (req.body?.confirmCode) {
      if (!current.mfa_secret) {
        throw badRequest('Start enrolment first: POST this endpoint without confirmCode to get a secret.');
      }
      const pendingSecret = decryptPII(current.mfa_secret);
      if (!totp.verifyTotp(pendingSecret, req.body.confirmCode)) {
        await audit.fromRequest(req, {
          action: 'OPERATOR_MFA_CONFIRM_FAILED', entityType: 'admin_user',
          entityId: req.operator.id, severity: 'WARNING',
        });
        throw badRequest('That code did not match. Check your device clock and try the next code.');
      }
      await db.query('update admin_users set mfa_enabled = true, updated_at = now() where id = $1::uuid', [req.operator.id]);
      await audit.fromRequest(req, {
        action: 'OPERATOR_MFA_ENABLED', entityType: 'admin_user', entityId: req.operator.id, severity: 'HIGH',
      });
      return res.json({ success: true, mfaEnabled: true, message: 'MFA is now required at every sign-in.' });
    }

    // (Re)start enrolment. If MFA is already on, the caller must be signed in
    // with a code to rotate it — the route is behind requireOperator, and an
    // existing enrolment is never silently dropped without confirmation.
    if (current.mfa_enabled) {
      return res.json({
        success: true,
        mfaEnabled: true,
        message: 'MFA is already active. Send { confirmCode } for the NEW secret to rotate it.',
      });
    }

    const secret = totp.generateSecret();
    await db.query('update admin_users set mfa_secret = $2, mfa_enabled = false where id = $1::uuid',
      [req.operator.id, encryptPII(secret)]);
    await audit.fromRequest(req, {
      action: 'OPERATOR_MFA_ENROLMENT_STARTED', entityType: 'admin_user',
      entityId: req.operator.id, severity: 'INFO',
    });
    return res.json({
      success: true,
      mfaEnabled: false,
      secret,
      otpauthUrl: totp.otpauthUrl({ secret, email: req.operator.email }),
      nextStep: 'Scan the secret, then POST { "confirmCode": "<6-digit code>" } to activate MFA.',
    });
  } catch (err) { return next(err); }
});

/** SUPER_ADMIN creates further operators (never via the app, always audited). */
router.post('/operators', requireOperator, requirePermission(P.SETTINGS_WRITE),
  validateBody(z.object({
    email: z.string().email(),
    password: z.string().min(12).max(200),
    fullName: z.string().min(2).max(120),
    role: z.enum(Object.keys(ROLES)),
  })), async (req, res, next) => {
    try {
      const {
        email, password, fullName, role,
      } = req.body;
      const operator = await auth.createAdmin({
        email, password, fullName, role, createdBy: req.operator.email,
      });
      res.status(201).json({
        success: true,
        operator: { ...operator, permissions: PERMISSIONS[operator.role] },
        message: 'Operator created. They should enable TOTP at first sign-in.',
      });
    } catch (err) { next(err); }
  });

router.get('/operators', requireOperator, requirePermission(P.SETTINGS_WRITE), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select id, email, full_name, role, is_active, mfa_enabled, last_login_at, created_at
         from admin_users order by created_at`,
    );
    res.json({ success: true, operators: rows });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
router.get('/overview', requireOperator, requirePermission(P.OVERVIEW_READ), async (req, res, next) => {
  try {
    const [
      transfers24h, holds, pendingKyc, pendingMc, floatRows, trial, integrity,
      corridors, cases, recentAudit, webhookHealth,
    ] = await Promise.all([
      db.query(`select count(*)::int as count,
                       coalesce(sum(total_debit_qar_minor),0)::bigint as volume_minor,
                       coalesce(sum(fee_qar_minor),0)::bigint as fees_minor,
                       coalesce(sum(spread_qar_minor),0)::bigint as spread_minor,
                       count(*) filter (where status = 'PAID')::int as paid,
                       count(*) filter (where status = 'FAILED')::int as failed
                  from transfers where initiated_at > now() - interval '24 hours'`),
      db.query(`select count(*)::int as count, coalesce(sum(total_debit_qar_minor),0)::bigint as held_minor
                  from transfers where status = 'AML_HOLD'`),
      db.query("select count(*)::int as count from kyc_requests where status in ('PENDING','IN_REVIEW')"),
      db.query("select count(*)::int as count from maker_checker_requests where status = 'PENDING'"),
      db.query('select * from afrisend_float_positions()'),
      db.query('select * from afrisend_currency_positions()'),
      db.query('select * from afrisend_books_integrity()'),
      db.query('select currency, country_code, country_name, flag, base_rate, retail_rate, active, updated_at from fx_corridors order by country_name'),
      db.query("select trigger_rule, severity, count(*)::int as cases from aml_cases where status in ('OPEN','ESCALATED') group by 1,2"),
      audit.list({ limit: 15 }),
      db.query(`select provider,
                       count(*)::int as total,
                       count(*) filter (where processed_at is not null and error is null)::int as processed,
                       count(*) filter (where error is not null)::int as failed,
                       count(*) filter (where not signature_ok)::int as rejected_signatures,
                       max(received_at) as latest
                  from webhook_events where received_at > now() - interval '7 days' group by 1`),
    ]);

    const sanctionsCoverage = await screening.stats();

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      last24h: {
        transferCount: transfers24h.rows[0].count,
        volumeMinor: Number(transfers24h.rows[0].volume_minor),
        volume: money.formatWithCurrency(transfers24h.rows[0].volume_minor, 'QAR'),
        feeRevenueMinor: Number(transfers24h.rows[0].fees_minor),
        fxSpreadRevenueMinor: Number(transfers24h.rows[0].spread_minor),
        paid: transfers24h.rows[0].paid,
        failed: transfers24h.rows[0].failed,
      },
      queues: {
        amlHolds: holds.rows[0].count,
        amlHeldValueMinor: Number(holds.rows[0].held_minor),
        kycPending: pendingKyc.rows[0].count,
        makerCheckerPending: pendingMc.rows[0].count,
        openAmlCases: cases.rows.reduce((a, c) => a + c.cases, 0),
      },
      amlCaseBreakdown: cases.rows,
      solvency: {
        // `booksBalanced` is the journal-level invariant (every journal balances
        // per currency, or in translated QAR when cross-currency). Per-currency
        // net positions are the FX exposure Treasury manages, not an error.
        ledgerIntegrity: integrity.rows[0],
        booksBalanced: integrity.rows[0].books_balanced === true,
        currencyPositions: trial.rows,
        floatPositions: floatRows.rows,
      },
      corridors: corridors.rows.map((c) => ({
        currency: c.currency, country: c.country_name, countryCode: c.country_code, flag: c.flag,
        baseRate: Number(c.base_rate), retailRate: Number(c.retail_rate), active: c.active,
        updatedAt: c.updated_at,
      })),
      screeningCoverage: sanctionsCoverage,
      webhookHealth: webhookHealth.rows,
      recentAudit: recentAudit,
      realtime: sse.stats(),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Transfers / AML
// ---------------------------------------------------------------------------
router.get('/transfers', requireOperator, requirePermission(P.TRANSFERS_READ), validateQuery(z.object({
  status: z.string().optional(),
  risk: z.string().optional(),
  country: z.string().length(2).optional(),
  search: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})), async (req, res, next) => {
  try {
    const rows = await transfers.listForConsole(req.query);
    res.json({
      success: true,
      transfers: rows.map((t) => ({
        id: t.id,
        reference: t.reference,
        status: t.status,
        riskLevel: t.risk_level,
        channel: t.channel,
        countryCode: t.country_code,
        payoutCurrency: t.payout_currency,
        totalDebitMinor: Number(t.total_debit_qar_minor),
        totalDebit: money.formatWithCurrency(t.total_debit_qar_minor, 'QAR'),
        payoutAmount: money.formatWithCurrency(t.payout_amount_minor, t.payout_currency),
        feeMinor: Number(t.fee_qar_minor),
        spreadMinor: Number(t.spread_qar_minor),
        provider: t.provider,
        providerReference: t.provider_reference,
        amlHoldReason: t.aml_hold_reason,
        failureReason: t.failure_reason,
        purposeCode: t.purpose_code,
        initiatedAt: t.initiated_at,
        paidAt: t.paid_at,
        customer: {
          reference: t.customer_ref, name: t.customer_name, kycTier: t.kyc_tier, riskLevel: t.customer_risk,
        },
        beneficiary: {
          name: t.beneficiary_name, institution: t.institution_name,
          accountMasked: t.account_number_last4 ? `••••${t.account_number_last4}` : null,
        },
      })),
    });
  } catch (err) { next(err); }
});

router.get('/transfers/:reference', requireOperator, requirePermission(P.TRANSFERS_READ), async (req, res, next) => {
  try {
    const transfer = await transfers.findByReference({ reference: req.params.reference });
    const { rows: journalRows } = await db.query(
      `select j.id, j.reference, j.journal_type, j.total_qar_minor, j.posted_at
         from ledger_journals j join transfers t on t.id = j.transfer_id
        where t.reference = $1 order by j.posted_at`,
      [req.params.reference],
    );
    const { rows: screeningRows } = await db.query(
      `select id, subject_type, query_name, outcome, best_score, match_count, lists_checked, matches, screened_at
         from screening_results
        where (subject_type = 'CUSTOMER' and subject_id = (select customer_id from transfers where reference = $1))
           or (subject_type = 'BENEFICIARY' and subject_id = (select beneficiary_id from transfers where reference = $1))
        order by screened_at desc limit 10`,
      [req.params.reference],
    );
    // Why the money was held: the rule set that fired, kept on the AML case so
    // an analyst (and the QCB return) can see the reasoning months later.
    const { rows: caseRows } = await db.query(
      `select reference, trigger_rule, severity, status, details, opened_at, closed_at, resolution_note
         from aml_cases
        where transfer_id = (select id from transfers where reference = $1)
        order by opened_at desc limit 1`,
      [req.params.reference],
    );
    const amlCase = caseRows[0] || null;
    res.json({
      success: true,
      transfer: {
        ...transfer,
        riskAssessment: amlCase
          ? {
            caseReference: amlCase.reference,
            triggerRule: amlCase.trigger_rule,
            severity: amlCase.severity,
            caseStatus: amlCase.status,
            rules: (amlCase.details && amlCase.details.rules) || [],
            openedAt: amlCase.opened_at,
            closedAt: amlCase.closed_at,
            resolutionNote: amlCase.resolution_note,
          }
          : null,
      },
      amlCase,
      journals: journalRows,
      screening: screeningRows,
    });
  } catch (err) { next(err); }
});

/** MLRO decision on a held transfer. */
router.post('/transfers/:reference/aml-action', requireOperator, requirePermission(P.AML_RELEASE),
  validateBody(z.object({
    action: z.enum(['RELEASE', 'BLOCK']),
    note: z.string().min(10).max(1000),
  })), async (req, res, next) => {
    try {
      const { action, note } = req.body;
      const operator = req.operator;

      if (action === 'BLOCK') {
        const result = await transfers.blockTransfer({ transferReference: req.params.reference, operator, note, ip: req.ip, userAgent: req.get('user-agent') });
        return res.json({ success: true, ...result });
      }

      // Releasing funds requires a second pair of eyes: create the request and
      // let a different operator approve it.
      const { rows } = await db.query(
        'select id, total_debit_qar_minor from transfers where reference = $1', [req.params.reference],
      );
      if (!rows[0]) throw notFound('Transfer not found');
      if (operator.role === 'SUPER_ADMIN' && req.body.selfApprove) {
        throw forbidden('Super admin override is disabled: AML releases must be approved by a second operator.');
      }
      const request = await makerChecker.create({
        type: 'AML_HOLD_RELEASE',
        title: `Release AML hold on ${req.params.reference}`,
        payload: { transferReference: req.params.reference, note },
        amountQarMinor: Number(rows[0].total_debit_qar_minor),
        maker: operator,
        note,
      });
      return res.status(202).json({
        success: true,
        pendingApproval: true,
        request: { reference: request.reference, type: request.request_type, status: request.status },
        message: 'Release queued for a second operator to approve (4-eyes).',
      });
    } catch (err) { return next(err); }
  });

router.get('/aml-cases', requireOperator, requirePermission(P.AML_REVIEW), async (req, res, next) => {
  try {
    res.json({ success: true, cases: await aml.listCases({ status: req.query.status || 'ALL', limit: req.query.limit }) });
  } catch (err) { next(err); }
});

router.post('/aml-cases/:reference/action', requireOperator, requirePermission(P.AML_REVIEW), validateBody(z.object({
  status: z.enum(['OPEN', 'ESCALATED', 'SAR_FILED', 'CLOSED_NO_ACTION', 'CLOSED_ACTIONED']),
  note: z.string().min(10).max(2000),
})), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `update aml_cases set status = $2, resolution_note = $3,
              closed_at = case when $2 like 'CLOSED%' then now() else null end,
              closed_by = case when $2 like 'CLOSED%' then $4 else closed_by end
        where reference = $1 returning *`,
      [req.params.reference, req.body.status, req.body.note, req.operator.id],
    );
    if (!rows[0]) throw notFound('Case not found');
    await audit.fromRequest(req, {
      action: `AML_CASE_${req.body.status}`, entityType: 'aml_case', entityId: rows[0].id,
      severity: req.body.status === 'SAR_FILED' ? 'CRITICAL' : 'HIGH',
      afterState: { status: req.body.status, note: req.body.note },
    });
    sse.broadcast('aml_case_updated', { reference: req.params.reference, status: req.body.status });
    res.json({ success: true, case: rows[0] });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------
router.get('/ledger', requireOperator, requirePermission(P.LEDGER_READ), async (req, res, next) => {
  try {
    const [journals, trial, positions, floats, integrity, shortfalls, reconciliation, suspense] = await Promise.all([
      ledger.listJournals({ limit: req.query.limit || 50, type: req.query.type, reference: req.query.reference }),
      ledger.trialBalance(),
      ledger.currencyPositions(),
      ledger.floatPositions(),
      ledger.booksIntegrity(),
      ledger.floatShortfalls(),
      db.query('select * from afrisend_wallet_reconciliation()'),
      db.query('select * from afrisend_suspense_position()'),
    ]);
    res.json({
      success: true,
      integrity,
      walletReconciliation: {
        ...reconciliation.rows[0],
        wallets: money.formatWithCurrency(reconciliation.rows[0].wallets_minor, 'QAR'),
        ledgerLiability: money.formatWithCurrency(reconciliation.rows[0].ledger_liability_minor, 'QAR'),
        difference: money.formatWithCurrency(reconciliation.rows[0].difference_minor, 'QAR'),
      },
      suspensePosition: {
        ...suspense.rows[0],
        suspense: money.formatWithCurrency(suspense.rows[0].suspense_minor, 'QAR'),
        heldTransfers: money.formatWithCurrency(suspense.rows[0].held_transfers_value_minor, 'QAR'),
        difference: money.formatWithCurrency(suspense.rows[0].difference_minor, 'QAR'),
      },
      journals,
      trialBalance: trial,
      currencyPositions: positions,
      balanceSheet: positions.map((p) => ({ currency: p.currency, debits_minor: Number(p.debits_minor), credits_minor: Number(p.credits_minor), balanced: p.debits_minor === p.credits_minor })),
      floats: floats.map((f) => ({ ...f, balance_minor: Number(f.balance_minor), qar_value_minor: Number(f.qar_value_minor) })),
      floatShortfalls: shortfalls.map((s2) => ({
        currency: s2.currency,
        owed: money.formatWithCurrency(s2.owed_minor, s2.currency),
        float: money.formatWithCurrency(s2.float_minor, s2.currency),
        shortfall: money.formatWithCurrency(s2.shortfall_minor, s2.currency),
      })),
    });
  } catch (err) { next(err); }
});

router.get('/ledger/journals/:journalId', requireOperator, requirePermission(P.LEDGER_READ), async (req, res, next) => {
  try {
    const entries = await ledger.entriesForJournal(req.params.journalId);
    if (!entries.length) throw notFound('Journal not found');
    res.json({
      success: true,
      entries: entries.map((e) => ({
        id: e.id, direction: e.direction, accountCode: e.account_code, accountName: e.account_name,
        accountClass: e.account_class, currency: e.currency, amountMinor: Number(e.amount_minor),
        amount: money.formatWithCurrency(e.amount_minor, e.currency),
        qarValueMinor: Number(e.qar_value_minor), memo: e.memo, createdAt: e.created_at,
      })),
    });
  } catch (err) { next(err); }
});

router.get('/ledger/accounts/:code', requireOperator, requirePermission(P.LEDGER_READ), async (req, res, next) => {
  try {
    const rows = await ledger.accountStatement({ accountCode: req.params.code, limit: req.query.limit || 100 });
    res.json({
      success: true,
      entries: rows.map((r) => ({
        ...r, amount_minor: Number(r.amount_minor),
        amount: money.formatWithCurrency(r.amount_minor, r.currency),
      })),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// KYC
// ---------------------------------------------------------------------------
router.get('/kyc', requireOperator, requirePermission(P.KYC_READ), async (req, res, next) => {
  try {
    const rows = await kyc.queue({ status: req.query.status || 'PENDING', limit: req.query.limit });
    res.json({
      success: true,
      queue: rows.map((r) => ({
        id: r.id,
        status: r.status,
        requestedTier: r.requested_tier,
        documentType: r.document_type,
        documentMasked: r.document_number_last4 ? `••••${r.document_number_last4}` : null,
        documentExpiry: r.document_expiry,
        livenessScore: r.liveness_score != null ? Number(r.liveness_score) : null,
        faceMatchScore: r.face_match_score != null ? Number(r.face_match_score) : null,
        screening: r.aml_name_screen,
        submittedAt: r.created_at,
        customer: {
          reference: r.public_ref, name: r.full_name, phone: r.phone_e164,
          currentTier: r.current_tier, riskLevel: r.risk_level, pep: r.pep_flag,
          previousTransfers: r.previous_transfers,
          lifetimeVolume: money.formatWithCurrency(r.lifetime_volume_minor, 'QAR'),
        },
      })),
    });
  } catch (err) { next(err); }
});

router.post('/kyc/:id/review', requireOperator, requirePermission(P.KYC_REVIEW), validateBody(z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'ESCALATE']),
  tier: z.number().int().min(1).max(3).optional(),
  note: z.string().min(5).max(1000),
})), async (req, res, next) => {
  try {
    const result = await kyc.review({
      kycId: req.params.id, operator: req.operator, decision: req.body.decision,
      tier: req.body.tier, note: req.body.note, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Maker-checker
// ---------------------------------------------------------------------------
router.get('/maker-checker', requireOperator, async (req, res, next) => {
  try {
    const [requests, pending] = await Promise.all([
      makerChecker.list({ status: req.query.status || 'PENDING', limit: req.query.limit }),
      db.query("select count(*)::int as c from maker_checker_requests where status = 'PENDING'"),
    ]);
    res.json({
      success: true,
      pendingCount: pending.rows[0].c,
      canApprove: can(req.operator.role, P.MAKER_APPROVE),
      requests: requests.map((r) => ({
        id: r.id, reference: r.reference, type: r.request_type, title: r.title, payload: r.payload,
        amountQarMinor: r.amount_qar_minor != null ? Number(r.amount_qar_minor) : null,
        amount: r.amount_qar_minor != null ? money.formatWithCurrency(r.amount_qar_minor, 'QAR') : null,
        status: r.status, maker: r.maker_email, makerRole: r.maker_role, makerNote: r.maker_note,
        checker: r.checker_email, checkerNote: r.checker_note, decidedAt: r.decided_at,
        expiresAt: r.expires_at, createdAt: r.created_at,
        isOwnRequest: r.maker_id === req.operator.id,
      })),
    });
  } catch (err) { next(err); }
});

router.post('/maker-checker', requireOperator, requirePermission(P.MAKER_CREATE), validateBody(z.object({
  type: z.enum([...MAKER_CHECKER_REQUIRED]),
  title: z.string().min(5).max(200),
  payload: z.record(z.any()),
  amountQarMinor: z.number().int().nonnegative().optional(),
  note: z.string().max(1000).optional(),
})), async (req, res, next) => {
  try {
    const request = await makerChecker.create({
      type: req.body.type, title: req.body.title, payload: req.body.payload,
      amountQarMinor: req.body.amountQarMinor ?? null, maker: req.operator, note: req.body.note,
    });
    res.status(201).json({
      success: true,
      request: { reference: request.reference, type: request.request_type, status: request.status, expiresAt: request.expires_at },
      message: 'Request recorded. A different operator must approve it before it takes effect.',
    });
  } catch (err) { next(err); }
});

router.post('/maker-checker/:reference/decide', requireOperator, requirePermission(P.MAKER_APPROVE), validateBody(z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  note: z.string().max(1000).optional(),
})), async (req, res, next) => {
  try {
    const result = await makerChecker.decide({
      reference: req.params.reference, action: req.body.action, checker: req.operator,
      note: req.body.note, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------
router.get('/fx', requireOperator, requirePermission(P.FX_READ), async (req, res, next) => {
  try {
    const corridors = await fx.corridors({ onlyActive: false });
    res.json({ success: true, corridors });
  } catch (err) { next(err); }
});

router.get('/fx/:currency/history', requireOperator, requirePermission(P.FX_READ), async (req, res, next) => {
  try { res.json({ success: true, history: await fx.listHistory(req.params.currency) }); } catch (err) { next(err); }
});

/** Market reference for the Treasury officer (never auto-applied). */
router.get('/fx/:currency/market', requireOperator, requirePermission(P.FX_READ), async (req, res, next) => {
  try { res.json({ success: true, ...(await fx.marketSuggestion(req.params.currency.toUpperCase())) }); } catch (err) { next(err); }
});

router.post('/fx/rate-change', requireOperator, requirePermission(P.MAKER_CREATE), validateBody(z.object({
  currency: z.string().length(3),
  baseRate: z.number().positive(),
  retailRate: z.number().positive(),
  reason: z.string().min(10).max(500),
})), async (req, res, next) => {
  try {
    const request = await makerChecker.create({
      type: 'FX_RATE_CHANGE',
      title: `${req.body.currency} rate ${req.body.retailRate} (base ${req.body.baseRate})`,
      payload: req.body, maker: req.operator, note: req.body.reason,
    });
    res.status(202).json({ success: true, request: { reference: request.reference, status: request.status } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Liquidity / treasury
// ---------------------------------------------------------------------------
router.get('/liquidity', requireOperator, requirePermission(P.LIQUIDITY_READ), async (req, res, next) => {
  try {
    const [pools, floats, pending, shortfalls, awaiting] = await Promise.all([
      db.query(`select p.*, c.exponent from liquidity_pools p join currencies c on c.code = p.currency order by p.key`),
      db.query('select * from afrisend_float_positions()'),
      db.query(`select reference, title, payload, amount_qar_minor, maker_email, created_at
                  from maker_checker_requests
                 where status = 'PENDING' and request_type in ('FLOAT_TOPUP','FLOAT_RECONCILIATION')`),
      db.query('select * from afrisend_float_shortfalls()'),
      db.query(`select payout_currency as currency, count(*)::int as payouts,
                       sum(payout_amount_minor)::bigint as owed_minor
                  from transfers
                 where status = 'INITIATED' and provider_status = 'AWAITING_FLOAT'
                 group by 1`),
    ]);
    res.json({
      success: true,
      pools: pools.rows.map((p) => ({
        key: p.key, name: p.name, provider: p.provider, currency: p.currency,
        balanceMinor: Number(p.balance_minor),
        balance: money.formatWithCurrency(p.balance_minor, p.currency),
        minThresholdMinor: Number(p.min_threshold_minor),
        belowThreshold: Number(p.balance_minor) < Number(p.min_threshold_minor),
        updatedAt: p.updated_at,
      })),
      floatAccounts: floats.rows.map((f) => ({
        ...f,
        balance_minor: Number(f.balance_minor), qar_value_minor: Number(f.qar_value_minor),
        balance: money.formatWithCurrency(f.balance_minor, f.currency),
      })),
      floatShortfalls: shortfalls.rows.map((row) => ({
        currency: row.currency,
        owed: money.formatWithCurrency(row.owed_minor, row.currency),
        float: money.formatWithCurrency(row.float_minor, row.currency),
        shortfall: money.formatWithCurrency(row.shortfall_minor, row.currency),
      })),
      awaitingFloat: awaiting.rows.map((row) => ({
        currency: row.currency,
        payouts: row.payouts,
        owed: money.formatWithCurrency(row.owed_minor, row.currency),
      })),
      pendingTopUps: pending.rows.map((r) => ({
        reference: r.reference, title: r.title, payload: r.payload,
        amount: r.amount_qar_minor != null ? money.formatWithCurrency(r.amount_qar_minor, 'QAR') : null,
        maker: r.maker_email, createdAt: r.created_at,
      })),
    });
  } catch (err) { next(err); }
});

/**
 * Operator action: after funding a float, send the payouts that were queued
 * waiting for it, instead of waiting for the 5-minute housekeeping cycle.
 * Safe to press twice — dispatch re-checks the float and the provider call is
 * idempotent on our reference.
 */
router.post('/liquidity/retry-queued', requireOperator, requirePermission(P.LIQUIDITY_OPERATE), async (req, res, next) => {
  try {
    const { rows: queued } = await db.query(
      `select t.reference, t.payout_currency, t.payout_amount_minor
         from transfers t
        where t.status = 'INITIATED' and t.provider_status = 'AWAITING_FLOAT'
        order by t.initiated_at limit 100`,
    );
    const dispatched = await transfers.retryAwaitingFloat({ limit: 100 });
    await audit.fromRequest(req, {
      action: 'PAYOUTS_REDISPATCHED', entityType: 'transfer', severity: 'HIGH',
      metadata: { queued: queued.length, dispatched, references: queued.map((row) => row.reference) },
    });
    sse.broadcast('metrics_dirty', { reason: 'payout_redispatch' });
    res.json({
      success: true,
      queued: queued.length,
      dispatched,
      message: queued.length === 0
        ? 'No payouts are waiting for float.'
        : `${dispatched} of ${queued.length} queued payout(s) picked up.`,
    });
  } catch (err) { next(err); }
});

router.post('/liquidity/topup', requireOperator, requirePermission(P.MAKER_CREATE), validateBody(z.object({
  poolKey: z.string().min(2).max(60),
  amount: z.union([z.string(), z.number()]),
  currency: z.string().length(3).optional(),
  reference: z.string().min(6).max(80),
  memo: z.string().max(300).optional(),
})), async (req, res, next) => {
  try {
    const request = await makerChecker.create({
      type: 'FLOAT_TOPUP',
      title: `Float top-up ${req.body.amount} ${req.body.currency || ''} → ${req.body.poolKey}`.trim(),
      payload: {
        poolKey: req.body.poolKey, amountMajor: String(req.body.amount),
        currency: req.body.currency, memo: req.body.memo, bankReference: req.body.reference,
      },
      maker: req.operator, note: req.body.memo,
    });
    res.status(202).json({ success: true, request: { reference: request.reference, status: request.status } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
router.get('/customers', requireOperator, requirePermission(P.CUSTOMERS_READ), validateQuery(z.object({
  search: z.string().max(80).optional(),
  status: z.string().optional(),
  risk: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select c.id, c.public_ref, c.full_name, c.email, c.phone_e164, c.nationality, c.status, c.kyc_tier,
              c.risk_level, c.pep_flag, c.created_at,
              w.available_minor, w.currency as wallet_currency,
              (select count(*) from transfers t where t.customer_id = c.id)::int as transfer_count,
              (select coalesce(sum(total_debit_qar_minor),0) from transfers t
                where t.customer_id = c.id and t.status in ('PAID','PROCESSING'))::bigint as lifetime_minor,
              afrisend_monthly_sent_qar(c.id) as month_to_date_minor
         from customers c left join wallets w on w.customer_id = c.id
        where ($1::text is null or c.full_name ilike '%'||$1||'%' or c.public_ref ilike '%'||$1||'%' or c.phone_e164 ilike '%'||$1||'%')
          and ($2::text is null or c.status::text = $2)
          and ($3::text is null or c.risk_level::text = $3)
        order by c.created_at desc limit $4`,
      [req.query.search || null, req.query.status || null, req.query.risk || null, req.query.limit || 100],
    );
    res.json({
      success: true,
      customers: rows.map((c) => ({
        id: c.id,
        reference: c.public_ref,
        name: c.full_name,
        email: c.email,
        phone: c.phone_e164,
        nationality: c.nationality,
        status: c.status,
        kycTier: c.kyc_tier,
        riskLevel: c.risk_level,
        pep: c.pep_flag,
        createdAt: c.created_at,
        wallet: money.formatWithCurrency(c.available_minor || 0, c.wallet_currency || 'QAR'),
        walletMinor: Number(c.available_minor || 0),
        transferCount: c.transfer_count,
        lifetimeVolume: money.formatWithCurrency(c.lifetime_minor, 'QAR'),
        monthToDate: money.formatWithCurrency(c.month_to_date_minor, 'QAR'),
      })),
    });
  } catch (err) { next(err); }
});

/**
 * Match an inbound bank payment to a customer wallet.
 *
 * This is a real back-office operation (a QNB deposit arrives, the operator
 * credits the matching account after checking the bank statement), so it is
 * audited at HIGH severity with the bank reference, and the ledger posts a
 * WALLET_FUNDING journal like any other top-up.
 */
router.post('/customers/:reference/wallet-credit', requireOperator, requirePermission(P.CUSTOMERS_WRITE),
  validateBody(z.object({
    amount: z.union([z.string(), z.number()]),
    bankReference: z.string().min(4).max(80),
    note: z.string().max(500).optional(),
  })), async (req, res, next) => {
    try {
      const amountMinor = money.toMinor(req.body.amount, 'QAR');
      if (amountMinor <= 0) throw badRequest('amount must be greater than zero');

      const result = await db.withTransaction(async (client) => {
        const { rows } = await client.query(
          'select id, public_ref from customers where public_ref = $1 for update', [req.params.reference],
        );
        const customer = rows[0];
        if (!customer) throw notFound('Customer not found');

        const { rows: fundingRows } = await client.query(
          `insert into wallet_fundings (customer_id, wallet_id, method, amount_minor, currency, provider_ref, status, settled_at)
           select $1, w.id, 'BANK_SETTLEMENT', $2, 'QAR', $3, 'PENDING', now()
             from wallets w where w.customer_id = $1
           returning id`,
          [customer.id, amountMinor, req.body.bankReference],
        );
        const funding = { id: fundingRows[0].id, customer_id: customer.id, method: 'BANK_SETTLEMENT' };

        await client.query('select afrisend_wallet_apply($1::uuid, $2::bigint)', [customer.id, amountMinor]);
        const journalId = await ledger.postWalletFunding({
          funding, amountMinor, reference: req.body.bankReference, postedBy: `operator:${req.operator.email}`, client,
        });
        await client.query('update wallet_fundings set status = $2, ledger_journal_id = $3 where id = $1',
          [funding.id, 'SETTLED', journalId]);

        await audit.record({
          client,
          actorType: 'OPERATOR', actorId: req.operator.id, actorEmail: req.operator.email,
          actorRole: req.operator.role, ip: req.ip, userAgent: req.get('user-agent'),
          action: 'WALLET_CREDITED_MANUALLY', entityType: 'customer', entityId: customer.id,
          severity: 'HIGH',
          afterState: { amount: money.toMajor(amountMinor, 'QAR'), bankReference: req.body.bankReference, journalId, note: req.body.note },
        });

        return { customerRef: customer.public_ref, amountMinor, journalId, fundingId: funding.id };
      });

      sse.broadcast('wallet_credited', { customerRef: result.customerRef, amountMinor: result.amountMinor });
      sse.broadcast('metrics_dirty', { reason: 'wallet_credit' });
      res.status(201).json({
        success: true,
        customerRef: result.customerRef,
        amount: money.formatWithCurrency(result.amountMinor, 'QAR'),
        ledgerJournalId: result.journalId,
      });
    } catch (err) { next(err); }
  });

/** Suspending an account is a maker-checker action. */
router.post('/customers/:reference/status', requireOperator, requirePermission(P.CUSTOMERS_WRITE), validateBody(z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']),
  reason: z.string().min(10).max(500),
})), async (req, res, next) => {
  try {
    const request = await makerChecker.create({
      type: 'CUSTOMER_STATUS_CHANGE',
      title: `${req.body.status} customer ${req.params.reference}`,
      payload: { customerRef: req.params.reference, status: req.body.status, reason: req.body.reason },
      maker: req.operator, note: req.body.reason,
    });
    res.status(202).json({ success: true, request: { reference: request.reference, status: request.status } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Audit / sanctions / webhooks
// ---------------------------------------------------------------------------
router.get('/audit-logs', requireOperator, requirePermission(P.AUDIT_READ), validateQuery(z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  action: z.string().max(60).optional(),
  actorEmail: z.string().max(120).optional(),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(80).optional(),
  severity: z.string().max(20).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})), async (req, res, next) => {
  try { res.json({ success: true, logs: await audit.list(req.query) }); } catch (err) { next(err); }
});

router.get('/sanctions', requireOperator, requirePermission(P.AML_REVIEW), async (req, res, next) => {
  try {
    const [coverage, recent] = await Promise.all([
      screening.stats(),
      db.query(`select id, subject_type, subject_id, query_name, outcome, best_score, match_count, lists_checked, screened_at
                  from screening_results order by screened_at desc limit $1`, [req.query.limit || 50]),
    ]);
    const thresholds = await screening.getThresholds();
    res.json({ success: true, coverage, thresholds, recentScreens: recent.rows });
  } catch (err) { next(err); }
});

router.get('/webhooks', requireOperator, requirePermission(P.AUDIT_READ), async (req, res, next) => {
  try {
    const { rows } = await db.query(
      `select id, provider, event_type, provider_event_id, signature_ok, processed_at, error, received_at
         from webhook_events order by received_at desc limit $1`, [req.query.limit || 100],
    );
    res.json({ success: true, events: rows });
  } catch (err) { next(err); }
});

/** Replay a stored webhook (used after a transient failure). */
router.post('/webhooks/:id/replay', requireOperator, requirePermission(P.AUDIT_READ), async (req, res, next) => {
  try {
    const { rows } = await db.query('select * from webhook_events where id = $1', [req.params.id]);
    if (!rows[0]) throw notFound('Webhook event not found');
    if (!rows[0].signature_ok) throw badRequest('Refusing to replay an event that failed signature verification');
    const body = rows[0].payload;
    const data = body.data || {};
    const reference = data.reference || data.tx_ref || body.clientReference || data.merchant_reference;
    const outcome = await transfers.applyProviderResult({
      reference,
      provider: rows[0].provider,
      providerReference: data.id ? String(data.id) : null,
      providerStatus: String(data.status || '').toUpperCase() || 'PROCESSING',
      payload: data,
      source: 'REPLAY',
    });
    await db.query('update webhook_events set processed_at = now(), error = null, processing_result = $2 where id = $1',
      [rows[0].id, JSON.stringify(outcome)]);
    await audit.fromRequest(req, {
      action: 'WEBHOOK_REPLAYED', entityType: 'webhook_event', entityId: rows[0].id,
      severity: 'HIGH', metadata: { provider: rows[0].provider, eventType: rows[0].event_type, outcome },
    });
    res.json({ success: true, outcome });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------
router.get('/reports', requireOperator, requirePermission(P.REPORTS_GENERATE), async (req, res, next) => {
  try { res.json({ success: true, reports: await reports.listReports({ limit: req.query.limit }) }); } catch (err) { next(err); }
});

router.post('/reports/qcb', requireOperator, requirePermission(P.REPORTS_GENERATE), validateBody(z.object({
  periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reportType: z.enum(['AML_QUARTERLY', 'AML_MONTHLY', 'SANCTIONS_MONTHLY']).optional(),
})), async (req, res, next) => {
  try {
    const report = await reports.generateQcbReport({ operator: req.operator, ...req.body });
    sse.broadcast('report_generated', { filingId: report.filingId, reportType: report.payload.reportType });
    res.status(201).json({ success: true, report });
  } catch (err) { next(err); }
});

router.get('/reports/:filingId', requireOperator, requirePermission(P.REPORTS_GENERATE), async (req, res, next) => {
  try {
    const report = await reports.getReport(req.params.filingId);
    res.json({ success: true, report });
  } catch (err) { next(err); }
});

router.post('/reports/qcb/verify', requireOperator, requirePermission(P.REPORTS_GENERATE), validateBody(z.object({
  filingId: z.string().min(6),
  contentHash: z.string().optional(),
  signature: z.string().optional(),
})), async (req, res, next) => {
  try { res.json({ success: true, verification: await reports.verify(req.body) }); } catch (err) { next(err); }
});

router.get('/reports/ctr/extract', requireOperator, requirePermission(P.REPORTS_GENERATE), async (req, res, next) => {
  try { res.json({ success: true, ...(await reports.ctrExtract({ date: req.query.date })) }); } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Realtime stream
// ---------------------------------------------------------------------------
/**
 * EventSource cannot send an Authorization header, so the console passes the
 * short-lived access token as a query parameter. It is verified exactly like a
 * header token (issuer, audience, type, role).
 */
router.get('/stream', async (req, res) => {
  try {
    const token = req.query.token || (req.get('authorization') || '').split(' ')[1];
    if (!token) return res.status(401).end();
    const payload = jwt.verify(token, env.JWT_SECRET, { issuer: env.JWT_ISSUER, audience: 'afrisend-admin' });
    if (payload.typ !== 'operator') return res.status(401).end();
    const operator = { id: payload.sub, email: payload.email, role: payload.role, name: payload.name };
    if (!can(operator.role, P.OVERVIEW_READ)) return res.status(403).end();
    return sse.subscribe(req, res, operator);
  } catch (err) {
    return res.status(401).end();
  }
});

module.exports = router;
