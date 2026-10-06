'use strict';
/**
 * FX pricing and quotes.
 *
 *  - Rates live in `fx_corridors` and are changed ONLY through the
 *    Maker-Checker queue (a Treasury officer proposes, a second human approves).
 *  - A quote is priced once and stored; the transfer books exactly that quote,
 *    so a rate move between "review" and "confirm" cannot change what the
 *    customer was shown. Quotes expire (default 90s) and are single-use.
 *  - Spread revenue is the difference between what the customer pays (retail)
 *    and what the payout actually costs us (base). It is posted to the ledger,
 *    not hidden in a spreadsheet.
 */
const db = require('../db/pool');
const money = require('../lib/money');
const { badRequest, notFound, conflict } = require('../lib/errors');

async function corridors({ onlyActive = true } = {}) {
  const { rows } = await db.query(
    `select f.*, c.name as currency_name, c.exponent
       from fx_corridors f join currencies c on c.code = f.currency
      ${onlyActive ? 'where f.active' : ''}
      order by f.country_name`,
  );
  return rows.map(publicCorridor);
}

function publicCorridor(row) {
  return {
    id: row.id,
    currency: row.currency,
    currencyName: row.currency_name,
    country: row.country_name,
    countryCode: row.country_code,
    flag: row.flag,
    baseRate: Number(row.base_rate),
    retailRate: Number(row.retail_rate),
    spreadPercent: Number((((Number(row.base_rate) - Number(row.retail_rate)) / Number(row.base_rate)) * 100).toFixed(2)),
    minSendQar: money.toMajor(row.min_send_qar_minor, 'QAR'),
    maxSendQar: money.toMajor(row.max_send_qar_minor, 'QAR'),
    perTransferLimitQar: money.toMajor(row.per_txn_limit_qar_minor, 'QAR'),
    updatedAt: row.updated_at,
  };
}

async function getCorridor(currency, client = db) {
  const { rows } = await client.query(
    `select f.*, c.name as currency_name, c.exponent
       from fx_corridors f join currencies c on c.code = $1
      where f.currency = $1 and f.active limit 1`,
    [String(currency).toUpperCase()],
  );
  if (!rows[0]) throw notFound(`Corridor ${currency} is not open`);
  return rows[0];
}

async function feeFor(amountQarMinor, client = db) {
  const { rows } = await client.query(
    `select value #>> '{}' as fee from compliance_settings where key = 'aml.fee_qar_minor'`,
  );
  const flat = Number(rows[0]?.fee ?? 1000);
  // Flat fee, waived on small tickets under 100 QAR so the app is usable.
  return amountQarMinor < 10000 ? 0 : flat;
}

async function quoteTtlSeconds(client = db) {
  const { rows } = await client.query(
    `select value #>> '{}' as ttl from compliance_settings where key = 'fx.quote_ttl_seconds'`,
  );
  return Number(rows[0]?.ttl ?? 90);
}

/**
 * Price a transfer. Pure function of the corridor row + fee, all in minor units.
 *
 * `qarPerUsd` is the DECIMAL rate (3.64 QAR per 1 USD), not minor units — the
 * USD conversion divides QAR minor units by it to get USD cents. Passing a
 * minor-unit rate here produced a 100× error in the float leg of the ledger.
 */
function price({ sendAmountQarMinor, corridor, feeQarMinor, qarPerUsd }) {
  const send = BigInt(sendAmountQarMinor);
  const fee = BigInt(feeQarMinor);
  const total = send + fee;

  const payoutAmountMinor = money.multiplyByRate(Number(send), corridor.retail_rate);
  if (payoutAmountMinor <= 0) throw badRequest('Computed payout amount is zero');

  // What the payout costs us at the interbank rate we bought the currency at.
  const costQarMinor = money.divideByRate(payoutAmountMinor, corridor.base_rate);
  const spreadQarMinor = Number(send) - costQarMinor;
  if (spreadQarMinor < 0) {
    throw conflict('Corridor pricing is inconsistent: retail rate exceeds the base rate. Contact Treasury.');
  }
  if (!(Number(qarPerUsd) > 0)) {
    throw conflict('No QAR/USD rate is configured (compliance_settings.fx.qar_per_usd).');
  }
  const usdCostMinor = money.divideByRate(costQarMinor, qarPerUsd);

  return {
    sendAmountQarMinor: Number(send),
    feeQarMinor: Number(fee),
    totalDebitQarMinor: Number(total),
    payoutAmountMinor,
    payoutCurrency: corridor.currency,
    baseRate: Number(corridor.base_rate),
    retailRate: Number(corridor.retail_rate),
    costQarMinor,
    spreadQarMinor,
    usdCostMinor,
  };
}

