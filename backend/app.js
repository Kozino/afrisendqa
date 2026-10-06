'use strict';
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const { env } = require('./config/env');
const log = require('./lib/logger');
const { errorHandler, notFoundHandler } = require('./middleware/error');
const { publicLimiter } = require('./middleware/rateLimit');

const app = express();

app.set('trust proxy', 1); // Render terminates TLS in front of us

// ---------------------------------------------------------------------------
// Request id + access log
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  req.id = req.get('x-request-id') || crypto.randomUUID();
  res.set('X-Request-Id', req.id);
  const started = Date.now();
  res.on('finish', () => {
    const line = {
      ms: Date.now() - started,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ip: req.ip,
      requestId: req.id,
    };
    if (res.statusCode >= 500) log.error('request', line);
    else if (res.statusCode >= 400) log.warn('request', line);
    else log.debug('request', line);
  });
  next();
});

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'default-src': ["'self'"],
      'script-src': ["'self'", "'unsafe-inline'"],   // console is a self-contained page
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"],
      'font-src': ["'self'", 'data:'],
      'frame-ancestors': ["'none'"],
      'object-src': ["'none'"],
      'base-uri': ["'self'"],
      'form-action': ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' },
  hsts: env.IS_PROD ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));
app.use(compression());

// ---------------------------------------------------------------------------
// CORS — same-origin console, the mobile app, and explicitly listed origins.
// ---------------------------------------------------------------------------
const allowedOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);                 // native app / curl / same-origin
    if (!env.IS_PROD) return callback(null, true);            // permissive in development
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (env.PUBLIC_BASE_URL && origin === env.PUBLIC_BASE_URL) return callback(null, true);
    return callback(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: false,
  exposedHeaders: ['Idempotency-Replayed', 'X-Request-Id'],
   allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Request-Id'],
}));

// ---------------------------------------------------------------------------
// Body parsing. The raw body is preserved for webhook signature verification.
// ---------------------------------------------------------------------------
app.use(express.json({
  limit: '2mb',
  verify: (req, res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: '256kb' }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/api/v1/auth', require('./routes/auth.routes'));
app.use('/api/v1/public', publicLimiter, require('./routes/public.routes'));
app.use('/api/v1/me', require('./routes/me.routes'));
app.use('/api/v1/transfers', require('./routes/transfers.routes'));
app.use('/api/v1/webhooks', require('./routes/webhooks.routes'));
app.use('/api/v1/admin', require('./routes/admin.routes'));

// Unversioned aliases so provider callbacks configured as /api/webhooks/... work.
app.use('/api/webhooks', require('./routes/webhooks.routes'));

// ---------------------------------------------------------------------------
// Operations console (served from the same origin to avoid CORS and to keep
// the API token surface to a single origin)
// ---------------------------------------------------------------------------
if (env.ADMIN_CONSOLE_ENABLED) {
  const consoleDir = path.join(__dirname, '..', 'admin-dashboard');
  app.use('/admin', express.static(consoleDir, {
    index: 'login.html',
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store');
      }
    },
  }));
  app.get('/admin/', (req, res) => res.redirect('/admin/login.html'));
}

app.get('/', (req, res) => {
  res.json({
    service: 'AfriSend Remittance API',
    version: process.env.APP_VERSION || '1.0.0',
    docs: '/api/v1/public/healthz',
    console: env.ADMIN_CONSOLE_ENABLED ? '/admin' : null,
  });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
