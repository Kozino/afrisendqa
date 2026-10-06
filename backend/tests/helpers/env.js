'use strict';
/**
 * Test bootstrap.
 *
 * The config module validates at import time and refuses to boot with missing
 * secrets, so every test file loads this first. Nothing here connects to a
 * database — the unit tests are pure. The end-to-end paths (schema, ledger,
 * four-eyes, webhooks) are covered by scripts/smoke-test.js against a real
 * Postgres, which CI runs as a separate step.
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://test:test@127.0.0.1:5432/afrisend_unit';
process.env.DATABASE_SSL = process.env.DATABASE_SSL || 'disable';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'unit_test_jwt_secret_0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'unit_test_refresh_secret_0123456789abcdef01234567';
process.env.PII_ENCRYPTION_KEY = process.env.PII_ENCRYPTION_KEY || 'ab'.repeat(32);
process.env.PII_HMAC_KEY = process.env.PII_HMAC_KEY || 'cd'.repeat(32);
process.env.FLW_SECRET_KEY = process.env.FLW_SECRET_KEY || 'FLWSECK_TEST-unitkeyforlocaltesting1234567890';
process.env.FLW_WEBHOOK_HASH = process.env.FLW_WEBHOOK_HASH || 'unit-webhook-secret-hash-2026';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
