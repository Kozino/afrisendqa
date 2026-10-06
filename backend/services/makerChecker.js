'use strict';
/**
 * Maker-Checker / 4-eyes control.
 *
 * Sensitive operations are never executed when an operator requests them; they
 * are recorded as a request and executed only when a SECOND, different operator
 * approves. Both identities are stamped on the record and the database CHECK
 * constraint refuses maker == checker even if service code were bypassed.
 */
const db = require('../db/pool');
const audit = require('./audit');
const sse = require('./sse');
const ledger = require('./ledger');
const xray = require('../lib/logger');
const { badRequest, forbidden, notFound, conflict } = require('../lib/errors');
const { MAKER_CHECKER_REQUIRED } = require('../config/permissions');
const transfers = require('./transfers');

const HANDLERS = {
  FX_RATE_CHANGE: applyFxRateChange,
  FLOAT_TOPUP: applyFloatTopup,
  FLOAT_RECONCILIATION: applyFloatReconciliation,
  CUSTOMER_LIMIT_UPGRADE: applyLimitUpgrade,
  CUSTOMER_STATUS_CHANGE: applyStatusChange,
  AML_HOLD_RELEASE: applyAmlRelease,
  SANCTIONS_MATCH_CLEAR: applySanctionsClear,
  PROVIDER_RAIL_CHANGE: applyRailChange,
};

async function create({ type, title, payload, amountQarMinor = null, maker, note = null, client = db }) {
  if (!HANDLERS[type]) throw badRequest(`Unknown maker-checker request type "${type}"`);
  if (!MAKER_CHECKER_REQUIRED.has(type)) {
    throw badRequest(`"${type}" does not require maker-checker approval`);
  }

  const reference = `MC-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const { rows } = await client.query(
    `insert into maker_checker_requests
       (reference, request_type, title, payload, amount_qar_minor, maker_id, maker_email, maker_role, maker_note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
    [reference, type, title, payload, amountQarMinor, maker.id, maker.email, maker.role, note],
  );

  await audit.record({
    client, actorType: 'OPERATOR', actorId: maker.id, actorEmail: maker.email, actorRole: maker.role,
    action: 'MAKER_CHECKER_CREATED', entityType: 'maker_checker_request', entityId: rows[0].id,
    severity: 'WARNING', afterState: { reference, type, title, payload, amountQarMinor },
  });
  sse.broadcast('maker_checker_created', {
    reference, type, title, maker: maker.email, amountQarMinor, status: 'PENDING',
  });
  return rows[0];
}

async function list({ status = 'PENDING', limit = 100 } = {}) {
  const { rows } = await db.query(
    `select * from maker_checker_requests
      where ($1 = 'ALL' or status::text = $1)
      order by case when status = 'PENDING' then 0 else 1 end, created_at desc
      limit $2`,
    [status, Math.min(Number(limit) || 100, 300)],
  );
  return rows;
}

async function decide({ reference, action, checker, note = null, ip, userAgent }) {
  if (!['APPROVE', 'REJECT'].includes(action)) throw badRequest('action must be APPROVE or REJECT');

  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      'select * from maker_checker_requests where reference = $1 for update', [reference],
    );
    const request = rows[0];
    if (!request) throw notFound('Maker-checker request not found');
    if (request.status !== 'PENDING') throw conflict(`This request is already ${request.status}`);
    if (new Date(request.expires_at) < new Date()) {
      await client.query("update maker_checker_requests set status = 'EXPIRED' where id = $1", [request.id]);
      throw conflict('This request expired and must be re-raised');
    }

    // The 4-eyes rule: the approver must be a different human being.
    if (request.maker_id === checker.id) {
      // Separate connection on purpose — this must land even though we roll back.
      await audit.record({
        actorType: 'OPERATOR', actorId: checker.id, actorEmail: checker.email,
        actorRole: checker.role, action: 'MAKER_CHECKER_SELF_APPROVAL_BLOCKED',
        entityType: 'maker_checker_request', entityId: request.id, severity: 'CRITICAL', ip, userAgent,
        metadata: { reference, type: request.request_type },
      });
      throw forbidden('Four-eyes violation: you cannot approve a request you raised yourself.');
    }

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    let effect = null;

    if (action === 'APPROVE') {
      effect = await HANDLERS[request.request_type]({ request, checker, client });
    }

    await client.query(
      `update maker_checker_requests
          set status = $2, checker_id = $3, checker_email = $4, checker_role = $5, checker_note = $6, decided_at = now()
        where id = $1`,
      [request.id, status, checker.id, checker.email, checker.role, note],
    );

    await audit.record({
      client, actorType: 'OPERATOR', actorId: checker.id, actorEmail: checker.email,
      actorRole: checker.role, action: status === 'APPROVED' ? 'MAKER_CHECKER_APPROVED' : 'MAKER_CHECKER_REJECTED',
      entityType: 'maker_checker_request', entityId: request.id,
      severity: 'HIGH', ip, userAgent,
      beforeState: { status: 'PENDING', maker: request.maker_email },
      afterState: { status, checker: checker.email, note, effect },
    });
    sse.broadcast('maker_checker_decided', {
      reference, type: request.request_type, status, checker: checker.email, effect,
    });
    sse.broadcast('metrics_dirty', { reason: 'maker_checker_decided' });

    // A released transfer is dispatched only AFTER the decision has committed,
    // otherwise the dispatcher would read the pre-release status from another
    // connection and skip it (which left released transfers stuck in INITIATED).
    if (effect && effect.dispatch && effect.transferId) {
      transfers.dispatchToProvider(effect.transferId)
        .catch((err) => xray.error('post-release dispatch failed', { err: err.message, reference }));
    }

    return { reference, status, effect };
  });
}

