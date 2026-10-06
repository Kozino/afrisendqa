'use strict';
const { badRequest } = require('../lib/errors');

/** zod body validator → 400 with field-level detail. */
function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)', message: i.message,
      }));
      return next(badRequest('Request validation failed', details));
    }
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return next(badRequest('Invalid query parameters', result.error.issues.map((i) => ({
        field: i.path.join('.') || '(root)', message: i.message,
      }))));
    }
    req.query = result.data;
    return next();
  };
}

module.exports = { validateBody, validateQuery };
