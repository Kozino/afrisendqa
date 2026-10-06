#!/usr/bin/env node
'use strict';
/**
 * Rotate the RSA keypair used to sign QCB filings.
 * Old keys stay in the table (and remain valid for verifying past filings);
 * only one key is `active` at a time.
 *
 *   npm run rotate-signing-key
 */
require('dotenv').config();
const db = require('../db/pool');
const reports = require('../services/reports');
const { encryptPII, generateRsaKeyPair } = require('../lib/crypto');

async function main() {
  const { rowCount: deactivated } = await db.query('update signing_keys set active = false where active');
  const { publicKey, privateKey } = generateRsaKeyPair();
  const kid = `afrisend-${new Date().toISOString().slice(0, 10)}-${Math.random().toString(16).slice(2, 10)}`;

  await db.query(
    `insert into signing_keys (kid, public_key_pem, private_key_pem_encrypted, active) values ($1,$2,$3,true)`,
    [kid, publicKey, encryptPII(privateKey)],
  );
  await db.query(
    `insert into audit_logs (actor_type, actor_email, action, entity_type, entity_id, severity, metadata)
     values ('SYSTEM','cli','SIGNING_KEY_ROTATED','signing_key',$1,'CRITICAL',$2)`,
    [kid, JSON.stringify({ deactivated: deactivated, newKid: kid })],
  );

  const active = await reports.ensureSigningKey();
  console.log(`✔ New signing key active: ${active.kid} (previous keys deactivated: ${deactivated})`);
  await db.close();
}

main().catch((err) => {
  console.error(`✗ ${err.message}`);
  process.exit(1);
});