async function createQuote({ customerId, currency, sendAmountQarMinor, countryCode = null, client = db }) {
  const corridor = await getCorridor(currency, client);
  if (sendAmountQarMinor < Number(corridor.min_send_qar_minor)) {
    throw badRequest(`Minimum send amount is ${money.toMajor(corridor.min_send_qar_minor, 'QAR')} QAR`);
  }
  if (sendAmountQarMinor > Number(corridor.max_send_qar_minor)) {
    throw badRequest(`Maximum send amount is ${money.toMajor(corridor.max_send_qar_minor, 'QAR')} QAR`);
  }

  const fee = await feeFor(sendAmountQarMinor, client);
  const { rows: [usdSetting] } = await client.query(
    `select value #>> '{}' as rate from compliance_settings where key = 'fx.qar_per_usd'`,
  );
  const qarPerUsd = Number(usdSetting?.rate ?? '3.64');

  const priced = price({ sendAmountQarMinor, corridor, feeQarMinor: fee, qarPerUsd });
  const ttl = await quoteTtlSeconds(client);

  const { rows } = await client.query(
    `insert into fx_quotes
       (reference, customer_id, currency, country_code, send_amount_qar_minor, fee_qar_minor,
        total_debit_qar_minor, payout_amount_minor, base_rate, retail_rate, spread_qar_minor,
        cost_qar_minor, expires_at)
     values ('QTE-' || upper(substr(md5(random()::text), 1, 12)), $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' seconds')::interval)
     returning *`,
    [customerId, corridor.currency, countryCode || corridor.country_code,
      priced.sendAmountQarMinor, priced.feeQarMinor, priced.totalDebitQarMinor,
      priced.payoutAmountMinor, priced.baseRate, priced.retailRate,
      priced.spreadQarMinor, priced.costQarMinor, String(ttl)],
  );

  return presentQuote(rows[0], corridor, { usdCostMinor: priced.usdCostMinor });
}

function presentQuote(row, corridor, extras = {}) {
  return {
    id: row.id,
    reference: row.reference,
    currency: row.currency,
    countryCode: row.country_code,
    country: corridor?.country_name,
    flag: corridor?.flag,
    sendAmountQarMinor: Number(row.send_amount_qar_minor),
    feeQarMinor: Number(row.fee_qar_minor),
    totalDebitQarMinor: Number(row.total_debit_qar_minor),
    payoutAmountMinor: Number(row.payout_amount_minor),
    baseRate: Number(row.base_rate),
    retailRate: Number(row.retail_rate),
    spreadQarMinor: Number(row.spread_qar_minor),
    costQarMinor: Number(row.cost_qar_minor),
    usdCostMinor: extras.usdCostMinor != null ? Number(extras.usdCostMinor) : null,
    // Presentation-ready strings so the app never does money math
    totals: {
      youSend: money.formatWithCurrency(row.send_amount_qar_minor, 'QAR'),
      fee: money.formatWithCurrency(row.fee_qar_minor, 'QAR'),
      totalDebit: money.formatWithCurrency(row.total_debit_qar_minor, 'QAR'),
      theyReceive: money.formatWithCurrency(row.payout_amount_minor, row.currency),
      rate: `1 QAR = ${Number(row.retail_rate).toFixed(4)} ${row.currency}`,
    },
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

/** Lock a quote for booking inside the transfer transaction. */
async function lockQuote({ quoteId, customerId, client }) {
  const { rows } = await client.query(
    'select * from fx_quotes where id = $1 and customer_id = $2 for update',
    [quoteId, customerId],
  );
  const quote = rows[0];
  if (!quote) throw notFound('Quote not found');
  if (quote.consumed_by_transfer) throw conflict('This quote has already been used');
  if (new Date(quote.expires_at) < new Date()) {
    throw quoteExpired();
  }
  return quote;
}

function quoteExpired() {
  const { AppError } = require('../lib/errors');
  return new AppError('The quoted rate has expired. Please refresh and try again.', { status: 409, code: 'QUOTE_EXPIRED' });
}

async function listHistory(currency, limit = 100) {
  const { rows } = await db.query(
    `select * from fx_rate_history where currency = $1 order by changed_at desc limit $2`,
    [String(currency).toUpperCase(), Math.min(limit, 500)],
  );
  return rows;
}

/**
 * Treasury tool: ask the smart-routing engine for a market rate so the officer
 * proposes a rate based on data rather than memory. Never auto-applies.
 */
async function marketSuggestion(currency) {
  const engine = require('./remittanceEngine');
  const corridor = await getCorridor(currency);
  const result = await engine.getRate('QAR', currency, 1000);
  if (!result.ok) return { ok: false, reason: result.error, corridor: publicCorridor(corridor) };
  return {
    ok: true,
    currency,
    providerRate: result.rate,
    currentBase: Number(corridor.base_rate),
    suggestion: {
      baseRate: result.rate,
      retailRate: Number((result.rate * 0.985).toFixed(6)),
    },
  };
}

module.exports = {
  corridors, publicCorridor, getCorridor,
  quote: createQuote, createQuote, presentQuote,
  price, lockQuote, listHistory, marketSuggestion, feeFor,
};
