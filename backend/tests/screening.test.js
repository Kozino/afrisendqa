'use strict';
/**
 * Name-matching policy for sanctions / PEP screening.
 *
 * These tests lock the documented behaviour in services/screening.js:
 *   exact            → 1.0
 *   word order       → HIT band (≥ 0.86)
 *   extra tokens     → penalised by unmatched material, not free
 *   one shared token → capped at 0.80, so a human decides (0.72–0.86)
 *   unrelated names  → CLEAR (< 0.72)
 *
 * False negatives here mean a sanctioned person can transact, so the variants
 * matter more than the happy path.
 */
require('./helpers/env');
const test = require('node:test');
const assert = require('node:assert/strict');
const screening = require('../services/screening');

const MATCH_THRESHOLD = 0.86;
const REVIEW_THRESHOLD = 0.72;

const score = (a, b) => screening.nameScore(a, b);

test('normalizeName folds accents, punctuation and honorifics', () => {
  assert.equal(screening.normalizeName('Mr. José  O’Brien-Smith'), 'JOSE OBRIEN SMITH');
  assert.equal(screening.normalizeName('SHEIKH Abdullah al-Rashid'), 'ABDULLAH AL RASHID');
  assert.equal(screening.normalizeName('  Ama   Diallo  '), 'AMA DIALLO');
  assert.equal(screening.normalizeName(''), '');
  assert.equal(screening.normalizeName(null), '');
  assert.equal(screening.normalizeName(undefined), '');
});

test('identical names are an exact match', () => {
  assert.equal(score('Amara Okafor', 'Amara Okafor'), 1);
  assert.equal(score('amara   okafor', 'AMARA OKAFOR'), 1);
  assert.equal(score('José O’Brien-Smith', 'Jose OBrien Smith'), 1);
});

test('word order and extra middle names reach the match band', () => {
  // The case that must not slip through: a name written in the other order.
  assert.ok(score('Muhammad A. Diallo', 'Diallo Muhammad') >= MATCH_THRESHOLD,
    `word-order variant scored ${score('Muhammad A. Diallo', 'Diallo Muhammad')}`);
  assert.ok(score('Fatoumata Diallo', 'Diallo Fatoumata') >= MATCH_THRESHOLD);
});

test('an honorific does not change the score', () => {
  assert.ok(score('Dr. Ahmad Al-Rashid', 'Ahmad Rashid') >= MATCH_THRESHOLD);
});

test('a spelling variant of one component lands in the review band, not a hit', () => {
  const value = score('Abubakar Sani', 'Abubakr Sani');
  assert.ok(value >= REVIEW_THRESHOLD && value < MATCH_THRESHOLD,
    `a genuinely different spelling should reach a human, got ${value}`);
});

test('a single shared component never reaches blocking confidence', () => {
  const value = score('John Smith', 'Mohammed Smith');
  assert.ok(value <= screening.SINGLE_TOKEN_CEILING,
    `one shared surname must be capped, got ${value}`);
  assert.ok(value < MATCH_THRESHOLD, 'a single shared token must not auto-block');
});

test('unrelated names clear', () => {
  assert.ok(score('Chinedu Okafor', 'Fatima Al Zahra') < REVIEW_THRESHOLD);
  assert.ok(score('Kofi Mensah', 'Wanjiku Kamau') < REVIEW_THRESHOLD);
  assert.ok(score('Amara Okafor', 'Vladimir Petrov') < 0.3);
});

test('empty input never produces a match', () => {
  assert.equal(score('', 'Amara Okafor'), 0);
  assert.equal(score('Amara Okafor', ''), 0);
  assert.equal(score('', ''), 0);
  assert.equal(score(null, null), 0);
});

test('scores are symmetric', () => {
  const pairs = [
    ['Muhammad A. Diallo', 'Diallo Muhammad'],
    ['John Smith', 'Mohammed Smith'],
    ['Abubakar Sani', 'Abubakr Sani'],
    ['Kofi Mensah', 'Wanjiku Kamau'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(score(a, b), score(b, a), `asymmetric score for ${a} / ${b}`);
  }
});

test('scores never exceed 1', () => {
  const pairs = [
    ['Amara Okafor', 'Amara Okafor Okafor Okafor'],
    ['A', 'AAAA'],
    ['Muhammad Diallo', 'Muhammad Muhammad Diallo Diallo'],
  ];
  for (const [a, b] of pairs) {
    assert.ok(score(a, b) <= 1, `${a} / ${b} scored ${score(a, b)}`);
  }
});

test('scoring detail is available for the audit trail', () => {
  const detail = screening.nameScore('Muhammad A. Diallo', 'Diallo Muhammad', { returnDetail: true });
  assert.equal(detail.matchedTokens, 2);
  assert.equal(detail.reason, 'TOKEN_SORT');
  const single = screening.nameScore('John Smith', 'Mohammed Smith', { returnDetail: true });
  assert.equal(single.matchedTokens, 1);
  assert.equal(single.reason, 'SINGLE_TOKEN_MATCH');
  const none = screening.nameScore('Kofi Mensah', 'Wanjiku Kamau', { returnDetail: true });
  assert.equal(none.matchedTokens, 0);
  assert.equal(none.reason, 'NO_TOKEN_OVERLAP');
});

test('the underlying primitives behave as documented', () => {
  assert.equal(screening.lcsLength('ABC', 'ABC'), 3);
  assert.equal(screening.lcsLength('ABC', ''), 0);
  assert.equal(screening.ratio('ABC', 'ABC'), 1);
  assert.ok(screening.ratio('ABC', 'AXC') > 0.6 && screening.ratio('ABC', 'AXC') < 1);
  assert.equal(screening.tokenSortRatio('b a', 'A B'), 1, 'token sort ignores order');
  // tokenSetRatio is the set score multiplied by the Jaccard overlap of the
  // token sets, so a single shared token cannot score 1.0:
  //   "john smith" vs "mohammed smith" → 1 shared of 3 distinct tokens = 1/3
  //   "Muhammad A. Diallo" vs "Diallo Muhammad" → 2 shared of 3 = 2/3
  assert.equal(Number(screening.tokenSetRatio('john smith', 'mohammed smith').toFixed(4)), 0.3333);
  assert.equal(Number(screening.tokenSetRatio('Muhammad A. Diallo', 'Diallo Muhammad').toFixed(4)), 0.6667);
  assert.equal(screening.tokenSetRatio('john smith', 'JOHN SMITH'), 1);
  assert.equal(screening.matchedTokenCount('Muhammad A. Diallo', 'Diallo Muhammad'), 2);
});
