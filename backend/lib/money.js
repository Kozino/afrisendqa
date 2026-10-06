'use strict';
/**
 * Money helpers.
 *
 * Money NEVER touches a JS float. Amounts travel as integers in minor units
 * (halalas, kobo, cents…) and every conversion is integer-only:
 *
 *   multiplyByRate(50000, '35.01675')  → 1,750,838 KES minor units
 *   divideByRate(1750838, '35.55')     → 49,251 QAR minor units
 *
 * Postgres `numeric` columns arrive as strings ("421.06000000"); floats are
 * rejected by parseRate() rather than silently rounded.
 *
 * Kept in sync with the `currencies` table (exponent column). Adding a currency
 * here without a row there is a bug — the SQL ledger will refuse the posting.
 */

const EXPONENTS = {
  QAR: 2, USD: 2, NGN: 2, GHS: 2, KES: 2, EGP: 2,
  UGX: 0, TZS: 0, RWF: 0, XAF: 0, XOF: 0,
};

const SYMBOLS = {
  QAR: 'QAR', USD: 'USD', NGN: 'NGN', GHS: 'GHS', KES: 'KSh', EGP: 'EGP',
  UGX: 'USh', TZS: 'TSh', RWF: 'FRw', XAF: 'FCFA', XOF: 'CFA',
};

function exponent(currency) {
  const e = EXPONENTS[String(currency).toUpperCase()];
  if (e === undefined) {
    throw Object.assign(new Error(`Unknown currency ${currency}`), { status: 400, code: 'UNKNOWN_CURRENCY' });
  }
  return e;
}

/** "1,234.50" | 1234.5 | "1234" → minor units. Rejects excess precision. */
function toMinor(amount, currency) {
  const e = exponent(currency);
  const raw = String(amount).replace(/,/g, '').trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw Object.assign(new Error(`Invalid amount "${amount}"`), { status: 400, code: 'INVALID_AMOUNT' });
  }
  const negative = raw.startsWith('-');
  const [whole, frac = ''] = raw.replace('-', '').split('.');
  if (frac.length > e) {
    throw Object.assign(
      new Error(`${String(currency).toUpperCase()} supports ${e} decimal place(s); received "${amount}"`),
      { status: 400, code: 'PRECISION_NOT_SUPPORTED' },
    );
  }
  const padded = (frac + '0'.repeat(e)).slice(0, e);
  const minor = BigInt(whole) * 10n ** BigInt(e) + BigInt(padded || '0');
  return Number(negative ? -minor : minor);
}

/** minor units → decimal number. Display/analytics only, never for arithmetic. */
function toMajor(minor, currency) {
  const e = exponent(currency);
  return Number(minor) / 10 ** e;
}

/** minor units → "1,234.50" (exact, string math). */
function format(minor, currency) {
  const e = exponent(currency);
  const value = BigInt(Math.trunc(Number(minor)));
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(e + 1, '0');
  const whole = digits.slice(0, digits.length - e) || '0';
  const frac = e > 0 ? `.${digits.slice(digits.length - e)}` : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${grouped}${frac}`;
}

/** minor units → "1,234.50 NGN" */
function formatWithCurrency(minor, currency) {
  const sym = SYMBOLS[String(currency).toUpperCase()] || String(currency).toUpperCase();
  return `${format(minor, currency)} ${sym}`;
}

/** Exact rational parsing of a rate: "421.06" → { value: 42106n, scale: 100n }. */
function parseRate(rate) {
  const raw = String(rate).trim();
  const match = raw.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) {
    throw Object.assign(new Error(`Invalid rate "${rate}"`), { status: 400, code: 'INVALID_RATE' });
  }
  const whole = match[1];
  const frac = match[2] || '';
  return { value: BigInt(whole + frac), scale: 10n ** BigInt(frac.length) };
}

/** round(minor × rate), half up, integer-only. */
function multiplyByRate(minor, rate) {
  const { value, scale } = parseRate(rate);
  const numerator = BigInt(Math.trunc(Number(minor))) * value;
  return Number((numerator * 2n + scale) / (scale * 2n));
}

/** round(minor ÷ rate), half up, integer-only. */
function divideByRate(minor, rate) {
  const { value, scale } = parseRate(rate);
  if (value === 0n) {
    throw Object.assign(new Error('rate cannot be zero'), { status: 400, code: 'INVALID_RATE' });
  }
  const numerator = BigInt(Math.trunc(Number(minor))) * scale;
  return Number((numerator * 2n + value) / (value * 2n));
}

function sum(values) {
  return Number(values.reduce((acc, v) => acc + BigInt(Math.trunc(Number(v))), 0n));
}

module.exports = {
  EXPONENTS, SYMBOLS, exponent, toMinor, toMajor, format, formatWithCurrency,
  parseRate, multiplyByRate, divideByRate, sum,
};
