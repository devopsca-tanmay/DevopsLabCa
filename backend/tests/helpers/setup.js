'use strict';

// Integration-test harness.
//
// These tests exercise the real Express app against a real PostgreSQL database
// via supertest - no mocking of the data layer. That is deliberate: the point
// of the integration stage in CI is to prove the route -> controller -> model
// -> postgres path actually works, including constraints and foreign keys.
//
// In CI, DATABASE_URL points at the `postgres` service container defined in
// .github/workflows/ci.yml. Locally it points at the compose postgres service.

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_secret_not_used_in_production';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgresql://fintrack:fintrack@localhost:5432/fintrack_test';
// Keep bcrypt cheap so the suite stays fast; production uses the configured 10.
process.env.BCRYPT_ROUNDS = '4';

const fs = require('fs');
const path = require('path');
const db = require('../../src/config/db');

const SCHEMA_FILE = path.resolve(__dirname, '../../../database/init.sql');

/** Applies database/init.sql so the test database matches production exactly. */
async function createSchema() {
  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  await db.query(sql);
}

/**
 * Empties every table between test files. TRUNCATE ... CASCADE also resets the
 * SERIAL sequences via RESTART IDENTITY, so ids are predictable per file.
 */
async function resetDatabase() {
  await db.query('TRUNCATE TABLE transactions, budgets, users RESTART IDENTITY CASCADE');
}

async function closeDatabase() {
  await db.close();
}

/**
 * Registers a user through the real API and returns credentials plus a token,
 * so each test file starts from a known-good authenticated state.
 */
async function registerTestUser(request, app, overrides = {}) {
  const payload = {
    name: overrides.name || 'Test User',
    email: overrides.email || `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: overrides.password || 'test-password-123',
  };

  const response = await request(app).post('/api/auth/register').send(payload);
  if (response.status !== 201) {
    throw new Error(`Test user registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  return { ...payload, token: response.body.token, user: response.body.user };
}

/** Convenience: the Authorization header for an authenticated request. */
function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = {
  createSchema,
  resetDatabase,
  closeDatabase,
  registerTestUser,
  authHeader,
};
