'use strict';
/**
 * Provider webhooks.
 *
 * Flutterwave v3 sends the configured "secret hash" in the `verif-hash` header;
 * newer accounts also receive `flutterwave-signature`, an HMAC-SHA256 of the raw
 * body keyed with that same secret. Both are verified (constant time) and the
 * raw body is used for the HMAC — never the re-serialised JSON.
 *
 * Rules:
 *   - an unsigned or badly signed call is rejected with 401 and recorded;
 *   - every accepted call is stored in `webhook_events` (dedupe key prevents
 *     double-processing when Flutterwave retries);
 *   - the body is never trusted for amounts: we look up OUR record by reference
 *     and only apply a status transition;
 *   - we always answer 200 once the event is durably stored, so the provider
 *     does not hammer the endpoint, and failures are visible in the console.
 */
const express = require('express');
const crypto = require('crypto');
const db = require('../db/pool');
const { env } = require('../config/env');
const { timingSafeEquals } = require('../lib/crypto');
const audit = require('../services/audit');
const sse = require('../services/sse');
const transfers = require('../services/transfers');
const customers = require('../services/customers');
const log = require('../lib/logger');
const { webhookLimiter } = require('../middleware/rateLimit');

const router = express.Router();

function verifyFlutterwaveSignature(req) {
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const verifHash = req.get('verif-hash') || req.get('Verif-Hash');
  const signature = req.get('flutterwave-signature') || req.get('Flutterwave-Signature');

  const hashOk = verifHash ? timingSafeEquals(verifHash, env.FLW_WEBHOOK_HASH) : false;
  const hmacOk = signature
    ? timingSafeEquals(
      signature,
      crypto.createHmac('sha256', env.FLW_WEBHOOK_HASH).update(raw).digest('base64'),
    )
    : false;

  return { verified: hashOk || hmacOk, method: hmacOk ? 'hmac' : hashOk ? 'verif-hash' : 'none' };
}

router.post('/flutterwave', webhookLimiter, async (req, res) => {
  const check = verifyFlutterwaveSignature(req);
  const body = req.body || {};
  const eventType = String(body['event.type'] || body.event || 'unknown');
  const eventId = String(
    body['event.id'] || body.data?.id || body.data?.tx_ref || body.data?.reference || '',
  );

  // 1. Persist first (audit + idempotency), even for rejected calls.
  let eventRow;
  try {
    const { rows } = await db.query(
      `insert into webhook_events (provider, event_type, provider_event_id, signature_ok, raw_headers, payload)
       values ('FLUTTERWAVE', $1, $2, $3, $4, $5)
       on conflict (provider, provider_event_id, event_type) where provider_event_id is not null
       do nothing
       returning id`,
      [eventType, eventId || null, check.verified,
        JSON.stringify({ 'verif-hash': req.get('verif-hash') ? '[present]' : null, signature: req.get('flutterwave-signature') ? '[present]' : null }),
        body],
    );
    eventRow = rows[0];
  } catch (err) {
    log.error('webhook persist failed', { err: err.message, eventType });
  }

  if (!check.verified) {
    await audit.record({
      actorType: 'WEBHOOK', action: 'WEBHOOK_SIGNATURE_REJECTED', entityType: 'webhook_event',
      entityId: eventRow?.id || null, severity: 'CRITICAL', ip: req.ip,
      metadata: { provider: 'FLUTTERWAVE', eventType, eventId },
    });
    return res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed' } });
  }

  if (!eventRow) {
    // Duplicate delivery: already stored → already handled.
    return res.status(200).json({ success: true, duplicate: true, eventType });
  }

  // 2. Apply the event.
  let result;
  try {
    result = await applyFlutterwaveEvent({ eventType, body, ip: req.ip });
    await db.query(
      `update webhook_events set processed_at = now(), processing_result = $2 where id = $1`,
      [eventRow.id, JSON.stringify(result)],
    );
  } catch (err) {
    result = { processed: false, error: err.message };
    log.error('webhook processing failed', { err: err.message, eventType, eventId, webhookEventId: eventRow.id });
    await db.query('update webhook_events set error = $2, processed_at = now() where id = $1', [eventRow.id, err.message]);
    await audit.record({
      actorType: 'WEBHOOK', action: 'WEBHOOK_PROCESSING_FAILED', entityType: 'webhook_event',
      entityId: eventRow.id, severity: 'ERROR', metadata: { eventType, error: err.message },
    });
  }

  sse.broadcast('webhook_received', { provider: 'FLUTTERWAVE', eventType, eventId, result });
  return res.status(200).json({ success: true, eventType, ...result });
});

