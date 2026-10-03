'use strict';

const app = require('./app');
const env = require('./config/env');
const db = require('./config/db');
const logger = require('./utils/logger');

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info('fintrack-backend started', {
    port: env.port,
    nodeEnv: env.nodeEnv,
    version: process.env.APP_VERSION || 'dev',
  });
});

/**
 * Graceful shutdown.
 *
 * `docker compose down` and the CD pipeline's container replacement both send
 * SIGTERM. Draining in-flight requests and closing the pg pool prevents
 * half-finished writes and connection leaks during a rolling deploy.
 */
function shutdown(signal) {
  logger.info('shutdown signal received', { signal });

  server.close(async () => {
    try {
      await db.close();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('error during shutdown', { error: err.message });
      process.exit(1);
    }
  });

  // Don't hang forever if a connection refuses to drain.
  setTimeout(() => {
    logger.error('forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('unhandled promise rejection', { reason: String(reason) });
});

module.exports = server;
