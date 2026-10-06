'use strict';
/**
 * Idempotency for money POSTs.
 *
 * The client sends `Idempotency-Key`. We store (scope, key) → request hash and
 * the response. A retry with the same key and same body returns the stored
 * response with `Idempotency-Replayed: true`; the same key with a *different*
 * body is rejected with 409 (that is a client bug, not a retry).
 *
 * A concurrent duplicate gets 409 while the first request is still in flight —
 * safer than double-spending the customer's balance.
 */
const db = require('../db/pool');
const { sha256 } = require('../lib/crypto');
const { badRequest, conflict } = require('../lib/errors');

function idempotency(scope) {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key) return next(badRequest('Idempotency-Key header is required for this endpoint'));
    if (key.length < 8 || key.length > 200) return next(badRequest('Idempotency-Key must be 8-200 characters'));

    const requestHash = sha256(JSON.stringify(req.body || {}));
    try {
      const { rows } = await db.query(
        `insert into idempotency_keys (scope, key, request_hash)
         values ($1, $2, $3)
         on conflict (scope, key) do nothing
         returning id`,
        [scope, key, requestHash],
      );

      if (!rows.length) {
        const { rows: existing } = await db.query(
          'select * from idempotency_keys where scope = $1 and key = $2',
          [scope, key],
        );
        const record = existing[0];
        if (record.request_hash !== requestHash) {
          return next(conflict('Idempotency-Key was already used with a different request body'));
        }
        if (!record.completed_at) {
          return next(conflict('An identical request is already being processed'));
        }
        res.set('Idempotency-Replayed', 'true');
        return res.status(record.status_code || 200).json(record.response_body);
      }

      res.locals.idempotency = { id: rows[0].id };

      const originalJson = res.json.bind(res);
      res.json = (payload) => {
        db.query(
          `update idempotency_keys set response_body = $2, status_code = $3, completed_at = now()
            where id = $1`,
          [rows[0].id, payload, res.statusCode],
        ).catch(() => {});
        return originalJson(payload);
      };
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { idempotency };
