'use strict';
/**
 * AfriSend API — entrypoint.
 *
 * Boot sequence:
 *   1. validate configuration (fail fast, no placeholder secrets)
 *   2. verify the database schema is present
 *   3. one-time bootstrap of the first operator account (if configured)
 *   4. ensure the QCB report signing key exists
 *   5. start listening on 0.0.0.0 (Render needs a non-loopback bind)
 *   6. start housekeeping jobs
 */
const http = require('http');
const { env, assertValid } = require('./config/env');
const log = require('./lib/logger');

assertValid();

const app = require('./app');
const db = require('./db/pool');
const reports = require('./services/reports');
const makerChecker = require('./services/makerChecker');
const bootstrap = require('./services/bootstrap');
const sse = require('./services/sse');

async function verifySchema() {
  const required = [
    'customers', 'transfers', 'ledger_journals', 'ledger_entries', 'kyc_requests',
    'maker_checker_requests', 'audit_logs', 'webhook_events', 'compliance_settings', 'admin_users',
  ];
  const { rows } = await db.query(
    `select table_name from information_schema.tables where table_schema = 'public'`,
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missing = required.filter((t) => !present.has(t));
  if (missing.length) {
    throw new Error(
      `Database schema is incomplete. Missing: ${missing.join(', ')}.\n`
      + 'Run the migrations first:  npm run migrate   (or paste supabase/migrations/*.sql into the Supabase SQL editor)',
    );
  }
}

async function bootstrapSigningKey() {
  const key = await reports.ensureSigningKey();
  log.info('report signing key ready', { kid: key.kid });
}

async function main() {
  await verifySchema();
  await bootstrapSigningKey();

  // First-run setup from environment variables, so a deployment can be finished
  // entirely from the hosting dashboard (no terminal, no scripts).
  const bootstrapSummary = await bootstrap.run();
  if (!process.env.AFRISEND_QUIET_BOOTSTRAP) {
    log.info('bootstrap summary', bootstrapSummary);
  }

  const server = http.createServer(app);
  server.keepAliveTimeout = 65_000;     // slightly above Render's 60s proxy idle
  server.headersTimeout = 70_000;

  server.listen(env.PORT, '0.0.0.0', () => {
    log.info('AfriSend API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      console: env.ADMIN_CONSOLE_ENABLED ? '/admin' : 'disabled',
      rails: { flutterwave: true, ria: Boolean(env.RIA_API_KEY) },
      sms: require('./services/notifications').smsConfigured,
    });
    // Point the operator at the console on the very first deploy.
    (async () => {
      try {
        const { rows } = await db.query('select count(*)::int as operators from admin_users');
        const { rows: [corridors] } = await db.query('select count(*)::int as count from fx_corridors');
        if (rows[0].operators === 0) {
          log.warn('NO OPERATOR ACCOUNT YET — set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD, then redeploy');
        } else {
          log.info('sign in at /admin with your operator account');
        }
        if (corridors.count === 0) {
          log.warn('NO CORRIDORS PROVISIONED — set BOOTSTRAP_CORRIDORS (e.g. "NGN=421.06, GHS=4.28") or add them in the console');
        }
      } catch { /* diagnostics only */ }
    })();
    if (!env.BOOTSTRAP_SANCTIONS_URLS) {
      log.warn('no sanctions list configured — transfers above the review threshold will be held until one is loaded (BOOTSTRAP_SANCTIONS_URLS)');
    }
  });

  // Housekeeping: expire undecided maker-checker requests and re-dispatch
  // payouts that were queued because the payout float was short.
  const transfers = require('./services/transfers');
  const housekeeping = setInterval(() => {
    makerChecker.expireStale()
      .then((n) => { if (n) log.info('expired maker-checker requests', { count: n }); })
      .catch((err) => log.warn('housekeeping failed', { err: err.message }));
    transfers.retryAwaitingFloat()
      .then((n) => { if (n) log.info('re-dispatched queued payouts', { count: n }); })
      .catch((err) => log.warn('float re-dispatch failed', { err: err.message }));
  }, 5 * 60_000);
  housekeeping.unref();

  const shutdown = async (signal) => {
    log.info('shutting down', { signal });
    clearInterval(housekeeping);
    sse.closeAll();
    server.close(async () => {
      await db.close().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error('unhandled rejection', { reason: String(reason) }));
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { err: err.message, stack: err.stack?.split('\n')[1] });
    shutdown('uncaughtException');
  });
}

main().catch((err) => {
  log.error('startup failed', { err: err.message });
  process.exit(1);
});
