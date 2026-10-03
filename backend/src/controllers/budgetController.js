'use strict';

const budgetModel = require('../models/budgetModel');
const ApiError = require('../utils/ApiError');

/** GET /api/budgets - optional ?month=&year= */
async function list(req, res) {
  const budgets = await budgetModel.findAllByUser(req.user.id, {
    month: req.query.month,
    year: req.query.year,
  });
  res.status(200).json({ budgets, count: budgets.length });
}

/** POST /api/budgets */
async function create(req, res) {
  // A duplicate (category, month, year) trips the unique constraint; the error
  // handler maps postgres 23505 to 409 Conflict.
  const budget = await budgetModel.create(req.user.id, req.body);
  res.status(201).json({ budget });
}

/** PUT /api/budgets/:id */
async function update(req, res) {
  const budget = await budgetModel.update(req.params.id, req.user.id, req.body);
  if (!budget) throw ApiError.notFound('Budget not found');
  res.status(200).json({ budget });
}

/** DELETE /api/budgets/:id */
async function remove(req, res) {
  const deleted = await budgetModel.remove(req.params.id, req.user.id);
  if (!deleted) throw ApiError.notFound('Budget not found');
  res.status(200).json({ message: 'Budget deleted', id: Number(req.params.id) });
}

module.exports = { list, create, update, remove };
