'use strict';
/**
 * JWT verification + RBAC enforcement.
 *
 * Tokens carry `typ: 'operator' | 'customer'` and `aud`. A customer token can
 * never be used on an operator route and vice versa, even if the signature is
 * valid — audience and type are both checked.
 */
const jwt = require('jsonwebtoken');
const { env } = require('../config/env');
const { can } = require('../config/permissions');
const { unauthorized, forbidden } = require('../lib/errors');

function extractBearer(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  return /^Bearer$/i.test(scheme) ? token : null;
}

function verify(token, audience, type) {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    issuer: env.JWT_ISSUER,
    audience,
  });
  if (payload.typ !== type) throw unauthorized('Wrong token type for this endpoint');
  return payload;
}

/** Operator (admin console) guard. */
function requireOperator(req, res, next) {
  const token = extractBearer(req);
  if (!token) return next(unauthorized());
  try {
    const payload = verify(token, 'afrisend-admin', 'operator');
    req.operator = {
      id: payload.sub, email: payload.email, name: payload.name, role: payload.role,
    };
    return next();
  } catch (err) {
    return next(unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token'));
  }
}

/** Customer (mobile app) guard. */
function requireCustomer(req, res, next) {
  const token = extractBearer(req);
  if (!token) return next(unauthorized());
  try {
    const payload = verify(token, 'afrisend-app', 'customer');
    req.customer = { id: payload.sub, reference: payload.ref, tier: payload.tier };
    return next();
  } catch (err) {
    return next(unauthorized(err.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token'));
  }
}

/** Permission guard, always used after requireOperator. */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.operator) return next(unauthorized());
    if (!can(req.operator.role, permission)) {
      return next(forbidden(`Your role (${req.operator.role}) does not include "${permission}"`));
    }
    return next();
  };
}

/** Customer KYC tier gate used by money-movement routes. */
function requireKycTier(minTier) {
  return (req, res, next) => {
    if (!req.customer) return next(unauthorized());
    if ((req.customer.tier || 0) < minTier) {
      return next(forbidden('Complete identity verification to use this feature'));
    }
    return next();
  };
}

module.exports = { requireOperator, requireCustomer, requirePermission, requireKycTier, extractBearer };
