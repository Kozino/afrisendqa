'use strict';
const rateLimit = require('express-rate-limit');

const common = {
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down.' } },
};

/** Sensitive auth surfaces: OTP requests, OTP verification, admin login. */
const authLimiter = rateLimit({
  ...common, windowMs: 10 * 60_000, limit: 20,
  keyGenerator: (req) => req.ip,
});

/** Public quote/rate endpoints. */
const publicLimiter = rateLimit({
  ...common, windowMs: 60_000, limit: 120,
});

/** Money movement: per customer (falls back to IP). */
const transferLimiter = rateLimit({
  ...common, windowMs: 60_000, limit: 20,
  keyGenerator: (req) => req.customer?.id || req.ip,
});

/** Webhooks: providers retry, so the ceiling is high but not unbounded. */
const webhookLimiter = rateLimit({
  ...common, windowMs: 60_000, limit: 600,
  keyGenerator: (req) => req.ip,
});

module.exports = { authLimiter, publicLimiter, transferLimiter, webhookLimiter };
