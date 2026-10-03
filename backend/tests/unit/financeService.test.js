'use strict';

const finance = require('../../src/services/financeService');

// These tests touch no database and no HTTP server - they exercise the pure
// calculation layer only. That is why the "unit tests" job in CI runs before
// (and independently of) the postgres service container.

describe('financeService - income and expense totals', () => {
  const sample = [
    { type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
    { type: 'income', amount: 70000, category: 'Freelance', transaction_date: '2026-09-10' },
    { type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-12' },
    { type: 'expense', amount: 27000, category: 'Bills', transaction_date: '2026-09-20' },
  ];

  test('calculateTotalIncome sums only income rows', () => {
    expect(finance.calculateTotalIncome(sample)).toBe(120000);
  });

  test('calculateTotalExpenses sums only expense rows', () => {
    expect(finance.calculateTotalExpenses(sample)).toBe(35000);
  });

  test('calculateBalance subtracts expenses from income', () => {
    expect(finance.calculateBalance(sample)).toBe(85000);
  });

  test('totals are 0 for an empty ledger rather than NaN', () => {
    expect(finance.calculateTotalIncome([])).toBe(0);
    expect(finance.calculateTotalExpenses([])).toBe(0);
    expect(finance.calculateBalance([])).toBe(0);
  });

  test('numeric strings from postgres NUMERIC columns are coerced', () => {
    const rows = [
      { type: 'income', amount: '1500.50' },
      { type: 'expense', amount: '500.25' },
    ];
    expect(finance.calculateTotalIncome(rows)).toBe(1500.5);
    expect(finance.calculateBalance(rows)).toBe(1000.25);
  });

  test('floating point addition does not leak drift into the total', () => {
    const rows = [
      { type: 'expense', amount: 0.1 },
      { type: 'expense', amount: 0.2 },
    ];
    // 0.1 + 0.2 === 0.30000000000000004 without rounding.
    expect(finance.calculateTotalExpenses(rows)).toBe(0.3);
  });

  test('malformed rows are ignored instead of throwing', () => {
    const rows = [null, undefined, { type: 'income', amount: 'not-a-number' }, { type: 'income', amount: 100 }];
    expect(finance.calculateTotalIncome(rows)).toBe(100);
  });
});

describe('financeService - savings rate', () => {
  test('savings rate matches (income - expenses) / income', () => {
    expect(finance.calculateSavingsRate(120000, 35000)).toBe(70.83);
  });

  test('spending nothing is a 100% savings rate', () => {
    expect(finance.calculateSavingsRate(1000, 0)).toBe(100);
  });

  test('zero income yields 0, not NaN or Infinity', () => {
    expect(finance.calculateSavingsRate(0, 500)).toBe(0);
    expect(Number.isFinite(finance.calculateSavingsRate(0, 500))).toBe(true);
  });

  test('overspending produces a negative rate clamped at -100', () => {
    expect(finance.calculateSavingsRate(100, 1000)).toBe(-100);
    expect(finance.calculateSavingsRate(100, 150)).toBe(-50);
  });
});

describe('financeService - category breakdown', () => {
  const rows = [
    { type: 'expense', amount: 8000, category: 'Food' },
    { type: 'expense', amount: 2000, category: 'Food' },
    { type: 'expense', amount: 4000, category: 'Transport' },
    { type: 'income', amount: 50000, category: 'Salary' },
  ];

  test('groups expenses by category and ignores income', () => {
    const result = finance.groupExpensesByCategory(rows);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.category)).not.toContain('Salary');
  });

  test('sorts categories by amount descending', () => {
    const result = finance.groupExpensesByCategory(rows);
    expect(result[0]).toMatchObject({ category: 'Food', amount: 10000 });
    expect(result[1]).toMatchObject({ category: 'Transport', amount: 4000 });
  });

  test('percentages are relative to total expenses and sum to ~100', () => {
    const result = finance.groupExpensesByCategory(rows);
    expect(result[0].percentage).toBeCloseTo(71.43, 1);
    const total = result.reduce((sum, r) => sum + r.percentage, 0);
    expect(total).toBeCloseTo(100, 1);
  });

  test('an empty ledger produces an empty breakdown', () => {
    expect(finance.groupExpensesByCategory([])).toEqual([]);
  });
});

