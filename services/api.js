/**
 * AfriSend mobile API client.
 *
 * The app talks ONLY to the AfriSend backend. Flutterwave, Ria and every
 * secret key stay on the server — nothing in this file (or anywhere in the
 * bundle) can be extracted to move money.
 *
 * Configure the base URL per environment with EXPO_PUBLIC_API_URL (see
 * .env.example). Preview builds default to the deployed API.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_BASE_URL = 'https://afrisend-api.onrender.com/api/v1';

export const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

const ACCESS_KEY = 'afrisend.accessToken';
const REFRESH_KEY = 'afrisend.refreshToken';
const CUSTOMER_KEY = 'afrisend.customer';

/* ------------------------------------------------------------------ tokens */
let memoryAccess = null;
let memoryRefresh = null;
const listeners = new Set();

export function onSessionChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  const snapshot = { hasSession: Boolean(memoryAccess) };
  listeners.forEach((listener) => {
    try { listener(snapshot); } catch { /* ignore */ }
  });
}

export const Session = {
  async load() {
    try {
      const [access, refresh] = await Promise.all([
        AsyncStorage.getItem(ACCESS_KEY),
        AsyncStorage.getItem(REFRESH_KEY),
      ]);
      memoryAccess = access;
      memoryRefresh = refresh;
      return { access, refresh };
    } catch {
      return { access: memoryAccess, refresh: memoryRefresh };
    }
  },
  async save({ accessToken, refreshToken }) {
    if (accessToken) {
      memoryAccess = accessToken;
      await AsyncStorage.setItem(ACCESS_KEY, accessToken).catch(() => {});
    }
    if (refreshToken) {
      memoryRefresh = refreshToken;
      await AsyncStorage.setItem(REFRESH_KEY, refreshToken).catch(() => {});
    }
    emit();
  },
  async saveCustomer(customer) {
    await AsyncStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer)).catch(() => {});
  },
  async getCustomer() {
    try {
      const raw = await AsyncStorage.getItem(CUSTOMER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  async clear() {
    memoryAccess = null;
    memoryRefresh = null;
    await AsyncStorage.multiRemove([ACCESS_KEY, REFRESH_KEY, CUSTOMER_KEY]).catch(() => {});
    emit();
  },
  get access() { return memoryAccess; },
  get refresh() { return memoryRefresh; },
  get isSignedIn() { return Boolean(memoryAccess); },
};

/* --------------------------------------------------------------- transport */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'NETWORK_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let refreshing = null;

async function refreshSession() {
  if (!memoryRefresh) throw new ApiError('Your session has expired. Please sign in again.', { status: 401, code: 'SESSION_EXPIRED' });
  if (!refreshing) {
    refreshing = fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: memoryRefresh }),
    })
      .then(async (response) => {
        if (!response.ok) throw new ApiError('Session expired', { status: 401, code: 'SESSION_EXPIRED' });
        const payload = await response.json();
        await Session.save(payload);
        return payload.accessToken;
      })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

/**
 * Single request helper.
 *  - attaches the access token
 *  - refreshes once on 401 and retries
 *  - unwraps the API envelope into a typed ApiError
 */
