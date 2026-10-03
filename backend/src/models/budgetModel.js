'use strict';

const db = require('../config/db');

const COLUMNS = 'id, user_id, category, amount::float8 AS amount, month, year, created_at';

async function findAllByUser(userId, filters = {}) {
  const clauses = ['user_id = $1'];
  const params = [userId];

  if (filters.month) {
    params.push(parseInt(filters.month, 10));
    clauses.push(`month = $${params.length}`);
  }
  if (filters.year) {
    params.push(parseInt(filters.year, 10));
    clauses.push(`year = $${params.length}`);
  }

  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM budgets
     WHERE ${clauses.join(' AND ')}
     ORDER BY year DESC, month DESC, category ASC`,
    params
  );
  return rows;
}

async function findByIdForUser(id, userId) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM budgets WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return rows[0] || null;
}

/**
 * Creates a budget. The (user_id, category, month, year) unique constraint
 * means a duplicate raises postgres error 23505, which the controller maps to
 * a 409 Conflict rather than a 500.
 */
async function create(userId, data) {
  const { rows } = await db.query(
    `INSERT INTO budgets (user_id, category, amount, month, year)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${COLUMNS}`,
    [userId, data.category, data.amount, parseInt(data.month, 10), parseInt(data.year, 10)]
  );
  return rows[0];
}

async function update(id, userId, data) {
  const { rows } = await db.query(
    `UPDATE budgets
     SET category = $1, amount = $2, month = $3, year = $4
     WHERE id = $5 AND user_id = $6
     RETURNING ${COLUMNS}`,
    [data.category, data.amount, parseInt(data.month, 10), parseInt(data.year, 10), id, userId]
  );
  return rows[0] || null;
}

async function remove(id, userId) {
  const { rowCount } = await db.query(
    'DELETE FROM budgets WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  return rowCount > 0;
}

/** Budgets for the current calendar month - used by the dashboard. */
async function findForCurrentPeriod(userId, month, year) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM budgets
     WHERE user_id = $1 AND month = $2 AND year = $3
     ORDER BY category ASC`,
    [userId, month, year]
  );
  return rows;
}

module.exports = {
  findAllByUser,
  findByIdForUser,
  create,
  update,
  remove,
  findForCurrentPeriod,
};
