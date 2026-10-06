'use strict';
/**
 * Environment configuration with FAIL-FAST validation.
 *
 * There are no placeholder defaults. If a secret is missing or still looks like
 * a template ("xxxx", "changeme", "your_key"), the process exits at boot with an
 * actionable message instead of silently running in an insecure state.
 */
require('dotenv').config();

const PLACEHOLDER_PATTERNS = [
  /x{4,}/i, /change[-_ ]?me/i, /your[-_ ]?(key|secret|token)/i,
  /placeholder/i, /example\.com/i, /^test$/i, /dummy/i,
];

function looksLikePlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(String(value)));
}

const errors = [];
const warnings = [];

function required(name, { minLength = 8, pattern = null, hint = '' } = {}) {
  const raw = process.env[name];
  if (!raw || !String(raw).trim()) {
    errors.push(`${name} is required${hint ? ` — ${hint}` : ''}`);
    return '';
  }
  const value = String(raw).trim();
  if (value.length < minLength) errors.push(`${name} must be at least ${minLength} characters`);
  if (looksLikePlaceholder(value)) {
    errors.push(`${name} still contains a placeholder value. Rotate it before deploying.`);
  }
  if (pattern && !pattern.test(value)) {
    errors.push(`${name} has an unexpected format.`);
  }
  return value;
}

function optional(name, fallback = '') {
  const raw = process.env[name];
  return raw && String(raw).trim() ? String(raw).trim() : fallback;
}

const NODE_ENV = optional('NODE_ENV', 'development');
const IS_PROD = NODE_ENV === 'production';
const PORT = Number(optional('PORT', '4000'));

