'use strict';
/**
 * Regulatory reporting.
 *
 * Reports are computed from the live ledger and transfer tables — not from
 * counters kept in memory — then hashed and signed with the platform's RSA key
 * so a filed document can be proven unmodified later. Every generated report is
 * stored in `qcb_reports` with its signature and the identity of the operator
 * who produced it.
 */
const db = require('../db/pool');
const crypto = require('crypto');
const { env } = require('../config/env');
const { encryptPII, decryptPII, sha256, generateRsaKeyPair, signPayload, verifySignature } = require('../lib/crypto');
const audit = require('./audit');
const { notFound, badRequest } = require('../lib/errors');

async function ensureSigningKey(client = db) {
  const { rows } = await client.query('select * from signing_keys where active order by created_at desc limit 1');
  if (rows[0]) {
    return { kid: rows[0].kid, publicKey: rows[0].public_key_pem, privateKey: decryptPII(rows[0].private_key_pem_encrypted) };
  }
  const { publicKey, privateKey } = generateRsaKeyPair();
  const kid = `afrisend-${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(4).toString('hex')}`;
  await client.query(
    `insert into signing_keys (kid, public_key_pem, private_key_pem_encrypted)
     values ($1,$2,$3)`,
    [kid, publicKey, encryptPII(privateKey)],
  );
  return { kid, publicKey, privateKey };
}

function canonical(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}

function periodFor({ periodStart, periodEnd, reportType }) {
  if (periodStart && periodEnd) {
    return { start: periodStart, end: periodEnd };
  }
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    reportType,
  };
}

