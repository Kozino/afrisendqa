'use strict';
/**
 * Payout rail aggregator: Flutterwave v3 (bank + mobile money) and Ria
 * (cash pickup), behind one interface with smart routing.
 *
 * Secrets live only here, on the server. The mobile app never sees a provider
 * key — it calls our API, our API talks to the rail.
 *
 * Every method returns a normalised envelope:
 *   { ok: true, provider, providerReference, status, raw }
 *   { ok: false, provider, error, retryable, raw }
 */
const { env } = require('../config/env');
const log = require('../lib/logger');

const FLW = {
  base: env.FLW_BASE_URL.replace(/\/$/, ''),
  headers: {
    Authorization: `Bearer ${env.FLW_SECRET_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
};

const RIA_ENABLED = Boolean(env.RIA_API_KEY && env.RIA_API_SECRET);

// ---------------------------------------------------------------------------
// Low-level HTTP with timeout + retry on network errors only (never on 4xx,
// which are business rejections and must not be repeated).
// ---------------------------------------------------------------------------
async function request(url, { method = 'GET', headers, body, timeoutMs = 20_000, retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
      clearTimeout(timer);

      if (!response.ok) {
        const retryable = response.status >= 500 || response.status === 429;
        if (retryable && attempt < retries) {
          await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
          continue;
        }
        return { ok: false, httpStatus: response.status, payload, retryable };
      }
      return { ok: true, httpStatus: response.status, payload };
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
    }
  }
  return { ok: false, httpStatus: 0, payload: { message: lastError?.message || 'network error' }, retryable: true };
}

// ---------------------------------------------------------------------------
// Flutterwave v3
// ---------------------------------------------------------------------------
async function getRate(from, to, amount = 1) {
  const result = await request(`${FLW.base}/rates?from=${from}&to=${to}&amount=${amount}`, {
    headers: FLW.headers,
  });
  if (!result.ok) return { ok: false, provider: 'FLUTTERWAVE', error: result.payload?.message || 'rate unavailable', raw: result.payload };
  const data = result.payload?.data;
  const rate = Array.isArray(data) ? data[0]?.rate : data?.rate;
  if (!rate) return { ok: false, provider: 'FLUTTERWAVE', error: 'Malformed rate response', raw: result.payload };
  return { ok: true, provider: 'FLUTTERWAVE', rate: Number(rate), raw: result.payload };
}

/**
 * Resolve an account holder name. This is the anti-fraud control that stops a
 * customer from sending money to a mistyped or swapped account number: we show
 * the legal name the bank returns and the app requires the customer to confirm.
 */
async function resolveAccount({ accountNumber, bankCode }) {
  const result = await request(
    `${FLW.base}/accounts/resolve`,
    { method: 'POST', headers: FLW.headers, body: { account_number: accountNumber, account_bank: bankCode } },
  );
  if (!result.ok) {
    return { ok: false, provider: 'FLUTTERWAVE', error: result.payload?.message || 'Could not resolve this account', retryable: result.retryable, raw: result.payload };
  }
  const data = result.payload?.data || {};
  return {
    ok: true,
    provider: 'FLUTTERWAVE',
    accountName: data.account_name,
    accountNumber: data.account_number || accountNumber,
    raw: result.payload,
  };
}

async function listBanks({ country }) {
  const result = await request(`${FLW.base}/banks/${country}`, { headers: FLW.headers });
  if (!result.ok) return { ok: false, provider: 'FLUTTERWAVE', error: result.payload?.message || 'Bank list unavailable', raw: result.payload };
  return { ok: true, provider: 'FLUTTERWAVE', banks: result.payload?.data || [], raw: result.payload };
}

/**
 * Payout. `reference` MUST be the AfriSend reference: Flutterwave enforces
 * uniqueness on tx_ref, which gives us provider-side idempotency for free.
 */
async function payoutViaFlutterwave({
  channel, accountBank, accountNumber, amountMajor, currency, narrative,
  beneficiaryName, reference, countryCode,
}) {
  const isMobileMoney = channel === 'FLUTTERWAVE_MOBILE_MONEY';
  const body = {
    account_bank: isMobileMoney ? accountBank : accountBank,
    account_number: accountNumber,
    amount: amountMajor,
    currency,
    narration: (narrative || 'AfriSend remittance').slice(0, 100),
    reference,
    callback_url: `${env.PUBLIC_BASE_URL || ''}/api/v1/webhooks/flutterwave`,
    debit_currency: 'QAR',
    beneficiary_name: beneficiaryName,
    meta: {
      sender: 'AfriSend',
      country: countryCode,
      channel: isMobileMoney ? 'mobile_money' : 'bank_transfer',
    },
  };
  if (isMobileMoney) body.type = 'mobile_money';

  const result = await request(`${FLW.base}/transfers`, {
    method: 'POST',
    headers: FLW.headers,
    body,
    timeoutMs: 30_000,
  });

  if (!result.ok) {
    return {
      ok: false,
      provider: 'FLUTTERWAVE',
      error: result.payload?.message || 'Payout rejected',
      retryable: result.retryable,
      raw: result.payload,
    };
  }
  const data = result.payload?.data || {};
  return {
    ok: true,
    provider: 'FLUTTERWAVE',
    providerReference: String(data.id ?? data.reference ?? reference),
    providerStatus: String(data.status || 'NEW').toUpperCase(),
    feeCharged: data.fee,
    raw: result.payload,
  };
}

/** Card/bank collection for wallet top-ups (hosted checkout). */
async function initializeCollection({
  amountMajor, currency = 'QAR', customerEmail, customerPhone, customerName, reference, redirectUrl, paymentOptions = 'card',
}) {
  const body = {
    tx_ref: reference,
    amount: amountMajor,
    currency,
    redirect_url: redirectUrl,
    payment_options: paymentOptions,
    customer: { email: customerEmail, phonenumber: customerPhone, name: customerName },
    customizations: {
      title: 'AfriSend Wallet Top-up',
      description: `Funding AfriSend wallet ${reference}`,
    },
  };
  const result = await request(`${FLW.base}/payments`, { method: 'POST', headers: FLW.headers, body, timeoutMs: 25_000 });
  if (!result.ok) {
    return { ok: false, provider: 'FLUTTERWAVE', error: result.payload?.message || 'Could not start the payment', raw: result.payload };
  }
  return {
    ok: true,
    provider: 'FLUTTERWAVE',
    checkoutUrl: result.payload?.data?.link,
    raw: result.payload,
  };
}

async function verifyTransaction(transactionId) {
  const result = await request(`${FLW.base}/transactions/${transactionId}/verify`, { headers: FLW.headers });
  if (!result.ok) return { ok: false, provider: 'FLUTTERWAVE', error: result.payload?.message, raw: result.payload };
  return { ok: true, provider: 'FLUTTERWAVE', transaction: result.payload?.data, raw: result.payload };
}

// ---------------------------------------------------------------------------
// Ria Money Transfer — cash pickup
// ---------------------------------------------------------------------------
function riaHeaders() {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Ria-Api-Key': env.RIA_API_KEY,
    'X-Ria-Api-Secret': env.RIA_API_SECRET,
    'X-Ria-Agent-Id': env.RIA_AGENT_ID || '',
  };
}

async function payoutViaRia({
  amountMajor, currency, countryCode, beneficiaryName, beneficiaryPhone,
  beneficiaryCity, beneficiaryIdType, beneficiaryIdNumber, reference, senderName, senderQid,
}) {
  if (!RIA_ENABLED) {
    return { ok: false, provider: 'RIA', error: 'Ria rail is not configured on this deployment', retryable: false };
  }
  const body = {
    clientReference: reference,
    sendingAgentId: env.RIA_AGENT_ID,
    transaction: {
      amount: amountMajor,
      currency,
      destinationCountry: countryCode,
      serviceCode: 'CASH_PICKUP',
    },
    beneficiary: {
      name: { full: beneficiaryName },
      phone: beneficiaryPhone,
      city: beneficiaryCity,
      identification: { type: beneficiaryIdType, number: beneficiaryIdNumber },
    },
    sender: { name: { full: senderName }, identificationNumber: senderQid },
  };

  const result = await request(`${env.RIA_BASE_URL.replace(/\/$/, '')}/transactions`, {
    method: 'POST', headers: riaHeaders(), body, timeoutMs: 30_000,
  });

  if (!result.ok) {
    return {
      ok: false,
      provider: 'RIA',
      error: result.payload?.message || result.payload?.errors?.[0]?.message || 'Ria rejected the payout',
      retryable: result.retryable,
      raw: result.payload,
    };
  }
  const data = result.payload?.data || result.payload;
  return {
    ok: true,
    provider: 'RIA',
    providerReference: String(data.transactionId ?? data.id ?? reference),
    providerStatus: String(data.status || 'PENDING').toUpperCase(),
    pickupCode: data.pin ?? data.pickupCode ?? null,
    raw: result.payload,
  };
}

// ---------------------------------------------------------------------------
// Smart routing
// ---------------------------------------------------------------------------
/**
 * Choose a rail. Order of preference:
 *   1. Explicit active rail configured for the corridor in `provider_rails`
 *      (lowest `priority` wins) — this is how Treasury steers volume.
 *   2. Channel capability: cash pickup must go to Ria, bank/MoMo to Flutterwave.
 */
async function route({ countryCode, channel, db }) {
  if (db) {
    const { rows } = await db.query(
      `select provider from provider_rails
        where country_code = $1 and channel = $2 and is_active
        order by priority asc limit 1`,
      [countryCode, channel],
    );
    if (rows[0]) return rows[0].provider;
  }
  if (channel === 'RIA_CASH_PICKUP') return 'RIA';
  return 'FLUTTERWAVE';
}

async function executePayout(params) {
  const provider = params.provider || (params.channel === 'RIA_CASH_PICKUP' ? 'RIA' : 'FLUTTERWAVE');
  log.info('payout dispatch', {
    provider, reference: params.reference, currency: params.currency, channel: params.channel,
  });
  if (provider === 'RIA') return payoutViaRia(params);
  return payoutViaFlutterwave(params);
}

const health = () => ({
  flutterwave: { configured: Boolean(env.FLW_SECRET_KEY), base: FLW.base },
  ria: { configured: RIA_ENABLED, base: env.RIA_BASE_URL },
});

module.exports = {
  getRate, resolveAccount, listBanks, payoutViaFlutterwave, payoutViaRia,
  initializeCollection, verifyTransaction, route, executePayout, health,
  request,
};
