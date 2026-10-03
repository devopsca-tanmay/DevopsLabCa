'use strict';

/**
 * Minimal forward-only migration runner.
 *
 *   npm run migrate
 *
 * Reads database/migrations/*.sql in filename order, skips any file already
 * recorded in schema_migrations, and applies the rest - each inside its own
 * transaction so a failing migration leaves no partial schema behind.
 *
 * The CD pipeline runs this on EC2 after pulling new images and before the new
 * containers start taking traffic.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const env = require('./env');
const logger = require('../utils/logger');

// The migrations directory sits in a different place in the repo than in the
// built image:
//   repo   backend/src/config -> ../../../database/migrations  (repo root)
//   image  /app/src/config    -> ../../database/migrations     (/app/database)
// Rather than hard-coding either, probe the candidates in order. MIGRATIONS_DIR
// overrides everything, which is what the CD pipeline uses if the layout moves.
function resolveMigrationsDir() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(__dirname, '../../database/migrations'), // inside the image
    path.resolve(__dirname, '../../../database/migrations'), // repo checkout
  ].filter(Boolean);

  const found = candidates.find((dir) => fs.existsSync(dir));
  return found || candidates[candidates.length - 1];
}

const MIGRATIONS_DIR = resolveMigrationsDir();

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function appliedMigrations(pool) {
  const { rows } = await pool.query('SELECT filename FROM schema_migrations');
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn('no migrations directory found, nothing to do', { dir: MIGRATIONS_DIR });
    return;
  }

  const pool = new Pool({ connectionString: env.databaseUrl });

  try {
    await ensureMigrationsTable(pool);
    const already = await appliedMigrations(pool);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    const pending = files.filter((f) => !already.has(f));

    if (pending.length === 0) {
      logger.info('database is up to date', { applied: already.size });
      return;
    }

    for (const file of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info('migration applied', { file });
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error('migration failed, rolled back', { file, error: err.message });
        throw err;
      } finally {
        client.release();
      }
    }

    logger.info('migrations complete', { applied: pending.length });
  } finally {
    await pool.end();
  }
}

// Only self-execute when invoked directly, so tests can import and call run().
if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch((err) => {
      // Exit non-zero so the CD pipeline treats a failed migration as a failed
      // deployment and does not proceed to swap containers.
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { run };
