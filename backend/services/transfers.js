'use strict';
/**
 * Transfer orchestration — the only place money moves.
 *
 * Order of operations (all inside one database transaction):
 *   1. lock the quote, verify it belongs to the customer and has not expired
 *   2. verify the transaction PIN
 *   3. run the AML risk engine (sanctions, structuring, velocity, limits)
 *   4. either BLOCK (nothing moves), HOLD (funds to compliance suspense) or
 *      proceed with settlement journals
 *   5. write the transfer + status event + audit entry, broadcast to the console
 *
 * The provider call happens AFTER the commit (it is an external side effect);
 * the result is applied by `applyProviderResult`, which is also what the
 * Flutterwave webhook uses. That makes the webhook and the synchronous path
 * idempotent with respect to each other.
 */
const db = require('../db/pool');
const money = require('../lib/money');
const ledger = require('./ledger');
const aml = require('./aml');
const audit = require('./audit');
const fx = require('./fx');
const sse = require('./sse');
const engine = require('./remittanceEngine');
const notifications = require('./notifications');
const auth = require('./auth');
const log = require('../lib/logger');
const { badRequest, notFound, conflict, forbidden } = require('../lib/errors');

const MAX_RETRIES = 3;

async function usdRate(client) {
  const { rows } = await client.query(
    `select value #>> '{}' as rate from compliance_settings where key = 'fx.qar_per_usd'`,
  );
  return Number(rows[0]?.rate ?? 3.64);
}

/**
 * Create a transfer. `req` is the raw express request so we can capture IP/UA
 * for the audit trail and the AML file.
 */
