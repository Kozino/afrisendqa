'use strict';
const { AppError, fromPgError, notFound } = require('../lib/errors');
const log = require('../lib/logger');

function notFoundHandler(req, res, next) {
  next(notFound(`No route matches ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err;
  if (!(error instanceof AppError)) {
    const mapped = error.code ? fromPgError(error) : null;
    if (mapped) error = mapped;
  }

  const status = error.status || 500;
  const code = error.code || 'INTERNAL_ERROR';

  if (status >= 500) {
    log.error('unhandled error', {
      err: error.message, stack: error.stack?.split('\n').slice(0, 4).join(' | '),
      path: req.originalUrl, method: req.method,
      operator: req.operator?.email, customer: req.customer?.reference,
    });
  }

  const body = {
    success: false,
    error: {
      code,
      message: status >= 500 && !error.expose ? 'Something went wrong on our side. Reference logged.' : error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    requestId: req.id,
  };

  if (status === 401) res.set('WWW-Authenticate', 'Bearer');
  res.status(status).json(body);
}

module.exports = { errorHandler, notFoundHandler };
