'use strict';
/**
 * PII protection and regulatory filing signatures.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  encryptPII, decryptPII, blindIndex, maskTail, sha256, numericCode,
  timingSafeEquals, generateRsaKeyPair, signPayload, verifySignature,
} = require('../lib/crypto');

test('PII round-trips', () => {
  const qid = '29463401928';
  const sealed = encryptPII(qid);
  assert.ok(sealed.startsWith('v1:'));
  assert.notEqual(sealed, qid);
  assert.equal(decryptPII(sealed), qid);
});

test('the same value encrypts differently each time (random IV)', () => {
  const a = encryptPII('29463401928');
  const b = encryptPII('29463401928');
  assert.notEqual(a, b, 'identical ciphertext would leak equality');
  assert.equal(decryptPII(a), decryptPII(b));
});

test('tampered ciphertext is rejected, not silently decrypted', () => {
  const sealed = encryptPII('29463401928');
  const [version, iv, tag, data] = sealed.split(':');
  const flipped = Buffer.from(data, 'base64');
  flipped[0] ^= 0xff;
  assert.equal(decryptPII([version, iv, tag, flipped.toString('base64')].join(':')), null);
  assert.equal(decryptPII('v1:not:valid:data'), null);
  assert.equal(decryptPII('garbage'), null);
  assert.equal(decryptPII(null), null);
});

test('empty values are stored as null rather than encrypted emptiness', () => {
  assert.equal(encryptPII(''), null);
  assert.equal(encryptPII(null), null);
  assert.equal(encryptPII(undefined), null);
});

test('blind index is deterministic and case-insensitive, but not reversible', () => {
  const a = blindIndex('+97455128842');
  const b = blindIndex(' +97455128842 ');
  const c = blindIndex('+97455128843');
  assert.equal(a, b, 'lookup must find the same phone number written slightly differently');
  assert.notEqual(a, c);
  assert.equal(a.length, 64);
  assert.ok(!a.includes('974'));
});

test('maskTail never exposes the full identifier', () => {
  assert.equal(maskTail('29463401928'), '••••1928');
  assert.equal(maskTail('1234'), '1234');
  assert.equal(maskTail(null), null);
});

test('one-time codes are numeric and uniformly padded', () => {
  for (let i = 0; i < 50; i += 1) {
    const code = numericCode(6);
    assert.match(code, /^\d{6}$/);
  }
  assert.match(numericCode(4), /^\d{4}$/);
});

test('constant-time comparison behaves like equality', () => {
  assert.ok(timingSafeEquals('abc', 'abc'));
  assert.ok(!timingSafeEquals('abc', 'abd'));
  assert.ok(!timingSafeEquals('abc', 'abcd'));
  assert.ok(!timingSafeEquals('', 'a'));
});

test('hashing is stable', () => {
  assert.equal(sha256('hello'), crypto.createHash('sha256').update('hello').digest('hex'));
});

test('QCB filings can be signed and verified', () => {
  const { publicKey, privateKey } = generateRsaKeyPair();
  const payloadHash = sha256(JSON.stringify({ transfers: 42, volume: 123456 }));
  const signature = signPayload(privateKey, payloadHash);

  assert.ok(verifySignature(publicKey, payloadHash, signature), 'a valid signature must verify');
  assert.ok(!verifySignature(publicKey, sha256('tampered'), signature), 'a modified payload must fail');
  assert.ok(!verifySignature(publicKey, payloadHash, 'not-a-signature'), 'a bad signature must fail');

  const other = generateRsaKeyPair();
  assert.ok(!verifySignature(other.publicKey, payloadHash, signature), 'another key must not verify it');
});
