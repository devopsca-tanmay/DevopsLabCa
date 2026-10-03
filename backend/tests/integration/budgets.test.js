'use strict';

const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

describe('Budgets API', () => {
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

  const budget = { category: 'Food', amount: 10000, month: 10, year: 2026 };

  describe('POST /api/budgets', () => {
    test('creates a budget', async () => {
      const res = await request(app).post('/api/budgets').set(auth).send(budget);

      expect(res.status).toBe(201);
      expect(res.body.budget).toMatchObject(budget);
      expect(res.body.budget.id).toEqual(expect.any(Number));
    });

    test('rejects a duplicate category for the same month with 409', async () => {
      await request(app).post('/api/budgets').set(auth).send(budget);
      const res = await request(app).post('/api/budgets').set(auth).send(budget);

      expect(res.status).toBe(409);
    });

    test('allows the same category in a different month', async () => {
      await request(app).post('/api/budgets').set(auth).send(budget);
      const res = await request(app)
        .post('/api/budgets')
        .set(auth)
        .send({ ...budget, month: 11 });

      expect(res.status).toBe(201);
    });

    test('rejects an out-of-range month with 400', async () => {
      const res = await request(app)
        .post('/api/budgets')
        .set(auth)
        .send({ ...budget, month: 13 });

      expect(res.status).toBe(400);
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/budgets').send(budget);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/budgets', () => {
    beforeEach(async () => {
      await request(app).post('/api/budgets').set(auth).send(budget);
      await request(app)
        .post('/api/budgets')
        .set(auth)
        .send({ category: 'Transport', amount: 5000, month: 10, year: 2026 });
      await request(app)
        .post('/api/budgets')
        .set(auth)
        .send({ category: 'Food', amount: 12000, month: 11, year: 2026 });
    });

    test('lists every budget for the user', async () => {
      const res = await request(app).get('/api/budgets').set(auth);

      expect(res.status).toBe(200);
      expect(res.body.budgets).toHaveLength(3);
    });

    test('filters by month and year', async () => {
      const res = await request(app).get('/api/budgets?month=10&year=2026').set(auth);

      expect(res.body.budgets).toHaveLength(2);
      expect(res.body.budgets.every((b) => b.month === 10)).toBe(true);
    });

    test('does not return another user budgets', async () => {
      const other = await helpers.registerTestUser(request, app, { email: 'other3@example.com' });
      const res = await request(app).get('/api/budgets').set(helpers.authHeader(other.token));

      expect(res.body.budgets).toHaveLength(0);
    });
  });

  describe('PUT /api/budgets/:id', () => {
    test('updates a budget amount', async () => {
      const created = await request(app).post('/api/budgets').set(auth).send(budget);

      const res = await request(app)
        .put(`/api/budgets/${created.body.budget.id}`)
        .set(auth)
        .send({ ...budget, amount: 15000 });

      expect(res.status).toBe(200);
      expect(res.body.budget.amount).toBe(15000);
    });

    test('returns 404 for a budget that does not exist', async () => {
      const res = await request(app).put('/api/budgets/999999').set(auth).send(budget);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/budgets/:id', () => {
    test('deletes a budget', async () => {
      const created = await request(app).post('/api/budgets').set(auth).send(budget);

      const res = await request(app)
        .delete(`/api/budgets/${created.body.budget.id}`)
        .set(auth);
      expect(res.status).toBe(200);

      const remaining = await request(app).get('/api/budgets').set(auth);
      expect(remaining.body.budgets).toHaveLength(0);
    });

    test('returns 404 when deleting a budget owned by another user', async () => {
      const created = await request(app).post('/api/budgets').set(auth).send(budget);
      const other = await helpers.registerTestUser(request, app, { email: 'other4@example.com' });

      const res = await request(app)
        .delete(`/api/budgets/${created.body.budget.id}`)
        .set(helpers.authHeader(other.token));

      expect(res.status).toBe(404);
    });
  });
});
