'use strict';
/**
 * Double-entry ledger posting.
 *
 * Contract
 *   postJournal() writes a journal through the `afrisend_post_journal` SQL
 *   function, which refuses to commit unless the legs balance:
 *     - single-currency journals must balance exactly in that currency;
 *     - cross-currency journals (buying USD float with QAR, for example) must
 *       balance once every leg is translated to QAR at the stated rate.
 *   `ledger_entries` is append-only at the database level. Mistakes are fixed
 *   with a reversing journal, never with an UPDATE.
 *
 * Journal types used by the platform
 *   WALLET_FUNDING        customer tops up: cash in, wallet liability up
 *   TRANSFER_SETTLEMENT   customer wallet down, fee + FX spread recognised,
 *                         payout partner payable created
 *   PAYOUT_CLEARING       the QAR payable is settled against the USD float we
 *                         consumed (cross-currency)
 *   PAYOUT_DISBURSEMENT   the local-currency float is reduced by the amount the
 *                         beneficiary received
 *   AML_HOLD_SWEEP        funds quarantined into the compliance suspense account
 *   AML_HOLD_RELEASE      reversing entry when the MLRO releases the transfer
 *   AML_HOLD_REFUND       funds returned to the customer wallet
 *   FLOAT_TOPUP           treasury wires value to a payout partner (cross-currency)
 *   PROVIDER_REVERSAL     rail returned the funds
 */
const db = require('../db/pool');
const money = require('../lib/money');
const log = require('../lib/logger');

const ACCOUNTS = {
  INBOUND_COLLECTION: '1000-QAR-INBOUND-COLLECTION',
  USD_PAYOUT_FLOAT: '1010-USD-PAYOUT-FLOAT',
  USD_RIA_ESCROW: '1011-USD-RIA-ESCROW',
  WALLET_LIABILITY: '2000-QAR-CUSTOMER-WALLET',
  AML_SUSPENSE: '2010-QAR-AML-SUSPENSE',
  PARTNER_PAYABLE: '2100-QAR-PAYOUT-PAYABLE',
  TREASURY_CAPITAL: '3000-QAR-TREASURY-CAPITAL',
  FEE_REVENUE: '4000-QAR-FEE-REVENUE',
  FX_SPREAD_REVENUE: '4010-QAR-FX-SPREAD-REVENUE',
  CHARGEBACK_EXPENSE: '5000-QAR-CHARGEBACK-EXPENSE',
};

async function ensureAccount({
  code, name, accountClass, currency, isFloat = false, client = db,
}) {
  const { rows } = await client.query(
    `insert into ledger_accounts (code, name, class, currency, is_float_account, is_system)
     values ($1,$2,$3,$4,$5,false)
     on conflict (code) do update set name = excluded.name
     returning id, code`,
    [code, name, accountClass, currency, isFloat],
  );
  return rows[0];
}

/** Per-currency float account for local payouts, e.g. 1012-NGN-PAYOUT-FLOAT. */
function localFloatAccount(currency) {
  return {
    code: `1012-${currency}-PAYOUT-FLOAT`,
    name: `${currency} Payout Float`,
    accountClass: 'ASSET',
    currency,
    isFloat: true,
  };
}

function clearingAccount(currency) {
  return {
    code: `6000-${currency}-FX-CLEARING`,
    name: `${currency} Cross-Currency Clearing`,
    accountClass: 'CLEARING',
    currency,
    isFloat: false,
  };
}

async function postJournal({
  reference,
  type,
  description,
  legs,
  transferId = null,
  customerId = null,
  crossCurrency = false,
  fxRate = null,
  postedBy = 'system',
  client = db,
}) {
  // Guarantee the accounts exist (idempotent upsert), inside the same tx.
  const seen = new Set();
  for (const leg of legs) {
    if (seen.has(leg.account)) continue;
    seen.add(leg.account);
    const meta = leg.accountMeta;
    if (meta) await ensureAccount({ ...meta, client });
  }

  const { rows } = await client.query(
    `select afrisend_post_journal($1,$2,$3,$4,$5,$6,$7,$8,$9) as id`,
    [reference, type, description, JSON.stringify(legs.map(({ account, direction, amountMinor, memo }) => ({
      account, direction, amount_minor: amountMinor, memo,
    }))), transferId, customerId, crossCurrency, fxRate, postedBy],
  );
  const journalId = rows[0].id;
  log.info('journal posted', { reference, type, legs: legs.length, crossCurrency });
  return journalId;
}