async function applyFlutterwaveEvent({ eventType, body, ip }) {
  const data = body.data || {};
  const type = eventType.toLowerCase();

  // ---- Collections (wallet funding) -------------------------------------
  const isCharge = type.startsWith('charge') || type.includes('payment');
  if (isCharge) {
    const reference = data.tx_ref || data.reference;
    const succeeded = ['successful', 'success', 'completed'].includes(String(data.status || '').toLowerCase());
    if (!reference) return { processed: false, reason: 'NO_REFERENCE' };
    if (!succeeded) return { processed: false, reason: `STATUS_${data.status}` };

    const outcome = await customers.settleFunding({
      reference, providerTransactionId: data.id, payload: data,
    });
    return { processed: outcome.applied, ...outcome };
  }

  // ---- Payouts ----------------------------------------------------------
  const isTransfer = type.startsWith('transfer');
  if (isTransfer) {
    const reference = data.reference || data.tx_ref || data.merchant_reference;
    if (!reference) return { processed: false, reason: 'NO_REFERENCE' };
    const status = String(data.status || '').toUpperCase();
    const outcome = await transfers.applyProviderResult({
      reference,
      provider: 'FLUTTERWAVE',
      providerReference: data.id ? String(data.id) : null,
      providerStatus: status || 'PROCESSING',
      payload: data,
      source: 'WEBHOOK',
    });
    if (!outcome.unchanged) {
      const { rows } = await db.query(
        `select c.phone_e164, t.reference, t.status from transfers t
          join customers c on c.id = t.customer_id where t.reference = $1`,
        [reference],
      );
      if (rows[0]) {
        const money = require('../lib/money');
        const { rows: [full] } = await db.query(
          'select payout_amount_minor, payout_currency from transfers where reference = $1', [reference],
        );
        require('../services/notifications').notifyTransfer(
          { id: outcome.customerId, phone_e164: rows[0].phone_e164 },
          {
            reference, status: outcome.status,
            payoutFormatted: money.formatWithCurrency(full.payout_amount_minor, full.payout_currency),
          },
        ).catch(() => {});
      }
    }
    return { processed: !outcome.unchanged, ...outcome };
  }

  return { processed: false, reason: `UNHANDLED_EVENT_${eventType}` };
}

// ---------------------------------------------------------------------------
// Ria Money Transfer
// ---------------------------------------------------------------------------
function verifyRiaSignature(req) {
  if (!env.RIA_WEBHOOK_SECRET) return { verified: false, method: 'not_configured' };
  const signature = req.get('x-ria-signature');
  if (!signature) return { verified: false, method: 'missing' };
  const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});
  const expected = crypto.createHmac('sha256', env.RIA_WEBHOOK_SECRET).update(raw).digest('hex');
  return { verified: timingSafeEquals(signature, expected), method: 'hmac' };
}

router.post('/ria', webhookLimiter, async (req, res) => {
  const check = verifyRiaSignature(req);
  const body = req.body || {};
  const eventType = String(body.event || body.status || 'unknown');
  const eventId = String(body.transactionId || body.id || body.clientReference || '');

  const { rows } = await db.query(
    `insert into webhook_events (provider, event_type, provider_event_id, signature_ok, payload)
     values ('RIA', $1, $2, $3, $4)
     on conflict (provider, provider_event_id, event_type) where provider_event_id is not null
     do nothing returning id`,
    [eventType, eventId || null, check.verified, body],
  );

  if (!check.verified) {
    await audit.record({
      actorType: 'WEBHOOK', action: 'WEBHOOK_SIGNATURE_REJECTED', entityType: 'webhook_event',
      entityId: rows[0]?.id || null, severity: 'CRITICAL', ip: req.ip,
      metadata: { provider: 'RIA', eventType, eventId, method: check.method },
    });
    return res.status(401).json({ success: false, error: { code: 'INVALID_SIGNATURE' } });
  }
  if (!rows[0]) return res.status(200).json({ success: true, duplicate: true });

  try {
    const outcome = await transfers.applyProviderResult({
      reference: body.clientReference || body.reference,
      provider: 'RIA',
      providerReference: String(body.transactionId || body.id || ''),
      providerStatus: String(body.status || eventType).toUpperCase(),
      payload: body,
      source: 'WEBHOOK',
    });
    await db.query('update webhook_events set processed_at = now(), processing_result = $2 where id = $1',
      [rows[0].id, JSON.stringify(outcome)]);
    return res.status(200).json({ success: true, ...outcome });
  } catch (err) {
    await db.query('update webhook_events set error = $2, processed_at = now() where id = $1', [rows[0].id, err.message]);
    return res.status(200).json({ success: true, processed: false, error: err.message });
  }
});

module.exports = router;
