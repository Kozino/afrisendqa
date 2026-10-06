'use strict';
/**
 * Customer-side domain: profile, wallet, beneficiaries, funding.
 * PII is encrypted on write and only ever returned masked.
 */
const db = require('../db/pool');
const money = require('../lib/money');
const audit = require('./audit');
const sse = require('./sse');
const ledger = require('./ledger');
const engine = require('./remittanceEngine');
const { encryptPII, decryptPII, blindIndex, maskTail } = require('../lib/crypto');
const { badRequest, notFound, conflict } = require('../lib/errors');
const { normalizePhone } = require('./auth');

async function getProfile(customerId) {
  const { rows } = await db.query(
    `select c.*, w.available_minor, w.pending_minor, w.currency as wallet_currency, w.updated_at as wallet_updated_at
       from customers c left join wallets w on w.customer_id = c.id
      where c.id = $1`,
    [customerId],
  );
  const c = rows[0];
  if (!c) throw notFound('Customer not found');
  const monthly = await db.query('select afrisend_monthly_sent_qar($1) as sent', [customerId]);
  const limit = await db.query(
    `select value #>> '{}' as limit from compliance_settings where key = $1`,
    [`kyc.tier${c.kyc_tier}_monthly_limit_qar_minor`],
  );
  return {
    reference: c.public_ref,
    fullName: c.full_name,
    email: c.email,
    phone: c.phone_e164,
    nationality: c.nationality,
    status: c.status,
    kycTier: c.kyc_tier,
    riskLevel: c.risk_level,
    pepFlag: c.pep_flag,
    hasTransactionPin: Boolean(c.transaction_pin_hash),
    qidMasked: c.qid_last4 ? `••••${c.qid_last4}` : null,
    qidExpiry: c.qid_expiry,
    occupation: c.occupation,
    employer: c.employer,
    sourceOfFunds: c.source_of_funds,
    createdAt: c.created_at,
    wallet: {
      currency: c.wallet_currency || 'QAR',
      availableMinor: Number(c.available_minor || 0),
      pendingMinor: Number(c.pending_minor || 0),
      available: money.formatWithCurrency(c.available_minor || 0, c.wallet_currency || 'QAR'),
      updatedAt: c.wallet_updated_at,
    },
    limits: {
      monthlyLimitMinor: Number(limit.rows[0]?.limit ?? 0),
      monthlyLimit: money.formatWithCurrency(limit.rows[0]?.limit ?? 0, 'QAR'),
      monthToDateSentMinor: Number(monthly.rows[0].sent),
      monthToDateSent: money.formatWithCurrency(monthly.rows[0].sent, 'QAR'),
      remainingMinor: Math.max(0, Number(limit.rows[0]?.limit ?? 0) - Number(monthly.rows[0].sent)),
    },
  };
}

async function updateProfile(customerId, { fullName, email, nationality, occupation, employer, sourceOfFunds, address }) {
  const { rows } = await db.query(
    `update customers
        set full_name = coalesce($2, full_name),
            email = coalesce($3, email),
            nationality = coalesce($4, nationality),
            occupation = coalesce($5, occupation),
            employer = coalesce($6, employer),
            source_of_funds = coalesce($7, source_of_funds),
            address_encrypted = coalesce($8, address_encrypted),
            updated_at = now()
      where id = $1 returning *`,
    [customerId, fullName || null, email || null, nationality || null, occupation || null,
      employer || null, sourceOfFunds || null, address ? encryptPII(address) : null],
  );
  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'PROFILE_UPDATED',
    entityType: 'customer', entityId: customerId,
    afterState: { fullName, email, occupation, employer, sourceOfFunds },
  });
  return rows[0];
}

// ---------------------------------------------------------------------------
// Beneficiaries
// ---------------------------------------------------------------------------
async function listBeneficiaries(customerId) {
  const { rows } = await db.query(
    `select id, full_name, nickname, country_code, currency, channel, institution_code,
            institution_name, account_number_last4, resolved_name, name_match_score, created_at
       from beneficiaries where customer_id = $1 and is_active order by created_at desc`,
    [customerId],
  );
  return rows.map((b) => ({
    id: b.id,
    name: b.nickname || b.full_name,
    fullName: b.full_name,
    countryCode: b.country_code,
    currency: b.currency,
    channel: b.channel,
    institutionCode: b.institution_code,
    institutionName: b.institution_name,
    accountMasked: maskTail(b.account_number_last4, 4),
    resolvedName: b.resolved_name,
    nameMatchScore: b.name_match_score != null ? Number(b.name_match_score) : null,
    createdAt: b.created_at,
  }));
}

/**
 * Add a beneficiary. For bank/MoMo rails we resolve the account name with the
 * provider first and store the match score — this is the control that catches
 * the "wrong account number" and APP-fraud cases before money leaves.
 */
