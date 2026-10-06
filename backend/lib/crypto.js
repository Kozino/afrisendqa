'use strict';
/**
 * PII protection.
 *
 *   encryptPII()  AES-256-GCM, random 96-bit IV, authenticated.
 *                 Output format: v1:<iv-b64>:<tag-b64>:<ciphertext-b64>
 *   decryptPII()  reverse. Returns null when the value cannot be decrypted
 *                 (key rotated without re-encryption) instead of throwing, so a
 *                 rotation mistake degrades the field rather than the request.
 *   blindIndex()  HMAC-SHA256 hex — deterministic, used for equality lookups
 *                 (find customer by phone, dedupe a beneficiary account) and
 *                 for spotting the same QID being used twice.
 *   maskTail()    last-4 display helper. We never show a full QID or account
 *                 number in the console or in API responses.
 */
const crypto = require('crypto');
const { env } = require('../config/env');

const key = Buffer.from(env.PII_ENCRYPTION_KEY, 'hex');
const hmacKey = Buffer.from(env.PII_HMAC_KEY, 'hex');

if (key.length !== 32) throw new Error('PII_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
if (hmacKey.length !== 32) throw new Error('PII_HMAC_KEY must be 32 bytes (64 hex chars)');

function encryptPII(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':');
}

function decryptPII(payload) {
  if (!payload) return null;
  try {
    const [version, ivB64, tagB64, dataB64] = String(payload).split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

function blindIndex(value) {
  if (value === null || value === undefined) return null;
  return crypto.createHmac('sha256', hmacKey).update(String(value).trim().toLowerCase()).digest('hex');
}

function maskTail(value, visible = 4) {
  if (!value) return null;
  const s = String(value);
  return s.length <= visible ? s : `••••${s.slice(-visible)}`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** 6-digit numeric OTP, uniformly distributed. */
function numericCode(digits = 6) {
  const max = 10 ** digits;
  return String(crypto.randomInt(0, max)).padStart(digits, '0');
}

function timingSafeEquals(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function generateRsaKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

function signPayload(privateKeyPem, payload) {
  return crypto.sign('sha256', Buffer.from(payload), {
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  }).toString('base64');
}

function verifySignature(publicKeyPem, payload, signatureB64) {
  try {
    return crypto.verify('sha256', Buffer.from(payload), {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

module.exports = {
  encryptPII, decryptPII, blindIndex, maskTail, sha256, randomToken,
  numericCode, timingSafeEquals, generateRsaKeyPair, signPayload, verifySignature,
};