async function createTransfer({ customerId, body, ip, userAgent, idempotencyKey }) {
  const result = await db.withTransaction(async (client) => {
    const { rows: customerRows } = await client.query(
      'select * from customers where id = $1 for update',
      [customerId],
    );
    const customer = customerRows[0];
    if (!customer) throw notFound('Customer not found');
    if (customer.status === 'SUSPENDED') throw forbidden('Your account is suspended. Contact support.');
    if (customer.status === 'CLOSED') throw forbidden('This account is closed.');
    if (customer.kyc_tier < 1) throw forbidden('Verify your identity before sending money.');

    const { rows: beneficiaryRows } = await client.query(
      'select * from beneficiaries where id = $1 and customer_id = $2 and is_active',
      [body.beneficiaryId, customerId],
    );
    const beneficiary = beneficiaryRows[0];
    if (!beneficiary) throw notFound('Beneficiary not found');

    // 1. quote
    const quote = await fx.lockQuote({ quoteId: body.quoteId, customerId, client });
    const corridor = await fx.getCorridor(quote.currency, client);

    // 2. PIN
    await auth.verifyTransactionPin(customerId, body.pin);

    // 3. wallet balance check (row locked above)
    const { rows: walletRows } = await client.query(
      'select * from wallets where customer_id = $1 for update', [customerId],
    );
    const wallet = walletRows[0];
    if (!wallet) throw notFound('Wallet not found');
    if (Number(wallet.available_minor) < Number(quote.total_debit_qar_minor)) {
      throw new (require('../lib/errors').AppError)(
        `Insufficient wallet balance. Top up ${money.formatWithCurrency(Number(quote.total_debit_qar_minor) - Number(wallet.available_minor), 'QAR')} to continue.`,
        { status: 422, code: 'INSUFFICIENT_FUNDS' },
      );
    }

    // 4. AML
    const assessment = await aml.assessTransfer({
      customer, beneficiary, corridor,
      amountQarMinor: Number(quote.total_debit_qar_minor),
      client,
    });

    if (assessment.decision === 'BLOCK') {
      const blocked = assessment.rules.filter((r) => r.effect === 'BLOCK');
      // Deliberately recorded on a separate connection: this audit entry must
      // survive the rollback of the transfer transaction below.
      await audit.record({
        actorType: 'CUSTOMER', actorId: customerId, action: 'TRANSFER_BLOCKED',
        entityType: 'customer', entityId: customerId, severity: 'HIGH', ip, userAgent,
        metadata: { rules: blocked, quote: quote.reference },
      });
      throw new (require('../lib/errors').AppError)(
        blocked[0]?.detail || 'This transfer cannot be processed. Please contact support.',
        { status: 422, code: 'AML_BLOCKED', details: blocked },
      );
    }

    const provider = await engine.route({ countryCode: beneficiary.country_code, channel: beneficiary.channel, db: client });
    const reference = body.reference || `AFQ-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
    const isHold = assessment.decision === 'HOLD';

    const { rows: inserted } = await client.query(
      `insert into transfers
         (reference, customer_id, beneficiary_id, channel, send_amount_qar_minor, fee_qar_minor,
          total_debit_qar_minor, spread_qar_minor, cost_qar_minor, payout_currency, payout_amount_minor,
          base_rate, retail_rate, country_code, purpose_code, purpose_narrative, status, risk_level,
          screening_result, aml_hold_reason, provider, ip_address, user_agent, idempotency_key)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       returning *`,
      [
        reference, customerId, beneficiary.id, beneficiary.channel,
        quote.send_amount_qar_minor, quote.fee_qar_minor, quote.total_debit_qar_minor,
        quote.spread_qar_minor, quote.cost_qar_minor, quote.currency, quote.payout_amount_minor,
        quote.base_rate, quote.retail_rate, beneficiary.country_code,
        body.purposeCode || null, body.purposeNarrative || null,
        isHold ? 'AML_HOLD' : 'INITIATED',
        assessment.riskLevel,
        JSON.stringify({
          outcome: assessment.screening.outcome,
          bestScore: assessment.screening.bestScore,
          listsChecked: assessment.screening.listsChecked,
          matches: assessment.screening.matches,
        }),
        isHold ? aml.holdReason(assessment.rules) : null,
        provider,
        ip || null,
        userAgent ? String(userAgent).slice(0, 400) : null,
        idempotencyKey || null,
      ],
    );
    const transfer = inserted[0];

    await client.query('update fx_quotes set consumed_by_transfer = $2 where id = $1', [quote.id, transfer.id]);

    if (isHold) {
      await ledger.postAmlHoldSweep({ transfer, reference, client });
      await client.query('select afrisend_wallet_apply($1::uuid, $2::bigint)', [customerId, -Number(transfer.total_debit_qar_minor)]);
      await aml.openCase({
        customerId,
        transferId: transfer.id,
        triggerRule: assessment.rules.find((r) => r.effect !== 'ALLOW')?.rule || 'AML_HOLD',
        severity: assessment.riskLevel,
        details: { rules: assessment.rules, reference },
        client,
      });
    } else {
      await settleTransfer({ transfer, customerId, client, usdRate: await usdRate(client) });
    }

    await client.query(
      `insert into transfer_events (transfer_id, from_status, to_status, actor_type, actor_id, reason, metadata)
       values ($1, null, $2, 'CUSTOMER', $3, $4, $5)`,
      [transfer.id, transfer.status, customerId,
        isHold ? 'Held by AML rules' : 'Transfer created',
        JSON.stringify({ rules: assessment.rules.map((r) => r.rule) })],
    );

    await audit.record({
      client, actorType: 'CUSTOMER', actorId: customerId, action: 'TRANSFER_INITIATED',
      entityType: 'transfer', entityId: transfer.id, ip, userAgent,
      afterState: {
        reference, amount: money.toMajor(transfer.total_debit_qar_minor, 'QAR'),
        currency: transfer.payout_currency, payoutAmount: money.toMajor(transfer.payout_amount_minor, transfer.payout_currency),
        status: transfer.status, riskLevel: transfer.riskLevel, provider,
      },
      metadata: { rules: assessment.rules, quote: quote.reference },
    });

    return { transfer, customer, beneficiary, assessment };
  });

  const { transfer, customer, beneficiary } = result;
  sse.broadcast('transfer_created', {
    reference: transfer.reference,
    status: transfer.status,
    riskLevel: transfer.risk_level,
    amountQarMinor: Number(transfer.total_debit_qar_minor),
    payoutAmountMinor: Number(transfer.payout_amount_minor),
    payoutCurrency: transfer.payout_currency,
    customerRef: customer.public_ref,
    beneficiaryName: beneficiary.full_name,
    countryCode: transfer.country_code,
  });
  sse.broadcast('metrics_dirty', { reason: 'transfer_created' });

  if (transfer.status === 'INITIATED') {
    // Fire and forget: the provider call must not block the customer's response.
    dispatchToProvider(transfer.id).catch((err) => log.error('provider dispatch failed', { err: err.message, reference: transfer.reference }));
  } else {
    notifications.notifyTransfer(customer, {
      reference: transfer.reference, status: transfer.status,
    }).catch(() => {});
  }

  return presentTransfer(transfer, beneficiary, result.assessment);
}

/** Post the settlement + clearing + disbursement journals for a released transfer. */
async function settleTransfer({ transfer, customerId, client, usdRate: rate }) {
  const reference = transfer.reference;
  await ledger.postTransferSettlement({ transfer, reference, postedBy: `customer:${customerId}`, client });

  const usdCostMinor = money.divideByRate(Number(transfer.cost_qar_minor), rate);
  await ledger.postPayoutClearing({
    transfer, reference, usdCostMinor, qarPerUsdMinor: money.toMinor(rate, 'QAR'), client,
  });
  await ledger.postPayoutDisbursement({ transfer, reference, client });

  await client.query(
    `select afrisend_wallet_apply($1::uuid, $2::bigint)`,
    [customerId, -Number(transfer.total_debit_qar_minor)],
  );
}

/**
 * Treasury guard: never instruct a payout in a currency whose float cannot
 * cover it. The transfer stays queued, an alert is raised, and the housekeeping
 * job re-dispatches it automatically once Treasury funds the float (through the
 * maker-checker top-up flow). This is what stops a rail from rejecting a batch
 * mid-flight and is exactly how float management is done in practice.
 */
async function assertFloatAvailable({ transfer, client }) {
  const { rows } = await client.query(
    `select coalesce(sum(case when e.direction = 'DEBIT' then e.amount_minor else -e.amount_minor end), 0)::bigint as balance_minor
       from ledger_accounts a
       left join ledger_entries e on e.account_id = a.id
      where a.is_float_account and a.currency = $1`,
    [transfer.payout_currency],
  );
  const balance = Number(rows[0]?.balance_minor || 0);
  const needed = Number(transfer.payout_amount_minor);
  return { sufficient: balance >= needed, balanceMinor: balance, neededMinor: needed };
}

/** Call the rail for a transfer that is INITIATED. */
async function dispatchToProvider(transferId) {
  const { rows } = await db.query(
    `select t.*, b.full_name as beneficiary_name, b.account_number_encrypted, b.institution_code,
            b.institution_name, b.resolved_name, c.public_ref, c.full_name as customer_name
       from transfers t
       join beneficiaries b on b.id = t.beneficiary_id
       join customers c on c.id = t.customer_id
      where t.id = $1`,
    [transferId],
  );
  const transfer = rows[0];
  if (!transfer) throw notFound('Transfer not found');
  if (transfer.status !== 'INITIATED') return transfer;

  const floatCheck = await assertFloatAvailable({ transfer, client: db });
  if (!floatCheck.sufficient) {
    await db.query(
      `update transfers set provider_status = 'AWAITING_FLOAT', updated_at = now() where id = $1`,
      [transfer.id],
    );
    await audit.record({
      actorType: 'SYSTEM', action: 'PAYOUT_QUEUED_FLOAT_SHORTFALL', entityType: 'transfer',
      entityId: transfer.id, severity: 'HIGH',
      metadata: {
        reference: transfer.reference,
        currency: transfer.payout_currency,
        floatMinor: floatCheck.balanceMinor,
        requiredMinor: floatCheck.neededMinor,
      },
    });
    sse.broadcast('float_alert', {
      reference: transfer.reference,
      currency: transfer.payout_currency,
      floatMinor: floatCheck.balanceMinor,
      requiredMinor: floatCheck.neededMinor,
    });
    sse.broadcast('metrics_dirty', { reason: 'float_shortfall' });
    return transfer;
  }

  const { decryptPII } = require('../lib/crypto');
  const accountNumber = decryptPII(transfer.account_number_encrypted);

  const payout = await engine.executePayout({
    provider: transfer.provider,
    channel: transfer.channel,
    accountBank: transfer.institution_code,
    accountNumber,
    amountMajor: money.toMajor(transfer.payout_amount_minor, transfer.payout_currency),
    currency: transfer.payout_currency,
    countryCode: transfer.country_code,
    beneficiaryName: transfer.beneficiary_name,
    beneficiaryPhone: null,
    narrative: `AfriSend ${transfer.reference}`,
    reference: transfer.reference,
    senderName: transfer.customer_name,
    senderQid: null,
  });

  if (!payout.ok) {
    const retryable = payout.retryable && transfer.retry_count < MAX_RETRIES;
    if (retryable) {
      await db.query('update transfers set retry_count = retry_count + 1, updated_at = now() where id = $1', [transferId]);
      const delay = 2000 * 2 ** transfer.retry_count;
      setTimeout(() => dispatchToProvider(transferId).catch(() => {}), delay);
      return transfer;
    }
    await failTransfer({ transferId, reason: payout.error, code: 'PROVIDER_REJECTED' });
    return transfer;
  }

  await applyProviderResult({
    reference: transfer.reference,
    provider: payout.provider,
    providerReference: payout.providerReference,
    providerStatus: payout.providerStatus,
    payload: payout.raw,
    source: 'API',
  });
  return transfer;
}

/**
 * Shared by the synchronous dispatch and by the webhook.
 * Idempotent: replaying the same provider event changes nothing the second time.
 */
async function applyProviderResult({
  reference, provider, providerReference, providerStatus, payload, source = 'WEBHOOK',
}) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      'select * from transfers where reference = $1 for update', [reference],
    );
    const transfer = rows[0];
    if (!transfer) throw notFound(`Unknown transfer ${reference}`);

    const { rows: mapped } = await client.query(
      'select internal_status, is_terminal from afrisend_provider_status_to_internal($1,$2) as t(internal_status, is_terminal)',
      [provider, providerStatus],
    ).catch(() => ({ rows: [] }));

    const nextStatus = mapped[0]?.internal_status
      || (String(providerStatus).toUpperCase() === 'SUCCESSFUL' ? 'PAID' : 'PROCESSING');

    if (transfer.status === nextStatus) return { unchanged: true, status: nextStatus, transferId: transfer.id };
    if (['PAID', 'REFUNDED'].includes(transfer.status)) {
      return { unchanged: true, status: transfer.status, transferId: transfer.id, note: 'already terminal' };
    }

    await client.query(
      `update transfers
          set status = $2, provider = $3, provider_reference = coalesce($4, provider_reference),
              provider_status = $5, provider_payload = $6,
              processing_at = case when $2 = 'PROCESSING' then coalesce(processing_at, now()) else processing_at end,
              paid_at = case when $2 = 'PAID' then now() else paid_at end,
              failure_reason = case when $2 in ('FAILED') then $7 else failure_reason end,
              updated_at = now()
        where id = $1`,
      [transfer.id, nextStatus, provider, providerReference || null, providerStatus, payload || null,
        nextStatus === 'FAILED' ? (payload?.message || 'Provider reported failure') : null],
    );

    await client.query(
      `insert into transfer_events (transfer_id, from_status, to_status, actor_type, actor_id, reason, metadata)
       values ($1,$2,$3,'WEBHOOK',$4,$5,$6)`,
      [transfer.id, transfer.status, nextStatus, provider, `Provider status ${providerStatus}`,
        JSON.stringify({ providerReference, source })],
    );

    if (nextStatus === 'FAILED' || nextStatus === 'REFUNDED') {
      // The rail did not complete the payout: unwind the settlement, restore the
      // USD float and the partner's local-currency float, then refund the
      // customer. All three journals are required or the float drifts.
      const { rows: [rateSetting] } = await client.query(
        `select value #>> '{}' as rate from compliance_settings where key = 'fx.qar_per_usd'`,
      );
      const reversed = await ledger.postProviderReversal({
        transfer,
        reference,
        usdRate: Number(rateSetting?.rate ?? 3.64),
        postedBy: `provider:${provider}`,
        client,
      });
      await client.query(
        'select afrisend_wallet_apply($1::uuid, $2::bigint)',
        [transfer.customer_id, Number(transfer.total_debit_qar_minor)],
      );
      await audit.record({
        client, actorType: 'WEBHOOK',
        action: nextStatus === 'REFUNDED' ? 'TRANSFER_REFUNDED' : 'TRANSFER_FAILED',
        entityType: 'transfer', entityId: transfer.id, severity: 'WARNING',
        metadata: { reference, provider, status: providerStatus, reversed },
      });
    }

    return { unchanged: false, status: nextStatus, transferId: transfer.id, customerId: transfer.customer_id };
  });
}

