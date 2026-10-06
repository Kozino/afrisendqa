'use strict';
/**
 * Postgres access layer (Supabase compatible).
 *
 *  - One pool for the process.
 *  - `withTransaction()` gives a SERIALIZABLE-safe unit of work with automatic
 *    rollback. All money movement goes through it.
 *  - `query()` is for read paths.
 */
const { Pool } = require('pg');
const { env } = require('../config/env');
const log = require('../lib/logger');

const sslMode = env.DATABASE_SSL;
const ssl = sslMode === 'disable'
  ? false
  : sslMode === 'require'
    ? { rejectUnauthorized: false }   // Supabase pooler presents a managed chain
    : (/supabase|neon|render|amazonaws/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : false);

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl,
  max: env.DB_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'afrisend-api',
});

pool.on('error', (err) => log.error('postgres pool error', { err: err.message }));

async function query(text, params) {
  const started = Date.now();
  try {
    const res = await pool.query(text, params);
    if (Date.now() - started > 1500) {
      log.warn('slow query', { ms: Date.now() - started, sql: text.slice(0, 120) });
    }
    return res;
  } catch (err) {
    log.error('query failed', { err: err.message, sql: text.slice(0, 200) });
    throw err;
  }
}

async function withTransaction(fn, { isolation = 'READ COMMITTED' } = {}) {
  const client = await pool.connect();
  try {
    await client.query(`begin isolation level ${isolation}`);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* connection already dead */ }
    throw err;
  } finally {
    client.release();
  }
}

async function health() {
  const { rows } = await pool.query('select now() as now, current_database() as db');
  return rows[0];
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, withTransaction, health, close };