describe('financeService - monthly trend', () => {
  const rows = [
    { type: 'income', amount: 1000, transaction_date: '2026-08-15' },
    { type: 'expense', amount: 400, transaction_date: '2026-08-20' },
    { type: 'income', amount: 1200, transaction_date: '2026-09-01' },
    { type: 'expense', amount: 900, transaction_date: '2026-09-11' },
  ];

  test('buckets transactions into YYYY-MM in ascending order', () => {
    const trend = finance.buildMonthlyTrend(rows);
    expect(trend).toEqual([
      { month: '2026-08', income: 1000, expenses: 400 },
      { month: '2026-09', income: 1200, expenses: 900 },
    ]);
  });

  test('keeps only the most recent N months', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      type: 'expense',
      amount: 100,
      transaction_date: `2026-${String(i + 1).padStart(2, '0')}-05`,
    }));
    expect(finance.buildMonthlyTrend(many, 6)).toHaveLength(6);
  });

  test('rows with an unparseable date are skipped', () => {
    const trend = finance.buildMonthlyTrend([
      { type: 'income', amount: 100, transaction_date: 'not-a-date' },
      { type: 'income', amount: 100, transaction_date: '2026-09-01' },
    ]);
    expect(trend).toHaveLength(1);
  });
});

describe('financeService - budget usage', () => {
  const budgets = [
    { id: 1, category: 'Food', amount: 10000 },
    { id: 2, category: 'Transport', amount: 5000 },
    { id: 3, category: 'Shopping', amount: 2000 },
  ];
  const transactions = [
    { type: 'expense', amount: 8000, category: 'Food' },
    { type: 'expense', amount: 3500, category: 'Transport' },
    { type: 'expense', amount: 3000, category: 'Shopping' },
    { type: 'income', amount: 50000, category: 'Salary' },
  ];

  test('computes spent, remaining and percentage per budget', () => {
    const usage = finance.calculateBudgetUsage(budgets, transactions);
    expect(usage[0]).toMatchObject({
      category: 'Food', budgeted: 10000, spent: 8000, remaining: 2000, percentage: 80,
    });
  });

  test('flags a budget at or above 80% as a warning', () => {
    const usage = finance.calculateBudgetUsage(budgets, transactions);
    expect(usage.find((u) => u.category === 'Food').status).toBe('warning');
    expect(usage.find((u) => u.category === 'Transport').status).toBe('ok');
  });

  test('an overspent budget reports status "over" with percentage above 100', () => {
    const usage = finance.calculateBudgetUsage(budgets, transactions);
    const shopping = usage.find((u) => u.category === 'Shopping');
    expect(shopping.percentage).toBe(150);
    expect(shopping.status).toBe('over');
    expect(shopping.remaining).toBe(-1000);
  });

  test('the progress-bar value is capped at 100 even when overspent', () => {
    const usage = finance.calculateBudgetUsage(budgets, transactions);
    expect(usage.find((u) => u.category === 'Shopping').used).toBe(100);
  });

  test('income is never counted against a budget', () => {
    const usage = finance.calculateBudgetUsage([{ id: 9, category: 'Salary', amount: 1000 }], transactions);
    expect(usage[0].spent).toBe(0);
  });
});

describe('financeService - budget adherence and expense growth', () => {
  test('adherence is 100 when every budget is respected', () => {
    const usage = [{ percentage: 50 }, { percentage: 100 }];
    expect(finance.calculateBudgetAdherence(usage)).toBe(100);
  });

  test('adherence decays as overspend grows', () => {
    expect(finance.calculateBudgetAdherence([{ percentage: 150 }])).toBe(0);
    expect(finance.calculateBudgetAdherence([{ percentage: 120 }])).toBe(60);
  });

  test('adherence is null when the user has set no budgets', () => {
    expect(finance.calculateBudgetAdherence([])).toBeNull();
  });

  test('expense growth compares the two most recent months', () => {
    const trend = [
      { month: '2026-08', income: 0, expenses: 1000 },
      { month: '2026-09', income: 0, expenses: 1500 },
    ];
    expect(finance.calculateExpenseGrowth(trend)).toBe(50);
  });

  test('expense growth is 0 when there is only one month of history', () => {
    expect(finance.calculateExpenseGrowth([{ month: '2026-09', expenses: 500 }])).toBe(0);
  });

  test('falling spend reports negative growth', () => {
    const trend = [
      { month: '2026-08', expenses: 1000 },
      { month: '2026-09', expenses: 750 },
    ];
    expect(finance.calculateExpenseGrowth(trend)).toBe(-25);
  });
});

