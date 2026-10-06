'use strict';
/**
 * KYC lifecycle.
 *
 * A submission is created by the app (document images go to object storage —
 * Supabase Storage — and only the path is stored here). The compliance console
 * reviews it. Tier upgrades change the customer's monthly limits and are written
 * to the audit trail.
 *
 * Liveness/face-match scores come from the device SDK; when they are absent the
 * request is forced into manual review rather than being auto-approved.
 */
const db = require('../db/pool');
const audit = require('./audit');
const screening = require('./screening');
const sse = require('./sse');
const { encryptPII, maskTail } = require('../lib/crypto');
const { badRequest, notFound, conflict, forbidden } = require('../lib/errors');

const DOCUMENT_TYPES = ['QID', 'PASSPORT', 'RESIDENCE_PERMIT', 'DRIVING_LICENCE'];

async function submit({ customerId, input }) {
  const { rows: customerRows } = await db.query('select * from customers where id = $1', [customerId]);
  const customer = customerRows[0];
  if (!customer) throw notFound('Customer not found');
  if (customer.status === 'SUSPENDED') throw forbidden('Your account is suspended.');

  if (!DOCUMENT_TYPES.includes(input.documentType)) {
    throw badRequest(`documentType must be one of ${DOCUMENT_TYPES.join(', ')}`);
  }
  if (!input.qidNumber && !input.documentNumber) throw badRequest('A document number is required');
  const documentNumber = input.qidNumber || input.documentNumber;

  const { rows: open } = await db.query(
    "select id from kyc_requests where customer_id = $1 and status in ('PENDING','IN_REVIEW') limit 1",
    [customerId],
  );
  if (open[0]) throw conflict('You already have a verification request in review');

  const screen = await screening.screenAndPersist({
    subjectType: 'CUSTOMER', subjectId: customerId, name: input.fullName || customer.full_name,
  });

  const { rows } = await db.query(
    `insert into kyc_requests
       (customer_id, requested_tier, document_type, document_number_encrypted, document_number_last4,
        document_expiry, liveness_score, face_match_score, document_quality, aml_name_screen, status)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning id, status, created_at`,
    [
      customerId,
      input.requestedTier || Math.min(3, (customer.kyc_tier || 0) + 1),
      input.documentType,
      encryptPII(documentNumber),
      String(documentNumber).slice(-4),
      input.documentExpiry || null,
      input.livenessScore ?? null,
      input.faceMatchScore ?? null,
      input.documentQuality ?? null,
      screen,
      screen.outcome === 'HIT' ? 'IN_REVIEW' : 'PENDING',
    ],
  );

  if (input.fullName && input.fullName !== customer.full_name) {
    await db.query('update customers set full_name = $2, updated_at = now() where id = $1', [customerId, input.fullName]);
  }
  if (input.nationality) {
    await db.query('update customers set nationality = $2, updated_at = now() where id = $1', [customerId, input.nationality]);
  }

  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'KYC_SUBMITTED',
    entityType: 'kyc_request', entityId: rows[0].id,
    afterState: {
      documentType: input.documentType, documentMasked: maskTail(documentNumber),
      requestedTier: input.requestedTier || null, screeningOutcome: screen.outcome, screeningScore: screen.bestScore,
    },
  });
  sse.broadcast('kyc_submitted', {
    kycId: rows[0].id, customerRef: customer.public_ref, customerName: input.fullName || customer.full_name,
    screeningOutcome: screen.outcome, screeningScore: screen.bestScore,
  });
  sse.broadcast('metrics_dirty', { reason: 'kyc_submitted' });

  return {
    id: rows[0].id,
    status: rows[0].status,
    screening: {
      outcome: screen.outcome,
      bestScore: screen.bestScore,
      listsChecked: screen.listsChecked,
    },
    submittedAt: rows[0].created_at,
    message: screen.outcome === 'HIT'
      ? 'Your submission needs a manual compliance review. We will contact you within 24 hours.'
      : 'Your documents were received. Verification usually completes within a few minutes.',
  };
}