// ---------------------------------------------------------------------------
// Domain journals
// ---------------------------------------------------------------------------
function journalRef(base, suffix) {
  return `JRN-${base}${suffix ? `-${suffix}` : ''}`;
}

async function postWalletFunding({ funding, amountMinor, reference, postedBy = 'system', client }) {
  return postJournal({
    reference: journalRef(reference, 'FUND'),
    type: 'WALLET_FUNDING',
    description: `Wallet funding via ${funding.method}`,
    customerId: funding.customer_id,
    postedBy,
    client,
    legs: [
      { account: ACCOUNTS.INBOUND_COLLECTION, direction: 'DEBIT', amountMinor, memo: 'QAR received into collection vault' },
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'CREDIT', amountMinor, memo: 'Customer wallet credited' },
    ],
  });
}

/**
 * Customer sends money. Everything here is in QAR except the payout amount.
 */
async function postTransferSettlement({
  transfer, reference, postedBy = 'system', client,
}) {
  const total = Number(transfer.total_debit_qar_minor);
  const cost = Number(transfer.cost_qar_minor);
  const spread = Number(transfer.spread_qar_minor);
  const fee = Number(transfer.fee_qar_minor);
  if (total !== cost + spread + fee) {
    throw new Error(`Transfer ${reference} is not economically balanced: total ${total} != cost ${cost} + spread ${spread} + fee ${fee}`);
  }

  return postJournal({
    reference: journalRef(reference, 'SETTLE'),
    type: 'TRANSFER_SETTLEMENT',
    description: `Settlement for ${reference} (${transfer.payout_currency})`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'DEBIT', amountMinor: total, memo: 'Customer wallet debited' },
      { account: ACCOUNTS.PARTNER_PAYABLE, direction: 'CREDIT', amountMinor: cost, memo: 'Payout partner payable at interbank' },
      ...(spread > 0 ? [{ account: ACCOUNTS.FX_SPREAD_REVENUE, direction: 'CREDIT', amountMinor: spread, memo: 'Realised FX spread' }] : []),
      ...(fee > 0 ? [{ account: ACCOUNTS.FEE_REVENUE, direction: 'CREDIT', amountMinor: fee, memo: 'Remittance fee' }] : []),
    ],
  });
}

/** QAR payable settled against USD float consumed (cross-currency). */
async function postPayoutClearing({
  transfer, reference, usdCostMinor, qarPerUsdMinor, postedBy = 'provider', client,
}) {
  const clearing = clearingAccount('USD');
  return postJournal({
    reference: journalRef(reference, 'FX'),
    type: 'PAYOUT_CLEARING',
    description: `USD float consumed to settle ${reference}`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    crossCurrency: true,
    fxRate: money.toMajor(qarPerUsdMinor, 'QAR'),
    postedBy,
    client,
    legs: [
      {
        account: clearing.code, accountMeta: clearing, direction: 'DEBIT',
        amountMinor: usdCostMinor, memo: 'USD purchased to fund payout',
      },
      {
        account: ACCOUNTS.PARTNER_PAYABLE, direction: 'CREDIT',
        amountMinor: Number(transfer.cost_qar_minor), memo: 'Payable settled',
      },
    ],
  });
}

/** Local currency leaves the float when the beneficiary is credited. */
async function postPayoutDisbursement({
  transfer, reference, postedBy = 'provider', client,
}) {
  const currency = transfer.payout_currency;
  const float = localFloatAccount(currency);
  const clearing = clearingAccount(currency);
  const amount = Number(transfer.payout_amount_minor);
  return postJournal({
    reference: journalRef(reference, 'PAYOUT'),
    type: 'PAYOUT_DISBURSEMENT',
    description: `Beneficiary paid ${money.formatWithCurrency(amount, currency)} for ${reference}`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      { account: clearing.code, accountMeta: clearing, direction: 'DEBIT', amountMinor: amount, memo: 'Clearing position settled' },
      { account: float.code, accountMeta: float, direction: 'CREDIT', amountMinor: amount, memo: 'Local float disbursed' },
    ],
  });
}