export async function request(path, { method = 'GET', body, headers = {}, retry = true, raw = false } = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(memoryAccess ? { Authorization: `Bearer ${memoryAccess}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError('No connection. Check your internet and try again.', { code: 'OFFLINE' });
  }

  if (response.status === 401 && retry && memoryRefresh) {
    await refreshSession();
    return request(path, { method, body, headers, retry: false, raw });
  }

  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = { raw: text }; }
  }

  if (!response.ok) {
    const error = (payload && payload.error) || {};
    if (response.status === 401) await Session.clear();
    throw new ApiError(error.message || `Request failed (${response.status})`, {
      status: response.status,
      code: error.code || 'REQUEST_FAILED',
      details: error.details || null,
    });
  }
  return raw ? { payload, response } : payload;
}

/* ----------------------------------------------------------------- helpers */
export function formatMoney(minor, currency = 'QAR') {
  if (minor === null || minor === undefined) return '—';
  const exponents = { UGX: 0, TZS: 0, RWF: 0, XAF: 0, XOF: 0 };
  const exponent = exponents[currency] ?? 2;
  const value = Number(minor) / 10 ** exponent;
  return value.toLocaleString('en-US', { minimumFractionDigits: exponent, maximumFractionDigits: exponent });
}

export function toMinor(amount, currency = 'QAR') {
  const exponents = { UGX: 0, TZS: 0, RWF: 0, XAF: 0, XOF: 0 };
  const exponent = exponents[currency] ?? 2;
  const [whole, frac = ''] = String(amount).replace(/,/g, '').split('.');
  return Number(whole) * 10 ** exponent + Number((frac + '0'.repeat(exponent)).slice(0, exponent) || '0');
}

/** Flutterwave-style idempotency key: generated once per payment attempt. */
export function idempotencyKey(prefix = 'txn') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* --------------------------------------------------------------------- api */
export const Api = {
  // --- public ------------------------------------------------------------
  corridors: () => request('/public/corridors'),
  purposeCodes: () => request('/public/purpose-codes'),
  institutions: (country) => request(`/public/institutions?country=${encodeURIComponent(country)}`),
  rates: (currency) => request(`/public/rates/${currency}`),

  // --- auth --------------------------------------------------------------
  requestOtp: (phone, deviceId) => request('/auth/otp/request', { method: 'POST', body: { phone, deviceId } }),
  verifyOtp: async (phone, code, deviceId) => {
    const payload = await request('/auth/otp/verify', { method: 'POST', body: { phone, code, deviceId } });
    await Session.save(payload);
    if (payload.customer) await Session.saveCustomer(payload.customer);
    return payload;
  },
  setPin: (pin, currentPin) => request('/auth/pin', { method: 'POST', body: { pin, currentPin } }),
  signOut: async () => {
    await Session.clear();
  },

  // --- profile / wallet --------------------------------------------------
  profile: () => request('/me/profile'),
  updateProfile: (patch) => request('/me/profile', { method: 'PATCH', body: patch }),
  fundings: () => request('/me/wallet/fundings'),
  startFunding: (amount, method = 'CARD') => request('/me/wallet/fundings', { method: 'POST', body: { amount, method } }),

  // --- beneficiaries -----------------------------------------------------
  beneficiaries: () => request('/me/beneficiaries'),
  resolveAccount: (accountNumber, institutionCode) =>
    request('/me/beneficiaries/resolve', { method: 'POST', body: { accountNumber, institutionCode } }),
  addBeneficiary: (beneficiary) => request('/me/beneficiaries', { method: 'POST', body: beneficiary }),
  removeBeneficiary: (id) => request(`/me/beneficiaries/${id}`, { method: 'DELETE' }),

  // --- KYC ---------------------------------------------------------------
  submitKyc: (input) => request('/me/kyc', { method: 'POST', body: input }),
  kycStatus: () => request('/me/kyc'),
  screenName: (name) => request('/me/screening/name', { method: 'POST', body: { name } }),

  // --- transfers ---------------------------------------------------------
  quote: (currency, amount, countryCode) =>
    request('/transfers/quotes', { method: 'POST', body: { currency, amount, countryCode } }),
  /** `key` must be reused verbatim if the customer retries the same payment. */
  createTransfer: ({ quoteId, beneficiaryId, pin, purposeCode, purposeNarrative, reference, key }) =>
    request('/transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: { quoteId, beneficiaryId, pin, purposeCode, purposeNarrative, reference },
    }),
  transfers: (params = {}) => {
    const query = Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    return request(`/me/transfers${query ? `?${query}` : ''}`);
  },
  transfer: (reference) => request(`/me/transfers/${encodeURIComponent(reference)}`),

  // --- devices / push ----------------------------------------------------
  registerDevice: (deviceId, platform, pushToken) =>
    request('/me/devices', { method: 'POST', body: { deviceId, platform, pushToken } }),
};

export default Api;