async function status(customerId) {
  const { rows } = await db.query(
    `select k.id, k.requested_tier, k.document_type, k.document_number_last4, k.status,
            k.reviewer_note, k.created_at, k.reviewed_at, c.kyc_tier, c.status as customer_status
       from kyc_requests k join customers c on c.id = k.customer_id
      where k.customer_id = $1 order by k.created_at desc limit 5`,
    [customerId],
  );
  return rows.map((r) => ({
    id: r.id,
    requestedTier: r.requested_tier,
    documentType: r.document_type,
    documentMasked: r.document_number_last4 ? `••••${r.document_number_last4}` : null,
    status: r.status,
    reviewerNote: r.reviewer_note,
    currentTier: r.kyc_tier,
    submittedAt: r.created_at,
    reviewedAt: r.reviewed_at,
  }));
}

// ---------------------------------------------------------------------------
// Console side
// ---------------------------------------------------------------------------
async function queue({ status = 'PENDING', limit = 100 }) {
  const { rows } = await db.query(
    `select k.id, k.status, k.requested_tier, k.document_type, k.document_number_last4,
            k.document_expiry, k.liveness_score, k.face_match_score, k.document_quality,
            k.aml_name_screen, k.created_at,
            c.public_ref, c.full_name, c.phone_e164, c.kyc_tier as current_tier, c.risk_level, c.pep_flag,
            (select count(*) from transfers t where t.customer_id = c.id)::int as previous_transfers,
            (select coalesce(sum(total_debit_qar_minor),0) from transfers t
              where t.customer_id = c.id and t.status in ('PAID','PROCESSING'))::bigint as lifetime_volume_minor
       from kyc_requests k join customers c on c.id = k.customer_id
      where ($1 = 'ALL' or k.status::text = $1)
      order by k.created_at asc limit $2`,
    [status, Math.min(Number(limit) || 100, 300)],
  );
  return rows;
}

async function review({ kycId, operator, decision, tier, note, ip, userAgent }) {
  if (!['APPROVE', 'REJECT', 'ESCALATE'].includes(decision)) throw badRequest('decision must be APPROVE, REJECT or ESCALATE');

  return db.withTransaction(async (client) => {
    const { rows } = await client.query('select * from kyc_requests where id = $1 for update', [kycId]);
    const request = rows[0];
    if (!request) throw notFound('KYC request not found');
    if (['APPROVED', 'REJECTED'].includes(request.status)) throw conflict(`This request is already ${request.status}`);

    const nextStatus = decision === 'APPROVE' ? 'APPROVED' : decision === 'REJECT' ? 'REJECTED' : 'IN_REVIEW';
    const grantedTier = decision === 'APPROVE'
      ? Math.min(3, Math.max(Number(tier || request.requested_tier), 1))
      : null;

    await client.query(
      `update kyc_requests set status = $2, reviewer_id = $3, reviewer_note = $4, reviewed_at = now(), updated_at = now()
        where id = $1`,
      [kycId, nextStatus, operator.id, note || null],
    );

    if (grantedTier) {
      await client.query(
        `update customers
            set kyc_tier = greatest(kyc_tier, $2),
                status = case when status = 'PENDING_KYC' then 'ACTIVE' else status end,
                qid_expiry = coalesce($3, qid_expiry),
                qid_last4 = coalesce($4, qid_last4),
                updated_at = now()
          where id = $1`,
        [request.customer_id, grantedTier, request.document_expiry, request.document_number_last4],
      );
    }

    await audit.record({
      client, actorType: 'OPERATOR', actorId: operator.id, actorEmail: operator.email,
      actorRole: operator.role, action: `KYC_${decision}`, entityType: 'kyc_request',
      entityId: kycId, severity: decision === 'APPROVE' ? 'INFO' : 'WARNING', ip, userAgent,
      beforeState: { status: request.status },
      afterState: { status: nextStatus, grantedTier, note },
    });

    sse.broadcast('kyc_updated', {
      kycId, status: nextStatus, grantedTier, reviewer: operator.email,
    });
    sse.broadcast('metrics_dirty', { reason: 'kyc_reviewed' });

    return { id: kycId, status: nextStatus, grantedTier };
  });
}

module.exports = { submit, status, queue, review, DOCUMENT_TYPES };