async function addBeneficiary(customerId, input) {
  const currency = input.currency.toUpperCase();
  const countryCode = input.countryCode.toUpperCase();

  if (input.channel !== 'RIA_CASH_PICKUP') {
    const resolution = await engine.resolveAccount({
      accountNumber: input.accountNumber,
      bankCode: input.institutionCode,
    });
    if (!resolution.ok) {
      throw badRequest(`We could not verify that account: ${resolution.error}`, { provider: resolution.provider });
    }
    input.resolvedName = resolution.accountName;
    // Composite name score (see services/screening.js for the documented policy).
    const score = require('./screening').nameScore(input.fullName, resolution.accountName) * 100;
    input.nameMatchScore = Number(score.toFixed(2));
  }

  const bidx = blindIndex(`${input.institutionCode || ''}:${input.accountNumber}`);
  const { rows } = await db.query(
    `insert into beneficiaries
       (customer_id, full_name, nickname, country_code, currency, channel, institution_code,
        institution_name, account_number_encrypted, account_number_last4, account_bidx,
        resolved_name, name_match_score)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (customer_id, account_bidx, institution_code) do update
       set full_name = excluded.full_name, nickname = excluded.nickname, is_active = true,
           resolved_name = excluded.resolved_name, name_match_score = excluded.name_match_score,
           updated_at = now()
     returning id, full_name, resolved_name, name_match_score, account_number_last4`,
    [
      customerId, input.fullName, input.nickname || null, countryCode, currency, input.channel,
      input.institutionCode || null, input.institutionName || null,
      encryptPII(input.accountNumber), input.accountNumber.slice(-4), bidx,
      input.resolvedName || null, input.nameMatchScore ?? null,
    ],
  );

  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'BENEFICIARY_ADDED',
    entityType: 'beneficiary', entityId: rows[0].id,
    afterState: {
      name: input.fullName, countryCode, currency, channel: input.channel,
      account: maskTail(input.accountNumber), resolvedName: input.resolvedName || null,
    },
  });
  return { ...rows[0], accountMasked: maskTail(input.accountNumber) };
}

async function deactivateBeneficiary(customerId, beneficiaryId) {
  const { rowCount } = await db.query(
    'update beneficiaries set is_active = false, updated_at = now() where id = $1 and customer_id = $2',
    [beneficiaryId, customerId],
  );
  if (!rowCount) throw notFound('Beneficiary not found');
  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'BENEFICIARY_REMOVED',
    entityType: 'beneficiary', entityId: beneficiaryId,
  });
  return { removed: true };
}

// ---------------------------------------------------------------------------
// Wallet funding
// ---------------------------------------------------------------------------
/** Card / bank collection: hand back a provider checkout URL. */
async function startFunding({ customerId, amountMajor, method }) {
  const { rows: customerRows } = await db.query('select * from customers where id = $1', [customerId]);
  const customer = customerRows[0];
  if (!customer) throw notFound('Customer not found');

  const amountMinor = money.toMinor(amountMajor, 'QAR');
  if (amountMinor < 1000) throw badRequest('Minimum top-up is 10.00 QAR');

  const reference = `FND-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 900 + 100)}`;
  const { rows } = await db.query(
    `insert into wallet_fundings (customer_id, wallet_id, method, amount_minor, currency, provider_ref, status)
     select $1, w.id, $2, $3, 'QAR', $4, 'PENDING' from wallets w where w.customer_id = $1
     returning id`,
    [customerId, method, amountMinor, reference],
  );

  const collection = await engine.initializeCollection({
    amountMajor: money.toMajor(amountMinor, 'QAR'),
    currency: 'QAR',
    customerEmail: customer.email || `${customer.public_ref}@customer.afrisend.qa`,
    customerPhone: customer.phone_e164,
    customerName: customer.full_name,
    reference,
    redirectUrl: `${process.env.PUBLIC_BASE_URL || ''}/fund/callback`,
    paymentOptions: method === 'CARD' ? 'card' : 'card,banktransfer',
  });

  if (!collection.ok) {
    await db.query('update wallet_fundings set status = $2 where id = $1', [rows[0].id, 'FAILED']);
    throw badRequest(`Could not start the payment: ${collection.error}`);
  }

  await db.query('update wallet_fundings set provider_payload = $2 where id = $1', [rows[0].id, JSON.stringify(collection.raw)]);
  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'WALLET_FUNDING_STARTED',
    entityType: 'wallet_funding', entityId: rows[0].id,
    afterState: { amount: money.toMajor(amountMinor, 'QAR'), method, reference },
  });

  return {
    fundingId: rows[0].id,
    reference,
    checkoutUrl: collection.checkoutUrl,
    amount: money.formatWithCurrency(amountMinor, 'QAR'),
    amountMinor,
  };
}

/** Called by the webhook when a collection succeeds. Idempotent. */
async function settleFunding({ reference, providerTransactionId, payload }) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      'select * from wallet_fundings where provider_ref = $1 for update', [reference],
    );
    const funding = rows[0];
    if (!funding) return { applied: false, reason: 'UNKNOWN_FUNDING_REFERENCE' };
    if (funding.status === 'SETTLED') return { applied: false, reason: 'ALREADY_SETTLED' };

    await client.query(
      `update wallet_fundings set status = 'SETTLED', settled_at = now(), provider_payload = $2 where id = $1`,
      [funding.id, payload || null],
    );
    await client.query('select afrisend_wallet_apply($1::uuid, $2::bigint)', [funding.customer_id, Number(funding.amount_minor)]);
    const journalId = await ledger.postWalletFunding({
      funding, amountMinor: Number(funding.amount_minor), reference, postedBy: 'webhook:flutterwave', client,
    });
    await client.query('update wallet_fundings set ledger_journal_id = $2 where id = $1', [funding.id, journalId]);

    await audit.record({
      client, actorType: 'WEBHOOK', action: 'WALLET_FUNDED', entityType: 'wallet_funding',
      entityId: funding.id, metadata: { reference, providerTransactionId, amountMinor: Number(funding.amount_minor) },
    });
    return { applied: true, customerId: funding.customer_id, amountMinor: Number(funding.amount_minor) };
  });
}

async function listFundings(customerId, limit = 50) {
  const { rows } = await db.query(
    `select id, method, amount_minor, currency, status, provider_ref, initiated_at, settled_at
       from wallet_fundings where customer_id = $1 order by initiated_at desc limit $2`,
    [customerId, Math.min(Number(limit) || 50, 200)],
  );
  return rows;
}

module.exports = {
  getProfile, updateProfile, listBeneficiaries, addBeneficiary, deactivateBeneficiary,
  startFunding, settleFunding, listFundings,
};