async function postAmlHoldSweep({ transfer, reference, postedBy = 'system', client }) {
  return postJournal({
    reference: journalRef(reference, 'HOLD'),
    type: 'AML_HOLD_SWEEP',
    description: `AML hold: ${reference} quarantined pending MLRO review`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'DEBIT', amountMinor: Number(transfer.total_debit_qar_minor), memo: 'Wallet debited, funds quarantined' },
      { account: ACCOUNTS.AML_SUSPENSE, direction: 'CREDIT', amountMinor: Number(transfer.total_debit_qar_minor), memo: 'AML suspense' },
    ],
  });
}

async function postAmlRelease({ transfer, reference, postedBy, client }) {
  const amount = Number(transfer.total_debit_qar_minor);
  return postJournal({
    reference: journalRef(reference, 'RELEASE'),
    type: 'AML_HOLD_RELEASE',
    description: `MLRO released ${reference}; funds released into settlement`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      { account: ACCOUNTS.AML_SUSPENSE, direction: 'DEBIT', amountMinor: amount, memo: 'Suspense released' },
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'CREDIT', amountMinor: amount, memo: 'Returned to customer wallet for settlement' },
    ],
  });
}

/**
 * Full reversal when a payout does not complete (rail rejected it, or the rail
 * returned the funds).
 *
 * A FAILED payout must undo three things, not just refund the customer:
 *   1. the settlement + recognised fee/spread revenue  → customer refunded
 *   2. the USD float that was consumed to settle it     → float restored
 *   3. the local-currency disbursement                  → partner float restored
 *
 * Skipping 2 and 3 (which the earlier implementation did) left the float
 * permanently wrong: the partner showed as paid while the customer had been
 * refunded, so reconciliation and the QCB liquidity ratio drifted apart.
 */
async function postProviderReversal({
  transfer, reference, usdRate, postedBy = 'provider', client,
}) {
  const total = Number(transfer.total_debit_qar_minor);
  const cost = Number(transfer.cost_qar_minor);
  const spread = Number(transfer.spread_qar_minor);
  const fee = Number(transfer.fee_qar_minor);
  const currency = transfer.payout_currency;
  const payoutAmount = Number(transfer.payout_amount_minor);

  // 1. unwind the settlement and refund the customer in one balanced journal
  const settlementReversal = await postJournal({
    reference: journalRef(reference, 'REVERSAL'),
    type: 'PROVIDER_REVERSAL',
    description: `${reference} reversed; customer refunded`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      { account: ACCOUNTS.PARTNER_PAYABLE, direction: 'DEBIT', amountMinor: cost, memo: 'Payable unwound' },
      ...(spread > 0 ? [{ account: ACCOUNTS.FX_SPREAD_REVENUE, direction: 'DEBIT', amountMinor: spread, memo: 'Spread revenue reversed' }] : []),
      ...(fee > 0 ? [{ account: ACCOUNTS.FEE_REVENUE, direction: 'DEBIT', amountMinor: fee, memo: 'Fee revenue reversed' }] : []),
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'CREDIT', amountMinor: total, memo: 'Customer refunded' },
    ],
  });

  // 2. undo the USD float consumption (cross-currency, so translated to QAR)
  let fxReversal = null;
  if (usdRate && cost > 0) {
    const usdCostMinor = money.divideByRate(cost, usdRate);
    fxReversal = await postJournal({
      reference: journalRef(reference, 'FXREV'),
      type: 'PAYOUT_CLEARING_REVERSAL',
      description: `${reference}: USD float restored`,
      transferId: transfer.id,
      customerId: transfer.customer_id,
      crossCurrency: true,
      fxRate: usdRate,
      postedBy,
      client,
      legs: [
        { account: ACCOUNTS.USD_PAYOUT_FLOAT, direction: 'DEBIT', amountMinor: usdCostMinor, memo: 'USD float restored' },
        { account: ACCOUNTS.PARTNER_PAYABLE, direction: 'CREDIT', amountMinor: cost, memo: 'Payable re-established then cleared' },
      ],
    });
  }

  // 3. undo the local-currency disbursement
  let payoutReversal = null;
  if (currency !== 'QAR' && payoutAmount > 0) {
    const float = localFloatAccount(currency);
    const clearing = clearingAccount(currency);
    payoutReversal = await postJournal({
      reference: journalRef(reference, 'PAYREV'),
      type: 'PAYOUT_DISBURSEMENT_REVERSAL',
      description: `${reference}: ${currency} float restored`,
      transferId: transfer.id,
      customerId: transfer.customer_id,
      postedBy,
      client,
      legs: [
        { account: float.code, accountMeta: float, direction: 'DEBIT', amountMinor: payoutAmount, memo: 'Partner float restored' },
        { account: clearing.code, accountMeta: clearing, direction: 'CREDIT', amountMinor: payoutAmount, memo: 'Clearing unwound' },
      ],
    });
  }

  return { settlementReversal, fxReversal, payoutReversal };
}

