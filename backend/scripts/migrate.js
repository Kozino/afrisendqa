#!/usr/bin/env node
'use strict';
/**
 * Applies supabase/migrations/*.sql in order, inside a transaction per file.
 * Records what has been applied in `schema_migrations`, so re-runs are safe.
 *
 *   npm run migrate
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');
const { env } = require('../config/env');

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'supabase', 'migrations');

async function main() {
  const client = new Client({
    connectionString: env.DATABASE_URL,
    ssl: /supabase|neon|render|amazonaws/.test(env.DATABASE_URL) ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    )`);

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (!files.length) {
    console.error(`No .sql files found in ${MIGRATIONS_DIR}`);
    process.exit(1);
  }

  const { rows: applied } = await client.query('select filename, checksum from schema_migrations');
  const appliedMap = new Map(applied.map((r) => [r.filename, r.checksum]));

  let ran = 0;
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');
    const previous = appliedMap.get(file);

    if (previous === checksum) {
      console.log(`= ${file} (already applied)`);
      continue;
    }
    if (previous && previous !== checksum) {
      console.error(`! ${file} changed after being applied. Create a new migration instead of editing history.`);
      process.exitCode = 1;
      continue;
    }

    process.stdout.write(`> ${file} ... `);
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query(
        'insert into schema_migrations (filename, checksum) values ($1,$2)',
        [file, checksum],
      );
      await client.query('commit');
      ran += 1;
      console.log('applied');
    } catch (err) {
      await client.query('rollback');
      console.log('FAILED');
      console.error(`\n${err.message}\n`);
      process.exit(1);
    }
  }

  console.log(`\nDone. ${ran} migration(s) applied, ${files.length - ran} already up to date.`);
  await client.end();
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