// ---------------------------------------------------------------------------
// Effects — executed only after a second operator approves
// ---------------------------------------------------------------------------
async function applyFxRateChange({ request, checker, client }) {
  const { currency, baseRate, retailRate, reason } = request.payload || {};
  if (!currency || !baseRate || !retailRate) throw badRequest('FX_RATE_CHANGE payload needs currency, baseRate and retailRate');
  if (Number(retailRate) > Number(baseRate)) throw badRequest('retailRate cannot exceed baseRate');

  const { rows: before } = await client.query('select * from fx_corridors where currency = $1', [currency]);
  if (!before[0]) throw notFound(`No corridor for ${currency}`);

  await client.query(
    `update fx_corridors set base_rate = $2, retail_rate = $3, updated_by = $4, updated_at = now()
      where currency = $1`,
    [currency, baseRate, retailRate, checker.email],
  );
  await client.query(
    `insert into fx_rate_history (currency, base_rate, retail_rate, source, changed_by)
     values ($1,$2,$3,$4,$5)`,
    [currency, baseRate, retailRate, `MAKER_CHECKER:${request.reference}`, checker.email],
  );
  xray.info('fx rate changed', { currency, baseRate, retailRate, checker: checker.email });
  return {
    currency,
    previous: { baseRate: Number(before[0].base_rate), retailRate: Number(before[0].retail_rate) },
    current: { baseRate: Number(baseRate), retailRate: Number(retailRate) },
    reason: reason || null,
  };
}

/**
 * Fund a payout float.
 *
 * Two distinct cases, and conflating them would corrupt the treasury view:
 *
 *   currency === pool.currency  → a classic top-up of that pool: post the
 *                                 cross-currency journal and raise the pool row.
 *   currency !== pool.currency  → funding a LOCAL-CURRENCY payout float (KES,
 *                                 NGN, XOF…). The ledger float account for that
 *                                 currency is the source of truth; the USD pool
 *                                 row is deliberately NOT incremented, because
 *                                 adding 200,000 KES to a USD balance would be
 *                                 nonsense.
 */
async function applyFloatTopup({ request, checker, client }) {
  const { poolKey, amountMajor, currency, memo } = request.payload || {};
  if (!poolKey || !amountMajor) throw badRequest('FLOAT_TOPUP payload needs poolKey and amountMajor');

  const { rows } = await client.query('select * from liquidity_pools where key = $1 for update', [poolKey]);
  const pool = rows[0];
  if (!pool) throw notFound(`Liquidity pool ${poolKey} not found`);

  const topUpCurrency = String(currency || pool.currency).toUpperCase();
  const sameCurrency = topUpCurrency === pool.currency;

  const { rows: [corridor] } = await client.query(
    'select base_rate from fx_corridors where currency = $1', [topUpCurrency],
  );

  const journalId = await ledger.postFloatTopup({
    reference: request.reference,
    pool: poolKey,
    amountMajor,
    currency: topUpCurrency,
    fxRate: corridor ? Number(corridor.base_rate) : null,
    memo: memo || `Maker-checker float top-up ${request.reference}`,
    postedBy: `operator:${checker.email}`,
    client,
  });

  const amountMinor = require('../lib/money').toMinor(amountMajor, topUpCurrency);

  if (sameCurrency) {
    await client.query(
      'update liquidity_pools set balance_minor = balance_minor + $2, updated_at = now() where id = $1',
      [pool.id, amountMinor],
    );
  }

  return {
    poolKey,
    journalId,
    amountMinor: Number(amountMinor),
    currency: topUpCurrency,
    poolBalanceUpdated: sameCurrency,
    note: sameCurrency
      ? `Pool ${poolKey} increased by ${amountMinor} ${topUpCurrency} minor units.`
      : `Local ${topUpCurrency} payout float funded; pool row (${pool.currency}) left unchanged.`,
  };
}

