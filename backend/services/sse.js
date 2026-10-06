'use strict';
/**
 * Server-Sent Events fan-out for the operations console.
 *
 * Single-process registry. When the API is scaled beyond one instance, replace
 * `broadcast()` with a Postgres LISTEN/NOTIFY bridge (see README,
 * "Scaling the console") — the channel contract stays the same.
 */
const log = require('../lib/logger');

const clients = new Map(); // id -> { res, operator, role, channels, openedAt, heartbeat }
let sequence = 0;

function subscribe(req, res, operator) {
  const id = ++sequence;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 5000\n\n`);
  res.write(`event: ready\ndata: ${JSON.stringify({ operator: operator.email, role: operator.role, serverTime: new Date().toISOString() })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(`:ping ${Date.now()}\n\n`); } catch { /* closed */ }
  }, 20_000);

  const entry = { id, res, operator, openedAt: new Date(), heartbeat };
  clients.set(id, entry);
  log.debug('sse client connected', { id, operator: operator.email, total: clients.size });

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.delete(id);
    log.debug('sse client disconnected', { id, total: clients.size });
  });
}

function broadcast(event, data) {
  if (!clients.size) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify({ ...data, emittedAt: new Date().toISOString() })}\n\n`;
  for (const [id, client] of clients) {
    try {
      client.res.write(payload);
    } catch (err) {
      clearInterval(client.heartbeat);
      clients.delete(id);
    }
  }
}

function stats() {
  return { connected: clients.size };
}

function closeAll() {
  for (const [, client] of clients) {
    clearInterval(client.heartbeat);
    try { client.res.end(); } catch { /* ignore */ }
  }
  clients.clear();
}

module.exports = { subscribe, broadcast, stats, closeAll };
