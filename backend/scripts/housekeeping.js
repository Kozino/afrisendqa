#!/usr/bin/env node
'use strict';
/**
 * Housekeeping job — safe to run from a Render cron job or any scheduler.
 *
 *   1. expires maker-checker requests nobody decided within 24h
 *   2. re-dispatches payouts that were queued because the payout float was short
 *   3. reports sanctions-list coverage so a stale list cannot go unnoticed
 *
 *   node scripts/housekeeping.js
 */
require('dotenv').config();
const db = require('../db/pool');
const makerChecker = require('../services/makerChecker');
const transfers = require('../services/transfers');
const screening = require('../services/screening');
const audit = require('../services/audit');
const log = require('../lib/logger');

async function main() {
  const started = Date.now();

  const expired = await makerChecker.expireStale();
  const redispatched = await transfers.retryAwaitingFloat({ limit: 100 });

  const { rows: shortfalls } = await db.query('select * from afrisend_float_shortfalls()');
  const { rows: integrity } = await db.query('select * from afrisend_books_integrity()');
  const coverage = await screening.stats();

  if (!integrity[0].books_balanced) {
    await audit.record({
      actorType: 'SYSTEM', action: 'LEDGER_INTEGRITY_ALERT', entityType: 'ledger',
      severity: 'CRITICAL', metadata: integrity[0],
    });
    log.error('LEDGER INTEGRITY ALERT', integrity[0]);
  }

  if (!coverage.length) {
    log.warn('no sanctions list is loaded — transfers above the review threshold will stay on hold');
  }

  await audit.record({
    actorType: 'SYSTEM', action: 'HOUSEKEEPING_RUN', entityType: 'system', severity: 'INFO',
    metadata: {
      expiredMakerChecker: expired,
      redispatchedTransfers: redispatched,
      floatShortfalls: shortfalls,
      ledgerIntegrity: integrity[0],
      sanctionsLists: coverage,
      durationMs: Date.now() - started,
    },
  });

  log.info('housekeeping complete', {
    expired, redispatched, shortfalls: shortfalls.length, durationMs: Date.now() - started,
  });
  await db.close();
}

main().catch(async (err) => {
  log.error('housekeeping failed', { err: err.message });
  process.exit(1);
});