async function applyFloatReconciliation({ request, checker, client }) {
  const { poolKey, observedMajor } = request.payload || {};
  const { rows } = await client.query('select * from liquidity_pools where key = $1 for update', [poolKey]);
  const pool = rows[0];
  if (!pool) throw notFound(`Liquidity pool ${poolKey} not found`);
  const observedMinor = require('../lib/money').toMinor(observedMajor, pool.currency);
  const deltaMinor = Number(observedMinor) - Number(pool.balance_minor);
  await client.query('update liquidity_pools set balance_minor = $2, updated_at = now() where id = $1', [pool.id, observedMinor]);
  if (deltaMinor !== 0) {
    await ledger.postJournal({
      reference: `${request.reference}-RECON`,
      type: 'FLOAT_RECONCILIATION',
      description: `Float reconciliation adjustment for ${poolKey}`,
      postedBy: `operator:${checker.email}`,
      client,
      crossCurrency: pool.currency !== 'QAR',
      fxRate: null,
      legs: [
        {
          account: pool.currency === 'USD' ? ledger.ACCOUNTS.USD_PAYOUT_FLOAT : ledger.clearingAccount(pool.currency).code,
          accountMeta: pool.currency === 'USD' ? undefined : ledger.clearingAccount(pool.currency),
          direction: deltaMinor > 0 ? 'DEBIT' : 'CREDIT',
          amountMinor: Math.abs(deltaMinor),
          memo: 'Reconciliation adjustment',
        },
        {
          account: ledger.ACCOUNTS.TREASURY_CAPITAL,
          direction: deltaMinor > 0 ? 'CREDIT' : 'DEBIT',
          amountMinor: Math.abs(deltaMinor),
          memo: 'Reconciliation adjustment counterpart',
        },
      ],
    });
  }
  return { poolKey, deltaMinor, observedMinor: Number(observedMinor) };
}

async function applyLimitUpgrade({ request, checker, client }) {
  const { customerRef, tier } = request.payload || {};
  const { rows } = await client.query('select id, kyc_tier from customers where public_ref = $1', [customerRef]);
  if (!rows[0]) throw notFound(`Customer ${customerRef} not found`);
  await client.query(
    "update customers set kyc_tier = $2, status = case when status = 'PENDING_KYC' then 'ACTIVE' else status end, updated_at = now() where id = $1",
    [rows[0].id, tier],
  );
  return { customerRef, previousTier: rows[0].kyc_tier, newTier: tier };
}

async function applyStatusChange({ request, checker, client }) {
  const { customerRef, status, reason } = request.payload || {};
  const { rows } = await client.query('select id, status from customers where public_ref = $1', [customerRef]);
  if (!rows[0]) throw notFound(`Customer ${customerRef} not found`);
  await client.query('update customers set status = $2, updated_at = now() where id = $1', [rows[0].id, status]);
  return { customerRef, previousStatus: rows[0].status, newStatus: status, reason };
}

async function applyAmlRelease({ request, checker, client }) {
  const { transferReference, note } = request.payload || {};
  const transfers = require('./transfers');
  return transfers.releaseAmlHold({
    transferReference, operator: checker, note: note || `Released by maker-checker ${request.reference}`,
    client, ip: null, userAgent: null,
  });
}

async function applySanctionsClear({ request, checker, client }) {
  const { transferReference, screeningId, justification } = request.payload || {};
  if (!justification || justification.length < 20) {
    throw badRequest('Clearing a sanctions match requires a written justification of at least 20 characters');
  }
  await client.query(
    `update screening_results set outcome = 'CLEAR' where id = $1`, [screeningId],
  );
  const transfers = require('./transfers');
  return transfers.releaseAmlHold({
    transferReference, operator: checker,
    note: `Sanctions match cleared: ${justification}`, client, ip: null, userAgent: null,
  });
}

async function applyRailChange({ request, checker, client }) {
  const { countryCode, channel, provider, priority = 100, isActive = true } = request.payload || {};
  const { rows } = await client.query(
    `insert into provider_rails (provider, channel, country_code, currency, priority, is_active)
     select $1, $2, $3, currency, $4, $5 from currencies where code = (
       select currency from fx_corridors where country_code = $3 limit 1)
     on conflict (provider, channel, country_code, institution_code)
       do update set priority = excluded.priority, is_active = excluded.is_active
     returning id`,
    [provider, channel, countryCode, priority, isActive],
  );
  return { countryCode, channel, provider, priority, isActive, railId: rows[0]?.id };
}

/** Housekeeping — call from a cron/mini-job. */
async function expireStale() {
  const { rows } = await db.query(
    `update maker_checker_requests set status = 'EXPIRED'
      where status = 'PENDING' and expires_at < now() returning reference`,
  );
  return rows.length;
}

module.exports = { create, list, decide, expireStale, HANDLERS };