/** Refund out of the AML suspense account (blocked before any payout). */
async function postRefund({ transfer, reference, postedBy = 'system', client }) {
  const amount = Number(transfer.total_debit_qar_minor);
  const fromSuspense = transfer.status === 'AML_HOLD';
  return postJournal({
    reference: journalRef(reference, 'REFUND'),
    type: fromSuspense ? 'AML_HOLD_REFUND' : 'PROVIDER_REVERSAL',
    description: `${reference} refunded to the customer wallet`,
    transferId: transfer.id,
    customerId: transfer.customer_id,
    postedBy,
    client,
    legs: [
      {
        account: fromSuspense ? ACCOUNTS.AML_SUSPENSE : ACCOUNTS.INBOUND_COLLECTION,
        direction: 'DEBIT', amountMinor: amount, memo: fromSuspense ? 'Suspense released' : 'Reversal settlement',
      },
      { account: ACCOUNTS.WALLET_LIABILITY, direction: 'CREDIT', amountMinor: amount, memo: 'Customer refunded' },
    ],
  });
}

/**
 * Treasury funds a payout partner (approved via maker-checker).
 * `fxRate` is expressed as QAR per 1 unit of `currency` so the cross-currency
 * journal can be validated in QAR terms.
 */
async function postFloatTopup({
  reference, pool, amountMajor, currency, fxRate = null, memo, postedBy, client,
}) {
  const amountMinor = money.toMinor(amountMajor, currency);

  let rate = fxRate;
  if (!rate) {
    if (currency === 'USD') {
      const { rows } = await client.query(
        `select value #>> '{}' as rate from compliance_settings where key = 'fx.qar_per_usd'`,
      );
      rate = Number(rows[0]?.rate ?? 3.64);
    } else {
      const { rows } = await client.query(
        'select base_rate from fx_corridors where currency = $1',
        [currency],
      );
      rate = Number(rows[0]?.base_rate ?? 0);
    }
  }
  if (!rate || rate <= 0) {
    throw Object.assign(new Error(`No QAR conversion rate available for ${currency}`), {
      status: 422, code: 'MISSING_FX_RATE',
    });
  }

  const qarMinor = money.multiplyByRate(amountMinor, rate);
  const isForeign = currency !== 'QAR';

  if (currency === 'USD') {
    return postJournal({
      reference: journalRef(reference, 'FLOAT'),
      type: 'FLOAT_TOPUP',
      description: memo || `Float top-up ${amountMajor} ${currency} → ${pool}`,
      crossCurrency: true,
      fxRate: rate,
      postedBy,
      client,
      legs: [
        { account: ACCOUNTS.USD_PAYOUT_FLOAT, direction: 'DEBIT', amountMinor, memo: 'USD float funded' },
        { account: ACCOUNTS.INBOUND_COLLECTION, direction: 'CREDIT', amountMinor: qarMinor, memo: 'QAR paid for USD float' },
      ],
    });
  }

  const float = localFloatAccount(currency);
  return postJournal({
    reference: journalRef(reference, 'FLOAT'),
    type: 'FLOAT_TOPUP',
    description: memo || `Float top-up ${amountMajor} ${currency} → ${pool}`,
    crossCurrency: isForeign,
    fxRate: isForeign ? rate : null,
    postedBy,
    client,
    legs: [
      { account: float.code, accountMeta: float, direction: 'DEBIT', amountMinor, memo: 'Local float funded' },
      { account: ACCOUNTS.INBOUND_COLLECTION, direction: 'CREDIT', amountMinor: qarMinor, memo: 'QAR funding source' },
    ],
  });
}

