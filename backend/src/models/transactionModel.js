'use strict';

const db = require('../config/db');

const COLUMNS =
  'id, user_id, type, amount::float8 AS amount, category, description, ' +
  "to_char(transaction_date, 'YYYY-MM-DD') AS transaction_date, created_at";

/**
 * Lists a user's transactions with optional filters.
 * Filters are appended as parameterised clauses - no string interpolation of
 * user input ever reaches the SQL text.
 *
 * @param {number} userId
 * @param {{type?:string, category?:string, from?:string, to?:string,
 *          limit?:number, offset?:number}} filters
 */
async function findAllByUser(userId, filters = {}) {
  const clauses = ['user_id = $1'];
  const params = [userId];

  if (filters.type) {
    params.push(filters.type);
    clauses.push(`type = $${params.length}`);
  }
  if (filters.category) {
    params.push(filters.category);
    clauses.push(`category = $${params.length}`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`transaction_date >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`transaction_date <= $${params.length}`);
  }

  const limit = Math.min(Math.max(parseInt(filters.limit || '200', 10), 1), 500);
  const offset = Math.max(parseInt(filters.offset || '0', 10), 0);
  params.push(limit, offset);

  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM transactions
     WHERE ${clauses.join(' AND ')}
     ORDER BY transaction_date DESC, id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}

/** Scoped by user_id so one user can never read another user's row. */
async function findByIdForUser(id, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM transactions WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

async function create(userId, data) {
  const { rows } = await db.query(
    `INSERT INTO transactions (user_id, type, amount, category, description, transaction_date)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6::date, CURRENT_DATE))
     RETURNING ${COLUMNS}`,
    [
      userId,
      data.type,
      data.amount,
      data.category,
      data.description || null,
      data.transaction_date || null,
    ]
  );
  return rows[0];
}

async function update(id, userId, data) {
  const { rows } = await db.query(
    `UPDATE transactions
     SET type = $1, amount = $2, category = $3, description = $4,
         transaction_date = COALESCE($5::date, transaction_date)
     WHERE id = $6 AND user_id = $7
     RETURNING ${COLUMNS}`,
    [
      data.type,
      data.amount,
      data.category,
      data.description || null,
      data.transaction_date || null,
      id,
      userId,
    ]
  );
  return rows[0] || null;
}

async function remove(id, userId) {
  const { rowCount } = await db.query(
    'DELETE FROM transactions WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

/** Every transaction for a user - the dashboard aggregates these in-process. */
async function findAllForDashboard(userId) {
  const { rows } = await db.query(
    `SELECT type, amount::float8 AS amount, category,
            to_char(transaction_date, 'YYYY-MM-DD') AS transaction_date
     FROM transactions WHERE user_id = $1
     ORDER BY transaction_date ASC`,
    [userId]
  );
  return rows;
}

module.exports = {
  findAllByUser,
  findByIdForUser,
  create,
  update,
  remove,
  findAllForDashboard,
};
