'use strict';
/** Typed application errors → consistent JSON error envelope. */

class AppError extends Error {
  constructor(message, { status = 400, code = 'BAD_REQUEST', details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

const badRequest = (message, details) => new AppError(message, { status: 400, code: 'BAD_REQUEST', details });
const unauthorized = (message = 'Authentication required') => new AppError(message, { status: 401, code: 'UNAUTHORIZED' });
const forbidden = (message = 'Not permitted for your role') => new AppError(message, { status: 403, code: 'FORBIDDEN' });
const notFound = (message = 'Resource not found') => new AppError(message, { status: 404, code: 'NOT_FOUND' });
const conflict = (message, details) => new AppError(message, { status: 409, code: 'CONFLICT', details });
const tooMany = (message = 'Too many requests') => new AppError(message, { status: 429, code: 'RATE_LIMITED' });
const unavailable = (message, details) => new AppError(message, { status: 503, code: 'UPSTREAM_UNAVAILABLE', details });

/** Maps Postgres error codes we care about onto HTTP semantics. */
function fromPgError(err) {
  switch (err.code) {
    case '23505': return conflict('A record with these details already exists', { constraint: err.constraint });
    case '23514': return new AppError(err.message, { status: 422, code: 'INVARIANT_VIOLATION', details: { constraint: err.constraint } });
    case '42501': return forbidden('This record is immutable and cannot be modified');
    case 'P0001': return new AppError(err.message, { status: 422, code: 'INSUFFICIENT_FUNDS' });
    case 'P0002': return notFound(err.message);
    case '22023': return badRequest(err.message);
    default: return null;
  }
}

module.exports = {
  AppError, badRequest, unauthorized, forbidden, notFound, conflict, tooMany, unavailable, fromPgError,
};
