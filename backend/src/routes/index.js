'use strict';

const express = require('express');

const router = express.Router();

router.use('/auth', require('./authRoutes'));
router.use('/transactions', require('./transactionRoutes'));
router.use('/budgets', require('./budgetRoutes'));
router.use('/dashboard', require('./dashboardRoutes'));

// Small discovery document, handy during the demo.
router.get('/', (_req, res) => {
  res.json({
    service: 'fintrack-api',
    version: process.env.APP_VERSION || 'dev',
    endpoints: [
      'POST   /api/auth/register',
      'POST   /api/auth/login',
      'GET    /api/auth/me',
      'GET    /api/transactions',
      'POST   /api/transactions',
      'GET    /api/transactions/:id',
      'PUT    /api/transactions/:id',
      'DELETE /api/transactions/:id',
      'GET    /api/budgets',
      'POST   /api/budgets',
      'PUT    /api/budgets/:id',
      'DELETE /api/budgets/:id',
      'GET    /api/dashboard',
      'GET    /health',
    ],
  });
});

module.exports = router;
