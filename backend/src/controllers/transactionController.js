'use strict';

const transactionModel = require('../models/transactionModel');
const ApiError = require('../utils/ApiError');
const { isValidDate } = require('../utils/validators');

/** GET /api/transactions - supports ?type=&category=&from=&to=&limit=&offset= */
async function list(req, res) {
  const { type, category, from, to, limit, offset } = req.query;

  if (type && type !== 'income' && type !== 'expense') {
    throw ApiError.badRequest("Filter 'type' must be 'income' or 'expense'");
  }
  if (from && !isValidDate(from)) throw ApiError.badRequest("Filter 'from' must be YYYY-MM-DD");
  if (to && !isValidDate(to)) throw ApiError.badRequest("Filter 'to' must be YYYY-MM-DD");

  const transactions = await transactionModel.findAllByUser(req.user.id, {
    type, category, from, to, limit, offset,
  });

  res.status(200).json({ transactions, count: transactions.length });
}

/** GET /api/transactions/:id */
async function getOne(req, res) {
  const transaction = await transactionModel.findByIdForUser(req.params.id, req.user.id);
  if (!transaction) throw ApiError.notFound('Transaction not found');
  res.status(200).json({ transaction });
}

/** POST /api/transactions */
async function create(req, res) {
  const transaction = await transactionModel.create(req.user.id, req.body);
  res.status(201).json({ transaction });
}

/** PUT /api/transactions/:id */
async function update(req, res) {
  const transaction = await transactionModel.update(req.params.id, req.user.id, req.body);
  // null here means the row either does not exist or belongs to another user.
  // Both answer 404 so the endpoint cannot confirm another user's row ids.
  if (!transaction) throw ApiError.notFound('Transaction not found');
  res.status(200).json({ transaction });
}

/** DELETE /api/transactions/:id */
async function remove(req, res) {
  const deleted = await transactionModel.remove(req.params.id, req.user.id);
  if (!deleted) throw ApiError.notFound('Transaction not found');
  res.status(200).json({ message: 'Transaction deleted', id: Number(req.params.id) });
}

module.exports = { list, getOne, create, update, remove };
