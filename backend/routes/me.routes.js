'use strict';
const express = require('express');
const { z } = require('zod');
const customers = require('../services/customers');
const kyc = require('../services/kyc');
const transfers = require('../services/transfers');
const screening = require('../services/screening');
const { requireCustomer } = require('../middleware/auth');
const { validateBody, validateQuery } = require('../middleware/validate');
const { transferLimiter } = require('../middleware/rateLimit');
const { badRequest } = require('../lib/errors');

const router = express.Router();
router.use(requireCustomer);

// --- Profile / wallet -------------------------------------------------------
router.get('/profile', async (req, res, next) => {
  try { res.json({ success: true, profile: await customers.getProfile(req.customer.id) }); } catch (err) { next(err); }
});

const profileSchema = z.object({
  fullName: z.string().min(3).max(120).optional(),
  email: z.string().email().optional(),
  nationality: z.string().length(2).optional(),
  occupation: z.string().max(120).optional(),
  employer: z.string().max(160).optional(),
  sourceOfFunds: z.string().max(160).optional(),
  address: z.string().max(400).optional(),
});

router.patch('/profile', validateBody(profileSchema), async (req, res, next) => {
  try { res.json({ success: true, profile: await customers.getProfile(req.customer.id) }); } catch (err) { next(err); }
});

// --- Beneficiaries ---------------------------------------------------------
router.get('/beneficiaries', async (req, res, next) => {
  try { res.json({ success: true, beneficiaries: await customers.listBeneficiaries(req.customer.id) }); } catch (err) { next(err); }
});

const resolveSchema = z.object({
  accountNumber: z.string().min(6).max(20),
  institutionCode: z.string().min(2).max(10),
});

/** Preview the legal account name BEFORE the beneficiary is saved. */
router.post('/beneficiaries/resolve', transferLimiter, validateBody(resolveSchema), async (req, res, next) => {
  try {
    const engine = require('../services/remittanceEngine');
    const result = await engine.resolveAccount({
      accountNumber: req.body.accountNumber, bankCode: req.body.institutionCode,
    });
    if (!result.ok) {
      return res.status(422).json({ success: false, error: { code: 'RESOLVE_FAILED', message: result.error } });
    }
    return res.json({ success: true, accountName: result.accountName, provider: result.provider });
  } catch (err) { return next(err); }
});

const beneficiarySchema = z.object({
  fullName: z.string().min(3).max(120),
  nickname: z.string().max(60).optional(),
  countryCode: z.string().length(2),
  currency: z.string().length(3),
  channel: z.enum(['FLUTTERWAVE_BANK', 'FLUTTERWAVE_MOBILE_MONEY', 'RIA_CASH_PICKUP']),
  institutionCode: z.string().max(10).optional(),
  institutionName: z.string().max(120).optional(),
  accountNumber: z.string().min(6).max(34),
});

router.post('/beneficiaries', transferLimiter, validateBody(beneficiarySchema), async (req, res, next) => {
  try {
    const beneficiary = await customers.addBeneficiary(req.customer.id, req.body);
    res.status(201).json({
      success: true,
      beneficiary,
      warning: beneficiary.name_match_score != null && Number(beneficiary.name_match_score) < 60
        ? 'The account name returned by the bank is different from the name you entered. Check the account number carefully.'
        : null,
    });
  } catch (err) { next(err); }
});

router.delete('/beneficiaries/:id', async (req, res, next) => {
  try { res.json({ success: true, ...(await customers.deactivateBeneficiary(req.customer.id, req.params.id)) }); } catch (err) { next(err); }
});

// --- KYC -------------------------------------------------------------------
const kycSchema = z.object({
  fullName: z.string().min(3).max(120).optional(),
  nationality: z.string().length(2).optional(),
  requestedTier: z.number().int().min(1).max(3).optional(),
  documentType: z.enum(['QID', 'PASSPORT', 'RESIDENCE_PERMIT', 'DRIVING_LICENCE']),
  qidNumber: z.string().min(5).max(30).optional(),
  documentNumber: z.string().min(5).max(30).optional(),
  documentExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  livenessScore: z.number().min(0).max(100).optional(),
  faceMatchScore: z.number().min(0).max(100).optional(),
  documentQuality: z.number().min(0).max(100).optional(),
});

router.post('/kyc', transferLimiter, validateBody(kycSchema), async (req, res, next) => {
  try {
    const request = await kyc.submit({ customerId: req.customer.id, input: req.body });
    res.status(201).json({ success: true, request });
  } catch (err) { next(err); }
});

router.get('/kyc', async (req, res, next) => {
  try { res.json({ success: true, submissions: await kyc.status(req.customer.id) }); } catch (err) { next(err); }
});

// --- Transfers -------------------------------------------------------------
router.get('/transfers', validateQuery(z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.string().optional(),
})), async (req, res, next) => {
  try {
    const list = await transfers.listForCustomer({
      customerId: req.customer.id, limit: req.query.limit || 50, status: req.query.status || null,
    });
    res.json({ success: true, transfers: list });
  } catch (err) { next(err); }
});

router.get('/transfers/:reference', async (req, res, next) => {
  try {
    const transfer = await transfers.findByReference({
      reference: req.params.reference, customerId: req.customer.id,
    });
    res.json({ success: true, transfer });
  } catch (err) { next(err); }
});

// --- Wallet funding --------------------------------------------------------
const fundingSchema = z.object({
  amount: z.union([z.string(), z.number()]),
  method: z.enum(['CARD', 'BANK_TRANSFER']).default('CARD'),
});

router.post('/wallet/fundings', transferLimiter, validateBody(fundingSchema), async (req, res, next) => {
  try {
    const funding = await customers.startFunding({
      customerId: req.customer.id, amountMajor: req.body.amount, method: req.body.method,
    });
    res.status(201).json({ success: true, funding });
  } catch (err) { next(err); }
});

router.get('/wallet/fundings', async (req, res, next) => {
  try { res.json({ success: true, fundings: await customers.listFundings(req.customer.id) }); } catch (err) { next(err); }
});

// --- Utilities -------------------------------------------------------------
/** Screen a name before saving a beneficiary (customer-visible safety check). */
router.post('/screening/name', transferLimiter, async (req, res, next) => {
  try {
    if (!req.body?.name) throw badRequest('name is required');
    const result = await screening.screenName(req.body.name);
    res.json({
      success: true,
      outcome: result.outcome,
      matchCount: result.matchCount,
      bestScore: result.bestScore,
      listsChecked: result.listsChecked,
    });
  } catch (err) { next(err); }
});

router.post('/devices', async (req, res, next) => {
  try {
    const { deviceId, platform, pushToken } = req.body || {};
    if (!deviceId) throw badRequest('deviceId is required');
    const db = require('../db/pool');
    await db.query(
      `insert into customer_devices (customer_id, device_id, platform, push_token, last_seen_at)
       values ($1,$2,$3,$4, now())
       on conflict (customer_id, device_id) do update
         set push_token = coalesce(excluded.push_token, customer_devices.push_token),
             platform = coalesce(excluded.platform, customer_devices.platform),
             last_seen_at = now()`,
      [req.customer.id, deviceId, platform || null, pushToken || null],
    );
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
