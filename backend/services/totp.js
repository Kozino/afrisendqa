'use strict';
/**
 * RFC 6238 TOTP (SHA-1, 6 digits, 30s step) implemented on node:crypto so the
 * backend has no extra dependency for MFA. Compatible with Google Authenticator,
 * Authy, 1Password, Microsoft Authenticator.
 */
const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const clean = String(input).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function hotp(secretBuffer, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', secretBuffer).update(buf).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(code % 10 ** digits).padStart(digits, '0');
}

function currentTotp(secret, { digits = 6, step = 30, at = Date.now() } = {}) {
  return hotp(base32Decode(secret), Math.floor(at / 1000 / step), digits);
}

/** Allows ±1 time step of clock drift. */
function verifyTotp(secret, token, options = {}) {
  try {
    const step = options.step || 30;
    const counter = Math.floor(Date.now() / 1000 / step);
    const buffer = base32Decode(secret);
    for (const drift of [-1, 0, 1]) {
      if (hotp(buffer, counter + drift) === String(token).trim()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function otpauthUrl({ secret, email, issuer = 'AfriSend Ops' }) {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}`
    + `?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = { generateSecret, currentTotp, verifyTotp, otpauthUrl, base32Encode, base32Decode };
