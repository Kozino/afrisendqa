#!/usr/bin/env node
'use strict';
/**
 * Create an operations console account.
 *
 *   npm run create-admin -- --email mlro@afrisend.qa --name "Zainab Yusuf" --role COMPLIANCE_MLRO
 *   npm run create-admin -- --email me@x.qa --name "Me" --role SUPER_ADMIN --password 'S3cure!Passw0rd'
 *
 * If --password is omitted you are prompted (never pass secrets on the shell
 * history of a shared machine unless you must).
 */
require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { env } = require('../config/env');
const db = require('../db/pool');
const { PERMISSIONS } = require('../config/permissions');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { args[key] = next; i += 1; } else { args[key] = true; }
  }
  return args;
}

function prompt(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      const onData = (char) => {
        if (['\n', '\r', '\u0004'].includes(String(char))) return;
        process.stdout.write('\r' + question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
      rl.question(question, (answer) => {
        process.stdin.removeListener('data', onData);
        rl.close();
        process.stdout.write('\n');
        resolve(answer);
      });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) throw new Error('Password must be at least 12 characters');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) throw new Error('Password must combine at least three of: lowercase, uppercase, digits, symbols');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.email) {
    console.log(`
Usage: npm run create-admin -- --email <email> --name "<full name>" --role <ROLE> [--password <password>]

Roles: ${Object.keys(PERMISSIONS).join(', ')}
Example: npm run create-admin -- --email mlro@afrisend.qa --name "Zainab Yusuf" --role COMPLIANCE_MLRO
`);
    process.exit(args.help ? 0 : 1);
  }

  const role = String(args.role || 'COMPLIANCE_ANALYST').toUpperCase();
  if (!PERMISSIONS[role]) {
    throw new Error(`Unknown role "${role}". Valid roles: ${Object.keys(PERMISSIONS).join(', ')}`);
  }

  const password = args.password || await prompt('Password: ', { hidden: true });
  assertPasswordStrength(password);

  const email = String(args.email).trim().toLowerCase();
  const hash = await bcrypt.hash(password, 12);

  const { rows } = await db.query(
    `insert into admin_users (email, full_name, password_hash, role)
     values ($1,$2,$3,$4)
     on conflict (email) do update
       set full_name = excluded.full_name,
           password_hash = excluded.password_hash,
           role = excluded.role,
           is_active = true,
           failed_logins = 0,
           locked_until = null,
           password_changed_at = now(),
           updated_at = now()
     returning id, email, role`,
    [email, args.name || email, hash, role],
  );

  await db.query(
    `insert into audit_logs (actor_type, actor_email, action, entity_type, entity_id, severity, after_state)
     values ('SYSTEM','cli','ADMIN_UPSERTED','admin_user',$1,'HIGH',$2)`,
    [rows[0].id, JSON.stringify({ email, role })],
  );

  console.log(`\n✔ Operator ready: ${rows[0].email} (${rows[0].role})`);
  console.log('  Sign in at /admin/login.html — enable TOTP from the console header afterwards.');
  console.log(`  Permissions: ${PERMISSIONS[role].join(', ')}\n`);
  await db.close();
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