const env = {
  NODE_ENV,
  IS_PROD,
  PORT,
  LOG_LEVEL: optional('LOG_LEVEL', IS_PROD ? 'info' : 'debug'),

  // --- Datastore (Supabase Postgres) -------------------------------------
  DATABASE_URL: required('DATABASE_URL', {
    minLength: 20,
    pattern: /^postgres(ql)?:\/\//,
    hint: 'Supabase → Project Settings → Database → Connection string (Session pooler)',
  }),
  DATABASE_SSL: optional('DATABASE_SSL', IS_PROD ? 'require' : 'auto'),
  DB_POOL_MAX: Number(optional('DB_POOL_MAX', '10')),

  // --- JWT ---------------------------------------------------------------
  JWT_SECRET: required('JWT_SECRET', { minLength: 32, hint: 'openssl rand -hex 32' }),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', { minLength: 32, hint: 'openssl rand -hex 32' }),
  JWT_ISSUER: optional('JWT_ISSUER', 'afrisend.qa'),
  ACCESS_TOKEN_TTL: optional('ACCESS_TOKEN_TTL', '30m'),
  REFRESH_TOKEN_TTL_DAYS: Number(optional('REFRESH_TOKEN_TTL_DAYS', '30')),

  // --- Crypto at rest ----------------------------------------------------
  PII_ENCRYPTION_KEY: required('PII_ENCRYPTION_KEY', {
    minLength: 64,
    hint: '32 bytes hex (openssl rand -hex 32). Encrypts QID, account numbers, TOTP seeds.',
  }),
  PII_HMAC_KEY: required('PII_HMAC_KEY', {
    minLength: 64,
    hint: '32 bytes hex, used for blind indexes (phone lookup, dedupe).',
  }),

  // --- Flutterwave v3 ----------------------------------------------------
  FLW_SECRET_KEY: required('FLW_SECRET_KEY', {
    pattern: /^FLWSECK(-|_)/,
    hint: 'Dashboard → Settings → API Keys. Starts with FLWSECK-',
  }),
  FLW_PUBLIC_KEY: optional('FLW_PUBLIC_KEY'),
  FLW_ENCRYPTION_KEY: optional('FLW_ENCRYPTION_KEY'),
  // The dashboard webhook "secret hash" you set on every webhook endpoint.
  FLW_WEBHOOK_HASH: required('FLW_WEBHOOK_HASH', {
    minLength: 12,
    hint: 'Flutterwave Dashboard → Webhooks → Secret hash',
  }),
  FLW_BASE_URL: optional('FLW_BASE_URL', 'https://api.flutterwave.com/v3'),

  // --- Ria Money Transfer (optional rail) --------------------------------
  RIA_API_KEY: optional('RIA_API_KEY'),
  RIA_API_SECRET: optional('RIA_API_SECRET'),
  RIA_AGENT_ID: optional('RIA_AGENT_ID'),
  RIA_BASE_URL: optional('RIA_BASE_URL', 'https://api.riamoneytransfer.com/v1'),
  RIA_WEBHOOK_SECRET: optional('RIA_WEBHOOK_SECRET'),

  // --- SMS / OTP ---------------------------------------------------------
  TWILIO_ACCOUNT_SID: optional('TWILIO_ACCOUNT_SID'),
  TWILIO_AUTH_TOKEN: optional('TWILIO_AUTH_TOKEN'),
  TWILIO_FROM_NUMBER: optional('TWILIO_FROM_NUMBER'),
  OTP_TTL_MINUTES: Number(optional('OTP_TTL_MINUTES', '5')),
  OTP_MAX_ATTEMPTS: Number(optional('OTP_MAX_ATTEMPTS', '5')),

  // --- Public origin (used in provider callbacks and the console) --------
  PUBLIC_BASE_URL: optional('PUBLIC_BASE_URL', ''),

  // --- CORS / console ----------------------------------------------------
  CORS_ORIGINS: optional('CORS_ORIGINS', ''),
  ADMIN_CONSOLE_ENABLED: optional('ADMIN_CONSOLE_ENABLED', 'true') === 'true',

  // --- One-time bootstrap, driven entirely from the hosting dashboard ----
  // Each step runs only while its table is still empty, so these can stay set.
  BOOTSTRAP_ADMIN_EMAIL: optional('BOOTSTRAP_ADMIN_EMAIL'),
  BOOTSTRAP_ADMIN_PASSWORD: optional('BOOTSTRAP_ADMIN_PASSWORD'),
  BOOTSTRAP_ADMIN_NAME: optional('BOOTSTRAP_ADMIN_NAME', 'Platform Administrator'),
  // "NGN=421.06, GHS=4.28, KES=35.55"  or  "NGN=421.06/415.00" (base/retail)
  BOOTSTRAP_CORRIDORS: optional('BOOTSTRAP_CORRIDORS'),
  BOOTSTRAP_CORRIDOR_SPREAD: optional('BOOTSTRAP_CORRIDOR_SPREAD', '1.5'),
  BOOTSTRAP_CORRIDOR_LIMIT_QAR: optional('BOOTSTRAP_CORRIDOR_LIMIT_QAR', '20000'),
  // "OFAC_SDN|https://host/file.csv" (comma separated for several lists)
  BOOTSTRAP_SANCTIONS_URLS: optional('BOOTSTRAP_SANCTIONS_URLS'),

  // --- Regulatory identity printed on QCB filings ------------------------
  INSTITUTION_NAME: optional('INSTITUTION_NAME', 'AfriSend Remittance LLC'),
  QCB_LICENSE_NUMBER: optional('QCB_LICENSE_NUMBER', ''),
  MLRO_NAME: optional('MLRO_NAME', ''),
  MLRO_TITLE: optional('MLRO_TITLE', 'Chief Compliance & MLRO Officer'),
};

// Conditional requirements
if (env.RIA_API_KEY && !env.RIA_API_SECRET) errors.push('RIA_API_SECRET is required when RIA_API_KEY is set');
if (env.TWILIO_ACCOUNT_SID && !env.TWILIO_AUTH_TOKEN) errors.push('TWILIO_AUTH_TOKEN is required when TWILIO_ACCOUNT_SID is set');
if (IS_PROD && !env.CORS_ORIGINS) {
  warnings.push('CORS_ORIGINS is empty in production: only the admin console origin will be allowed.');
}
if (IS_PROD && env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
  errors.push('JWT_SECRET and JWT_REFRESH_SECRET must differ.');
}

function assertValid() {
  const critical = errors.filter((e) => !/CORS_ORIGINS/.test(e));
  if (critical.length) {
    // eslint-disable-next-line no-console
    console.error('\n[afrisend] Configuration errors — refusing to start:\n' +
      critical.map((e) => `  ✗ ${e}`).join('\n') +
      '\n\nSee backend/.env.example and README.md#environment-variables.\n');
    process.exit(1);
  }
  if (warnings.length) {
    // eslint-disable-next-line no-console
    console.warn('[afrisend] warnings:\n' + warnings.map((w) => `  ! ${w}`).join('\n'));
  }
}

module.exports = { env, assertValid, looksLikePlaceholder };
