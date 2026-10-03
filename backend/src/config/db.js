'use strict';

const { Pool } = require('pg');
const env = require('./env');
const logger = require('../utils/logger');

// A single shared pool per process. Pool size is kept modest because the EC2
// demo box runs postgres in a sibling container with default max_connections.
const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.isTest ? 5 : 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  // An idle client blew up (e.g. postgres restarted). Log it; the pool will
  // transparently create a replacement on the next checkout.
  logger.error('Unexpected postgres pool error', { error: err.message });
});

/**
 * Runs a parameterised query. Every call site uses $1/$2 placeholders -
 * values are never interpolated into SQL strings.
 */
async function query(text, params) {
  const startedAt = process.hrtime.bigint();
  const result = await pool.query(text, params);
  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  if (env.logLevel === 'debug') {
    logger.debug('sql', { text: text.replace(/\s+/g, ' ').trim(), durationMs, rows: result.rowCount });
  }
  return result;
}

/** Checks out a client so a caller can run a BEGIN/COMMIT transaction. */
function getClient() {
  return pool.connect();
}

/** Used by GET /health to prove the database is actually reachable. */
async function ping() {
  const { rows } = await pool.query('SELECT 1 AS ok');
  return rows[0].ok === 1;
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, getClient, ping, close };