/**
 * Fail a payout that never reached the rail (or that the rail rejected outright).
 *
 * The customer's money MUST come back. The earlier version of this function
 * flipped the status to FAILED and called the wallet function with a zero delta,
 * which left the debit standing against the customer while the transfer was
 * marked failed — the worst possible outcome for a remittance customer.
 *
 * It now runs inside one transaction: reverse the settlement and the float
 * consumption (which credits the customer wallet), then mark the transfer
 * failed and clear the rail state.
 */
async function failTransfer({ transferId, reason, code }) {
  const outcome = await db.withTransaction(async (client) => {
    const { rows } = await client.query('select * from transfers where id = $1 for update', [transferId]);
    const transfer = rows[0];
    if (!transfer) return null;
    if (['FAILED', 'REFUNDED', 'CANCELLED'].includes(transfer.status)) return null;

    const { rows: settled } = await client.query(
      `select 1 from ledger_journals where transfer_id = $1 and journal_type = 'TRANSFER_SETTLEMENT' limit 1`,
      [transferId],
    );

    let reversed = null;
    if (settled.length) {
      const { rows: [rateSetting] = [{}] } = await client.query(
        `select value #>> '{}' as rate from compliance_settings where key = 'fx.qar_per_usd'`,
      );
      reversed = await ledger.postProviderReversal({
        transfer,
        reference: transfer.reference,
        usdRate: Number(rateSetting?.rate ?? 3.64),
        postedBy: 'system:dispatch-failure',
        client,
      });
      await client.query(
        'select afrisend_wallet_apply($1::uuid, $2::bigint)',
        [transfer.customer_id, Number(transfer.total_debit_qar_minor)],
      );
    }

    await client.query(
      `update transfers
          set status = 'FAILED', failure_code = $2, failure_reason = $3,
              provider_status = null, updated_at = now()
        where id = $1`,
      [transferId, code, reason],
    );
    await client.query(
      `insert into transfer_events (transfer_id, from_status, to_status, actor_type, reason, metadata)
       values ($1,$2,'FAILED','SYSTEM',$3,$4)`,
      [transferId, transfer.status, reason, JSON.stringify({ code, reversed: Boolean(reversed) })],
    );
    await audit.record({
      client, actorType: 'SYSTEM', action: 'TRANSFER_FAILED', entityType: 'transfer', entityId: transferId,
      severity: 'ERROR',
      metadata: {
        reference: transfer.reference, reason, code,
        refunded: Boolean(reversed),
        refundAmountMinor: reversed ? Number(transfer.total_debit_qar_minor) : 0,
      },
    });
    return { reference: transfer.reference, customerId: transfer.customer_id, refunded: Boolean(reversed) };
  });

  if (!outcome) return;
  sse.broadcast('transfer_updated', { reference: outcome.reference, status: 'FAILED', reason, refunded: outcome.refunded });
  sse.broadcast('metrics_dirty', { reason: 'transfer_failed' });

  const { rows: [customer] } = await db.query('select * from customers where id = $1', [outcome.customerId]);
  if (customer && outcome.refunded) {
    notifications.notifyTransfer(customer, {
      reference: outcome.reference, status: 'REFUNDED', supportRef: outcome.reference,
    }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// MLRO actions on held transfers
// ---------------------------------------------------------------------------
async function releaseAmlHold({ transferReference, operator, note, ip, userAgent, client: providedClient = null }) {
  const run = async (client) => {
    const { rows } = await client.query(
      'select * from transfers where reference = $1 for update', [transferReference],
    );
    const transfer = rows[0];
    if (!transfer) throw notFound('Transfer not found');
    if (transfer.status !== 'AML_HOLD') throw conflict(`Transfer is ${transfer.status}, not on AML hold`);

    // Release the quarantined funds back to the wallet liability...
    await ledger.postAmlRelease({ transfer, reference: transfer.reference, postedBy: `operator:${operator.email}`, client });
    // ...and mirror it in the wallet balance, because settleTransfer() below
    // debits the wallet again as part of settlement. Without this mirror the
    // wallet column and the ledger liability diverge by the transfer amount
    // (the funds were debited at hold time and the release credited only one side).
    await client.query(
      'select afrisend_wallet_apply($1::uuid, $2::bigint)',
      [transfer.customer_id, Number(transfer.total_debit_qar_minor)],
    );

    await settleTransfer({
      transfer: { ...transfer, status: 'PROCESSING' },
      customerId: transfer.customer_id,
      client,
      usdRate: await usdRate(client),
    });

    await client.query(
      `update transfers
          set status = 'INITIATED', aml_released_by = $2, aml_released_at = now(), updated_at = now()
        where id = $1`,
      [transfer.id, operator.id],
    );
    await client.query(
      `insert into transfer_events (transfer_id, from_status, to_status, actor_type, actor_id, reason)
       values ($1,'AML_HOLD','INITIATED','OPERATOR',$2,$3)`,
      [transfer.id, operator.email, note || 'AML hold released by MLRO'],
    );
    await client.query(
      `update aml_cases set status = 'CLOSED_NO_ACTION', closed_at = now(), closed_by = $2, resolution_note = $3
        where transfer_id = $1 and status in ('OPEN','ESCALATED')`,
      [transfer.id, operator.id, note || 'Released after review'],
    );

    await audit.record({
      client, actorType: 'OPERATOR', actorId: operator.id, actorEmail: operator.email,
      actorRole: operator.role, action: 'AML_HOLD_RELEASED', entityType: 'transfer',
      entityId: transfer.id, severity: 'HIGH', ip, userAgent, metadata: { note, reference: transfer.reference },
    });

    return { reference: transfer.reference, status: 'INITIATED', transferId: transfer.id, dispatch: true };
  };
  return providedClient ? run(providedClient) : db.withTransaction(run);
}

async function blockTransfer({ transferReference, operator, note, ip, userAgent, client: providedClient = null }) {
  const run = async (client) => {
    const { rows } = await client.query('select * from transfers where reference = $1 for update', [transferReference]);
    const transfer = rows[0];
    if (!transfer) throw notFound('Transfer not found');
    if (!['AML_HOLD', 'INITIATED', 'PROCESSING'].includes(transfer.status)) {
      throw conflict(`Transfer is ${transfer.status} and can no longer be blocked`);
    }
    if (transfer.status === 'AML_HOLD') {
      await ledger.postRefund({ transfer: { ...transfer, status: 'AML_HOLD' }, reference: transfer.reference, postedBy: `operator:${operator.email}`, client });
      await client.query('select afrisend_wallet_apply($1::uuid, $2::bigint)', [transfer.customer_id, Number(transfer.total_debit_qar_minor)]);
    }
    await client.query(
      `update transfers set status = 'CANCELLED', aml_hold_reason = coalesce(aml_hold_reason,'') || ' | BLOCKED: ' || $2, updated_at = now()
        where id = $1`,
      [transfer.id, note || 'Blocked by compliance'],
    );
    await client.query(
      `insert into transfer_events (transfer_id, from_status, to_status, actor_type, actor_id, reason)
       values ($1,$2,'CANCELLED','OPERATOR',$3,$4)`,
      [transfer.id, transfer.status, operator.email, note || 'Blocked by compliance'],
    );
    await client.query(
      `update aml_cases set status = 'CLOSED_ACTIONED', closed_at = now(), closed_by = $2, resolution_note = $3
        where transfer_id = $1 and status in ('OPEN','ESCALATED')`,
      [transfer.id, operator.id, note || 'Blocked and funds returned'],
    );
    await audit.record({
      client, actorType: 'OPERATOR', actorId: operator.id, actorEmail: operator.email,
      actorRole: operator.role, action: 'TRANSFER_BLOCKED_BY_COMPLIANCE', entityType: 'transfer',
      entityId: transfer.id, severity: 'CRITICAL', ip, userAgent, metadata: { note },
    });
    return { reference: transfer.reference, status: 'CANCELLED' };
  };
  return providedClient ? run(providedClient) : db.withTransaction(run);
}

// ---------------------------------------------------------------------------
// Read models
// ---------------------------------------------------------------------------
function presentTransfer(row, beneficiary = null, assessment = null) {
  const transfer = {
    reference: row.reference,
    status: row.status,
    riskLevel: row.risk_level,
    channel: row.channel,
    countryCode: row.country_code,
    payoutCurrency: row.payout_currency,
    provider: row.provider,
    providerReference: row.provider_reference,
    // Internal rail state, e.g. AWAITING_FLOAT when the payout is queued because
    // the payout-currency float cannot cover it yet.
    providerStatus: row.provider_status,
    sendAmountQarMinor: Number(row.send_amount_qar_minor),
    feeQarMinor: Number(row.fee_qar_minor),
    totalDebitQarMinor: Number(row.total_debit_qar_minor),
    payoutAmountMinor: Number(row.payout_amount_minor),
    baseRate: Number(row.base_rate),
    retailRate: Number(row.retail_rate),
    amlHoldReason: row.aml_hold_reason,
    failureReason: row.failure_reason,
    purposeCode: row.purpose_code,
    initiatedAt: row.initiated_at,
    paidAt: row.paid_at,
    totals: {
      youSend: money.formatWithCurrency(row.send_amount_qar_minor, 'QAR'),
      fee: money.formatWithCurrency(row.fee_qar_minor, 'QAR'),
      totalDebit: money.formatWithCurrency(row.total_debit_qar_minor, 'QAR'),
      theyReceive: money.formatWithCurrency(row.payout_amount_minor, row.payout_currency),
      rate: `1 QAR = ${Number(row.retail_rate).toFixed(4)} ${row.payout_currency}`,
    },
  };
  if (beneficiary) {
    transfer.beneficiary = {
      id: beneficiary.id,
      name: beneficiary.full_name,
      institution: beneficiary.institution_name,
      accountLast4: beneficiary.account_number_last4,
      countryCode: beneficiary.country_code,
    };
  }
  if (assessment) transfer.riskAssessment = { decision: assessment.decision, rules: assessment.rules };
  return transfer;
}

/** Customer-facing list. */
async function listForCustomer({ customerId, limit = 50, status = null }) {
  const { rows } = await db.query(
    `select t.*, b.full_name as beneficiary_name, b.institution_name, b.account_number_last4, b.country_code as b_country
       from transfers t join beneficiaries b on b.id = t.beneficiary_id
      where t.customer_id = $1 and ($2::text is null or t.status::text = $2)
      order by t.initiated_at desc limit $3`,
    [customerId, status, Math.min(Number(limit) || 50, 200)],
  );
  return rows.map((row) => presentTransfer(row, {
    id: row.beneficiary_id,
    full_name: row.beneficiary_name,
    institution_name: row.institution_name,
    account_number_last4: row.account_number_last4,
    country_code: row.b_country,
  }));
}

async function findByReference({ reference, customerId = null }) {
  const { rows } = await db.query(
    `select t.*, b.full_name as beneficiary_name, b.institution_name, b.account_number_last4,
            (select json_agg(json_build_object(
                'from', e.from_status, 'to', e.to_status, 'at', e.created_at,
                'actor', e.actor_type, 'reason', e.reason) order by e.created_at)
               from transfer_events e where e.transfer_id = t.id) as timeline
       from transfers t join beneficiaries b on b.id = t.beneficiary_id
      where t.reference = $1 and ($2::uuid is null or t.customer_id = $2)`,
    [reference, customerId],
  );
  const row = rows[0];
  if (!row) throw notFound('Transfer not found');
  const present = presentTransfer(row, {
    id: row.beneficiary_id,
    full_name: row.beneficiary_name,
    institution_name: row.institution_name,
    account_number_last4: row.account_number_last4,
    country_code: row.country_code,
  });
  present.timeline = row.timeline || [];
  return present;
}

/** Console list with filters. */
async function listForConsole({ status, risk, country, search, limit = 100, offset = 0 }) {
  const { rows } = await db.query(
    `select t.id, t.reference, t.status, t.risk_level, t.channel, t.country_code, t.payout_currency,
            t.total_debit_qar_minor, t.payout_amount_minor, t.fee_qar_minor, t.spread_qar_minor,
            t.provider, t.provider_reference, t.aml_hold_reason, t.failure_reason,
            t.initiated_at, t.paid_at, t.purpose_code,
            c.public_ref as customer_ref, c.full_name as customer_name, c.kyc_tier, c.risk_level as customer_risk,
            b.full_name as beneficiary_name, b.institution_name, b.account_number_last4
       from transfers t
       join customers c on c.id = t.customer_id
       join beneficiaries b on b.id = t.beneficiary_id
      where ($1::text is null or t.status::text = $1)
        and ($2::text is null or t.risk_level::text = $2)
        and ($3::text is null or t.country_code = $3)
        and ($4::text is null or t.reference ilike '%'||$4||'%' or c.full_name ilike '%'||$4||'%'
             or b.full_name ilike '%'||$4||'%' or c.public_ref ilike '%'||$4||'%')
      order by t.initiated_at desc
      limit $5 offset $6`,
    [status || null, risk || null, country || null, search || null, Math.min(Number(limit) || 100, 500), Number(offset) || 0],
  );
  return rows;
}

/**
 * Housekeeping: re-dispatch transfers that were queued waiting for float, once
 * the float is funded. Safe to run repeatedly — dispatchToProvider re-checks
 * the float and the provider reference is idempotent on our side.
 */
async function retryAwaitingFloat({ limit = 50 } = {}) {
  const { rows } = await db.query(
    `select t.id from transfers t
      where t.status = 'INITIATED' and t.provider_status = 'AWAITING_FLOAT'
      order by t.initiated_at
      limit $1`,
    [limit],
  );
  let dispatched = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const before = await db.query('select status, provider_status from transfers where id = $1', [row.id]);
    // eslint-disable-next-line no-await-in-loop
    await dispatchToProvider(row.id).catch((err) => log.error('re-dispatch failed', { err: err.message }));
    // eslint-disable-next-line no-await-in-loop
    const after = await db.query('select status, provider_status from transfers where id = $1', [row.id]);
    // Counted as dispatched when the rail was actually called: either the status
    // moved on, or the waiting-for-float marker was cleared (a payout that the
    // rail rejected is still a dispatch attempt, and it is refunded).
    const beforeRow = before.rows[0] || {};
    const afterRow = after.rows[0] || {};
    if (afterRow.status !== 'INITIATED' || afterRow.provider_status !== beforeRow.provider_status) {
      dispatched += 1;
    }
  }
  return dispatched;
}

module.exports = {
  createTransfer, dispatchToProvider, retryAwaitingFloat, assertFloatAvailable, applyProviderResult, failTransfer,
  releaseAmlHold, blockTransfer, presentTransfer, listForCustomer, findByReference,
  listForConsole, settleTransfer,
};
