'use strict';
const express = require('express');
const { z } = require('zod');
const db = require('../db/pool');
const auth = require('../services/auth');
const { validateBody } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { requireCustomer } = require('../middleware/auth');
const { env } = require('../config/env');
const audit = require('../services/audit');

const router = express.Router();

// ---------------------------------------------------------------------------
// Customers (mobile app)
// ---------------------------------------------------------------------------
const otpRequestSchema = z.object({
  phone: z.string().min(8).max(20),
  deviceId: z.string().max(120).optional(),
});

router.post('/otp/request', authLimiter, validateBody(otpRequestSchema), async (req, res, next) => {
  try {
    const result = await auth.requestCustomerOtp({
      phoneE164: req.body.phone, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({
      success: true,
      phone: result.phone,
      expiresAt: result.expiresAt,
      delivery: {
        channel: 'sms',
        provider: result.delivery.provider,
        // Never return the code itself. In development, when Twilio is not
        // configured, it is written to the server log instead.
        delivered: result.delivery.delivered,
      },
      nextStep: 'VERIFY_OTP',
    });
  } catch (err) { next(err); }
});

const otpVerifySchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^\d{4,8}$/),
  deviceId: z.string().max(120).optional(),
});

router.post('/otp/verify', authLimiter, validateBody(otpVerifySchema), async (req, res, next) => {
  try {
    const session = await auth.verifyCustomerOtp({
      phoneE164: req.body.phone, code: req.body.code,
      deviceId: req.body.deviceId, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ success: true, ...session });
  } catch (err) { next(err); }
});

router.post('/refresh', authLimiter, async (req, res, next) => {
  try {
    const tokens = await auth.refreshCustomerSession({
      refreshToken: req.body?.refreshToken, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ success: true, ...tokens });
  } catch (err) { next(err); }
});

/** Set or change the 6-digit transaction PIN (required before the first send). */
router.post('/pin', requireCustomer, async (req, res, next) => {
  try {
    const { pin, currentPin } = req.body || {};
    const { rows } = await db.query('select transaction_pin_hash from customers where id = $1', [req.customer.id]);
    if (rows[0]?.transaction_pin_hash) {
      await auth.verifyTransactionPin(req.customer.id, currentPin);
    }
    await auth.setTransactionPin(req.customer.id, pin);
    res.json({ success: true, message: 'Transaction PIN set.' });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// Operators (admin console)
// ---------------------------------------------------------------------------
const adminLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z.string().regex(/^\d{6}$/).optional(),
});

router.post('/admin/login', authLimiter, validateBody(adminLoginSchema), async (req, res, next) => {
  try {
    const result = await auth.adminLogin({
      email: req.body.email, password: req.body.password, totp: req.body.totp,
      ip: req.ip, userAgent: req.get('user-agent'),
    });
    if (result.mfaRequired) {
      return res.status(206).json({ success: true, mfaRequired: true, message: 'Enter your authenticator code.' });
    }
    return res.json({ success: true, ...result });
  } catch (err) { return next(err); }
});

router.post('/admin/refresh', authLimiter, async (req, res, next) => {
  try {
    const tokens = await auth.refreshAdminSession({
      refreshToken: req.body?.refreshToken, ip: req.ip, userAgent: req.get('user-agent'),
    });
    res.json({ success: true, ...tokens });
  } catch (err) { next(err); }
});

router.post('/admin/logout', async (req, res, next) => {
  try {
    await auth.adminLogout(req.body?.refreshToken);
    await audit.record({ actorType: 'OPERATOR', action: 'ADMIN_LOGOUT', ip: req.ip });
    res.json({ success: true });
  } catch (err) { next(err); }
});

router.get('/config', (req, res) => {
  res.json({
    success: true,
    environment: env.NODE_ENV,
    institution: env.INSTITUTION_NAME,
    railways: {
      flutterwave: true,
      ria: Boolean(env.RIA_API_KEY),
    },
    otpChannel: 'sms',
  });
});

module.exports = router;
