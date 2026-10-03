'use strict';

const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

describe('Dashboard API', () => {
  let auth;

  beforeAll(async () => {
    await helpers.createSchema();
  });

  beforeEach(async () => {
    await helpers.resetDatabase();
    const testUser = await helpers.registerTestUser(request, app);
    auth = helpers.authHeader(testUser.token);
  });

  afterAll(async () => {
    await helpers.closeDatabase();
  });

  /** Seeds a ledger in the CURRENT month so budget joins line up. */
  async function seedLedger() {
    const now = new Date();
    const month = now.getUTCMonth() + 1;
    const year = now.getUTCFullYear();
    const day = `${year}-${String(month).padStart(2, '0')}-01`;

    const rows = [
      { type: 'income', amount: 120000, category: 'Salary', transaction_date: day },
      { type: 'expense', amount: 8000, category: 'Food', transaction_date: day },
      { type: 'expense', amount: 27000, category: 'Bills', transaction_date: day },
    ];
    for (const row of rows) {
      await request(app).post('/api/transactions').set(auth).send(row);
    }
    await request(app)
      .post('/api/budgets')
      .set(auth)
      .send({ category: 'Food', amount: 10000, month, year });
  }

  test('requires authentication', async () => {
    const res = await request(app).get('/api/dashboard');

    expect(res.status).toBe(401);
  });

  test('returns a complete, zeroed dashboard for a brand new account', async () => {
    const res = await request(app).get('/api/dashboard').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalIncome: 0,
      totalExpenses: 0,
      balance: 0,
      savingsRate: 0,
      transactionCount: 0,
    });
    expect(res.body.categoryBreakdown).toEqual([]);
    expect(res.body.healthScore).toHaveProperty('score');
  });

  test('summary totals reflect the seeded ledger', async () => {
    await seedLedger();
    const res = await request(app).get('/api/dashboard').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      totalIncome: 120000,
      totalExpenses: 35000,
      balance: 85000,
      savingsRate: 70.83,
      transactionCount: 3,
    });
  });

  test('expense categories are broken down largest first', async () => {
    await seedLedger();
    const res = await request(app).get('/api/dashboard').set(auth);

    expect(res.body.categoryBreakdown[0]).toMatchObject({ category: 'Bills', amount: 27000 });
    expect(res.body.categoryBreakdown[1]).toMatchObject({ category: 'Food', amount: 8000 });
  });

  test('budget usage joins the Food budget against actual Food spending', async () => {
    await seedLedger();
    const res = await request(app).get('/api/dashboard').set(auth);

    const food = res.body.budgetUsage.find((b) => b.category === 'Food');
    expect(food).toMatchObject({ budgeted: 10000, spent: 8000, percentage: 80, status: 'warning' });
  });

  test('includes a health score with a rating and a disclaimer', async () => {
    await seedLedger();
    const res = await request(app).get('/api/dashboard').set(auth);

    expect(res.body.healthScore.score).toBeGreaterThanOrEqual(0);
    expect(res.body.healthScore.score).toBeLessThanOrEqual(100);
    expect(typeof res.body.healthScore.rating).toBe('string');
    expect(res.body.healthScore.disclaimer).toMatch(/not financial advice/i);
  });

  test('includes the income-vs-expenses monthly trend', async () => {
    await seedLedger();
    const res = await request(app).get('/api/dashboard').set(auth);

    expect(Array.isArray(res.body.monthlyTrend)).toBe(true);
    expect(res.body.monthlyTrend.length).toBeGreaterThan(0);
    expect(res.body.monthlyTrend[0]).toHaveProperty('income');
    expect(res.body.monthlyTrend[0]).toHaveProperty('expenses');
  });

  test('one user dashboard is unaffected by another user data', async () => {
    await seedLedger();
    const other = await helpers.registerTestUser(request, app, { email: 'other5@example.com' });

    const res = await request(app).get('/api/dashboard').set(helpers.authHeader(other.token));

    expect(res.body.summary.transactionCount).toBe(0);
    expect(res.body.summary.balance).toBe(0);
  });
});
