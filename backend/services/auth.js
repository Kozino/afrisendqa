'use strict';
/**
 * Authentication for both populations:
 *   - Operators (admin console): email + password (bcrypt, cost 12) + optional
 *     TOTP, refresh-token rotation, account lockout, login audit.
 *   - Customers (mobile app): phone + one-time code over SMS, refresh rotation.
 *
 * Refresh tokens are opaque random strings; only their SHA-256 is stored, so a
 * database leak cannot be replayed.
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { env } = require('../config/env');
const db = require('../db/pool');
const { permissionsFor } = require('../config/permissions');
const {
  badRequest, unauthorized, forbidden, notFound, tooMany,
} = require('../lib/errors');
const { sha256, randomToken, numericCode, timingSafeEquals, decryptPII, blindIndex } = require('../lib/crypto');
const { sendSms } = require('./notifications');
const audit = require('./audit');

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
function issueAccessToken(subject, claims, audience) {
  return jwt.sign({ ...claims, aud: audience }, env.JWT_SECRET, {
    subject: String(subject),
    issuer: env.JWT_ISSUER,
    expiresIn: env.ACCESS_TOKEN_TTL,
  });
}

async function issueRefreshToken({ table, ownerColumn, ownerId, deviceId, userAgent, ip }) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 864e5);
  if (table === 'admin_sessions') {
    await db.query(
      `insert into admin_sessions (admin_id, refresh_token_hash, user_agent, ip_address, expires_at)
       values ($1, $2, $3, $4, $5)`,
      [ownerId, sha256(token), userAgent ? String(userAgent).slice(0, 400) : null, ip || null, expiresAt],
    );
  } else {
    await db.query(
      `insert into customer_sessions (customer_id, refresh_token_hash, device_id, expires_at)
       values ($1, $2, $3, $4)`,
      [ownerId, sha256(token), deviceId || null, expiresAt],
    );
  }
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------
async function adminLogin({ email, password, totp, ip, userAgent }) {
  const { rows } = await db.query(
    'select * from admin_users where email = $1 limit 1',
    [String(email).toLowerCase()],
  );
  const admin = rows[0];

  // Constant-ish work factor whether or not the account exists.
  if (!admin) {
    await bcrypt.compare(password || '', '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw unauthorized('Invalid credentials');
  }
  if (!admin.is_active) throw forbidden('This operator account is disabled');
  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    throw tooMany(`Account locked until ${admin.locked_until.toISOString()} after repeated failed logins`);
  }

  const ok = await bcrypt.compare(password || '', admin.password_hash);
  if (!ok) {
    const failed = admin.failed_logins + 1;
    // Explicit casts are required: without them Postgres cannot infer a single
    // type for $2 (assigned to an integer column and compared against an
    // untyped parameter), and it fails with 42P08 — which surfaced to the
    // operator as a 500 "something went wrong" instead of "invalid credentials".
    await db.query(
      `update admin_users
          set failed_logins = $2::int,
              locked_until = case
                when $2::int >= $3::int then now() + make_interval(mins => $4::int)
                else locked_until
              end
        where id = $1::uuid`,
      [admin.id, failed, MAX_FAILED_LOGINS, LOCK_MINUTES],
    );
    await audit.record({
      actorType: 'OPERATOR', actorEmail: admin.email, actorId: admin.id,
      action: 'ADMIN_LOGIN_FAILED', entityType: 'admin_user', entityId: admin.id,
      severity: failed >= MAX_FAILED_LOGINS ? 'HIGH' : 'WARNING', ip, userAgent,
    });
    throw unauthorized('Invalid credentials');
  }

  if (admin.mfa_enabled) {
    if (!totp) {
      return { mfaRequired: true };
    }
    const { verifyTotp } = require('./totp');
    const secret = decryptPII(admin.mfa_secret);
    if (!verifyTotp(secret, totp)) {
      await audit.record({
        actorType: 'OPERATOR', actorEmail: admin.email, actorId: admin.id,
        action: 'ADMIN_MFA_FAILED', entityType: 'admin_user', entityId: admin.id,
        severity: 'HIGH', ip, userAgent,
      });
      throw unauthorized('Invalid authenticator code');
    }
  }

  await db.query(
    'update admin_users set failed_logins = 0, locked_until = null, last_login_at = now() where id = $1',
    [admin.id],
  );
  const accessToken = issueAccessToken(admin.id, {
    typ: 'operator', role: admin.role, email: admin.email, name: admin.full_name,
  }, 'afrisend-admin');
  const refresh = await issueRefreshToken({
    table: 'admin_sessions', ownerColumn: 'admin_id', ownerId: admin.id, userAgent, ip,
  });

  await audit.record({
    actorType: 'OPERATOR', actorEmail: admin.email, actorId: admin.id, actorRole: admin.role,
    action: 'ADMIN_LOGIN', entityType: 'admin_user', entityId: admin.id, ip, userAgent,
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    operator: {
      id: admin.id, email: admin.email, name: admin.full_name, role: admin.role,
      mfaEnabled: admin.mfa_enabled, permissions: permissionsFor(admin.role),
    },
  };
}

async function refreshAdminSession({ refreshToken, ip, userAgent }) {
  if (!refreshToken) throw badRequest('refreshToken is required');
  const { rows } = await db.query(
    `select s.*, a.email, a.full_name, a.role, a.is_active
       from admin_sessions s join admin_users a on a.id = s.admin_id
      where s.refresh_token_hash = $1`,
    [sha256(refreshToken)],
  );
  const session = rows[0];
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    throw unauthorized('Session expired, please sign in again');
  }
  if (!session.is_active) throw forbidden('This operator account is disabled');

  // rotation: revoke the presented token, mint a new pair
  await db.query('update admin_sessions set revoked_at = now() where id = $1', [session.id]);
  const accessToken = issueAccessToken(session.admin_id, {
    typ: 'operator', role: session.role, email: session.email, name: session.full_name,
  }, 'afrisend-admin');
  const next = await issueRefreshToken({
    table: 'admin_sessions', ownerColumn: 'admin_id', ownerId: session.admin_id, userAgent, ip,
  });
  return { accessToken, refreshToken: next.token, refreshExpiresAt: next.expiresAt };
}

async function adminLogout(refreshToken) {
  if (refreshToken) {
    await db.query('update admin_sessions set revoked_at = now() where refresh_token_hash = $1', [sha256(refreshToken)]);
  }
}

async function createAdmin({ email, password, fullName, role, createdBy }) {
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('A valid email is required');
  assertPasswordStrength(password);
  const hash = await bcrypt.hash(password, 12);
  const { rows } = await db.query(
    `insert into admin_users (email, full_name, password_hash, role)
     values ($1,$2,$3,$4) returning id, email, full_name, role`,
    [String(email).toLowerCase(), fullName, hash, role],
  );
  await audit.record({
    actorType: createdBy ? 'OPERATOR' : 'SYSTEM',
    actorEmail: createdBy || 'bootstrap',
    action: 'ADMIN_CREATED', entityType: 'admin_user', entityId: rows[0].id,
    severity: 'HIGH', afterState: { email, role },
  });
  return rows[0];
}

function assertPasswordStrength(password) {
  if (typeof password !== 'string' || password.length < 12) {
    throw badRequest('Password must be at least 12 characters');
  }
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) throw badRequest('Password must combine at least three of: lowercase, uppercase, digits, symbols');
}

// ---------------------------------------------------------------------------
// Customers — SMS one-time codes
// ---------------------------------------------------------------------------
async function requestCustomerOtp({ phoneE164, ip, userAgent, purpose = 'LOGIN' }) {
  const phone = normalizePhone(phoneE164);
  const { rows: settings } = await db.query(
    "select (value #>> '{}')::int as max_per_hour from compliance_settings where key = 'otp.max_per_hour'",
  );
  const perHour = settings[0]?.max_per_hour || 5;
  const { rows: recent } = await db.query(
    "select count(*)::int as c from auth_challenges where phone_e164 = $1 and created_at > now() - interval '1 hour'",
    [phone],
  );
  if (recent[0].c >= perHour) throw tooMany('Too many codes requested for this number, try again later');

  // Development/testing affordance: a fixed code may be injected so integration
  // tests can log in without reading an SMS. It is ignored in production.
  const code = (!env.IS_PROD && process.env.DEV_OTP_CODE) ? String(process.env.DEV_OTP_CODE) : numericCode(6);
  const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);
  await db.query(
    `insert into auth_challenges (phone_e164, code_hash, purpose, expires_at)
     values ($1, $2, $3, $4)`,
    [phone, sha256(`${phone}:${code}`), purpose, expiresAt],
  );

  const delivery = await sendSms(phone, `Your AfriSend verification code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Never share it.`);
  await audit.record({
    actorType: 'CUSTOMER', actorId: null, action: 'OTP_REQUESTED',
    entityType: 'auth_challenge', entityId: phone, ip, userAgent,
    metadata: { delivered: delivery.delivered, provider: delivery.provider },
  });
  return { phone, expiresAt, delivery };
}

async function verifyCustomerOtp({ phoneE164, code, deviceId, ip, userAgent }) {
  const phone = normalizePhone(phoneE164);
  const { rows } = await db.query(
    `select * from auth_challenges
      where phone_e164 = $1 and consumed_at is null and purpose in ('LOGIN','SIGNUP')
      order by created_at desc limit 1`,
    [phone],
  );
  const challenge = rows[0];
  if (!challenge) throw unauthorized('No active code for this number. Request a new one.');
  if (new Date(challenge.expires_at) < new Date()) throw unauthorized('This code has expired. Request a new one.');
  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) throw tooMany('Too many incorrect attempts. Request a new code.');

  if (!timingSafeEquals(challenge.code_hash, sha256(`${phone}:${code}`))) {
    await db.query('update auth_challenges set attempts = attempts + 1 where id = $1', [challenge.id]);
    await audit.record({
      actorType: 'CUSTOMER', action: 'OTP_FAILED', entityType: 'auth_challenge',
      entityId: challenge.id, severity: 'WARNING', ip, userAgent,
    });
    throw unauthorized('Incorrect code');
  }

  await db.query('update auth_challenges set consumed_at = now() where id = $1', [challenge.id]);
  return createOrLoadCustomer({ phone, deviceId, ip, userAgent });
}

async function createOrLoadCustomer({ phone, deviceId, ip, userAgent }) {
  const { rows: existing } = await db.query(
    'select * from customers where phone_bidx = $1 limit 1',
    [blindIndex(phone)],
  );
  let customer = existing[0];
  let created = false;

  if (!customer) {
    const publicRef = `AFQ-${crypto.randomInt(100000, 999999)}`;
    const client = await db.pool.connect();
    try {
      await client.query('begin');
      const inserted = await client.query(
        `insert into customers (public_ref, full_name, phone_e164, phone_bidx, status, kyc_tier)
         values ($1, $2, $3, $4, 'PENDING_KYC', 0) returning *`,
        [publicRef, 'New Customer', phone, blindIndex(phone)],
      );
      customer = inserted.rows[0];
      await client.query('insert into wallets (customer_id) values ($1)', [customer.id]);
      await client.query('commit');
      created = true;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  if (customer.status === 'SUSPENDED') throw forbidden('This account is suspended. Contact support@afrisend.qa');

  const accessToken = issueAccessToken(customer.id, {
    typ: 'customer', ref: customer.public_ref, tier: customer.kyc_tier,
  }, 'afrisend-app');
  const refresh = await issueRefreshToken({
    table: 'customer_sessions', ownerColumn: 'customer_id', ownerId: customer.id,
    deviceId, userAgent: userAgent?.slice(0, 400),
  });

  if (deviceId) {
    await db.query(
      `insert into customer_devices (customer_id, device_id) values ($1,$2)
       on conflict (customer_id, device_id) do update set last_seen_at = now()`,
      [customer.id, deviceId],
    );
  }

  await audit.record({
    actorType: 'CUSTOMER', actorId: customer.id, action: created ? 'CUSTOMER_SIGNUP' : 'CUSTOMER_LOGIN',
    entityType: 'customer', entityId: customer.id, ip, userAgent,
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
    isNewAccount: created,
    customer: publicCustomer(customer),
  };
}

async function refreshCustomerSession({ refreshToken, ip, userAgent }) {
  if (!refreshToken) throw badRequest('refreshToken is required');
  const { rows } = await db.query(
    `select s.*, c.public_ref, c.kyc_tier, c.status
       from customer_sessions s join customers c on c.id = s.customer_id
      where s.refresh_token_hash = $1`,
    [sha256(refreshToken)],
  );
  const session = rows[0];
  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    throw unauthorized('Session expired');
  }
  if (session.status === 'SUSPENDED') throw forbidden('Account suspended');
  await db.query('update customer_sessions set revoked_at = now() where id = $1', [session.id]);
  const accessToken = issueAccessToken(session.customer_id, {
    typ: 'customer', ref: session.public_ref, tier: session.kyc_tier,
  }, 'afrisend-app');
  const next = await issueRefreshToken({
    table: 'customer_sessions', ownerColumn: 'customer_id', ownerId: session.customer_id,
    deviceId: session.device_id, userAgent: userAgent?.slice(0, 400),
  });
  return { accessToken, refreshToken: next.token, refreshExpiresAt: next.expiresAt };
}

async function setTransactionPin(customerId, pin) {
  if (!/^\d{6}$/.test(String(pin))) throw badRequest('Transaction PIN must be exactly 6 digits');
  const hash = await bcrypt.hash(String(pin), 12);
  await db.query('update customers set transaction_pin_hash = $2, updated_at = now() where id = $1', [customerId, hash]);
  await audit.record({
    actorType: 'CUSTOMER', actorId: customerId, action: 'TRANSACTION_PIN_SET',
    entityType: 'customer', entityId: customerId, severity: 'HIGH',
  });
}

async function verifyTransactionPin(customerId, pin) {
  const { rows } = await db.query('select transaction_pin_hash from customers where id = $1', [customerId]);
  if (!rows[0]) throw notFound('Customer not found');
  if (!rows[0].transaction_pin_hash) {
    throw badRequest('Set your transaction PIN before sending money');
  }
  if (!/^\d{6}$/.test(String(pin || ''))) throw unauthorized('Invalid transaction PIN');
  const ok = await bcrypt.compare(String(pin), rows[0].transaction_pin_hash);
  if (!ok) {
    await audit.record({
      actorType: 'CUSTOMER', actorId: customerId, action: 'TRANSACTION_PIN_FAILED',
      entityType: 'customer', entityId: customerId, severity: 'WARNING',
    });
    throw unauthorized('Invalid transaction PIN');
  }
  return true;
}

function normalizePhone(input) {
  const s = String(input || '').replace(/[\s()-]/g, '');
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^00\d+/.test(s)) return `+${s.slice(2)}`;
  if (/^\d{8}$/.test(s)) return `+974${s}`;        // local Qatari number
  if (/^974\d{8}$/.test(s)) return `+${s}`;
  throw badRequest('Phone number must be in E.164 format, e.g. +97455128842');
}

function publicCustomer(customer) {
  return {
    id: customer.id,
    reference: customer.public_ref,
    fullName: customer.full_name,
    email: customer.email,
    phone: customer.phone_e164,
    nationality: customer.nationality,
    status: customer.status,
    kycTier: customer.kyc_tier,
    riskLevel: customer.risk_level,
    hasTransactionPin: Boolean(customer.transaction_pin_hash),
    createdAt: customer.created_at,
  };
}

module.exports = {
  adminLogin, refreshAdminSession, adminLogout, createAdmin, assertPasswordStrength,
  requestCustomerOtp, verifyCustomerOtp, refreshCustomerSession,
  setTransactionPin, verifyTransactionPin, normalizePhone, publicCustomer,
  issueAccessToken,
};
