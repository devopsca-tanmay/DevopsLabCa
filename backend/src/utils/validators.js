'use strict';

// Pure validation helpers.
//
// They are deliberately free of Express/DB imports so the unit test suite can
// exercise them directly - no server, no database, no network. This is what
// makes the "unit tests" stage of CI fast and independent of the postgres
// service container.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TRANSACTION_TYPES = ['income', 'expense'];

const CATEGORIES = [
  'Salary', 'Freelance', 'Investment', 'Gift', 'Other Income',
  'Food', 'Transport', 'Shopping', 'Bills', 'Entertainment',
  'Health', 'Education', 'Rent', 'Other Expense',
];

function isNonEmptyString(value, maxLength = 255) {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= maxLength;
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 255 && EMAIL_RE.test(email.trim());
}

/** Minimum 8 characters - enforced on registration only. */
function isValidPassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

/** Amounts must be finite, strictly positive, and at most 2 decimal places. */
function isValidAmount(amount) {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (typeof n !== 'number' || !Number.isFinite(n)) return false;
  if (n <= 0 || n > 1e12) return false;
  return Math.round(n * 100) / 100 === n;
}

function isValidTransactionType(type) {
  return TRANSACTION_TYPES.includes(type);
}

/** Accepts YYYY-MM-DD and rejects impossible dates such as 2026-02-31. */
function isValidDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m - 1 &&
    parsed.getUTCDate() === d
  );
}

function isValidMonth(month) {
  const n = Number(month);
  return Number.isInteger(n) && n >= 1 && n <= 12;
}

function isValidYear(year) {
  const n = Number(year);
  return Number.isInteger(n) && n >= 2000 && n <= 2100;
}

/**
 * Validates a registration payload.
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateRegistration(body = {}) {
  const errors = [];
  if (!isNonEmptyString(body.name, 120)) errors.push('name is required (1-120 characters)');
  if (!isValidEmail(body.email)) errors.push('a valid email is required');
  if (!isValidPassword(body.password)) errors.push('password must be at least 8 characters');
  return { valid: errors.length === 0, errors };
}

function validateLogin(body = {}) {
  const errors = [];
  if (!isValidEmail(body.email)) errors.push('a valid email is required');
  if (!isNonEmptyString(body.password, 128)) errors.push('password is required');
  return { valid: errors.length === 0, errors };
}

function validateTransaction(body = {}) {
  const errors = [];
  if (!isValidTransactionType(body.type)) {
    errors.push("type must be either 'income' or 'expense'");
  }
  if (!isValidAmount(body.amount)) {
    errors.push('amount must be a positive number with at most 2 decimal places');
  }
  if (!isNonEmptyString(body.category, 60)) {
    errors.push('category is required');
  }
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    errors.push('description must be a string');
  }
  if (body.transaction_date !== undefined && !isValidDate(body.transaction_date)) {
    errors.push('transaction_date must be a valid YYYY-MM-DD date');
  }
  return { valid: errors.length === 0, errors };
}

function validateBudget(body = {}) {
  const errors = [];
  if (!isNonEmptyString(body.category, 60)) errors.push('category is required');
  if (!isValidAmount(body.amount)) errors.push('amount must be a positive number');
  if (!isValidMonth(body.month)) errors.push('month must be an integer between 1 and 12');
  if (!isValidYear(body.year)) errors.push('year must be an integer between 2000 and 2100');
  return { valid: errors.length === 0, errors };
}

module.exports = {
  TRANSACTION_TYPES,
  CATEGORIES,
  isNonEmptyString,
  isValidEmail,
  isValidPassword,
  isValidAmount,
  isValidTransactionType,
  isValidDate,
  isValidMonth,
  isValidYear,
  validateRegistration,
  validateLogin,
  validateTransaction,
  validateBudget,
};
