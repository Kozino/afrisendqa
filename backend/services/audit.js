'use strict';
/**
 * Immutable audit trail.
 *
 * Every privileged action writes here. The table is append-only (enforced by a
 * database trigger) so an operator cannot erase their own footprint, and the
 * same event is pushed to the console over SSE.
 */
const db = require('../db/pool');
const sse = require('./sse');
const log = require('../lib/logger');

async function record({
  actorType = 'SYSTEM',
  actorId = null,
  actorEmail = null,
  actorRole = null,
  action,
  entityType = null,
  entityId = null,
  severity = 'INFO',
  ip = null,
  userAgent = null,
  beforeState = null,
  afterState = null,
  metadata = null,
  client = null,
} = {}) {
  const runner = client || db;
  try {
    const { rows } = await runner.query(
      `insert into audit_logs
         (actor_type, actor_id, actor_email, actor_role, action, entity_type, entity_id,
          severity, ip_address, user_agent, before_state, after_state, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       returning id, created_at`,
      [actorType, actorId, actorEmail, actorRole, action, entityType, entityId,
        severity, ip, userAgent ? String(userAgent).slice(0, 400) : null,
        beforeState, afterState, metadata],
    );
    const entry = rows[0];
    sse.broadcast('audit_log', {
      id: entry.id, action, severity, actorType,
      actor: actorEmail || actorId || 'system',
      entityType, entityId, createdAt: entry.created_at, metadata,
    });
    return entry;
  } catch (err) {
    // Auditing must never take down the request path, but it must be loud.
    log.error('audit write failed', { err: err.message, action });
    return null;
  }
}

/** Convenience wrapper bound to a request, for routes. */
function fromRequest(req, fields) {
  return record({
    actorType: req.operator ? 'OPERATOR' : req.customer ? 'CUSTOMER' : 'SYSTEM',
    actorId: req.operator?.id || req.customer?.id || null,
    actorEmail: req.operator?.email || null,
    actorRole: req.operator?.role || null,
    ip: req.ip,
    userAgent: req.get('user-agent'),
    ...fields,
  });
}

async function list({ limit = 200, action, actorEmail, entityType, entityId, severity, from, to } = {}) {
  const conditions = [];
  const params = [];
  const push = (clause, value) => { params.push(value); conditions.push(clause.replace('$?', `$${params.length}`)); };

  if (action) push('action = $?', action);
  if (actorEmail) push('actor_email = $?', actorEmail);
  if (entityType) push('entity_type = $?', entityType);
  if (entityId) push('entity_id = $?', entityId);
  if (severity) push('severity = $?', severity);
  if (from) push('created_at >= $?', from);
  if (to) push('created_at <= $?', to);

  params.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await db.query(
    `select id, actor_type, actor_id, actor_email, actor_role, action, entity_type, entity_id,
            severity, ip_address::text as ip_address, before_state, after_state, metadata, created_at
       from audit_logs
      ${conditions.length ? `where ${conditions.join(' and ')}` : ''}
      order by created_at desc
      limit $${params.length}`,
    params,
  );
  return rows;
}

module.exports = { record, fromRequest, list };