describe('financeService - financial health score', () => {
  test('strong savings, respected budgets and flat spend scores Excellent', () => {
    const result = finance.calculateHealthScore({
      savingsRate: 40, budgetAdherence: 100, expenseGrowth: -5,
    });
    expect(result.score).toBe(100);
    expect(result.rating).toBe('Excellent');
  });

  test('no savings and runaway spending scores Needs attention', () => {
    const result = finance.calculateHealthScore({
      savingsRate: 0, budgetAdherence: 0, expenseGrowth: 80,
    });
    expect(result.score).toBe(0);
    expect(result.rating).toBe('Needs attention');
  });

  test('the score is always clamped to the 0-100 range', () => {
    const extreme = finance.calculateHealthScore({
      savingsRate: 500, budgetAdherence: 100, expenseGrowth: -500,
    });
    expect(extreme.score).toBeLessThanOrEqual(100);
    expect(extreme.score).toBeGreaterThanOrEqual(0);
  });

  test('budget weight is redistributed when the user has no budgets', () => {
    const withoutBudgets = finance.calculateHealthScore({ savingsRate: 30, expenseGrowth: 0 });
    expect(withoutBudgets.components.budgetAdherence).toBeNull();
    // Full marks on both remaining components should still reach 100.
    expect(withoutBudgets.score).toBe(100);
  });

  test('the score carries a not-financial-advice disclaimer', () => {
    const result = finance.calculateHealthScore({ savingsRate: 10 });
    expect(result.disclaimer).toMatch(/not financial advice/i);
  });

  test('ratings map to the documented score bands', () => {
    expect(finance.calculateHealthScore({ savingsRate: 30, budgetAdherence: 100, expenseGrowth: 0 }).rating)
      .toBe('Excellent');
    expect(finance.calculateHealthScore({ savingsRate: 0, budgetAdherence: 100, expenseGrowth: 0 }).rating)
      .toBe('Fair');
  });
});

describe('financeService - buildDashboard assembly', () => {
  const transactions = [
    { type: 'income', amount: 120000, category: 'Salary', transaction_date: '2026-09-01' },
    { type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-05' },
    { type: 'expense', amount: 27000, category: 'Bills', transaction_date: '2026-09-20' },
  ];
  const budgets = [{ id: 1, category: 'Food', amount: 10000 }];

  test('returns every section the dashboard screen renders', () => {
    const dashboard = finance.buildDashboard({ transactions, budgets });
    expect(dashboard).toHaveProperty('summary');
    expect(dashboard).toHaveProperty('monthlyTrend');
    expect(dashboard).toHaveProperty('categoryBreakdown');
    expect(dashboard).toHaveProperty('budgetUsage');
    expect(dashboard).toHaveProperty('healthScore');
  });

  test('summary figures agree with the individual calculations', () => {
    const { summary } = finance.buildDashboard({ transactions, budgets });
    expect(summary).toMatchObject({
      totalIncome: 120000,
      totalExpenses: 35000,
      balance: 85000,
      savingsRate: 70.83,
      transactionCount: 3,
    });
  });

  test('a brand new account produces a valid, empty dashboard', () => {
    const dashboard = finance.buildDashboard({ transactions: [], budgets: [] });
    expect(dashboard.summary.balance).toBe(0);
    expect(dashboard.categoryBreakdown).toEqual([]);
    expect(dashboard.healthScore.score).toBeGreaterThanOrEqual(0);
  });

  test('called with no arguments at all it still returns a usable shape', () => {
    const dashboard = finance.buildDashboard();
    expect(dashboard.summary.transactionCount).toBe(0);
  });
});
