'use strict';

const transactionModel = require('../models/transactionModel');
const budgetModel = require('../models/budgetModel');
const financeService = require('../services/financeService');

/**
 * GET /api/dashboard
 *
 * Two reads, then all aggregation happens in financeService (pure functions).
 * Keeping the maths out of SQL is what makes it unit-testable without a
 * database, which is why the unit-test stage in CI needs no postgres service.
 */
async function getDashboard(req, res) {
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  const year = now.getUTCFullYear();

  const [transactions, budgets] = await Promise.all([
    transactionModel.findAllForDashboard(req.user.id),
    budgetModel.findForCurrentPeriod(req.user.id, month, year),
  ]);

  const dashboard = financeService.buildDashboard({ transactions, budgets });

  res.status(200).json({
    period: { month, year },
    ...dashboard,
  });
}

module.exports = { getDashboard };
