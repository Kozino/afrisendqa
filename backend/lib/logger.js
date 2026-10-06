'use strict';
/** Structured JSON logger — Render and CloudWatch friendly. */

const LEVELS = { error: 50, warn: 40, info: 30, debug: 20 };

function emit(level, message, fields = {}) {
  const min = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg: message,
    ...fields,
  });
  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  info: (m, f) => emit('info', m, f),
  warn: (m, f) => emit('warn', m, f),
  error: (m, f) => emit('error', m, f),
  debug: (m, f) => emit('debug', m, f),
};
