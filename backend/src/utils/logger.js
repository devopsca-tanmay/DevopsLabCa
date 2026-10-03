'use strict';

// Deliberately dependency-free structured logger.
//
// Everything is written to stdout/stderr as a single JSON line per event. That
// is the contract Docker expects: `docker logs <container>` shows these lines
// verbatim, and any future log shipper (CloudWatch agent, Loki, ELK) can parse
// them without an application change. We do NOT write to log files inside the
// container - container filesystems are ephemeral.

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function currentLevel() {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return LEVELS[configured] === undefined ? LEVELS.info : LEVELS[configured];
}

function write(level, message, meta = {}) {
  if (LEVELS[level] > currentLevel()) return;
  // Tests would otherwise drown the Jest reporter in log noise.
  if (process.env.NODE_ENV === 'test' && process.env.LOG_LEVEL !== 'debug') return;

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'fintrack-backend',
    message,
    ...meta,
  });

  if (level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

module.exports = {
  error: (msg, meta) => write('error', msg, meta),
  warn: (msg, meta) => write('warn', msg, meta),
  info: (msg, meta) => write('info', msg, meta),
  debug: (msg, meta) => write('debug', msg, meta),
};