// ---------------------------------------------------------------------------
// QCB AML / quarterly return
// ---------------------------------------------------------------------------
async function generateQcbReport({ operator, periodStart, periodEnd, reportType = 'AML_QUARTERLY' }) {
  const { start, end } = periodFor({ periodStart, periodEnd, reportType });

  const { rows: [volume] } = await db.query(
    `select count(*)::int as transfers,
            coalesce(sum(total_debit_qar_minor),0)::bigint as volume_qar_minor,
            coalesce(sum(payout_amount_minor),0)::bigint as payout_minor,
            coalesce(sum(fee_qar_minor),0)::bigint as fees_qar_minor,
            coalesce(sum(spread_qar_minor),0)::bigint as spread_qar_minor
       from transfers
      where initiated_at >= $1::date and initiated_at < ($2::date + interval '1 day')
        and status in ('PAID','PROCESSING','INITIATED')`,
    [start, end],
  );

  const { rows: [riskStats] } = await db.query(
    `select
       count(*) filter (where risk_level = 'HIGH')::int as high_risk,
       count(*) filter (where risk_level = 'CRITICAL')::int as critical_risk,
       count(*) filter (where risk_level = 'MEDIUM')::int as medium_risk,
       count(*) filter (where aml_hold_reason is not null)::int as held,
       count(*) filter (where aml_released_at is not null)::int as released,
       count(*) filter (where status = 'FAILED')::int as failed,
       count(*) filter (where status = 'REFUNDED')::int as refunded
       from transfers
      where initiated_at >= $1::date and initiated_at < ($2::date + interval '1 day')`,
    [start, end],
  );

  const { rows: corridors } = await db.query(
    `select country_code, payout_currency, count(*)::int as transfers,
            sum(total_debit_qar_minor)::bigint as volume_qar_minor,
            avg(retail_rate)::numeric(20,6) as avg_rate
       from transfers
      where initiated_at >= $1::date and initiated_at < ($2::date + interval '1 day')
        and status in ('PAID','PROCESSING','INITIATED')
      group by 1,2 order by volume_qar_minor desc`,
    [start, end],
  );

  const { rows: [cases] } = await db.query(
    `select count(*)::int as opened,
            count(*) filter (where status in ('SAR_FILED'))::int as sar_filed,
            count(*) filter (where status in ('OPEN','ESCALATED'))::int as still_open
       from aml_cases where opened_at >= $1::date and opened_at < ($2::date + interval '1 day')`,
    [start, end],
  );

  const { rows: [kycStats] } = await db.query(
    `select count(*) filter (where status = 'APPROVED')::int as approved,
            count(*) filter (where status = 'REJECTED')::int as rejected,
            count(*) filter (where status in ('PENDING','IN_REVIEW'))::int as pending
       from kyc_requests where created_at >= $1::date and created_at < ($2::date + interval '1 day')`,
    [start, end],
  );

  const { rows: customers } = await db.query(
    `select count(*)::int as total,
            count(*) filter (where kyc_tier >= 1)::int as verified,
            count(*) filter (where risk_level in ('HIGH','CRITICAL'))::int as high_risk,
            count(*) filter (where pep_flag)::int as pep
       from customers`,
  );

  const { rows: trial } = await db.query('select * from afrisend_currency_positions()');
  const { rows: floatRows } = await db.query('select * from afrisend_float_positions()');
  const { rows: [integrity] } = await db.query('select * from afrisend_books_integrity()');
  const { rows: shortfalls } = await db.query('select * from afrisend_float_shortfalls()');
  const { rows: screeningCoverage } = await db.query(
    `select list_source, count(*)::int as entries, max(imported_at) as last_import from sanctions_list group by 1`,
  );

  const booksBalanced = integrity.books_balanced === true;
  const qarFloat = floatRows.filter((f) => f.currency === 'QAR').reduce((a, f) => a + Number(f.balance_minor), 0);
  const customerLiabilities = trial
    .filter((t) => t.class === 'LIABILITY' || t.code === '2000-QAR-CUSTOMER-WALLET')
    .reduce((a, t) => a + Math.abs(Number(t.net_minor)), 0);

  const payload = {
    reportType,
    reportingPeriod: { start, end },
    institution: {
      name: env.INSTITUTION_NAME,
      licenseNumber: env.QCB_LICENSE_NUMBER || 'NOT_CONFIGURED',
      jurisdiction: 'State of Qatar',
      regulator: 'Qatar Central Bank — Financial Information Unit',
    },
    transfers: {
      count: volume.transfers,
      volumeQar: Number(volume.volume_qar_minor) / 100,
      payoutTotalMinor: Number(volume.payout_minor),
      feeRevenueQar: Number(volume.fees_qar_minor) / 100,
      fxSpreadRevenueQar: Number(volume.spread_qar_minor) / 100,
      byRisk: riskStats,
      byCorridor: corridors.map((c) => ({
        countryCode: c.country_code,
        currency: c.payout_currency,
        transfers: c.transfers,
        volumeQar: Number(c.volume_qar_minor) / 100,
        averageRate: Number(c.avg_rate),
      })),
    },
    aml: {
      casesOpened: cases.opened,
      suspiciousActivityReportsFiled: cases.sar_filed,
      casesStillOpen: cases.still_open,
      sanctionsListsLoaded: screeningCoverage,
      screeningCoverageComplete: screeningCoverage.length > 0,
    },
    kyc: kycStats,
    customers: customers[0],
    solvency: {
      booksBalanced,
      ledgerIntegrity: integrity,
      currencyPositions: trial,
      floatPositions: floatRows,
      floatShortfalls: shortfalls,
      customerLiabilitiesQar: customerLiabilities / 100,
      availableLiquidityQar: qarFloat / 100,
      liquidityCoverageRatio: customerLiabilities > 0
        ? Number(((qarFloat / customerLiabilities) * 100).toFixed(2))
        : null,
    },
    generatedAt: new Date().toISOString(),
    generatedBy: { email: operator?.email, role: operator?.role },
  };

  const contentHash = sha256(canonical(payload));
  const key = await ensureSigningKey();
  const signature = signPayload(key.privateKey, contentHash);
  const filingId = `QCB-${reportType}-${end.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const { rows: [stored] } = await db.query(
    `insert into qcb_reports (filing_id, report_type, period_start, period_end, payload, content_hash, signature, generated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, created_at`,
    [filingId, reportType, start, end, payload, contentHash, signature, operator.id],
  );

  await audit.record({
    actorType: 'OPERATOR', actorId: operator.id, actorEmail: operator.email, actorRole: operator.role,
    action: 'QCB_REPORT_GENERATED', entityType: 'qcb_report', entityId: stored.id,
    severity: 'HIGH', afterState: { filingId, reportType, periodStart: start, periodEnd: end, contentHash },
  });

  return {
    id: stored.id,
    filingId,
    signature: { algorithm: 'RSA-PSS-SHA256', kid: key.kid, value: signature },
    contentHash,
    verification: 'POST /api/v1/admin/reports/qcb/verify with { filingId, contentHash, signature } to prove integrity.',
    payload,
    createdAt: stored.created_at,
  };
}

async function listReports({ limit = 50 } = {}) {
  const { rows } = await db.query(
    `select r.id, r.filing_id, r.report_type, r.period_start, r.period_end, r.content_hash,
            r.filed_at, r.created_at, a.email as generated_by_email
       from qcb_reports r join admin_users a on a.id = r.generated_by
      order by r.created_at desc limit $1`,
    [Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

async function getReport(filingId) {
  const { rows } = await db.query(
    `select r.*, a.email as generated_by_email from qcb_reports r
       join admin_users a on a.id = r.generated_by where r.filing_id = $1`, [filingId],
  );
  if (!rows[0]) throw notFound('Report not found');
  return rows[0];
}

async function verify({ filingId, contentHash = null, signature = null }) {
  const report = await getReport(filingId);
  const recomputed = sha256(canonical(report.payload));
  const key = await ensureSigningKey();
  const storedSignatureOk = signature ? verifySignature(key.publicKey, report.content_hash, signature) : null;
  return {
    filingId,
    payloadUnmodified: recomputed === report.content_hash,
    storedSignatureValid: verifySignature(key.publicKey, report.content_hash, report.signature),
    providedSignatureValid: storedSignatureOk,
    contentHash: report.content_hash,
    recomputedHash: recomputed,
    submittedHashMatches: contentHash ? contentHash === report.content_hash : null,
  };
}

/** CTR extract for a single day — file with the FIU when a threshold is crossed. */
async function ctrExtract({ date }) {
  if (!date) throw badRequest('date is required (YYYY-MM-DD)');
  const { rows } = await db.query(
    `select t.reference, t.initiated_at, t.total_debit_qar_minor, t.payout_currency, t.payout_amount_minor,
            t.country_code, t.purpose_code, t.status, t.risk_level,
            c.public_ref, c.full_name, c.nationality, c.qid_last4,
            b.full_name as beneficiary_name, b.institution_name, b.account_number_last4
       from transfers t
       join customers c on c.id = t.customer_id
       join beneficiaries b on b.id = t.beneficiary_id
      where t.initiated_at >= $1::date and t.initiated_at < ($1::date + interval '1 day')
        and t.total_debit_qar_minor >= afrisend_setting_int('ctr.threshold_qar_minor')
      order by t.initiated_at`,
    [date],
  );
  const { rows: [thresholdRow] } = await db.query(
    "select afrisend_setting_int('ctr.threshold_qar_minor') as threshold_minor",
  );
  await audit.record({
    actorType: 'SYSTEM', action: 'CTR_EXTRACT_GENERATED', entityType: 'report',
    entityId: date, metadata: { rows: rows.length, thresholdMinor: thresholdRow.threshold_minor },
  });
  return { date, thresholdQar: Number(thresholdRow.threshold_minor) / 100, rows };
}

module.exports = { generateQcbReport, listReports, getReport, verify, ctrExtract, ensureSigningKey };
