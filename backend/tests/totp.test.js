'use strict';
/**
 * Operator MFA (RFC 6238 TOTP).
 * The known-answer vector below is the one published in RFC 6238 Appendix B,
 * so this proves the implementation, not just self-consistency.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const totp = require('../services/totp');

// RFC 6238 test secret: ASCII "12345678901234567890" base32-encoded.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('matches the RFC 6238 reference vectors', () => {
  const vectors = [
    { at: 59_000, expected: '94287082' },
    { at: 1_111_111_109_000, expected: '07081804' },
    { at: 1_111_111_111_000, expected: '14050471' },
    { at: 2_000_000_000_000, expected: '69279037' },
  ];
  for (const vector of vectors) {
    assert.equal(totp.currentTotp(RFC_SECRET, { digits: 8, at: vector.at }), vector.expected);
  }
});

test('generates 6-digit codes by default', () => {
  assert.match(totp.currentTotp(RFC_SECRET), /^\d{6}$/);
});

test('a freshly generated secret produces a verifiable code', () => {
  const secret = totp.generateSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.ok(totp.verifyTotp(secret, totp.currentTotp(secret)));
});

test('wrong codes are rejected', () => {
  const secret = totp.generateSecret();
  const code = totp.currentTotp(secret);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  assert.ok(!totp.verifyTotp(secret, wrong));
  assert.ok(!totp.verifyTotp(secret, ''));
  assert.ok(!totp.verifyTotp(secret, 'abcdef'));
  assert.ok(!totp.verifyTotp('not-base32-!!!', code));
});

test('one step of clock drift is tolerated in both directions', () => {
  const secret = totp.generateSecret();
  const previous = totp.currentTotp(secret, { at: Date.now() - 30_000 });
  const next = totp.currentTotp(secret, { at: Date.now() + 30_000 });
  assert.ok(totp.verifyTotp(secret, previous), 'a slow authenticator must still work');
  assert.ok(totp.verifyTotp(secret, next), 'a fast authenticator must still work');
});

test('codes far outside the drift window are rejected', () => {
  const secret = totp.generateSecret();
  const old = totp.currentTotp(secret, { at: Date.now() - 10 * 60_000 });
  assert.ok(!totp.verifyTotp(secret, old));
});

test('the otpauth URL is scannable and carries the issuer', () => {
  const secret = totp.generateSecret();
  const url = totp.otpauthUrl({ secret, email: 'mlro@afrisend.qa' });
  assert.match(url, /^otpauth:\/\/totp\//);
  assert.ok(url.includes(`secret=${secret}`));
  assert.ok(url.includes('issuer=AfriSend%20Ops'));
  assert.ok(url.includes('digits=6'));
  assert.ok(url.includes('mlro%40afrisend.qa'));
});
