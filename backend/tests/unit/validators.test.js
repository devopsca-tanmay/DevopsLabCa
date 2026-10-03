'use strict';

const v = require('../../src/utils/validators');

describe('validators - email', () => {
  test.each([
    'user@example.com',
    'first.last@sub.domain.co.in',
    'name+tag@example.org',
  ])('accepts %s', (email) => {
    expect(v.isValidEmail(email)).toBe(true);
  });

  test.each([
    ['missing an @', 'userexample.com'],
    ['missing a domain', 'user@'],
    ['missing a TLD', 'user@example'],
    ['containing a space', 'us er@example.com'],
    ['empty', ''],
    ['not a string', 12345],
    ['null', null],
  ])('rejects an address %s', (_label, email) => {
    expect(v.isValidEmail(email)).toBe(false);
  });
});

describe('validators - password', () => {
  test('accepts a password of at least 8 characters', () => {
    expect(v.isValidPassword('correct-horse')).toBe(true);
  });

  test('rejects a password shorter than 8 characters', () => {
    expect(v.isValidPassword('short12')).toBe(false);
  });

  test('rejects a password longer than 128 characters', () => {
    expect(v.isValidPassword('a'.repeat(129))).toBe(false);
  });

  test('rejects non-string input', () => {
    expect(v.isValidPassword(null)).toBe(false);
    expect(v.isValidPassword(12345678)).toBe(false);
  });
});

describe('validators - amount', () => {
  test('accepts positive numbers with up to 2 decimal places', () => {
    expect(v.isValidAmount(100)).toBe(true);
    expect(v.isValidAmount(1500.5)).toBe(true);
    expect(v.isValidAmount(0.01)).toBe(true);
  });

  test('accepts a numeric string, as sent by an HTML form', () => {
    expect(v.isValidAmount('250.75')).toBe(true);
  });

  test('rejects zero and negative amounts', () => {
    expect(v.isValidAmount(0)).toBe(false);
    expect(v.isValidAmount(-50)).toBe(false);
  });

  test('rejects more than 2 decimal places', () => {
    expect(v.isValidAmount(10.555)).toBe(false);
  });

  test('rejects non-finite and non-numeric values', () => {
    expect(v.isValidAmount(Infinity)).toBe(false);
    expect(v.isValidAmount(NaN)).toBe(false);
    expect(v.isValidAmount('abc')).toBe(false);
    expect(v.isValidAmount(undefined)).toBe(false);
  });
});

describe('validators - transaction type', () => {
  test('accepts the two supported types', () => {
    expect(v.isValidTransactionType('income')).toBe(true);
    expect(v.isValidTransactionType('expense')).toBe(true);
  });

  test('rejects anything else, including case variants', () => {
    expect(v.isValidTransactionType('Income')).toBe(false);
    expect(v.isValidTransactionType('transfer')).toBe(false);
    expect(v.isValidTransactionType('')).toBe(false);
  });
});

describe('validators - date', () => {
  test('accepts a real YYYY-MM-DD date', () => {
    expect(v.isValidDate('2026-10-03')).toBe(true);
    expect(v.isValidDate('2024-02-29')).toBe(true); // leap year
  });

  test('rejects a calendar-impossible date', () => {
    expect(v.isValidDate('2026-02-31')).toBe(false);
    expect(v.isValidDate('2026-13-01')).toBe(false);
    expect(v.isValidDate('2025-02-29')).toBe(false); // not a leap year
  });

  test('rejects wrong formats', () => {
    expect(v.isValidDate('03-10-2026')).toBe(false);
    expect(v.isValidDate('2026/10/03')).toBe(false);
    expect(v.isValidDate('')).toBe(false);
    expect(v.isValidDate(null)).toBe(false);
  });
});

describe('validators - month and year', () => {
  test('month accepts 1 through 12', () => {
    expect(v.isValidMonth(1)).toBe(true);
    expect(v.isValidMonth(12)).toBe(true);
    expect(v.isValidMonth('6')).toBe(true);
  });

  test('month rejects out-of-range and fractional values', () => {
    expect(v.isValidMonth(0)).toBe(false);
    expect(v.isValidMonth(13)).toBe(false);
    expect(v.isValidMonth(6.5)).toBe(false);
  });

  test('year accepts the supported 2000-2100 window', () => {
    expect(v.isValidYear(2026)).toBe(true);
    expect(v.isValidYear(1999)).toBe(false);
    expect(v.isValidYear(2101)).toBe(false);
  });
});

describe('validators - validateRegistration', () => {
  test('accepts a complete, valid payload', () => {
    const result = v.validateRegistration({
      name: 'Asha Rao', email: 'asha@example.com', password: 'super-secret',
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  test('reports every problem at once rather than stopping at the first', () => {
    const result = v.validateRegistration({ name: '', email: 'nope', password: '123' });
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(3);
  });

  test('rejects a completely empty body without throwing', () => {
    expect(v.validateRegistration({}).valid).toBe(false);
    expect(v.validateRegistration().valid).toBe(false);
  });
});

describe('validators - validateTransaction', () => {
  const valid = {
    type: 'expense', amount: 1200.5, category: 'Food',
    description: 'Groceries', transaction_date: '2026-10-01',
  };

  test('accepts a complete, valid transaction', () => {
    expect(v.validateTransaction(valid)).toEqual({ valid: true, errors: [] });
  });

  test('transaction_date is optional - the API defaults it to today', () => {
    const { transaction_date: _omitted, ...withoutDate } = valid;
    expect(v.validateTransaction(withoutDate).valid).toBe(true);
  });

  test('rejects an unsupported type', () => {
    const result = v.validateTransaction({ ...valid, type: 'transfer' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/type/);
  });

  test('rejects a negative amount', () => {
    const result = v.validateTransaction({ ...valid, amount: -10 });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/amount/);
  });

  test('rejects a missing category', () => {
    const result = v.validateTransaction({ ...valid, category: '   ' });
    expect(result.valid).toBe(false);
  });

  test('rejects an impossible transaction_date', () => {
    const result = v.validateTransaction({ ...valid, transaction_date: '2026-02-31' });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/transaction_date/);
  });
});

describe('validators - validateBudget', () => {
  const valid = { category: 'Food', amount: 10000, month: 10, year: 2026 };

  test('accepts a complete, valid budget', () => {
    expect(v.validateBudget(valid)).toEqual({ valid: true, errors: [] });
  });

  test('rejects an out-of-range month', () => {
    expect(v.validateBudget({ ...valid, month: 0 }).valid).toBe(false);
    expect(v.validateBudget({ ...valid, month: 13 }).valid).toBe(false);
  });

  test('rejects an out-of-range year', () => {
    expect(v.validateBudget({ ...valid, year: 1990 }).valid).toBe(false);
  });

  test('rejects a zero amount', () => {
    expect(v.validateBudget({ ...valid, amount: 0 }).valid).toBe(false);
  });
});

describe('validators - exported category list', () => {
  test('exposes both income and expense categories used by the UI', () => {
    expect(v.CATEGORIES).toContain('Salary');
    expect(v.CATEGORIES).toContain('Food');
    expect(v.CATEGORIES.length).toBeGreaterThan(5);
  });

  test('transaction types are exactly income and expense', () => {
    expect(v.TRANSACTION_TYPES).toEqual(['income', 'expense']);
  });
});
