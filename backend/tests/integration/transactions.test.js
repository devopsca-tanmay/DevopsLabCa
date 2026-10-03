'use strict';

const helpers = require('../helpers/setup');
const request = require('supertest');
const app = require('../../src/app');

describe('Transactions API', () => {
  let token;
  let auth;

  beforeAll(async () => {
    await helpers.createSchema();
  });

  beforeEach(async () => {
    await helpers.resetDatabase();
    const testUser = await helpers.registerTestUser(request, app);
    token = testUser.token;
    auth = helpers.authHeader(token);
  });

  afterAll(async () => {
    await helpers.closeDatabase();
  });

  const expense = {
    type: 'expense',
    amount: 1250.5,
    category: 'Food',
    description: 'Weekly groceries',
    transaction_date: '2026-10-01',
  };

  // -------------------------------------------------------------------------
  describe('POST /api/transactions', () => {
    test('creates a transaction and echoes it back with an id', async () => {
      const res = await request(app).post('/api/transactions').set(auth).send(expense);

      expect(res.status).toBe(201);
      expect(res.body.transaction).toMatchObject({
        type: 'expense',
        amount: 1250.5,
        category: 'Food',
        description: 'Weekly groceries',
        transaction_date: '2026-10-01',
      });
      expect(res.body.transaction.id).toEqual(expect.any(Number));
    });

    test('defaults transaction_date to today when it is omitted', async () => {
      const { transaction_date: _omitted, ...withoutDate } = expense;
      const res = await request(app).post('/api/transactions').set(auth).send(withoutDate);

      expect(res.status).toBe(201);
      expect(res.body.transaction.transaction_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('rejects a negative amount with 400', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set(auth)
        .send({ ...expense, amount: -100 });

      expect(res.status).toBe(400);
      expect(res.body.details.join(' ')).toMatch(/amount/);
    });

    test('rejects an unsupported type with 400', async () => {
      const res = await request(app)
        .post('/api/transactions')
        .set(auth)
        .send({ ...expense, type: 'transfer' });

      expect(res.status).toBe(400);
    });

    test('requires authentication', async () => {
      const res = await request(app).post('/api/transactions').send(expense);

      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/transactions', () => {
    beforeEach(async () => {
      const rows = [
        { type: 'income', amount: 50000, category: 'Salary', transaction_date: '2026-09-01' },
        { type: 'expense', amount: 8000, category: 'Food', transaction_date: '2026-09-15' },
        { type: 'expense', amount: 4000, category: 'Transport', transaction_date: '2026-10-02' },
      ];
      for (const row of rows) {
        await request(app).post('/api/transactions').set(auth).send(row);
      }
    });

    test('lists every transaction for the authenticated user', async () => {
      const res = await request(app).get('/api/transactions').set(auth);

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(3);
      expect(res.body.count).toBe(3);
    });

    test('returns newest transactions first', async () => {
      const res = await request(app).get('/api/transactions').set(auth);
      const dates = res.body.transactions.map((t) => t.transaction_date);

      expect(dates).toEqual([...dates].sort().reverse());
    });

    test('filters by type', async () => {
      const res = await request(app).get('/api/transactions?type=expense').set(auth);

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(2);
      expect(res.body.transactions.every((t) => t.type === 'expense')).toBe(true);
    });

    test('filters by category', async () => {
      const res = await request(app).get('/api/transactions?category=Food').set(auth);

      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.transactions[0].category).toBe('Food');
    });

    test('filters by date range', async () => {
      const res = await request(app)
        .get('/api/transactions?from=2026-09-10&to=2026-09-30')
        .set(auth);

      expect(res.body.transactions).toHaveLength(1);
      expect(res.body.transactions[0].category).toBe('Food');
    });

    test('rejects an invalid filter value with 400', async () => {
      const res = await request(app).get('/api/transactions?type=nonsense').set(auth);

      expect(res.status).toBe(400);
    });

    test('never leaks another user transactions', async () => {
      const other = await helpers.registerTestUser(request, app, { email: 'other@example.com' });
      const res = await request(app).get('/api/transactions').set(helpers.authHeader(other.token));

      expect(res.status).toBe(200);
      expect(res.body.transactions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /api/transactions/:id', () => {
    test('returns a single transaction by id', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const id = created.body.transaction.id;

      const res = await request(app).get(`/api/transactions/${id}`).set(auth);

      expect(res.status).toBe(200);
      expect(res.body.transaction.id).toBe(id);
    });

    test('returns 404 for an id that does not exist', async () => {
      const res = await request(app).get('/api/transactions/999999').set(auth);

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /api/transactions/:id', () => {
    test('updates an existing transaction', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const id = created.body.transaction.id;

      const res = await request(app)
        .put(`/api/transactions/${id}`)
        .set(auth)
        .send({ ...expense, amount: 999.99, category: 'Shopping' });

      expect(res.status).toBe(200);
      expect(res.body.transaction).toMatchObject({ id, amount: 999.99, category: 'Shopping' });
    });

    test('the update is actually persisted', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const id = created.body.transaction.id;

      await request(app)
        .put(`/api/transactions/${id}`)
        .set(auth)
        .send({ ...expense, amount: 42 });
      const reread = await request(app).get(`/api/transactions/${id}`).set(auth);

      expect(reread.body.transaction.amount).toBe(42);
    });

    test('returns 404 when updating a transaction owned by another user', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const other = await helpers.registerTestUser(request, app, { email: 'thief@example.com' });

      const res = await request(app)
        .put(`/api/transactions/${created.body.transaction.id}`)
        .set(helpers.authHeader(other.token))
        .send({ ...expense, amount: 1 });

      expect(res.status).toBe(404);
    });

    test('rejects an invalid update payload with 400', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);

      const res = await request(app)
        .put(`/api/transactions/${created.body.transaction.id}`)
        .set(auth)
        .send({ ...expense, amount: 0 });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('DELETE /api/transactions/:id', () => {
    test('deletes a transaction and it is gone afterwards', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const id = created.body.transaction.id;

      const res = await request(app).delete(`/api/transactions/${id}`).set(auth);
      expect(res.status).toBe(200);

      const reread = await request(app).get(`/api/transactions/${id}`).set(auth);
      expect(reread.status).toBe(404);
    });

    test('returns 404 when deleting something that does not exist', async () => {
      const res = await request(app).delete('/api/transactions/999999').set(auth);

      expect(res.status).toBe(404);
    });

    test('cannot delete a transaction owned by another user', async () => {
      const created = await request(app).post('/api/transactions').set(auth).send(expense);
      const other = await helpers.registerTestUser(request, app, { email: 'other2@example.com' });

      const res = await request(app)
        .delete(`/api/transactions/${created.body.transaction.id}`)
        .set(helpers.authHeader(other.token));

      expect(res.status).toBe(404);

      // The original owner can still see it.
      const stillThere = await request(app)
        .get(`/api/transactions/${created.body.transaction.id}`)
        .set(auth);
      expect(stillThere.status).toBe(200);
    });
  });
});