// ---------------------------------------------------------------------------
// Read models for the console
// ---------------------------------------------------------------------------
async function listJournals({ limit = 50, type = null, reference = null, customerId = null } = {}) {
  const { rows } = await db.query(
    `select j.*, t.reference as transfer_reference,
            (select count(*) from ledger_entries e where e.journal_id = j.id)::int as leg_count
       from ledger_journals j
       left join transfers t on t.id = j.transfer_id
      where ($1::text is null or j.journal_type = $1)
        and ($2::text is null or j.reference ilike '%' || $2 || '%'
             or t.reference ilike '%' || $2 || '%')
        and ($3::uuid is null or j.customer_id = $3)
      order by j.posted_at desc
      limit $4`,
    [type, reference, customerId, Math.min(Number(limit) || 50, 300)],
  );
  return rows;
}

async function entriesForJournal(journalId) {
  const { rows } = await db.query(
    `select e.id, e.direction, e.amount_minor, e.currency, e.qar_value_minor, e.memo, e.created_at,
            a.code as account_code, a.name as account_name, a.class as account_class
       from ledger_entries e join ledger_accounts a on a.id = e.account_id
      where e.journal_id = $1
      order by e.id`,
    [journalId],
  );
  return rows;
}

async function trialBalance() {
  const { rows } = await db.query('select * from v_trial_balance order by class, code');
  return rows;
}

async function balanceSheet() {
  const { rows } = await db.query('select * from afrisend_balance_sheet()');
  return rows;
}

/** The real accounting invariant: every journal balances (per currency, or in
 *  translated QAR terms when it is a cross-currency journal). */
async function booksIntegrity() {
  const { rows } = await db.query('select * from afrisend_books_integrity()');
  return rows[0];
}

/** Net position per currency — the FX exposure Treasury manages. */
async function currencyPositions() {
  const { rows } = await db.query('select * from afrisend_currency_positions()');
  return rows;
}

/** Payout currencies where the float cannot cover committed payouts. */
async function floatShortfalls() {
  const { rows } = await db.query('select * from afrisend_float_shortfalls()');
  return rows;
}

async function floatPositions() {
  const { rows } = await db.query('select * from afrisend_float_positions() order by account_code');
  return rows;
}

async function accountStatement({ accountCode, limit = 100 }) {
  const { rows } = await db.query(
    `select e.id, e.created_at, e.direction, e.amount_minor, e.currency, e.memo,
            j.reference as journal_reference, j.journal_type
       from ledger_entries e
       join ledger_accounts a on a.id = e.account_id
       join ledger_journals j on j.id = e.journal_id
      where a.code = $1
      order by e.id desc
      limit $2`,
    [accountCode, Math.min(Number(limit) || 100, 500)],
  );
  return rows;
}

module.exports = {
  ACCOUNTS, ensureAccount, localFloatAccount, clearingAccount, postJournal,
  postWalletFunding, postTransferSettlement, postPayoutClearing, postPayoutDisbursement,
  postAmlHoldSweep, postAmlRelease, postRefund, postProviderReversal, postFloatTopup,
  listJournals, entriesForJournal, trialBalance, balanceSheet, booksIntegrity,
  currencyPositions, floatShortfalls, floatPositions, accountStatement,
  journalRef,
};
