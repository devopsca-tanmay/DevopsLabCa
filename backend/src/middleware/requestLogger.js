'use strict';

const logger = require('../utils/logger');

/**
 * Emits one structured line per completed request:
 *
 *   timestamp, method, route, status code, response time, user id
 *
 * Attached before the routes so it sees every request, and it logs on the
 * response `finish` event so the status code and duration are final.
 * These lines are exactly what `docker logs fintrack-backend` shows.
 */
function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    // The health endpoint is polled by Docker every 30s; logging it at info
    // level would bury real traffic. Keep it at debug.
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn'
      : req.originalUrl === '/health' ? 'debug' : 'info';

    logger[level]('request', {
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      userId: req.user ? req.user.id : null,
      ip: req.ip,
    });
  });

  next();
}

module.exports = requestLogger;
