'use strict';

const db = require('../config/db');

// Columns safe to return to the client. password_hash is never selected here.
const PUBLIC_COLUMNS = 'id, name, email, created_at';

async function create({ name, email, passwordHash }) {
  const { rows } = await db.query(
    `INSERT INTO users (name, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name.trim(), email.trim().toLowerCase(), passwordHash]
  );
  return rows[0];
}

/** Includes password_hash - only for the login flow. */
async function findByEmailWithHash(email) {
  const { rows } = await db.query(
    `SELECT id, name, email, password_hash, created_at
     FROM users WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function emailExists(email) {
  const { rows } = await db.query(
    'SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1',
    [email.trim()]
  );
  return rows.length > 0;
}

module.exports = { create, findByEmailWithHash, findById, emailExists };
