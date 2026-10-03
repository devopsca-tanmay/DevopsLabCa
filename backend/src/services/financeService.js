'use strict';

// Pure finance calculations.
//
// Every function here takes plain data and returns plain data - no database,
// no request object. That separation is what lets the dashboard maths be unit
// tested exhaustively, while the integration tests only need to prove the
// wiring (route -> controller -> model -> this service) holds together.
//
// NOTE: the "financial health score" below is a toy heuristic computed purely
// from the user's own entries in this app. It is a demonstration metric and is
// not financial advice.

/** Rounds to 2 decimals, avoiding 0.1 + 0.2 style drift in the response body. */
function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function toNumber(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sums the amounts of every transaction of a given type.
 * @param {Array} transactions
 * @param {string} type - 'income' or 'expense'
 */
function sumByType(transactions = [], type) {
  return round2(
    transactions
      .filter((t) => t && t.type === type)
      .reduce((total, t) => total + toNumber(t.amount), 0)
  );
}

function calculateTotalIncome(transactions = []) {
  return sumByType(transactions, 'income');
}

function calculateTotalExpenses(transactions = []) {
  return sumByType(transactions, 'expense');
}

/** Balance = income - expenses. May legitimately be negative. */
function calculateBalance(transactions = []) {
  return round2(calculateTotalIncome(transactions) - calculateTotalExpenses(transactions));
}

/**
 * Savings rate as a percentage of income: (income - expenses) / income * 100.
 * With zero income the rate is defined as 0 rather than NaN/Infinity so the
 * dashboard of a brand new account still renders. Clamped to [-100, 100].
 */
function calculateSavingsRate(income, expenses) {
  const inc = toNumber(income);
  const exp = toNumber(expenses);
  if (inc <= 0) return 0;
  const rate = ((inc - exp) / inc) * 100;
  return round2(Math.max(-100, Math.min(100, rate)));
}

/**
 * Totals expenses per category, biggest first.
 * Returns objects of shape { category, amount, percentage }.
 */
function groupExpensesByCategory(transactions = []) {
  const expenses = transactions.filter((t) => t && t.type === 'expense');
  const total = expenses.reduce((sum, t) => sum + toNumber(t.amount), 0);

  const byCategory = new Map();
  for (const t of expenses) {
    const category = t.category || 'Uncategorised';
    byCategory.set(category, (byCategory.get(category) || 0) + toNumber(t.amount));
  }

  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      amount: round2(amount),
      percentage: total > 0 ? round2((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * Buckets income and expenses into YYYY-MM for the income-vs-expenses chart.
 * Returns an ascending array of { month, income, expenses }.
 */
function buildMonthlyTrend(transactions = [], monthsBack = 6) {
  const buckets = new Map();

  for (const t of transactions) {
    if (!t || !t.transaction_date) continue;
    const date =
      t.transaction_date instanceof Date ? t.transaction_date : new Date(t.transaction_date);
    if (Number.isNaN(date.getTime())) continue;

    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const key = date.getUTCFullYear() + '-' + month;
    if (!buckets.has(key)) buckets.set(key, { month: key, income: 0, expenses: 0 });

    const bucket = buckets.get(key);
    if (t.type === 'income') bucket.income += toNumber(t.amount);
    else if (t.type === 'expense') bucket.expenses += toNumber(t.amount);
  }

  return Array.from(buckets.values())
    .map((b) => ({ month: b.month, income: round2(b.income), expenses: round2(b.expenses) }))
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-monthsBack);
}

/**
 * Joins budgets against actual spend in the same category.
 * "used" is capped at 100 for the progress bar; "percentage" is uncapped so an
 * overspend is still visible as e.g. 134%.
 */
function calculateBudgetUsage(budgets = [], transactions = []) {
  const spentByCategory = new Map();
  for (const t of transactions) {
    if (!t || t.type !== 'expense') continue;
    const category = t.category || 'Uncategorised';
    spentByCategory.set(category, (spentByCategory.get(category) || 0) + toNumber(t.amount));
  }

  return budgets.map((b) => {
    const budgeted = toNumber(b.amount);
    const spent = round2(spentByCategory.get(b.category) || 0);
    const percentage = budgeted > 0 ? round2((spent / budgeted) * 100) : 0;
    return {
      id: b.id,
      category: b.category,
      budgeted: round2(budgeted),
      spent,
      remaining: round2(budgeted - spent),
      percentage,
      used: Math.min(100, Math.round(percentage)),
      status: percentage > 100 ? 'over' : percentage >= 80 ? 'warning' : 'ok',
    };
  });
}

/**
 * Average adherence across budgets: 100 when at or under budget, decaying
 * toward 0 as the overspend grows. No budgets at all -> null (not scored).
 */
function calculateBudgetAdherence(budgetUsage = []) {
  if (budgetUsage.length === 0) return null;
  const scores = budgetUsage.map((b) => {
    if (b.percentage <= 100) return 100;
    // 150% of budget -> 50 points, 200% or worse -> 0 points.
    return Math.max(0, 100 - (b.percentage - 100) * 2);
  });
  return round2(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Month-over-month expense growth as a percentage, using the two most recent
 * months in the trend. Positive means spending is rising.
 */
function calculateExpenseGrowth(trend = []) {
  if (trend.length < 2) return 0;
  const previous = toNumber(trend[trend.length - 2].expenses);
  const current = toNumber(trend[trend.length - 1].expenses);
  if (previous <= 0) return current > 0 ? 100 : 0;
  return round2(((current - previous) / previous) * 100);
}

/**
 * Demonstration-only financial health score, 0-100, from three components:
 *
 *   Savings rate      50% weight - rewards keeping income above expenses
 *   Budget adherence  30% weight - rewards staying inside self-set budgets
 *   Expense growth    20% weight - rewards flat or falling spending
 *
 * When the user has no budgets the budget weight is redistributed over the
 * other two components, so a new account is not penalised for data it has not
 * entered yet.
 */
function calculateHealthScore(input = {}) {
  const savingsRate = input.savingsRate === undefined ? 0 : input.savingsRate;
  const budgetAdherence = input.budgetAdherence === undefined ? null : input.budgetAdherence;
  const expenseGrowth = input.expenseGrowth === undefined ? 0 : input.expenseGrowth;

  // A savings rate of 30% or better is treated as a full-marks outcome.
  const savingsComponent = Math.max(0, Math.min(100, (toNumber(savingsRate) / 30) * 100));

  // Flat or falling spend scores 100; +50% month over month scores 0.
  const growth = toNumber(expenseGrowth);
  const growthComponent = growth <= 0 ? 100 : Math.max(0, 100 - growth * 2);

  const hasBudgets = budgetAdherence !== null && budgetAdherence !== undefined;

  let score;
  if (hasBudgets) {
    score = savingsComponent * 0.5 + toNumber(budgetAdherence) * 0.3 + growthComponent * 0.2;
  } else {
    // Redistribute the 30% budget weight across the remaining two components.
    score = savingsComponent * (0.5 / 0.7) + growthComponent * (0.2 / 0.7);
  }

  const rounded = Math.round(Math.max(0, Math.min(100, score)));

  let rating;
  if (rounded >= 80) rating = 'Excellent';
  else if (rounded >= 65) rating = 'Good';
  else if (rounded >= 45) rating = 'Fair';
  else rating = 'Needs attention';

  return {
    score: rounded,
    rating,
    components: {
      savingsRate: round2(savingsComponent),
      budgetAdherence: hasBudgets ? round2(toNumber(budgetAdherence)) : null,
      expenseGrowth: round2(growthComponent),
    },
    disclaimer:
      'Demonstration metric computed only from data entered in this app. Not financial advice.',
  };
}

/** Assembles the whole GET /api/dashboard payload from raw rows. */
function buildDashboard(input = {}) {
  const transactions = input.transactions || [];
  const budgets = input.budgets || [];

  const totalIncome = calculateTotalIncome(transactions);
  const totalExpenses = calculateTotalExpenses(transactions);
  const balance = round2(totalIncome - totalExpenses);
  const savingsRate = calculateSavingsRate(totalIncome, totalExpenses);

  const categoryBreakdown = groupExpensesByCategory(transactions);
  const monthlyTrend = buildMonthlyTrend(transactions);
  const budgetUsage = calculateBudgetUsage(budgets, transactions);
  const budgetAdherence = calculateBudgetAdherence(budgetUsage);
  const expenseGrowth = calculateExpenseGrowth(monthlyTrend);

  return {
    summary: {
      totalIncome,
      totalExpenses,
      balance,
      savingsRate,
      transactionCount: transactions.length,
    },
    monthlyTrend,
    categoryBreakdown,
    budgetUsage,
    healthScore: calculateHealthScore({ savingsRate, budgetAdherence, expenseGrowth }),
    expenseGrowth,
  };
}

module.exports = {
  round2,
  sumByType,
  calculateTotalIncome,
  calculateTotalExpenses,
  calculateBalance,
  calculateSavingsRate,
  groupExpensesByCategory,
  buildMonthlyTrend,
  calculateBudgetUsage,
  calculateBudgetAdherence,
  calculateExpenseGrowth,
  calculateHealthScore,
  buildDashboard,
};
