'use strict';
const express = require('express');
const db = require('../db/pool');
const fx = require('../services/fx');
const engine = require('../services/remittanceEngine');
const { health: dbHealth } = require('../db/pool');
const { publicLimiter } = require('../middleware/rateLimit');
const { env } = require('../config/env');

const router = express.Router();

/** Liveness — Render/Render health check. No dependencies touched. */
router.get('/healthz', (req, res) => {
  res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()), version: process.env.APP_VERSION || '1.0.0' });
});

/** Readiness — verifies the database and reports which rails are live. */
router.get('/readyz', async (req, res) => {
  try {
    const info = await dbHealth();
    const rails = engine.health();
    res.json({
      status: 'ready',
      database: { connected: true, serverTime: info.now, name: info.db },
      rails,
      sms: { configured: require('../services/notifications').smsConfigured },
      environment: env.NODE_ENV,
    });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', database: { connected: false, error: err.message } });
  }
});

/** Public corridor + fee schedule the app shows before login. */
router.get('/corridors', publicLimiter, async (req, res, next) => {
  try {
    const corridors = await fx.corridors();
    const fee = await fx.feeFor(50000);
    res.json({
      success: true,
      fundingCurrency: 'QAR',
      feeQarMinor: Number(fee),
      corridors,
    });
  } catch (err) { next(err); }
});

/** Live market rate snapshot (base rate only, no customer pricing). */
router.get('/rates/:currency', publicLimiter, async (req, res, next) => {
  try {
    const corridor = await fx.getCorridor(req.params.currency);
    res.json({
      success: true,
      currency: corridor.currency,
      baseRate: Number(corridor.base_rate),
      retailRate: Number(corridor.retail_rate),
      updatedAt: corridor.updated_at,
    });
  } catch (err) { next(err); }
});

/** Bank / mobile-money directory for a country (Flutterwave rail). */
router.get('/institutions', publicLimiter, async (req, res, next) => {
  try {
    const country = String(req.query.country || 'NG').toUpperCase();
    const result = await engine.listBanks({ country });
    if (!result.ok) {
      return res.status(503).json({ success: false, error: { code: 'RAIL_UNAVAILABLE', message: result.error } });
    }
    const institutions = (result.banks || []).map((b) => ({
      code: b.code, name: b.name, type: b.type || 'bank',
    }));
    return res.json({ success: true, country, count: institutions.length, institutions });
  } catch (err) { return next(err); }
});

/** Purpose-of-transfer codes required by the QCB on outbound transfers. */
router.get('/purpose-codes', publicLimiter, async (req, res, next) => {
  try {
    const { rows } = await db.query('select code, label, requires_narrative from purpose_codes order by label');
    res.json({ success: true, purposeCodes: rows });
  } catch (err) { next(err); }
});

module.exports = router;
