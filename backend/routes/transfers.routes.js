'use strict';
const express = require('express');
const { z } = require('zod');
const money = require('../lib/money');
const fx = require('../services/fx');
const transfers = require('../services/transfers');
const { requireCustomer } = require('../middleware/auth');
const { validateBody } = require('../middleware/validate');
const { idempotency } = require('../middleware/idempotency');
const { transferLimiter } = require('../middleware/rateLimit');
const { badRequest } = require('../lib/errors');

const router = express.Router();
router.use(requireCustomer);

/**
 * Price a transfer. The response is the exact contract the app renders on the
 * review screen, in both minor units and formatted strings.
 */
const quoteSchema = z.object({
  currency: z.string().length(3),
  amount: z.union([z.string(), z.number()]),          // QAR, in major units
  countryCode: z.string().length(2).optional(),
});

router.post('/quotes', transferLimiter, validateBody(quoteSchema), async (req, res, next) => {
  try {
    const amountQarMinor = money.toMinor(req.body.amount, 'QAR');
    if (amountQarMinor <= 0) throw badRequest('amount must be greater than zero');
    const quote = await fx.createQuote({
      customerId: req.customer.id,
      currency: req.body.currency.toUpperCase(),
      sendAmountQarMinor: amountQarMinor,
      countryCode: req.body.countryCode?.toUpperCase(),
    });
    res.status(201).json({ success: true, quote });
  } catch (err) { next(err); }
});

/**
 * Create the transfer. Money movement, so it requires:
 *   - an Idempotency-Key header (retry-safe),
 *   - the 6-digit transaction PIN,
 *   - a quote that has not expired.
 */
const createSchema = z.object({
  quoteId: z.string().uuid(),
  beneficiaryId: z.string().uuid(),
  pin: z.string().regex(/^\d{6}$/),
  purposeCode: z.string().max(40).optional(),
  purposeNarrative: z.string().max(300).optional(),
  reference: z.string().min(6).max(60).optional(),
});

router.post('/', transferLimiter, idempotency('transfer:create'), validateBody(createSchema), async (req, res, next) => {
  try {
    const transfer = await transfers.createTransfer({
      customerId: req.customer.id,
      body: req.body,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      idempotencyKey: req.get('idempotency-key'),
    });
    const status = transfer.status === 'AML_HOLD' ? 202 : 201;
    res.status(status).json({
      success: true,
      transfer,
      message: transfer.status === 'AML_HOLD'
        ? 'Your transfer is being reviewed by our compliance team. You will be notified within 24 hours.'
        : 'Transfer submitted. You can track it in Activity.',
    });
  } catch (err) { next(err); }
});

module.exports = router;
