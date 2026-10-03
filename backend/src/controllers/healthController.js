'use strict';

const db = require('../config/db');
const logger = require('../utils/logger');

const startedAt = Date.now();

/**
 * GET /health
 *
 * The single endpoint the whole delivery pipeline leans on:
 *   - the backend Dockerfile HEALTHCHECK polls it
 *   - docker compose waits on it before reporting the service healthy
 *   - the CD workflow calls it after deployment and FAILS the deploy if it
 *     does not return 200 with status "healthy"
 *
 * It verifies the database round-trip rather than just answering 200, because
 * a backend that cannot reach postgres is not actually serving.
 */
async function health(req, res) {
  const body = {
    status: 'healthy',
    service: 'fintrack-backend',
    version: process.env.APP_VERSION || 'dev',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks: { database: 'unknown' },
  };

  try {
    await db.ping();
    body.checks.database = 'up';
    return res.status(200).json(body);
  } catch (err) {
    logger.error('health check failed - database unreachable', { error: err.message });
    body.status = 'unhealthy';
    body.checks.database = 'down';
    // 503 so load balancers and the CD verification step both see a failure.
    return res.status(503).json(body);
  }
}

/**
 * GET /health/live - liveness only, no dependency checks.
 * Answers 200 as long as the event loop is responsive.
 */
function liveness(_req, res) {
  res.status(200).json({ status: 'alive', service: 'fintrack-backend' });
}

module.exports = { health, liveness };
